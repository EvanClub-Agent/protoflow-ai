"""Real Hermes + OpenAI SDK + local HTTP/SSE; no production credentials or model."""
import hashlib
import json
import os
from pathlib import Path
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from openai import OpenAI
from run_agent import AIAgent
from agent.codex_runtime import run_codex_stream
from agent.chat_completion_helpers import interruptible_streaming_api_call
from agent.error_classifier import classify_api_error, FailoverReason
from agent.alex_rate_limit import execute, RecoveryStopped, ResponsesRejected

requests = []
scenario = 'limit'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append((time.monotonic(), self.path, request))
        if self.path.endswith('/chat/completions'):
            if scenario == 'http-429-plain' and len(requests) == 1:
                self.send_response(429)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Retry-After', '0.1')
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(b'Too Many Requests')
                self.wfile.flush()
                self.close_connection = True
                return
            if scenario in ('http-502-pure', 'http-502-server-tool', 'http-502-extra-body-server-tool') and len(requests) == 1:
                self.send_response(502)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Retry-After', '0.1')
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(b'502 Bad Gateway')
                self.wfile.flush()
                self.close_connection = True
                return
            if not request.get('stream'):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Connection', 'close')
                self.end_headers()
                payload = {
                    'id': 'chatcmpl-summary',
                    'object': 'chat.completion',
                    'created': 1,
                    'model': 'fixture-model',
                    'choices': [{
                        'index': 0,
                        'message': {
                            'role': 'assistant',
                            'content': '## Goal\nGenerate order page.\n## Progress\nPrior schema and table rules confirmed.',
                        },
                        'finish_reason': 'stop',
                    }],
                    'usage': {'prompt_tokens': 120, 'completion_tokens': 24, 'total_tokens': 144},
                }
                self.wfile.write(json.dumps(payload).encode())
                self.wfile.flush()
                self.close_connection = True
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Connection', 'close')
            self.end_headers()
            chunks = [
                {'id': 'chatcmpl-1', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'fixture-model',
                 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': 'chat-complete'}, 'finish_reason': None}]},
                {'id': 'chatcmpl-1', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'fixture-model',
                 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]},
            ]
            for chunk in chunks:
                self.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
            self.close_connection = True
            return

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Connection', 'close')
        self.end_headers()
        events = [{'type': 'response.created', 'response': {'id': 'resp_fixture', 'status': 'in_progress'}}]
        rejection = {'code': 'rate_limit_exceeded', 'message': 'Please try again in 0.1s.'}
        if scenario == 'sdk-error' and len(requests) == 1:
            # An unlabelled SSE data envelope is raised by OpenAI's SDK as APIError
            # before Hermes receives an event; this is a separate real wire path.
            events.append({'type': 'sdk-error-fixture', 'error': rejection})
        elif scenario == 'limit' and len(requests) == 1:
            events.append({'type': 'error', **rejection})
        elif scenario == 'failed' and len(requests) == 1:
            events.append({'type': 'response.failed', 'response': {'id': 'resp_fixture', 'status': 'failed', 'output': [], 'error': rejection}})
        elif scenario in ('server-error', 'extra-body-server-tool') and len(requests) == 1:
            events.append({'type': 'error', 'code': 'server_error', 'message': 'Please try again in 0.1s.'})
        elif scenario == 'unknown-code':
            events.append({'type': 'error', 'code': 'unknown_vendor_error', 'message': 'unrecognized parameter'})
        elif scenario == 'overflow-handoff' and len(requests) == 1:
            events.append({'type': 'error', 'code': 'context_length_exceeded', 'message': 'Your input exceeds the context window of this model.'})
        elif scenario == 'overflow-e2e-run-conversation' and sum(
            1 for _, p, r in requests if p.endswith('/responses') and 'You are a precise UI builder.' in str(r.get('instructions') or '')
        ) == 1 and 'You are a precise UI builder.' in str(request.get('instructions') or ''):
            events.append({
                'type': 'error',
                'code': 'context_length_exceeded',
                'message': "This model's maximum context length is 65536 tokens. However, your messages resulted in 72000 tokens.",
            })
        elif scenario == 'overflow-e2e-run-conversation' and 'You are a precise UI builder.' not in str(request.get('instructions') or ''):
            summary_text = '## Goal\nGenerate order page.\n## Progress\nPrior schema and table rules confirmed.'
            events += [
                {'type': 'response.output_text.delta', 'delta': summary_text},
                {'type': 'response.output_item.done', 'output_index': 0, 'item': {'type': 'message', 'id': 'msg_sum',
                    'role': 'assistant', 'status': 'completed', 'content': [{'type': 'output_text', 'text': summary_text}]}},
                {'type': 'response.completed', 'response': {'id': 'resp_sum', 'status': 'completed', 'output': []}},
            ]
        elif scenario == 'quota':
            events.append({'type': 'error', 'code': 'insufficient_quota', 'message': 'private quota details'})
        elif scenario in ('partial', 'tool', 'eof'):
            if scenario == 'partial': events.append({'type': 'response.output_text.delta', 'delta': 'partial'})
            if scenario == 'tool': events.append({'type': 'response.output_item.added', 'output_index': 0,
                'item': {'type': 'function_call', 'id': 'fc_fixture', 'call_id': 'call_fixture', 'name': 'write', 'arguments': ''}})
        else:
            events += [
                {'type': 'response.output_text.delta', 'delta': 'complete'},
                {'type': 'response.output_item.done', 'output_index': 0, 'item': {'type': 'message', 'id': 'msg_fixture',
                    'role': 'assistant', 'status': 'completed', 'content': [{'type': 'output_text', 'text': 'complete'}]}},
                {'type': 'response.completed', 'response': {'id': 'resp_fixture', 'status': 'completed', 'output': []}},
            ]
        for event in events:
            if event['type'] == 'sdk-error-fixture':
                self.wfile.write(('data: ' + json.dumps({'error': event['error']}) + '\n\n').encode())
            else:
                self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode())
        self.wfile.flush()
        self.close_connection = True


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base_url = f'http://127.0.0.1:{server.server_port}/v1'
agent = AIAgent(model='fixture-model', provider='custom', api_mode='codex_responses', base_url=base_url,
    api_key='fixture-only', session_id='responses-recovery-fixture', skip_context_files=True, skip_memory=True,
    skip_background_review=True, quiet_mode=True)
