import importlib.util
import json
import os
from pathlib import Path
import tempfile
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('alex_policy', Path(__file__).resolve().parents[1] / 'electron/hermes-rate-limit.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def limit(message='Please try again in 3.976s.', headers=None, **fields):
    error = Exception('provider rejection')
    error.status_code = 429
    error.response = SimpleNamespace(status_code=429, headers=headers or {})
    error.body = {'error': {'code': 'rate_limit_exceeded', 'type': 'tokens', 'message': message, **fields}}
    return error


class RetryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = os.environ.get('ALEX_RECOVERY_DIR')
        os.environ['ALEX_RECOVERY_DIR'] = self.temp.name
        self.agent = SimpleNamespace(session_id='exact-session', _interrupt_requested=False, _current_streamed_assistant_text='', client=SimpleNamespace(max_retries=0))
        self.file = Path(self.temp.name) / (policy.hashlib.sha256(b'exact-session').hexdigest() + '.json')
        self.file.write_text(json.dumps({'active': True, 'runId': 'original-run', 'sessionId': self.agent.session_id}))
        self.now = 0
        self.calls = []
        self.request = {'messages': [{'role': 'user', 'content': '原始需求'}, {'role': 'tool', 'content': '已暂存，精确ID：a'}], 'tools': [{'name': 'write'}]}

    def tearDown(self):
        if self.previous is None: os.environ.pop('ALEX_RECOVERY_DIR', None)
        else: os.environ['ALEX_RECOVERY_DIR'] = self.previous
        self.temp.cleanup()

    def sleep(self, seconds): self.now += seconds

    def run_policy(self, error, failures=1, sleep=None):
        def call(request):
            self.assertIs(request, self.request)
            self.calls.append((self.now, json.dumps(request, sort_keys=True)))
            if len(self.calls) <= failures: raise error
            return 'complete'
        return policy.execute(self.agent, self.request, call, clock=lambda: self.now, sleep=sleep or self.sleep, jitter=lambda: .25)

    def test_production_hint_and_exact_request_no_tool_replay(self):
        self.assertEqual(self.run_policy(limit()), 'complete')
        self.assertGreaterEqual(self.calls[1][0], 3.976)
        self.assertEqual(self.calls[0][1], self.calls[1][1])
        self.assertEqual(json.loads(Path(str(self.file)+'.status').read_text())['status'], 'recovered')

    def test_structured_header_precedes_body(self):
        self.run_policy(limit(headers={'retry-after': '12.5'}, retry_after=5))
        self.assertGreaterEqual(self.calls[1][0], 12.5)

    def test_dates_reset_and_invalid_hints(self):
        self.assertEqual(policy.retry_after(limit(headers={'retry-after': 'Thu, 01 Jan 1970 00:00:15 GMT'}), wall=lambda: 10), 5)
        self.assertEqual(policy.retry_after(limit(headers={'x-ratelimit-reset-tokens': '2m'})), 120)
        self.assertEqual(policy.retry_after(limit(headers={'retry-after': 'nan'}, retry_after=4)), 4)
        for value in ['nan', 'inf', -2]: self.assertIsNone(policy.positive(value))

    def test_missing_hint_uses_backoff(self):
        self.run_policy(limit(message='Rate limited'), failures=2)
        self.assertGreaterEqual(self.calls[1][0]-self.calls[0][0], 2)
        self.assertGreaterEqual(self.calls[2][0]-self.calls[1][0], 4)

    def test_long_hint_never_shortened(self):
        with self.assertRaisesRegex(policy.RecoveryStopped, 'budget'):
            self.run_policy(limit(headers={'retry-after': '601'}))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.now, 0)

    def test_continuous_limits_bounded_once(self):
        with self.assertRaisesRegex(policy.RecoveryStopped, 'budget'):
            self.run_policy(limit(message='Rate limited'), failures=100)
        self.assertEqual(len(self.calls), 6)
        self.assertLessEqual(self.now, 180)

    def test_one_request_exceeds_capacity(self):
        with self.assertRaisesRegex(policy.RecoveryStopped, 'exceeds-token-limit'):
            self.run_policy(limit(message='Limit 1000000, Used 0, Requested 1000001. Please try again in 1s.'))
        self.assertEqual(len(self.calls), 1)

    def test_cancel_during_wait(self):
        def sleep(seconds): self.sleep(seconds); self.agent._interrupt_requested = True
        with self.assertRaisesRegex(policy.RecoveryStopped, 'cancelled'): self.run_policy(limit(), sleep=sleep)
        self.assertEqual(len(self.calls), 1)
        self.assertLess(self.now, .3)

    def test_cancel_during_last_sleep_does_not_send_extra_request(self):
        def sleep(seconds):
            self.sleep(seconds)
            if self.now >= 4.226: self.agent._interrupt_requested = True
        with self.assertRaisesRegex(policy.RecoveryStopped, 'cancelled'): self.run_policy(limit(), sleep=sleep)
        self.assertEqual(len(self.calls), 1)

    def test_compacted_physical_session_uses_native_lineage(self):
        self.agent.session_id='physical-after-compression'
        resolved=[]
        def logical(db, physical):
            resolved.append((db,physical));return 'exact-session'
        with patch.dict(sys.modules, {'acp_adapter.catalog': SimpleNamespace(logical_session_id=logical),
                                     'hermes_constants': SimpleNamespace(get_hermes_home=lambda: Path(self.temp.name))}):
            self.assertEqual(self.run_policy(limit()), 'complete')
        self.assertEqual(resolved, [(Path(self.temp.name)/'state.db',self.agent.session_id)])
        self.assertEqual(json.loads(Path(str(self.file)+'.status').read_text())['sessionId'],'exact-session')

    def test_replaced_turn_cannot_retry(self):
        def sleep(seconds): self.sleep(seconds); self.file.write_text(json.dumps({'active': True, 'runId': 'next-run'}))
        with self.assertRaisesRegex(policy.RecoveryStopped, 'cancelled'): self.run_policy(limit(), sleep=sleep)
        self.assertEqual(len(self.calls), 1)

    def test_inactive_owned_session_never_starts_a_request(self):
        self.file.write_text(json.dumps({'active':False,'runId':'original-run','sessionId':self.agent.session_id}))
        with self.assertRaisesRegex(policy.RecoveryStopped,'cancelled'): self.run_policy(limit())
        self.assertEqual(self.calls,[])

    def test_corrupt_owned_descriptor_fails_closed(self):
        self.file.write_text('{corrupt')
        with self.assertRaisesRegex(policy.RecoveryStopped,'channel-unavailable'): self.run_policy(limit())
        self.assertEqual(self.calls,[])

    def test_partial_does_not_replay(self):
        self.agent._current_streamed_assistant_text = 'partial'
        with self.assertRaisesRegex(policy.RecoveryStopped, 'partial'): self.run_policy(limit())
        self.assertEqual(len(self.calls), 1)
        self.calls.clear()
        with self.assertRaisesRegex(policy.RecoveryStopped, 'partial'): self.run_policy(ConnectionError('stream disconnected'))
        self.assertEqual(len(self.calls), 1)

    def test_ambiguous_transport_and_native_partial_stub_do_not_retry(self):
        with self.assertRaisesRegex(policy.RecoveryStopped, 'outcome-unknown'):
            self.run_policy(ConnectionError('request outcome unknown'))
        self.assertEqual(len(self.calls),1)
        self.calls.clear()
        with self.assertRaisesRegex(policy.RecoveryStopped, 'partial-response'):
            self.run_policy(policy.RecoveryStopped('partial-response'))
        self.assertEqual(len(self.calls),1)
        self.assertFalse(self.agent._alex_request_recovery_active)
        self.assertEqual(json.loads(Path(str(self.file)+'.status').read_text())['reason'],'partial-response')

    def test_quota_and_sdk_attempts_do_not_multiply(self):
        with self.assertRaisesRegex(policy.RecoveryStopped, 'non-transient'): self.run_policy(limit(code='insufficient_quota'))
        self.assertEqual(len(self.calls), 1)
        self.calls.clear(); self.agent.client.max_retries = 2
        with self.assertRaisesRegex(policy.RecoveryStopped, 'sdk-retry'): self.run_policy(limit())
        self.assertEqual(len(self.calls), 1)

    def test_unrelated_errors_and_sessions_unchanged(self):
        with self.assertRaisesRegex(ValueError, 'parameter'): self.run_policy(ValueError('parameter'))
        self.assertEqual(len(self.calls), 1)

    def responses(self, events):
        class APIError(Exception):
            def __init__(self, body): self.body = body
        with patch.dict(sys.modules, {'openai': SimpleNamespace(APIError=APIError)}):
            yield from policy.observe_responses(self.agent, events)

    def test_responses_error_frame_waits_without_losing_request(self):
        event = {'type':'error','code':'rate_limit_exceeded','message':'tokens per min (TPM): Limit 1000000, Used 625675, Requested 440588. Please try again in 3.976s.'}
        self.agent._current_streamed_assistant_text = 'previous successful request in same turn'
        def call(request):
            self.calls.append((self.now,json.dumps(request,sort_keys=True)))
            events = [{'type':'response.created'},event] if len(self.calls)==1 else [{'type':'response.completed'}]
            return list(self.responses(events))
        policy.execute(self.agent,self.request,call,clock=lambda:self.now,sleep=self.sleep,jitter=lambda:0)
        self.assertEqual(len(self.calls),2)
        self.assertEqual(self.calls[0][1],self.calls[1][1])
        self.assertGreaterEqual(self.calls[1][0],3.976)
        waiting=json.loads(Path(str(self.file)+'.events').read_text().splitlines()[0])
        self.assertEqual(waiting['providerEvidence'],'responses-error-event')
        self.assertEqual(waiting['failure']['tokensRequested'],440588)
        self.assertNotIn('message',waiting['failure'])

    def test_responses_sdk_error_preserves_code(self):
        class APIError(Exception):
            def __init__(self,body): self.body=body
        def stream():
            yield {'type':'response.created'}
            raise APIError({'code':'rate_limit_exceeded','message':'Please try again in 2s.'})
        self.agent._alex_request_recovery_active=True
        with patch.dict(sys.modules, {'openai':SimpleNamespace(APIError=APIError)}):
            with self.assertRaises(policy.ResponsesRejected) as caught:
                list(policy.observe_responses(self.agent,stream()))
        self.assertTrue(policy.transient_limit(caught.exception))
        self.assertIsNone(getattr(caught.exception,'status_code',None))
        self.assertEqual(policy.retry_after(caught.exception),2)

    def test_responses_failed_and_quota_are_not_transport_errors(self):
        self.agent._alex_request_recovery_active=True
        for code,reason in [('rate_limit_exceeded','rate-limit'),('insufficient_quota','quota'),('server_error','unclassified')]:
            with self.assertRaises(policy.ResponsesRejected) as caught:
                list(self.responses([{'type':'response.failed','response':{'output':[],'error':{'code':code,'message':'private provider detail'}}}]))
            diagnostic=policy.provider_diagnostic(caught.exception)
            self.assertEqual(diagnostic['failure']['reason'],reason)
            self.assertEqual(diagnostic['providerCode'],code)
            self.assertNotIn('private provider detail',json.dumps(diagnostic))
            if code!='rate_limit_exceeded':self.assertFalse(policy.transient_limit(caught.exception))

    def test_responses_any_partial_output_forbids_replay(self):
        self.agent._alex_request_recovery_active=True
        for event in [{'type':'response.output_text.delta','delta':'text'},
                      {'type':'response.reasoning_text.delta','delta':'thinking'},
                      {'type':'response.output_item.added','item':{'type':'function_call','call_id':'exact'}}]:
            with self.assertRaisesRegex(policy.RecoveryStopped,'partial-response'):
                list(self.responses([event,{'type':'error','code':'rate_limit_exceeded'}]))
        with self.assertRaisesRegex(policy.RecoveryStopped,'outcome-unknown'):
            list(self.responses([{'type':'response.failed','response':{'error':{'code':'rate_limit_exceeded'}}}]))

    def test_responses_eof_never_becomes_success(self):
        self.agent._alex_request_recovery_active=True
        with self.assertRaisesRegex(policy.RecoveryStopped,'outcome-unknown'):
            list(self.responses([{'type':'response.created'}]))
        with self.assertRaisesRegex(policy.RecoveryStopped,'partial-response'):
            list(self.responses([{'type':'response.output_text.delta','delta':'unfinished'}]))

    def test_responses_budget_and_quota_stop_with_structured_evidence(self):
        def call(_):
            self.calls.append(self.now)
            return list(self.responses([{'type':'error','code':code,'message':'Please try again in 3.976s.'}]))
        for code,reason,expected_calls in [('rate_limit_exceeded','rate-limit-budget',6),('insufficient_quota','non-transient-limit',1)]:
            self.calls=[]
            with self.assertRaisesRegex(policy.RecoveryStopped,reason):
                policy.execute(self.agent,self.request,call,clock=lambda:self.now,sleep=self.sleep,jitter=lambda:0)
            self.assertEqual(len(self.calls),expected_calls)
            status=json.loads(Path(str(self.file)+'.status').read_text())
            self.assertEqual(status['providerCode'],code)

    def test_responses_outside_owned_request_keeps_original_stream(self):
        event={'type':'error','code':'rate_limit_exceeded'}
        self.assertEqual(list(self.responses([event])),[event])
        self.file.unlink(); self.calls.clear()
        with self.assertRaisesRegex(Exception, 'provider rejection'): self.run_policy(limit())
        self.assertEqual(len(self.calls), 1)

    def test_plain_text_and_empty_http_429_retry_while_quota_wall_stops(self):
        def http_error(status_code, body=None, headers=None, message='HTTP error'):
            err = Exception(message)
            err.status_code = status_code
            err.response = SimpleNamespace(status_code=status_code, headers=headers or {})
            err.body = body
            return err

        plain_429 = http_error(429, None, {'retry-after': '4'}, 'Too Many Requests')
        self.assertEqual(self.run_policy(plain_429), 'complete')
        self.assertEqual(len(self.calls), 2)
        self.assertGreaterEqual(self.calls[1][0], 4.0)

        self.calls.clear()
        self.now = 0.0
        empty_429 = http_error(429, None, {}, 'HTTP 429')
        self.assertEqual(self.run_policy(empty_429), 'complete')
        self.assertEqual(len(self.calls), 2)
        self.assertGreaterEqual(self.calls[1][0], 2.0)

        for quota_msg in (
            'You exceeded your current quota, please check your plan and billing details.',
            'Daily limit reached for this account; resets tomorrow.',
        ):
            self.calls.clear()
            self.now = 0.0
            with self.assertRaisesRegex(policy.RecoveryStopped, 'non-transient-limit'):
                self.run_policy(http_error(429, {'message': quota_msg}, {}, quota_msg))
            self.assertEqual(len(self.calls), 1)
            status = json.loads(Path(str(self.file) + '.status').read_text())
            self.assertEqual(status['failure']['reason'], 'quota')
            self.assertFalse(status['candidateUncertain'])

    def test_responses_unknown_sse_error_does_not_generalize_into_rate_limit(self):
        def call(_):
            self.calls.append(self.now)
            return list(self.responses([{'type': 'error', 'code': 'unknown_vendor_error', 'message': 'unexpected schema'}]))
        with self.assertRaisesRegex(policy.RecoveryStopped, 'provider-rejected'):
            policy.execute(self.agent, self.request, call, clock=lambda: self.now, sleep=self.sleep, jitter=lambda: 0)
        self.assertEqual(len(self.calls), 1)
        status = json.loads(Path(str(self.file) + '.status').read_text())
        self.assertEqual(status['reason'], 'provider-rejected')
        self.assertEqual(status['providerEvidence'], 'responses-error-event')
        self.assertNotIn('providerCode', status)
        self.assertFalse(status['candidateUncertain'])

    def test_responses_context_overflow_delegates_without_faking_http_status_and_cleans_residual_status(self):
        attempt_no = 0
        def call(_):
            nonlocal attempt_no
            attempt_no += 1
            self.calls.append(self.now)
            if attempt_no == 1:
                return list(self.responses([{
                    'type': 'error',
                    'code': 'context_length_exceeded',
                    'message': 'Your input exceeds the context window of this model.',
                }]))
            return list(self.responses([
                {'type': 'response.output_text.delta', 'delta': 'compressed-ok'},
                {'type': 'response.completed', 'response': {'output': []}},
            ]))
        with self.assertRaises(policy.ResponsesRejected) as caught:
            policy.execute(self.agent, self.request, call, clock=lambda: self.now, sleep=self.sleep, jitter=lambda: 0)
        self.assertIsNone(getattr(caught.exception, 'status_code', None))
        delegated = json.loads(Path(str(self.file) + '.status').read_text())
        self.assertEqual(delegated['status'], 'delegated')
        self.assertEqual(delegated['reason'], 'native-overflow-recovery')
        self.assertEqual(delegated['providerEvidence'], 'responses-error-event')
        self.assertEqual(delegated['failure']['reason'], 'context-limit')
        self.assertFalse(delegated['candidateUncertain'])

        # Simulate native recover_from_overflow issuing a compressed retry in the SAME runId:
        events = policy.execute(self.agent, {'model': 'gpt-test', 'input': 'compressed'}, call, clock=lambda: self.now, sleep=self.sleep, jitter=lambda: 0)
        self.assertEqual(len(self.calls), 2)
        self.assertTrue(any(e.get('delta') == 'compressed-ok' for e in events))
        recovered = json.loads(Path(str(self.file) + '.status').read_text())
        self.assertEqual(recovered['status'], 'recovered')
        self.assertFalse(recovered['candidateUncertain'])

    def test_pre_output_5xx_retries_only_for_pure_inference_and_marks_server_tools_uncertain(self):
        def http_error(status_code, body=None, headers=None, message='HTTP error'):
            err = Exception(message)
            err.status_code = status_code
            err.response = SimpleNamespace(status_code=status_code, headers=headers or {})
            err.body = body
            return err

        pure_req = {'model': 'gpt-test', 'messages': [{'role': 'user', 'content': 'hi'}],
                    'tools': [{'type': 'function', 'function': {'name': 'protoflow_apply_tsx_patch'}}]}
        self.request = pure_req
        self.assertEqual(self.run_policy(http_error(502, None, {'retry-after': '3'}, 'Bad Gateway')), 'complete')
        self.assertEqual(len(self.calls), 2)
        self.assertGreaterEqual(self.calls[1][0], 3.0)

        self.calls.clear()
        self.now = 0.0
        with self.assertRaisesRegex(policy.RecoveryStopped, 'server-error-budget'):
            self.run_policy(http_error(502, {'code': 'bad_gateway'}, {}, 'Bad Gateway'), failures=6)
        self.assertEqual(len(self.calls), 6)
        budget_status = json.loads(Path(str(self.file) + '.status').read_text())
        self.assertFalse(budget_status['candidateUncertain'])
        self.assertEqual(budget_status['failure']['reason'], 'network')

        self.calls.clear()
        self.now = 0.0
        self.request = {'model': 'gpt-test', 'messages': [{'role': 'user', 'content': 'hi'}],
                        'tools': [{'type': 'web_search'}]}
        with self.assertRaisesRegex(policy.RecoveryStopped, 'request-outcome-unknown'):
            self.run_policy(http_error(502, None, {}, 'Bad Gateway'))
        self.assertEqual(len(self.calls), 1)
        uncertain_status = json.loads(Path(str(self.file) + '.status').read_text())
        self.assertTrue(uncertain_status['candidateUncertain'])
        self.assertTrue(uncertain_status.get('providerToolUncertain'))

    def test_pure_inference_request_merges_extra_body_overrides_and_fails_closed(self):
        def http_error(status_code, wire_body=None):
            err = Exception('Bad Gateway')
            err.status_code = status_code
            req_obj = SimpleNamespace(content=wire_body) if wire_body is not None else None
            err.request = req_obj
            err.response = SimpleNamespace(status_code=status_code, headers={}, request=req_obj)
            err.body = {'code': 'bad_gateway'}
            return err

        for unknown_shape in (
            None,
            'raw',
            [],
            {},
            {'model': 'gpt-test'},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'extra_body': 'not-a-dict'},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'request_overrides': ['bad']},
        ):
            self.assertFalse(policy.pure_inference_request(unknown_shape), repr(unknown_shape))

        for non_pure in (
            {'input': [{'role': 'user', 'content': 'hi'}], 'extra_body': {'tools': [{'type': 'web_search'}]}},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'extra_body': {'tools': [{'type': 'web_search_preview'}]}},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'request_overrides': {'extra_body': {'tools': [{'type': 'mcp', 'server_label': 's'}]}}},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'extra_body': {'mcp_servers': [{'url': 'https://mcp.invalid'}]}},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'extra_body': {'web_search_options': {}}},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'extra_body': {'plugins': [{'id': 'web'}]}},
            {'input': [{'role': 'user', 'content': 'hi'}], 'store': True},
            {'input': [{'role': 'user', 'content': 'hi'}], 'previous_response_id': 'resp_prev'},
            {'contents': ['hi'], 'tools': [{'google_search': {}}]},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'toolConfig': {'tools': [{'systemTool': {'name': 'nova_grounding'}}]}},
            {'messages': [{'role': 'user', 'content': 'hi'}], 'tools': [{'type': 'bash_20250124', 'name': 'bash'}]},
        ):
            self.assertFalse(policy.pure_inference_request(non_pure), repr(non_pure))

        override_agent = SimpleNamespace(request_overrides={'extra_body': {'tools': [{'type': 'web_search'}]}})
        self.assertFalse(policy.pure_inference_request(
            {'messages': [{'role': 'user', 'content': 'hi'}]},
            agent=override_agent,
        ))

        for pure in (
            {'messages': [], 'tools': [], 'extra_body': {
                'messages': [{'role': 'user', 'content': 'hi'}],
                'tools': [{'type': 'function', 'function': {'name': 'protoflow_apply_tsx_patch', 'parameters': {'type': 'object'}}}],
            }},
            {'input': [{'role': 'user', 'content': 'hi'}], 'store': False,
             'tools': [{'type': 'function', 'name': 'protoflow_apply_tsx_patch', 'parameters': {'type': 'object'}}]},
            {'messages': [{'role': 'user', 'content': 'hi'}],
             'tools': [{'name': 'protoflow_apply_tsx_patch', 'input_schema': {'type': 'object'}}]},
            {'messages': [{'role': 'user', 'content': 'hi'}],
             'toolConfig': {'tools': [{'toolSpec': {'name': 'protoflow_apply_tsx_patch'}}]}},
        ):
            self.assertTrue(policy.pure_inference_request(pure), repr(pure))

        self.calls.clear()
        self.now = 0.0
        self.request = {
            'model': 'gpt-test',
            'input': [{'role': 'user', 'content': 'hi'}],
            'extra_body': {'tools': [{'type': 'web_search'}]},
        }
        with self.assertRaisesRegex(policy.RecoveryStopped, 'request-outcome-unknown'):
            self.run_policy(http_error(502))
        self.assertEqual(len(self.calls), 1)
        st = json.loads(Path(str(self.file) + '.status').read_text())
        self.assertTrue(st['candidateUncertain'])
        self.assertTrue(st.get('providerToolUncertain'))

        self.calls.clear()
        self.now = 0.0
        self.request = {'model': 'gpt-test', 'messages': [{'role': 'user', 'content': 'hi'}]}
        injected_wire = json.dumps({
            'model': 'gpt-test',
            'messages': [{'role': 'user', 'content': 'hi'}],
            'tools': [{'type': 'web_search'}],
        }).encode('utf-8')
        with self.assertRaisesRegex(policy.RecoveryStopped, 'request-outcome-unknown'):
            self.run_policy(http_error(502, wire_body=injected_wire))
        self.assertEqual(len(self.calls), 1)
        st2 = json.loads(Path(str(self.file) + '.status').read_text())
        self.assertTrue(st2['candidateUncertain'])


if __name__ == '__main__': unittest.main()
