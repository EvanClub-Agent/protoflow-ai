"""Gateway activation must never interrupt existing work or bypass ownership."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'electron/hermes-recovery-gateway.py'


class GatewayTests(unittest.TestCase):
    def check_activation(self, mode):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); home=root/'home'; home.mkdir()
            (root/'alex-adapter.json').write_text(json.dumps({'recoveryPolicy':'verified-policy'}))
            channel=str(root/'channel'); fingerprint=hashlib.sha256(channel.encode()).hexdigest()
            marker=home/'.drain_request.json'; calls=[]; reads=0; stopped=False; started=False
            if mode=='existing-drain': marker.write_text('{"principal":"another-maintainer"}')
            def identify(home, timeout):
                current={'pid':123,'hermes_home':str(home),'supervisor':'none','state':'running'}
                if mode=='managed': current['supervisor']='systemd'
                if marker.exists(): current['state']='draining'
                if mode=='compatible' or started:
                    current.update(alex_recovery_policy='verified-policy',alex_recovery_channel=fingerprint)
                if mode=='wrong-owner' and started: current['alex_recovery_policy']='unverified'
                return current
            def work(home):
                nonlocal reads
                reads+=1
                active=mode=='active' or (mode=='new-work' and reads==2)
                return {'active_agents':1 if active else 0,'active_work':['active'] if active else []}
            def write(**kw):
                calls.append('drain'); marker.write_text(json.dumps({'principal':kw['principal']}))
            def clear(**kw): calls.append('clear'); marker.unlink()
            def stop(args, **kw):
                nonlocal stopped
                self.assertEqual(args[-2:],['gateway','stop'])
                self.assertNotIn('--yes',args);self.assertNotIn('--force',args)
                self.assertTrue(marker.exists());self.assertEqual(reads,2)
                calls.append('stop');stopped=True;return SimpleNamespace(returncode=0)
            def ensure(home, **kw):
                nonlocal started
                self.assertTrue(stopped or mode=='compatible');self.assertFalse(marker.exists())
                calls.append('ensure');started=True;return SimpleNamespace(state='ready')
            modules={
                'pm.environments':SimpleNamespace(activate_dependencies=lambda root:None),
                'hermes_cli.gateway_runtime_discovery':SimpleNamespace(query_identify=identify),
                'hermes_cli.gateway_lifecycle_guards':SimpleNamespace(live_work=work),
                'hermes_cli.gateway_runtime':SimpleNamespace(ensure_gateway_runtime=ensure),
                'gateway.drain_control':SimpleNamespace(write_drain_request=write,clear_drain_request=clear,drain_request_path=lambda home:marker),
                'gateway.control_socket':SimpleNamespace(query_gateway_control=lambda home, verb: {'answering_pid':123,'gateway_state':'draining' if marker.exists() else 'running'}),
            }
            output=io.StringIO(); oldpath=list(sys.path)
            try:
                with patch.dict(sys.modules,modules), patch.dict(os.environ,{'HERMES_HOME':str(home),'ALEX_RECOVERY_DIR':channel}), \
                     patch.object(sys,'argv',[str(SCRIPT),str(root)]), patch('subprocess.run',stop), contextlib.redirect_stdout(output):
                    try: runpy.run_path(str(SCRIPT),run_name='__main__')
                    except SystemExit as error: self.assertEqual(error.code,1)
            finally: sys.path[:]=oldpath
            result=json.loads(output.getvalue())
            if mode=='compatible':
                self.assertTrue(result['ready']);self.assertEqual(calls,['ensure'])
            elif mode=='idle':
                self.assertTrue(result['ready']);self.assertEqual(calls,['drain','stop','clear','ensure'])
            else:
                self.assertFalse(result['ready'])
                if mode in ('active','managed','existing-drain'): self.assertEqual(calls,[])
                if mode=='existing-drain': self.assertEqual(json.loads(marker.read_text())['principal'],'another-maintainer')
                if mode=='new-work': self.assertEqual(calls,['drain','clear']);self.assertFalse(marker.exists())

    def test_reuses_compatible_owner(self): self.check_activation('compatible')
    def test_idle_owner_is_drained_before_stop(self): self.check_activation('idle')
    def test_active_work_never_stopped(self): self.check_activation('active')
    def test_managed_service_never_replaced(self): self.check_activation('managed')
    def test_racing_work_continues_and_drain_is_cancelled(self): self.check_activation('new-work')
    def test_existing_maintenance_is_not_overwritten(self): self.check_activation('existing-drain')
    def test_actual_owner_must_confirm_policy(self): self.check_activation('wrong-owner')


if __name__=='__main__': unittest.main()
