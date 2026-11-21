"""Activate the verified source copy on an idle, unmanaged gateway only.

This runs before ACP attaches. Never uses --yes/--force, never replaces a service
definition, and verifies the *running owner*, not just the installed source.
"""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

root, home = Path(sys.argv[1]), Path(os.environ['HERMES_HOME']).resolve()
policy = json.loads((root / 'alex-adapter.json').read_text())['recoveryPolicy']
channel = hashlib.sha256(os.environ['ALEX_RECOVERY_DIR'].encode()).hexdigest()
sys.path.insert(0, str(root))
from pm.environments import activate_dependencies
activate_dependencies(root)
from hermes_cli.gateway_runtime_discovery import query_identify
from hermes_cli.gateway_lifecycle_guards import live_work
from hermes_cli.gateway_runtime import ensure_gateway_runtime
from gateway.drain_control import write_drain_request, clear_drain_request, drain_request_path
from gateway.control_socket import query_gateway_control


def identify():
    try:
        return query_identify(home, timeout=2)
    except (FileNotFoundError, ConnectionRefusedError):
        return None


def _tr(zh, en):
    return en if os.environ.get('PROTOFLOW_LOCALE', '').lower().startswith('en') else zh


try:
    owner = identify()
    if owner and (owner.get('alex_recovery_policy') != policy or owner.get('alex_recovery_channel') != channel):
        if Path(owner['hermes_home']).resolve() != home or owner.get('supervisor') not in (None, 'none'):
            raise RuntimeError(_tr('当前 Hermes 由独立服务管理，请在维护窗口部署对应的限流适配，未修改该服务', 'Hermes is managed by an external service; deploy rate-limit recovery in your maintenance window. Service was not modified.'))
        work = live_work(home)
        if work is None or work.get('active_agents') != 0 or work.get('active_work'):
            raise RuntimeError(_tr('Hermes 仍有任务运行或无法确认空闲，未重启；任务结束后重新连接以启用限流恢复', 'Hermes still has active tasks or idle state could not be confirmed; reconnect after tasks finish to enable rate-limit recovery.'))
        marker = drain_request_path(home)
        if marker.exists():
            raise RuntimeError(_tr('Hermes 已处于其他维护流程，未覆盖现有维护状态', 'Hermes is already in another maintenance workflow; existing state preserved.'))
        principal = 'alex-recovery-' + uuid.uuid4().hex
        write_drain_request(home=home, principal=principal, suppress_notification=True)
        try:
            # Admission closes before the second work check. New turns cannot
            # enter the read/stop race, and already running work is not interrupted.
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                current = identify()
                if not current or current.get('pid') != owner.get('pid'):
                    raise RuntimeError(_tr('Hermes 运行进程已变化，取消本次适配切换', 'Hermes process changed; cancelled recovery adapter switch.'))
                # identify.state describes the session runtime and does not
                # reflect this version's reversible external drain. The live
                # status verb returns the drain state and its answering PID.
                status = query_gateway_control(home, 'status')
                if isinstance(status, dict) and status.get('answering_pid') == owner.get('pid') and status.get('gateway_state') == 'draining':
                    break
                time.sleep(.1)
            else:
                raise RuntimeError(_tr('Hermes 未确认暂停接收新任务，未重启', 'Hermes did not confirm draining new tasks; not restarted.'))
            work = live_work(home)
            if work is None or work.get('active_agents') != 0 or work.get('active_work'):
                raise RuntimeError(_tr('Hermes 有任务进入执行，取消本次适配切换，现有任务继续运行', 'A task entered execution; cancelled switch so active work continues.'))
            script = 'import sys, runpy; sys.path.insert(0, sys.argv.pop(1)); sys._hermes_pin_default_home=True; import hermes_bootstrap; sys.argv[0]="hermes"; runpy.run_module("hermes_cli.main", run_name="__main__", alter_sys=True)'
            result = subprocess.run([sys.executable, '-I', '-c', script, str(root), 'gateway', 'stop'],
                                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
            if result.returncode:
                raise RuntimeError(_tr('Hermes 未同意空闲切换，原任务和环境保持原状', 'Hermes declined idle switch; active tasks and environment remain unchanged.'))
        finally:
            if marker.exists() and json.loads(marker.read_text()).get('principal') == principal:
                clear_drain_request(home=home)
    result = ensure_gateway_runtime(home, timeout=60, idle_exit=True)
    if result.state != 'ready':
        raise RuntimeError(_tr('Hermes 恢复运行时尚未就绪，请稍后重新连接', 'Hermes recovery runtime is not ready yet; please reconnect shortly.'))
    owner = identify()
    if not owner or owner.get('alex_recovery_policy') != policy or owner.get('alex_recovery_channel') != channel:
        raise RuntimeError(_tr('当前 Gateway 未加载限流恢复适配，已停止连接，避免误报修复生效', 'Current Gateway did not load rate-limit recovery adapter; connection stopped to avoid false readiness.'))
    print(json.dumps({'ready': True}))
except Exception as error:
    # No raw subprocess stderr, credentials, or provider payloads leave this boundary.
    print(json.dumps({'ready': False, 'error': str(error) if isinstance(error, RuntimeError) else _tr('Hermes 恢复运行时启动失败', 'Failed to start Hermes recovery runtime')}))
    sys.exit(1)
