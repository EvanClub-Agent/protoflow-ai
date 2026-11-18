"""Alex's bounded provider-request retry policy. No prompt/history transformations.

Loaded only by the hash-verified private Hermes source copy. Stdout stays ACP-only.
"""
import email.utils
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import time

MAX_ATTEMPTS = 6
WAIT_BUDGET = 180.0


class RecoveryStopped(Exception):
    def __init__(self, reason, diagnostic=None):
        super().__init__(reason)
        self.reason = reason
        self.diagnostic = diagnostic or {}


class ResponsesRejected(Exception):
    """An explicit Responses error frame before any output, not an HTTP 429."""
    def __init__(self, body):
        msg = ""
        if isinstance(body, dict):
            err = body.get("error") if isinstance(body.get("error"), dict) else body
            msg = str(err.get("message") or "").strip()
        super().__init__(msg or "responses-provider-rejection")
        self.body = body


NON_TRANSIENT_LIMIT_CODES = frozenset((
    'insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active',
    'payment_required', 'insufficient_credits', 'no_usable_credits',
    'balance_depleted', 'model_not_supported_on_free_tier', 'member_spend_cap_exceeded',
    'terminal_quota_exhausted', 'credit_balance_exhausted',
    'organization_spend_limit_exceeded', 'organization_usage_limit_exceeded',
    'project_spend_limit_exceeded', 'insufficient_credits_for_paid_model',
    'subscription_sharing_usage_limit_exceeded',
))
RESPONSES_RATE_LIMIT_CODES = frozenset((
    'rate_limit_exceeded', 'rate_limit_error', 'throttled', 'resource_exhausted',
))
RESPONSES_OVERFLOW_CODES = frozenset(('context_length_exceeded', 'max_tokens_exceeded'))
RESPONSES_SERVER_ERROR_CODES = frozenset((
    'server_error', 'api_error', 'overloaded', 'overloaded_error',
))
PROVIDER_CODES = (
    NON_TRANSIENT_LIMIT_CODES
    | RESPONSES_RATE_LIMIT_CODES
    | RESPONSES_OVERFLOW_CODES
    | RESPONSES_SERVER_ERROR_CODES
    | frozenset((
        'invalid_api_key', 'invalid_request_error', 'invalid_prompt',
        'subscription_sharing_usage_unavailable',
    ))
)

_BILLING_PHRASES = (
    'insufficient credits', 'insufficient_quota', 'insufficient balance',
    'credit balance', 'credits exhausted', 'credits have been exhausted',
    'requires available credits', 'account balance is too low', 'no usable credits',
    'top up your credits', 'payment required', 'billing hard limit',
    'hard billing limit', 'exceeded your current quota', 'account is deactivated',
    'plan does not include', 'out of extra usage', 'out of funds', 'run out of funds',
    'balance_depleted', 'insufficient funds', 'budget limit exceeded',
    'not available on the free tier', "isn't available on the free tier",
    'spending limit', 'requires a subscription', 'upgrade for access',
)
_LONG_QUOTA_PHRASES = (
    'tokens per day', 'daily limit', 'daily quota', 'weekly usage limit',
    'weekly limit', 'monthly limit', 'reached your session usage limit',
    'usage_limit_reached',
)
_SHORT_RATE_SIGNALS = (
    'try again in', 'retry after', 'resets in', 'reset in', 'available in',
    'per minute', 'per second', 'requests per minute', 'tokens per minute',
    'too many requests', 'rate limit', 'rate_limit', 'throttl',
)
_VALIDATION_PATTERNS = (
    'unknown parameter', 'unsupported parameter', 'unrecognized request argument',
    'invalid_request_error', 'unknown_parameter', 'unsupported_parameter',
)
_OVERFLOW_PATTERNS = (
    'context length', 'context size', 'maximum context', 'too many tokens',
    'prompt is too long', 'prompt exceeds max length', 'maximum number of tokens',
    'exceeds the max_model_len', 'max_model_len', 'maximum model length',
    'context length exceeded', 'tokens in request more than max tokens allowed',
    'exceeds the maximum number of input tokens', 'maximum allowed input length',
    '超过最大长度', '上下文长度',
)
_MEMORY_CEILING_PATTERNS = (
    'memory guard', 'memory limit exceeded', 'memory ceiling', 'out of memory',
    'insufficient memory', 'prefill would require', 'predicted peak would',
)


