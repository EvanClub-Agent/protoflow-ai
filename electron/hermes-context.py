"""Scoped native Hermes context/compaction/history bridge. Never edits the Hermes store."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys


def _load_surface_module():
    try:
        from agent import alex_acp_surface
        return alex_acp_surface
    except Exception:
        bundled = globals().get('_ALEX_BUNDLED_ACP_SURFACE_SOURCE')
        if isinstance(bundled, str) and bundled.strip():
            existing = sys.modules.get('alex_acp_surface_bundled')
            if existing is not None:
                return existing
            import types
            module = types.ModuleType('alex_acp_surface_bundled')
            sys.modules[module.__name__] = module
            exec(compile(bundled, '<hermes-acp-surface.py>', 'exec'), module.__dict__)
            return module
        candidates = []
        env_file = __import__('os').environ.get('ALEX_ACP_SURFACE_FILE')
        if env_file:
            candidates.append(Path(env_file))
        if '__file__' in globals():
            candidates.append(Path(__file__).resolve().with_name('hermes-acp-surface.py'))
        candidates.append(Path.cwd().resolve() / 'electron' / 'hermes-acp-surface.py')
        for helper_path in candidates:
            if helper_path.is_file():
                spec = importlib.util.spec_from_file_location('alex_acp_surface_local', helper_path)
                if spec is not None and spec.loader is not None:
                    module = importlib.util.module_from_spec(spec)
                    sys.modules[spec.name] = module
                    spec.loader.exec_module(module)
                    return module
        raise RuntimeError('unable to load hermes-acp-surface.py')


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def usage_state(usage):
    out = {}
    for source, target in [('context_used', 'used'), ('context_max', 'size'), ('compressions', 'compressions')]:
        value = usage.get(source)
        if type(value) is int and value >= 0 and (target != 'size' or value > 0):
            out[target] = value
    if type(usage.get('context_estimated')) is bool:
        out['estimated'] = usage['context_estimated']
    out['available'] = 'used' in out and 'size' in out
    return out


async def native_usage(client, sid):
    stats = await client.rpc('session.stats', session_id=sid)
    state = usage_state({'context_used': stats.get('context_tokens'), 'context_max': stats.get('context_length'),
                         'compressions': stats.get('compression_count')})
    source = stats.get('context_source')
    if source in ('provider_usage', 'local_estimate', 'provider_usage_plus_estimate'):
        state['estimated'] = source != 'provider_usage'
    return state


def search_history(home, sid, request):
    from hermes_state import SessionDB
    surface = _load_surface_module()
    query = request.get('query')
    offset = request.get('offset', 0)
    if not isinstance(query, str) or not query.strip() or len(query) > 200 or type(offset) is not int or offset < 0:
        raise ValueError('invalid history query')
    db_file = home / 'state.db'
    if not db_file.exists():
        raise ValueError('session store unavailable')
    allowed = request.get('allowedHistorySessions')
    with SessionDB(db_path=db_file, read_only=True) as db:
        verified_entries = surface.verify_allowed_history_sessions(
            db, db_file, request.get('sessionId'), allowed,
        )
        collected_rows = []
        seen_msg_keys = set()
        for order_idx, entry in enumerate(verified_entries):
            rows = db.get_messages(entry['tipId'], include_compacted=True, include_ancestors=True)
            for row_idx, row in enumerate(rows):
                msg_id = row.get('id')
                dedup_key = (entry['tipId'], msg_id) if msg_id is not None else (entry['tipId'], 'idx', row_idx)
                if dedup_key in seen_msg_keys:
                    continue
                seen_msg_keys.add(dedup_key)
                ts = row.get('timestamp')
                ts_num = float(ts) if isinstance(ts, (int, float)) else 0.0
                collected_rows.append((ts_num, -order_idx, row_idx, entry, row))

    collected_rows.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    matches = []
    needle = query.strip().casefold()
    for _ts, _ord, _ridx, entry, row in collected_rows:
        if row.get('role') not in ('user', 'assistant'):
            continue
        content = row.get('content')
        if isinstance(content, list):
            content = '\n'.join(
                block['text']
                for block in content
                if isinstance(block, dict) and block.get('type') == 'text' and isinstance(block.get('text'), str)
            )
        if not isinstance(content, str) or needle not in content.casefold():
            continue
        pos = content.casefold().find(needle)
        start = max(0, pos - 250)
        matches.append({
            'messageId': row['id'],
            'role': row['role'],
            'sourceSessionId': entry['sessionId'],
            'sourceRole': entry['role'],
            'text': content[start:start + 1400],
            'truncated': start > 0 or len(content) > start + 1400,
        })
    return {
        'query': query,
        'total': len(matches),
        'offset': offset,
        'matches': matches[offset:offset + 10],
        'nextOffset': offset + 10 if offset + 10 < len(matches) else None,
    }


def refresh_prompt(home, sid, request):
    from hermes_state import SessionDB
    surface = _load_surface_module()
    db_file = home / 'state.db'
    if not db_file.exists():
        raise ValueError('session store unavailable')
    with SessionDB(db_path=db_file) as db:
        tip = surface.active_physical_id(db, sid)
        row = db.get_session(tip)
        if row is None or surface.classify_session_surface(db, tip) != 'acp':
            raise ValueError('not an ACP session')
        epoch = db.request_prompt_refresh(tip)
    return {'sessionId': request['sessionId'], 'requestedEpoch': epoch}


def verify_prompt(home, sid, request):
    import hashlib
    from agent.prompt_refresh import _applied_epoch
    from hermes_state import SessionDB
    surface = _load_surface_module()

    skill_raw = request.get('skillFile')
    min_epoch = request.get('minEpoch', 0)
    if not isinstance(skill_raw, str) or not skill_raw or type(min_epoch) is not int or min_epoch < 0:
        raise ValueError('invalid prompt verification request')
    skill_path = Path(skill_raw).resolve()
    if not skill_path.is_file():
        return {'sessionId': request['sessionId'], 'verified': False, 'blocked': False, 'truncated': False,
                'appliedSkillDigest': None, 'appliedEpoch': 0, 'expectedEpoch': min_epoch}
    raw_bytes = skill_path.read_bytes()
    file_digest = hashlib.sha256(raw_bytes).hexdigest()
    expected_text = raw_bytes.decode('utf-8').strip()
    db_file = home / 'state.db'
    if not db_file.exists():
        return {'sessionId': request['sessionId'], 'verified': False, 'blocked': False, 'truncated': False,
                'appliedSkillDigest': None, 'appliedEpoch': 0, 'expectedEpoch': min_epoch}
    with SessionDB(db_path=db_file, read_only=True) as db:
        tip = surface.active_physical_id(db, sid)
        row = db.get_session(tip)
        req_epoch = db.prompt_refresh_epoch(tip)
        is_acp = row is not None and surface.classify_session_surface(db, tip) == 'acp'
    if not is_acp:
        return {'sessionId': request['sessionId'], 'verified': False, 'blocked': False, 'truncated': False,
                'appliedSkillDigest': None, 'appliedEpoch': 0, 'expectedEpoch': max(min_epoch, req_epoch)}
    stored_prompt = row.get('system_prompt') or ''
    expected_epoch = max(min_epoch, req_epoch)
    applied_epoch = _applied_epoch(row)
    epoch_ok = applied_epoch >= expected_epoch
    blocked = '[BLOCKED: AGENTS.md' in stored_prompt
    truncated = '[...truncated AGENTS.md:' in stored_prompt
    if not expected_text:
        content_ok = bool(stored_prompt) and not blocked and not truncated
    else:
        content_ok = (not blocked) and (not truncated) and (f"## AGENTS.md\n\n{expected_text}" in stored_prompt)
    verified = bool(stored_prompt and epoch_ok and content_ok)
    return {
        'sessionId': request['sessionId'],
        'verified': verified,
        'blocked': blocked,
        'truncated': truncated,
        'appliedSkillDigest': file_digest if verified else None,
        'appliedEpoch': applied_epoch,
        'expectedEpoch': expected_epoch,
    }


def _is_gateway_info_acp(home, sid, info):
    source = info.get('source') if isinstance(info, dict) else None
    if source == 'acp':
        return True
    if source == 'local' and isinstance(info, dict) and info.get('created_source') == 'acp':
        return True
    db_file = home / 'state.db'
    if db_file.exists():
        from hermes_state import SessionDB
        surface = _load_surface_module()
        with SessionDB(db_path=db_file, read_only=True) as db:
            return surface.classify_session_surface(db, sid) == 'acp'
    return False


async def main(request):
    from acp_adapter.catalog import logical_session_id
    from hermes_cli.gateway_client import connect_gateway
    from hermes_cli.gateway_runtime import gateway_profile_home
    from hermes_constants import get_hermes_home
    raw_sid = request.get('sessionId')
    if not isinstance(raw_sid, str) or not raw_sid.strip():
        raise ValueError('invalid sessionId')
    home = gateway_profile_home(get_hermes_home())
    sid = logical_session_id(home / 'state.db', raw_sid)
    action = request['action']
    if action == 'refresh_prompt':
        return await asyncio.to_thread(refresh_prompt, home, sid, request)
    if action == 'verify_prompt':
        return await asyncio.to_thread(verify_prompt, home, sid, request)
    if action == 'history':
        return {'sessionId': raw_sid, **await asyncio.to_thread(search_history, home, sid, request)}
    async with connect_gateway() as client:
        info = await client.rpc('session.info', session_id=sid)
        if not _is_gateway_info_acp(home, sid, info):
            raise ValueError('not an ACP session')
        if action == 'compress':
            from hermes_cli.gateway_mutations import PreparedMutations
            result = await PreparedMutations().apply(client, sid, 'compress', {})
            summary = result.get('summary') or {}
            return {'sessionId': raw_sid, 'status': result.get('status'),
                    'summary': {key: summary[key] for key in ('noop', 'aborted', 'fallback_used', 'headline', 'token_line') if key in summary},
                    'usage': await native_usage(client, sid)}
        if action == 'usage':
            return {'sessionId': raw_sid, 'usage': await native_usage(client, sid)}
        if action != 'watch':
            raise ValueError('unknown context action')
        snapshot = await client.rpc('session.resume', session_id=sid)
        emit({'sessionId': raw_sid, 'usage': await native_usage(client, sid)})
        emit({'ready': True})
        epoch, seq = snapshot.get('replay_epoch'), snapshot.get('last_sequence', 0)
        while True:
            frame = await client.events.get()
            if isinstance(frame, Exception):
                raise frame
            event = frame.get('params', {})
            if event.get('session_id') != sid:
                continue
            if event.get('replay_epoch') == epoch and event.get('seq', 0) <= seq:
                continue
            epoch, seq = event.get('replay_epoch'), event.get('seq', 0)
            payload = event.get('payload', {})
            if event.get('type') == 'session.usage' and isinstance(payload.get('usage'), dict):
                emit({'sessionId': raw_sid, 'usage': usage_state(payload['usage'])})
            elif event.get('type') == 'status.update' and payload.get('kind') == 'compacting':
                emit({'sessionId': raw_sid, 'compacting': True})
            elif event.get('type') in ('message.complete', 'session.updated'):
                emit({'sessionId': raw_sid, 'compacting': False,
                      'usage': await native_usage(client, sid)})


SERVE_ACTIONS = ('usage', 'history', 'verify_prompt', 'refresh_prompt')


def _safe_error(locale_override=None):
    raw = (locale_override or os.environ.get('PROTOFLOW_LOCALE', '')).strip().lower()
    if raw.startswith('en'):
        return 'Hermes context interface unavailable ({}), please check connection or update Hermes and retry'
    return 'Hermes 上下文接口不可用（{}），请检查连接或更新 Hermes 后重试'


async def serve():
    """Long-lived bridge: reuses the interpreter and imported Hermes modules only.
    Every request is answered by Hermes afresh (new gateway connection / SessionDB
    read per request); nothing is cached between requests. Strictly one at a time."""
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        request_id = None
        req_locale = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError('invalid request')
            request_id = request.pop('requestId', None)
            req_locale = request.pop('locale', None)
            if request.get('action') not in SERVE_ACTIONS:
                raise ValueError('action not served by persistent bridge')
            result = await main(request)
            emit({'requestId': request_id, **(result or {})})
        except Exception as exc:
            emit({'requestId': request_id, 'error': _safe_error(req_locale).format(type(exc).__name__)})


if __name__ == '__main__':
    try:
        root = Path(sys.argv[1])
        sys.path.insert(0, str(root))
        from pm.environments import activate_dependencies
        activate_dependencies(root)
        if '--serve' in sys.argv[2:]:
            asyncio.run(serve())
        else:
            payload = json.load(sys.stdin)
            if isinstance(payload, dict):
                payload.pop('locale', None)
            result = asyncio.run(main(payload))
            if result is not None:
                emit(result)
    except Exception as exc:
        emit({'error': _safe_error().format(type(exc).__name__)})