chat_agent = AIAgent(model='fixture-model', provider='custom', api_mode='chat_completions', base_url=base_url,
    api_key='fixture-only', session_id='chat-recovery-fixture', skip_context_files=True, skip_memory=True,
    skip_background_review=True, quiet_mode=True)
client = OpenAI(api_key='fixture-only', base_url=base_url, max_retries=0)
chat_agent.client = client
channel = Path(os.environ['ALEX_RECOVERY_DIR']) / (hashlib.sha256(agent.session_id.encode()).hexdigest() + '.json')
chat_channel = Path(os.environ['ALEX_RECOVERY_DIR']) / (hashlib.sha256(chat_agent.session_id.encode()).hexdigest() + '.json')
channel.parent.mkdir(parents=True, exist_ok=True)
channel.write_text(json.dumps({'active': True, 'runId': 'fixture-run', 'sessionId': agent.session_id}))
chat_channel.write_text(json.dumps({'active': True, 'runId': 'chat-fixture-run', 'sessionId': chat_agent.session_id}))
request = {'model': 'fixture-model', 'input': [{'role': 'user', 'content': 'Keep exact prior task and tool result.'}]}
try:
    for scenario in ('sdk-error', 'limit', 'failed', 'server-error', 'unknown-code', 'quota', 'partial', 'tool', 'eof'):
        requests.clear()
        try:
            result = execute(agent, request, lambda req: run_codex_stream(agent, req, client=client), jitter=lambda: 0)
            assert scenario in ('sdk-error', 'limit', 'failed', 'server-error'), scenario
            assert result.output_text == 'complete'
            assert len(requests) == 2
            assert requests[1][0] - requests[0][0] >= .1
            assert requests[0][2] == requests[1][2]
        except RecoveryStopped as error:
            expected = {'quota': 'non-transient-limit', 'partial': 'partial-response',
                        'tool': 'partial-response', 'eof': 'request-outcome-unknown',
                        'unknown-code': 'provider-rejected'}
            assert error.reason == expected.get(scenario), (scenario, error.reason)
            assert len(requests) == 1, (scenario, len(requests))
        print('PASS', scenario, 'physical requests:', len(requests), flush=True)

    # Probe 1: Responses extra_body={'tools': [{'type': 'web_search'}]} reaches the wire and MUST NOT retry on server_error:
    scenario = 'extra-body-server-tool'
    requests.clear()
    channel.write_text(json.dumps({'active': True, 'runId': 'extra-body-run', 'sessionId': agent.session_id}))
    extra_body_req = {
        'model': 'fixture-model',
        'input': [{'role': 'user', 'content': 'Search and build page.'}],
        'extra_body': {'tools': [{'type': 'web_search'}]},
    }
    try:
        execute(agent, extra_body_req, lambda req: run_codex_stream(agent, req, client=client), jitter=lambda: 0)
        raise AssertionError('extra-body-server-tool must stop with request-outcome-unknown')
    except RecoveryStopped as stop_err:
        assert stop_err.reason == 'request-outcome-unknown', stop_err.reason
        assert len(requests) == 1, len(requests)
        assert requests[0][2].get('tools') == [{'type': 'web_search'}], requests[0][2]
        st = json.loads(Path(str(channel) + '.status').read_text())
        assert st['candidateUncertain'] is True and st.get('providerToolUncertain') is True, st
    print('PASS extra-body-server-tool physical requests:', len(requests), flush=True)

    # Probe 2a (low-level execute/classifier handoff): Responses context_length_exceeded preserves structure and delegates:
    scenario = 'overflow-handoff'
    requests.clear()
    channel.write_text(json.dumps({'active': True, 'runId': 'overflow-run', 'sessionId': agent.session_id}))
    try:
        execute(agent, request, lambda req: run_codex_stream(agent, req, client=client), jitter=lambda: 0)
        raise AssertionError('overflow-handoff must raise ResponsesRejected')
    except ResponsesRejected as overflow_err:
        assert getattr(overflow_err, 'status_code', None) is None
        classified = classify_api_error(overflow_err)
        assert classified.reason == FailoverReason.context_overflow, classified
        assert classified.should_compress is True
        delegated_status = json.loads(Path(str(channel) + '.status').read_text())
        assert delegated_status['status'] == 'delegated' and delegated_status['reason'] == 'native-overflow-recovery'
    post_overflow = execute(agent, {'model': 'fixture-model', 'input': [{'role': 'user', 'content': 'Compressed prompt'}]},
        lambda req: run_codex_stream(agent, req, client=client), jitter=lambda: 0)
    assert post_overflow.output_text == 'complete'
    assert len(requests) == 2
    recovered_status = json.loads(Path(str(channel) + '.status').read_text())
    assert recovered_status['status'] == 'recovered' and recovered_status['candidateUncertain'] is False
    print('PASS overflow-handoff physical requests:', len(requests), flush=True)

    # Probe 2b (real AIAgent.run_conversation end-to-end): SSE context_length_exceeded -> real ContextCompressor -> automatic compressed retry -> status 'recovered':
    scenario = 'overflow-e2e-run-conversation'
    requests.clear()
    e2e_agent = AIAgent(
        model='fixture-model', provider='custom', api_mode='codex_responses', base_url=base_url,
        api_key='fixture-only', session_id='responses-overflow-e2e-session',
        skip_context_files=True, skip_memory=True, skip_background_review=True, quiet_mode=True,
    )
    e2e_agent.client = client
    e2e_channel = Path(os.environ['ALEX_RECOVERY_DIR']) / (hashlib.sha256(e2e_agent.session_id.encode()).hexdigest() + '.json')
    e2e_channel.write_text(json.dumps({'active': True, 'runId': 'overflow-e2e-run', 'sessionId': e2e_agent.session_id}))
    long_history = []
    for idx in range(16):
        long_history.append({'role': 'user', 'content': f'Historical turn {idx}: ' + ('schema_field_' + str(idx) + ' ') * 420})
        long_history.append({'role': 'assistant', 'content': f'Confirmed step {idx}: ' + ('recorded_detail_' + str(idx) + ' ') * 420})
    conv_result = e2e_agent.run_conversation(
        user_message='Keep exact active page task and finish order page.',
        system_message='You are a precise UI builder.',
        conversation_history=long_history,
    )
    assert conv_result.get('completed') is True and not conv_result.get('failed'), conv_result
    assert conv_result.get('final_response') == 'complete', conv_result
    turn_calls = [
        req for _, p, req in requests
        if p.endswith('/responses') and 'You are a precise UI builder.' in str(req.get('instructions') or '')
    ]
    summary_calls = [
        req for _, p, req in requests
        if 'You are a precise UI builder.' not in str(req.get('instructions') or '')
    ]
    assert len(summary_calls) >= 1, len(summary_calls)
    assert len(turn_calls) == 2, len(turn_calls)
    assert len(turn_calls[1]['input']) < len(turn_calls[0]['input']), (len(turn_calls[0]['input']), len(turn_calls[1]['input']))
    assert len(json.dumps(turn_calls[1]['input'])) < len(json.dumps(turn_calls[0]['input']))
    assert any('CONTEXT COMPACTION' in json.dumps(item) for item in turn_calls[1]['input']), turn_calls[1]['input']
    e2e_events = [json.loads(line) for line in Path(str(e2e_channel) + '.events').read_text().splitlines() if line.strip()]
    assert [ev['status'] for ev in e2e_events] == ['delegated', 'recovered'], e2e_events
    e2e_status = json.loads(Path(str(e2e_channel) + '.status').read_text())
    assert e2e_status['status'] == 'recovered' and e2e_status['candidateUncertain'] is False, e2e_status
    print('PASS overflow-e2e-run-conversation total HTTP requests:', len(requests), 'turn calls:', len(turn_calls), flush=True)

    # Verify Chat Completions HTTP path (_StreamingCall + alex_bounded_recovery):
    for scenario in ('http-429-plain', 'http-502-pure', 'http-502-server-tool', 'http-502-extra-body-server-tool'):
        requests.clear()
        chat_req = {
            'model': 'fixture-model',
            'messages': [{'role': 'user', 'content': 'Generate page'}],
            'stream': True,
        }
        if scenario == 'http-502-server-tool':
            chat_req['tools'] = [{'type': 'web_search'}]
        elif scenario == 'http-502-extra-body-server-tool':
            chat_req['extra_body'] = {'tools': [{'type': 'web_search'}]}
        else:
            chat_req['tools'] = [{'type': 'function', 'function': {'name': 'protoflow_apply_tsx_patch'}}]
        chat_channel.write_text(json.dumps({'active': True, 'runId': f'chat-run-{scenario}', 'sessionId': chat_agent.session_id}))
        if scenario in ('http-429-plain', 'http-502-pure'):
            resp = execute(chat_agent, chat_req, lambda req: interruptible_streaming_api_call(chat_agent, dict(req)), jitter=lambda: 0)
            content = resp.choices[0].message.content
            assert content == 'chat-complete', content
            assert len(requests) == 2, (scenario, len(requests))
            assert requests[1][0] - requests[0][0] >= 0.1
            assert requests[0][2] == requests[1][2]
        else:
            try:
                execute(chat_agent, chat_req, lambda req: interruptible_streaming_api_call(chat_agent, dict(req)), jitter=lambda: 0)
                raise AssertionError(f'{scenario} must stop with request-outcome-unknown')
            except RecoveryStopped as stop_err:
                assert stop_err.reason == 'request-outcome-unknown'
                assert len(requests) == 1
                assert requests[0][2].get('tools') == [{'type': 'web_search'}], requests[0][2]
                st = json.loads(Path(str(chat_channel) + '.status').read_text())
                assert st['candidateUncertain'] is True and st.get('providerToolUncertain') is True
        print('PASS', scenario, 'physical requests:', len(requests), flush=True)
finally:
    client.close()
    server.shutdown()