def positive(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else None
    except (TypeError, ValueError):
        return None


def error_body(error):
    body = getattr(error, "body", None)
    if not isinstance(body, dict):
        return {}
    return body["error"] if isinstance(body.get("error"), dict) else body


def http_status(error):
    status = getattr(error, "status_code", None)
    resp_status = getattr(getattr(error, "response", None), "status_code", None)
    if isinstance(status, int) and not isinstance(status, bool) and status == resp_status:
        return status
    return None


def _error_text(error):
    body = error_body(error)
    parts = [str(body.get("message") or ""), str(error or "")]
    return " ".join(p for p in parts if p).lower()


def _header_or_body_reset_hint(error, wall=time.time):
    headers = getattr(getattr(error, "response", None), "headers", None) or {}
    if not hasattr(headers, "get"):
        headers = {}
    raw = headers.get("retry-after") or headers.get("Retry-After")
    value = positive(raw)
    if value is None and isinstance(raw, str):
        try:
            value = max(0.0, email.utils.parsedate_to_datetime(raw).timestamp() - wall())
        except (ValueError, TypeError, OverflowError):
            pass
    if value is not None:
        return value
    body = error_body(error)
    value = positive(body.get("retry_after"))
    if value is not None:
        return value
    resets = []
    for name in ("x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"):
        match = re.fullmatch(r"(\d+(?:\.\d+)?)(ms|s|m|h)", str(headers.get(name, "")))
        if match:
            resets.append(float(match[1]) * {"ms": .001, "s": 1, "m": 60, "h": 3600}[match[2]])
    if resets:
        return max(resets)
    return None


_SERVER_LIST_CAPABILITY_KEYS = frozenset((
    "mcp_servers",
    "remote_mcp",
    "server_tools",
    "builtin_tools",
    "plugins",
))
_SERVER_OPTION_CAPABILITY_KEYS = frozenset((
    "web_search_options",
    "previous_response_id",
    "conversation",
    "computer_use",
    "code_execution",
    "google_search",
    "google_search_retrieval",
    "url_context",
    "file_search",
    "grounding_config",
))
_PROMPT_PAYLOAD_KEYS = ("messages", "input", "prompt", "contents")
_CHAT_TOOL_OUTER_KEYS = frozenset(("type", "function", "cache_control", "strict", "defer_loading"))
_FUNCTION_SCHEMA_KEYS = frozenset(("name", "description", "parameters", "strict", "cache_control"))
_RESPONSES_FUNCTION_KEYS = frozenset((
    "type", "name", "description", "parameters", "strict", "defer_loading", "cache_control",
))
_ANTHROPIC_CLIENT_TOOL_KEYS = frozenset((
    "type", "name", "description", "input_schema", "cache_control",
    "defer_loading", "strict", "input_examples",
))


def _non_empty_tool_name(value):
    return isinstance(value, str) and bool(value.strip())


def _is_client_function_tool(tool):
    if not isinstance(tool, dict):
        return False
    tool_type = tool.get("type")
    if tool_type == "function":
        fn = tool.get("function")
        if fn is not None:
            return (
                isinstance(fn, dict)
                and _non_empty_tool_name(fn.get("name"))
                and set(tool.keys()) <= _CHAT_TOOL_OUTER_KEYS
                and set(fn.keys()) <= _FUNCTION_SCHEMA_KEYS
            )
        return (
            _non_empty_tool_name(tool.get("name"))
            and set(tool.keys()) <= _RESPONSES_FUNCTION_KEYS
        )
    if tool_type in (None, "custom") and "input_schema" in tool:
        return (
            _non_empty_tool_name(tool.get("name"))
            and isinstance(tool.get("input_schema"), dict)
            and set(tool.keys()) <= _ANTHROPIC_CLIENT_TOOL_KEYS
        )
    if tool_type is None:
        fn = tool.get("function")
        if fn is not None:
            return (
                isinstance(fn, dict)
                and _non_empty_tool_name(fn.get("name"))
                and set(tool.keys()) <= _CHAT_TOOL_OUTER_KEYS
                and set(fn.keys()) <= _FUNCTION_SCHEMA_KEYS
            )
        return (
            _non_empty_tool_name(tool.get("name"))
            and set(tool.keys()) <= _FUNCTION_SCHEMA_KEYS
        )
    return False


def _is_client_tool_config(tool_config):
    if tool_config is None:
        return True
    if not isinstance(tool_config, dict) or not (set(tool_config.keys()) <= {"tools", "toolChoice"}):
        return False
    tools = tool_config.get("tools")
    if tools is None:
        return True
    if not isinstance(tools, (list, tuple)):
        return False
    for entry in tools:
        if not isinstance(entry, dict) or not (set(entry.keys()) <= {"toolSpec", "cachePoint"}):
            return False
        if "toolSpec" in entry:
            spec = entry.get("toolSpec")
            if not isinstance(spec, dict) or not _non_empty_tool_name(spec.get("name")):
                return False
    return True


def _is_client_functions_list(functions):
    if functions is None:
        return True
    if not isinstance(functions, (list, tuple)):
        return False
    return all(
        isinstance(fn, dict)
        and _non_empty_tool_name(fn.get("name"))
        and set(fn.keys()) <= _FUNCTION_SCHEMA_KEYS
        for fn in functions
    )


def _layer_is_pure_inference(layer):
    if not isinstance(layer, dict):
        return False
    for key in _SERVER_LIST_CAPABILITY_KEYS:
        if key in layer and layer[key] is not None:
            if not isinstance(layer[key], (list, tuple)) or len(layer[key]) > 0:
                return False
    for key in _SERVER_OPTION_CAPABILITY_KEYS:
        if key in layer and layer[key] not in (None, False):
            return False
    if layer.get("store") is True:
        return False
    include = layer.get("include")
    if include is not None:
        if not isinstance(include, (list, tuple)):
            return False
        if any(
            not isinstance(item, str)
            or any(tok in item for tok in ("web_search", "file_search", "code_interpreter", "computer_call", "mcp"))
            for item in include
        ):
            return False
    tool_choice = layer.get("tool_choice")
    if isinstance(tool_choice, dict):
        if tool_choice.get("type") not in (None, "function", "auto", "any", "none", "tool"):
            return False
    if not _is_client_tool_config(layer.get("toolConfig")):
        return False
    if not _is_client_functions_list(layer.get("functions")):
        return False
    tools = layer.get("tools")
    if tools is None:
        return True
    if not isinstance(tools, (list, tuple)):
        return False
    return all(_is_client_function_tool(tool) for tool in tools)


def _flatten_override_layers(container, depth=0):
    if depth > 4 or not isinstance(container, dict):
        return None
    layers = [container]
    for subkey in ("request_overrides", "extra_body"):
        if subkey in container and container[subkey] is not None:
            sub = container[subkey]
            if not isinstance(sub, dict):
                return None
            nested = _flatten_override_layers(sub, depth + 1)
            if nested is None:
                return None
            layers.extend(nested)
    return layers


def _wire_request_payload(error):
    if error is None:
        return None
    req_obj = getattr(error, "request", None) or getattr(getattr(error, "response", None), "request", None)
    if req_obj is None:
        return None
    try:
        content = getattr(req_obj, "content", None)
    except Exception:
        return False
    if content is None:
        return None
    if isinstance(content, (bytes, bytearray)):
        if not content:
            return False
        try:
            content = content.decode("utf-8")
        except UnicodeDecodeError:
            return False
    if not isinstance(content, str) or not content.strip():
        return False
    try:
        parsed = json.loads(content)
    except (TypeError, ValueError):
        return False
    return parsed if isinstance(parsed, dict) else False


def pure_inference_request(request, agent=None, error=None):
    """True iff the effective wire request invokes model inference only (fail-closed).

    Inspects top-level fields, ``request_overrides`` (on both ``agent`` and ``request``),
    SDK-merged ``extra_body`` layers (including ``bypass_sdk_request_transform``),
    protocol-specific client tool schemas, and any serialized HTTP wire body attached to
    ``error``. Unknown or unverifiable request shapes fail closed (``False``).
    """
    if not isinstance(request, dict):
        return False
    all_layers = []
    if agent is not None:
        agent_overrides = getattr(agent, "request_overrides", None)
        if agent_overrides is not None:
            extracted = _flatten_override_layers(agent_overrides)
            if extracted is None:
                return False
            all_layers.extend(extracted)
    req_layers = _flatten_override_layers(request)
    if req_layers is None:
        return False
    all_layers.extend(req_layers)
    merged = {}
    for layer in all_layers:
        if not _layer_is_pure_inference(layer):
            return False
        for key, val in layer.items():
            if key not in ("extra_body", "request_overrides"):
                merged[key] = val
    if not _layer_is_pure_inference(merged):
        return False
    if not any(isinstance(merged.get(key), (list, tuple, str)) for key in _PROMPT_PAYLOAD_KEYS):
        return False
    wire_payload = _wire_request_payload(error)
    if wire_payload is False:
        return False
    if isinstance(wire_payload, dict) and not pure_inference_request(wire_payload):
        return False
    return True


def is_non_transient_limit(error):
    body = error_body(error)
    code = body.get("code")
    if code in NON_TRANSIENT_LIMIT_CODES or body.get("type") == "insufficient_quota":
        return True
    msg = _error_text(error)
    if any(phrase in msg for phrase in _BILLING_PHRASES):
        return True
    has_short_signal = (
        _header_or_body_reset_hint(error) is not None
        or any(sig in msg for sig in _SHORT_RATE_SIGNALS)
    )
    if not has_short_signal and any(phrase in msg for phrase in _LONG_QUOTA_PHRASES):
        return True
    if ("quota exceeded" in msg or "quota_exceeded" in msg) and not has_short_signal:
        return True
    return False


def transient_limit(error):
    """Separate generalization rules for HTTP 429 vs HTTP-200 Responses SSE frames."""
    body = error_body(error)
    if isinstance(error, ResponsesRejected):
        if is_non_transient_limit(error):
            return False
        return (
            body.get("code") in RESPONSES_RATE_LIMIT_CODES
            or body.get("type") in ("tokens", "requests", "rate_limit_error")
        )
    if http_status(error) != 429:
        return False
    return not is_non_transient_limit(error)


def is_overflow_delegation(error):
    """Context-window or payload-size rejections delegated to native recover_from_overflow."""
    body = error_body(error)
    code = body.get("code")
    if isinstance(error, ResponsesRejected):
        return code in RESPONSES_OVERFLOW_CODES
    status = http_status(error)
    if status == 413:
        return True
    if status in (400, 500, 503, 529):
        if code in RESPONSES_OVERFLOW_CODES:
            return True
        msg = _error_text(error)
        if any(p in msg for p in _MEMORY_CEILING_PATTERNS):
            return False
        if any(p in msg for p in _VALIDATION_PATTERNS if p != 'invalid_request_error'):
            return False
        return any(p in msg for p in _OVERFLOW_PATTERNS)
    return False


def is_5xx_validation_rejection(error):
    status = http_status(error)
    if status is None or status < 500 or status >= 600:
        return False
    body = error_body(error)
    if body.get("code") in ("invalid_request_error", "unknown_parameter", "unsupported_parameter"):
        return True
    msg = _error_text(error)
    return any(p in msg for p in _VALIDATION_PATTERNS)


def transient_server_error(error):
    """Upstream 5xx / server_error candidates (still gated by pure_inference_request in execute)."""
    if isinstance(error, ResponsesRejected):
        body = error_body(error)
        return (
            body.get("code") in RESPONSES_SERVER_ERROR_CODES
            or body.get("type") in ("server_error", "overloaded_error")
        )
    status = http_status(error)
    if status in (500, 502, 503, 504, 529):
        return not is_overflow_delegation(error) and not is_5xx_validation_rejection(error)
    return False


def retry_after(error, wall=time.time):
    hint = _header_or_body_reset_hint(error, wall=wall)
    if hint is not None:
        return hint
    if transient_limit(error) or transient_server_error(error):
        body = error_body(error)
        text = str(body.get("message", "")) or (str(error) if http_status(error) == 429 else "")
        match = re.search(r"\bPlease try again in (\d+(?:\.\d+)?)(ms|s|m|h)\b", text, re.I)
        if match:
            return float(match[1]) * {"ms": .001, "s": 1, "m": 60, "h": 3600}[match[2].lower()]
    return None


def provider_diagnostic(error):
    body = error_body(error)
    code = body.get('code')
    status = http_status(error)
    err_name = type(error).__name__
    if transient_limit(error):
        reason = 'rate-limit'
    elif code in NON_TRANSIENT_LIMIT_CODES or body.get('type') == 'insufficient_quota' or status == 402 or (status == 429 and is_non_transient_limit(error)):
        reason = 'quota'
    elif is_overflow_delegation(error):
        reason = 'context-limit'
    elif code == 'invalid_api_key' or status in (401, 403):
        reason = 'authentication'
    elif status in (408, 504) or isinstance(error, TimeoutError) or 'Timeout' in err_name or err_name == 'StreamLifetimeExceeded':
        reason = 'timeout'
    elif status == 502 or isinstance(error, ConnectionError) or 'Connect' in err_name:
        reason = 'network'
    else:
        reason = 'unclassified'
    result = {'failure': {'reason': reason, 'evidence': 'runtime-error'}}
    if err_name in ('ResponsesRejected', 'APIError', 'APIConnectionError', 'APITimeoutError',
                    'RateLimitError', 'AuthenticationError', 'PermissionDeniedError',
                    'BadRequestError', 'InternalServerError', 'APIStatusError',
                    'ReadTimeout', 'ConnectTimeout', 'PoolTimeout', 'ConnectError',
                    'ReadError', 'RemoteProtocolError', 'ConnectionError', 'TimeoutError',
                    'EmptyStreamError', 'StreamLifetimeExceeded'):
        result['errorType'] = err_name
    if code in PROVIDER_CODES:
        result['providerCode'] = code
    if isinstance(error, ResponsesRejected):
        result['providerEvidence'] = 'responses-error-event'
    elif status is not None:
        result['providerEvidence'] = 'http-error'
    if reason == 'rate-limit':
        wait = retry_after(error)
        if wait is not None:
            result['failure']['retryAfterSeconds'] = wait
        message = str(body.get('message', '')) or (str(error) if status == 429 else '')
        if body.get('type') == 'tokens' or re.search(r'\bTPM\b|tokens per min', message, re.I):
            result['failure']['rateLimitKind'] = 'tokens'
            budget = re.search(r'\bLimit ([\d,]+), Used ([\d,]+), Requested ([\d,]+)', message)
            if budget:
                result['failure'].update(zip(('tokenLimit', 'tokensUsed', 'tokensRequested'), (int(n.replace(',', '')) for n in budget.groups())))
    return result


def observe_responses(agent, events):
    """Observe the actual Responses iterator, including errors raised by the SDK.

    Lifecycle frames are not output. Any output/reasoning/tool item stops replay;
    no IDs or text are reconstructed and no original events are changed.
    """
    if not getattr(agent, '_alex_request_recovery_active', False):
        yield from events
        return
    from openai import APIError
    agent._alex_responses_observed = True
    agent._alex_responses_output = False
    terminal = False
    def field(value, key):
        return value.get(key) if isinstance(value, dict) else getattr(value, key, None)
    def reject(body, *, empty_output=True):
        if not isinstance(body, dict):
            body = {key: field(body, key) for key in ('code', 'type', 'message', 'retry_after')}
        rejection = ResponsesRejected(body)
        if agent._alex_responses_output:
            raise RecoveryStopped('partial-response', provider_diagnostic(rejection))
        if not empty_output:
            raise RecoveryStopped('request-outcome-unknown', provider_diagnostic(rejection))
        raise rejection
    try:
        for event in events:
            kind = field(event, 'type')
            if kind == 'error':
                reject(field(event, 'error') if field(event, 'error') is not None else event)
            if kind == 'response.failed':
                response = field(event, 'response')
                reject(field(response, 'error'), empty_output=field(response, 'output') == [])
            if isinstance(kind, str) and (kind.startswith('response.output_item.') or
                    kind.startswith('response.content_part.') or (kind.endswith('.delta') and field(event, 'delta'))):
                agent._alex_responses_output = True
            if kind in ('response.completed', 'response.incomplete'):
                terminal = True
            yield event
        if not terminal:
            raise RecoveryStopped('partial-response' if agent._alex_responses_output else 'request-outcome-unknown')
    except APIError as error:
        # Exact SDK APIError is raised by an SSE `error` envelope. Subclasses
        # (transport, HTTP status etc.) do not prove a structured stream rejection.
        if type(error) is APIError and isinstance(error.body, dict):
            reject(error_body(error))
        raise


def channel(agent):
    root = os.environ.get("ALEX_RECOVERY_DIR")
    if not root or not agent.session_id:
        raise RecoveryStopped("recovery-channel-unavailable")
    file = Path(root) / (hashlib.sha256(agent.session_id.encode()).hexdigest() + ".json")
    if not file.exists():
        # Compression changes the physical transcript ID. Resolve through the
        # native persisted lineage, never through a title or guessed ID.
        from acp_adapter.catalog import logical_session_id
        from hermes_constants import get_hermes_home
        logical = logical_session_id(get_hermes_home() / 'state.db', agent.session_id)
        file = Path(root) / (hashlib.sha256(logical.encode()).hexdigest() + '.json')
    descriptor = json.loads(file.read_text())
    return file, descriptor["runId"], descriptor['sessionId']


def _has_residual_run_status(bound_file, bound_run):
    status_file = Path(str(bound_file) + ".status")
    if not status_file.exists():
        return False
    try:
        prior = json.loads(status_file.read_text())
    except (OSError, ValueError):
        return False
    return prior.get("runId") == bound_run and prior.get("status") in ("delegated", "waiting", "retrying", "stopped")


def execute(agent, request, call, *, clock=time.monotonic, sleep=time.sleep, jitter=random.random):
    # The gateway may also serve the user's CLI. Only Alex's exact active session
    # has a descriptor; unrelated sessions retain native behavior.
    try:
        bound_file, bound_run, logical_session = channel(agent)
    except (FileNotFoundError, ImportError, RecoveryStopped):
        return call(request)
    except (OSError, ValueError, KeyError) as error:
        raise RecoveryStopped('recovery-channel-unavailable') from error
    start = clock()
    file = run_id = None
    attempt = 0
    pure_inference = pure_inference_request(request, agent=agent)
    def report(status, **values):
        event = {"runId": run_id, "sessionId": logical_session, "status": status, "attempt": attempt, **values}
        target = str(file) + ".status"
        tmp = target + ".tmp"
        with open(tmp, "w") as stream:
            os.chmod(tmp, 0o600)
            json.dump(event, stream)
            stream.flush()
        os.replace(tmp, target)
        history = str(file) + '.events'
        # Only numeric/status metadata; never provider bodies, prompts or keys.
        if os.path.exists(history) and os.path.getsize(history) > 256 * 1024:
            with open(history, 'w') as stream: stream.write('')
        with open(history, 'a') as stream:
            os.chmod(history, 0o600)
            stream.write(json.dumps(event) + '\n')
    while True:
        # Check again at the boundary, including cancellation during the final
        # sleep slice. No extra provider call is sent for an obsolete run.
        try:
            active = json.loads(bound_file.read_text())
        except (OSError, ValueError):
            active = {}
        if agent._interrupt_requested or active.get('runId') != bound_run or active.get('sessionId') != logical_session or active.get('active') is not True:
            file, run_id = bound_file, bound_run
            report('stopped', reason='cancelled', candidateUncertain=False)
            raise RecoveryStopped('cancelled')
        attempt += 1
        try:
            agent._alex_request_recovery_active = True
            agent._alex_responses_observed = False
            agent._alex_responses_output = False
            try:
                result = call(request)
            finally:
                agent._alex_request_recovery_active = False
            if file is None and _has_residual_run_status(bound_file, bound_run):
                file, run_id = bound_file, bound_run
            if file:
                report("recovered", candidateUncertain=False, elapsedSeconds=clock() - start)
            return result
        except RecoveryStopped as error:
            file, run_id = bound_file, bound_run
            uncertain = error.reason in ('partial-response', 'request-outcome-unknown')
            report('stopped', reason=error.reason, candidateUncertain=uncertain, **error.diagnostic)
            raise
        except Exception as error:
            partial = agent._alex_responses_output if agent._alex_responses_observed else getattr(agent, "_current_streamed_assistant_text", "")
            if partial or getattr(error, "partial", False):
                file, run_id = bound_file, bound_run
                report("stopped", reason="partial-response", candidateUncertain=True, **provider_diagnostic(error))
                raise RecoveryStopped("partial-response") from error
            if is_overflow_delegation(error):
                # Preserve real structured error (e.g. ResponsesRejected without fake HTTP 400)
                # and hand off to native recover_from_overflow. A subsequent successful call in
                # the same runId clears this status to 'recovered'.
                file, run_id = bound_file, bound_run
                report('delegated', reason='native-overflow-recovery', candidateUncertain=False, **provider_diagnostic(error))
                raise
            is_rate_limit = transient_limit(error)
            is_server_err = False if is_rate_limit else transient_server_error(error)
            if not is_rate_limit and not is_server_err:
                status = http_status(error)
                if isinstance(error, ResponsesRejected):
                    file, run_id = bound_file, bound_run
                    reason = 'non-transient-limit' if is_non_transient_limit(error) else 'provider-rejected'
                    report('stopped', reason=reason, candidateUncertain=False, **provider_diagnostic(error))
                    raise RecoveryStopped(reason) from error
                if status in (402, 429):
                    file, run_id = bound_file, bound_run
                    report('stopped', reason='non-transient-limit', candidateUncertain=False, **provider_diagnostic(error))
                    raise RecoveryStopped('non-transient-limit') from error
                if is_5xx_validation_rejection(error):
                    file, run_id = bound_file, bound_run
                    report('stopped', reason='provider-rejected', candidateUncertain=False, **provider_diagnostic(error))
                    raise RecoveryStopped('provider-rejected') from error
                module = type(error).__module__.split('.')[0]
                if (status == 408
                        or type(error).__name__ in ('EmptyStreamError', 'StreamLifetimeExceeded')
                        or isinstance(error, (ConnectionError, TimeoutError))
                        or (module in ('httpx', 'httpcore', 'openai', 'anthropic') and getattr(error, 'response', None) is None)):
                    file, run_id = bound_file, bound_run
                    report('stopped', reason='request-outcome-unknown', candidateUncertain=True, **provider_diagnostic(error))
                    raise RecoveryStopped('request-outcome-unknown') from error
                # Let native handling classify unrelated deterministic errors; this policy never retries them.
                raise
            if is_server_err and not (pure_inference and pure_inference_request(request, agent=agent, error=error)):
                # RFC 9110: 502/504/5xx cannot prove upstream did not execute; when provider-hosted
                # tools are present or request shape is unverifiable, side-effect outcome is unknown.
                file, run_id = bound_file, bound_run
                report('stopped', reason='request-outcome-unknown', candidateUncertain=True, providerToolUncertain=True, **provider_diagnostic(error))
                raise RecoveryStopped('request-outcome-unknown') from error
            if file is None:
                file, run_id = bound_file, bound_run
            diagnostic = provider_diagnostic(error)
            failure = diagnostic['failure']
            if is_rate_limit and failure.get('rateLimitKind') == 'tokens' and 'tokensRequested' in failure and failure['tokensRequested'] > failure['tokenLimit']:
                report('stopped', reason='request-exceeds-token-limit', candidateUncertain=False, **diagnostic)
                raise RecoveryStopped('request-exceeds-token-limit') from error
            client = getattr(agent, 'client', None)
            if getattr(client, 'max_retries', None) != 0:
                report('stopped', reason='sdk-retry-budget-unknown', candidateUncertain=False, **diagnostic)
                raise RecoveryStopped('sdk-retry-budget-unknown') from error
            minimum = retry_after(error)
            delay = (minimum if minimum is not None else min(60, 2 ** attempt)) + jitter()
            budget_reason = "rate-limit-budget" if is_rate_limit else "server-error-budget"
            if attempt >= MAX_ATTEMPTS or delay > WAIT_BUDGET - (clock() - start):
                report("stopped", reason=budget_reason, candidateUncertain=False, retryAfterSeconds=minimum, elapsedSeconds=clock() - start, **diagnostic)
                raise RecoveryStopped(budget_reason) from error
            report("waiting", waitSeconds=delay, retryAfterSeconds=minimum, **diagnostic)
            wait_started = clock()
            deadline = wait_started + delay
            while clock() < deadline:
                try:
                    active = json.loads(file.read_text())
                except (OSError, ValueError):
                    active = {}
                if agent._interrupt_requested or active.get("runId") != run_id or active.get("active") is not True:
                    report("stopped", reason="cancelled", candidateUncertain=False, waitedSeconds=clock() - wait_started)
                    raise RecoveryStopped("cancelled") from error
                sleep(min(.2, deadline - clock()))
            report("retrying", waitedSeconds=clock() - wait_started)
