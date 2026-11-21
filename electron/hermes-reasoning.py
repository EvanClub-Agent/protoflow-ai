"""Narrow bridge to the selected Hermes installation's session settings API."""
import asyncio
import json
import os
from pathlib import Path
import sys

# argv[1] is the installation directory printed by this Hermes launcher.
_root = Path(sys.argv[1])
sys.path.insert(0, str(_root))
from pm.environments import activate_dependencies
activate_dependencies(_root)
from acp_adapter.catalog import logical_session_id
from acp_adapter.model_catalog import encode_model_choice
from agent.reasoning_effort import EFFORT_LADDER, route_supported_efforts
from hermes_cli.gateway_client import connect_gateway
from hermes_cli.gateway_runtime import gateway_profile_home
from hermes_cli.main_provider_setup import _main_model_reasoning_efforts
from hermes_constants import get_hermes_home


class SettingError(Exception):
    pass


def _is_acp_info(home, sid, info):
    source = info.get('source') if isinstance(info, dict) else None
    if source == 'acp':
        return True
    if source == 'local' and isinstance(info, dict) and info.get('created_source') == 'acp':
        return True
    db_file = home / 'state.db'
    if db_file.exists():
        from hermes_state import SessionDB
        with SessionDB(db_path=db_file, read_only=True) as db:
            row = db.get_session(sid)
            if row is not None and (
                row.get('source') == 'acp'
                or (row.get('source') == 'local' and row.get('created_source') == 'acp')
            ):
                return True
    return False


def _tr(zh, en):
    return en if os.environ.get('PROTOFLOW_LOCALE', '').lower().startswith('en') else zh


def check_route(home, sid, info, request):
    if not _is_acp_info(home, sid, info) or not info.get('provider') or not info.get('model'):
        raise SettingError(_tr('Hermes 未返回此对话的模型配置', 'Hermes did not return model settings for this session'))
    if encode_model_choice(info['provider'], info['model']) != request['modelId']:
        # Named endpoints can have a different ACP picker ID from their runtime provider.
        from acp_adapter.gateway_session_meta import model_state
        if model_state(info).current_model_id != request['modelId']:
            raise SettingError(_tr('模型已切换，请重新打开推理强度', 'Model changed; please reopen reasoning effort settings'))


def settings(home, sid, info, request):
    check_route(home, sid, info, request)
    model, provider = info['model'], info['provider']
    offered = _main_model_reasoning_efforts(model, provider)
    wire_effort = info['reasoning_effort_wire']
    allowed = set()
    general_levels = False
    if offered is not None:
        from providers import get_provider_profile
        profile = get_provider_profile(provider)
        declared = profile.supported_reasoning_efforts(model) if profile else None
        # Hermes's setup picker handles "none" separately from its effort ladder.
        allowed = set(route_supported_efforts(provider, model, info.get('api_mode'))).intersection([*offered, 'none'])
        general_levels = declared is None and provider not in ('openai-codex', 'openai-api', 'copilot')
        if provider == 'copilot':
            allowed.intersection_update(offered)
        if declared is not None:
            allowed.intersection_update(declared)
        if provider == 'openai-api':
            from agent.model_metadata import openai_model_rejects_reasoning
            from agent.reasoning_effort import codex_supported_efforts
            allowed.intersection_update(() if openai_model_rejects_reasoning(model) else codex_supported_efforts(model))
        elif provider == 'deepseek' and profile is not None:
            # This profile clamps further than session.info's entry-point clamp.
            # Ask its request builder which levels it sends verbatim for this model.
            general_levels = False
            for level in allowed.copy() | ({wire_effort} if wire_effort else set()):
                body, fields = profile.build_api_kwargs_extras(
                    model=model, reasoning_config={'enabled': level != 'none', 'effort': level})
                actual = fields.get('reasoning_effort')
                if level == 'none' and body.get('thinking', {}).get('type') == 'disabled':
                    continue
                if actual != level:
                    allowed.discard(level)
                    if level == info['reasoning_effort_wire'] and actual:
                        wire_effort = actual
        elif provider in ('openrouter', 'nous'):
            from hermes_cli.models_reasoning_caps import openrouter_model_reasoning_capabilities, nous_model_reasoning_capabilities
            lookup = openrouter_model_reasoning_capabilities if provider == 'openrouter' else nous_model_reasoning_capabilities
            caps = lookup(model)
            if caps is not None:
                if caps['supports_reasoning'] is False:
                    allowed.clear()
                elif caps.get('supported_efforts') is not None:
                    general_levels = False
                    allowed.intersection_update(caps['supported_efforts'])
                if caps.get('mandatory'):
                    allowed.discard('none')
    levels = [level for level in EFFORT_LADDER if level in allowed]
    return {'sessionId': request['sessionId'], 'modelId': request['modelId'],
            'levels': levels, 'generalLevels': general_levels, 'current': info['reasoning_effort'], 'wire': wire_effort}


async def main(request):
    home = gateway_profile_home(get_hermes_home())
    sid = logical_session_id(home / 'state.db', request['sessionId'])
    async with connect_gateway() as client:
        info = await client.rpc('session.info', session_id=sid)
        state = settings(home, sid, info, request)
        if 'effort' not in request:
            return state
        effort = request['effort']  # null explicitly restores the profile default
        if effort is not None:
            if not isinstance(effort, str):
                raise SettingError(_tr('推理强度无效', 'Invalid reasoning effort'))
            if not state['levels'] or effort not in state['levels']:
                raise SettingError(_tr('当前模型不支持这个推理强度', 'Current model does not support this reasoning effort'))
        from uuid import uuid4
        snapshot = await client.rpc('session.resume', session_id=sid)
        # Recheck after obtaining the generation/revision fences. A concurrent
        # model switch after this read is rejected by the owner at commit.
        check_route(home, sid, await client.rpc('session.info', session_id=sid), request)
        ack = await client.rpc('session.mutate', session_id=sid, operation='reasoning',
                               payload={'effort': effort}, request_id=uuid4().hex,
                               expected_revision=snapshot['revision'],
                               expected_generation=snapshot['execution_generation'])
        if ack.get('session_id') != sid or ack.get('operation') != 'reasoning' or 'effort' not in ack or ack['effort'] != effort:
            raise SettingError(_tr('Hermes 尚未确认设置，请重新读取当前强度', 'Hermes has not confirmed the setting; please reload current effort'))
        result = settings(home, sid, await client.rpc('session.info', session_id=sid), request)
        if effort is not None and result['current'] != effort:
            raise SettingError(_tr('Hermes 回读的强度与所选档位不一致，请刷新', 'Readback reasoning effort did not match selection; please refresh'))
        return result


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(main(json.load(sys.stdin)))))
    except SettingError as exc:
        print(json.dumps({'error': str(exc)}))
    except Exception as exc:
        # Never forward gateway diagnostics, policy snapshots or provider secrets.
        print(json.dumps({'error': _tr(
            'Hermes 无法读取或修改此会话的推理设置（' + type(exc).__name__ + '）',
            'Hermes could not read or update reasoning settings for this session (' + type(exc).__name__ + ')',
        )}))
