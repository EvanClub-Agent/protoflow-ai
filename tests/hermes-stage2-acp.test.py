"""Stage 2 staged Hermes v0.23.1 adapter/policy fault-injection probes (Probes 1-6).

Note on test boundary:
- Probes 2-6 instantiate the staged `GatewayACPAgent` / `PendingControls` with `FakeGatewayClient`
  and `FakeEditorConn` for deterministic microsecond race injection (e.g. event-before-ACK timeout,
  mid-await projector overtaking, reconnect conn_gen races, and replay_gap prompt dedup).
- Full OS-process stdio ACP + live local Gateway daemon + MCP stdio transport is verified in
  `tests/stage2-recovery.test.ts` (Probe 14).
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest

REPO_ROOT = Path(__file__).resolve().parents[1]
HERMES_ROOT = Path.home() / ".hermes" / "hermes-agent"
CONTEXT_SCRIPT = REPO_ROOT / "electron" / "hermes-context.py"


def _stage_native_recovery(stage_data_dir: Path) -> Path:
    script = """
    const { prepareNativeRecovery } = require('./electron/hermes-recovery-native.cjs');
    (async () => {
      const out = await prepareNativeRecovery(process.argv[1], process.argv[2]);
      process.stdout.write(out);
    })().catch(err => {
      console.error(err);
      process.exit(1);
    });
    """
    proc = subprocess.run(
        ["node", "-e", script, str(HERMES_ROOT), str(stage_data_dir)],
        cwd=str(REPO_ROOT),
        check=True,
        capture_output=True,
        text=True,
    )
    return Path(proc.stdout.strip())


def _run_hermes_runtime_wire_probe(payload: dict) -> dict:
    script = r"""
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { EventEmitter } = require('node:events');
    const { HermesRuntime } = require('./electron/hermes-runtime.cjs');

    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-stage2-wire-'));
    const emitted = [];
    const clientReplies = [];
    const clientRejects = [];

    (async () => {
      try {
        const runtime = new HermesRuntime({
          dataDir: tmpDir,
          emit: (evt) => emitted.push(evt),
        });
        const mockClient = new EventEmitter();
        mockClient.closed = false;
        mockClient.reply = (id, result) => clientReplies.push({ id, result });
        mockClient.reject = (id, message) => clientRejects.push({ id, message });
        runtime.client = mockClient;

        const key = JSON.stringify([input.projectId, 'project-page-exec', null, input.targetPageId]);
        const dir = path.join(tmpDir, 'exec-cwd');
        fs.mkdirSync(dir, { recursive: true });
        const session = {
          projectId: input.projectId,
          kind: 'project',
          targetPageId: input.targetPageId,
          sessionId: input.execSessionId,
          planningSessionId: input.planningSessionId,
          execSessionId: input.execSessionId,
          taskKey: key,
          isPageExec: true,
          dir,
          running: Boolean(input.running),
          cancelled: false,
          boundAdmissionId: null,
          runId: input.activeRunId || '',
          text: '',
          tools: [],
          models: { currentModelId: 'mock-model', availableModels: [] },
        };
        runtime.pageSessions.set(key, session);

        for (const frame of input.frames) {
          if (frame.kind === 'notification') {
            runtime.onNotification({ method: frame.method, params: frame.params });
          } else if (frame.kind === 'request') {
            runtime.onRequest({ id: frame.id, method: frame.method, params: frame.params });
          }
        }
        process.stdout.write(JSON.stringify({
          sessionText: session.text,
          emitted,
          clientReplies,
          clientRejects,
        }));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
    """
    proc = subprocess.run(
        ["node", "-e", script],
        cwd=str(REPO_ROOT),
        input=json.dumps(payload),
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(proc.stdout)


class FakeEditorConn:
    """Captures exact ACP wire calls produced by GatewayACPAgent."""

    def __init__(self, on_update=None, on_permission=None, on_raw_request=None):
        self.updates = []
        self.permissions = []
        self.raw_requests = []
        self._on_update = on_update
        self._on_permission = on_permission
        self._on_raw_request = on_raw_request
        self._conn = SimpleNamespace(send_request=self._send_request)

    async def session_update(self, *, session_id, update, **kwargs):
        assert "field_meta" not in kwargs, "AgentSideConnection packs **kwargs into SessionNotification.field_meta (_meta)"
        record = {
            "session_id": session_id,
            "update": update,
            "field_meta": dict(kwargs) if kwargs else None,
            "kwargs": kwargs,
        }
        self.updates.append(record)
        if self._on_update is not None:
            await self._on_update(record)

    async def request_permission(self, *, session_id, tool_call, options, **kwargs):
        from acp.schema import AllowedOutcome, RequestPermissionResponse

        assert "field_meta" not in kwargs, "AgentSideConnection packs **kwargs into RequestPermissionRequest.field_meta (_meta)"
        record = {
            "session_id": session_id,
            "tool_call": tool_call,
            "options": options,
            "field_meta": dict(kwargs) if kwargs else None,
            "kwargs": kwargs,
        }
        self.permissions.append(record)
        if self._on_permission is not None:
            return await self._on_permission(record)
        option_id = options[0].option_id if options else "allow_once"
        return RequestPermissionResponse(outcome=AllowedOutcome(outcome="selected", option_id=option_id))

    async def _send_request(self, method, params):
        record = {"method": method, "params": params}
        self.raw_requests.append(record)
        if self._on_raw_request is not None:
            return await self._on_raw_request(record)
        return {"action": "accept", "content": {"answer": "确认"}}


class FakeGatewayClient:
    """In-memory Gateway RPC + raw events queue matching hermes_cli.gateway_client."""

    def __init__(self, profile_home: Path, rpc_handler):
        self.profile_home = profile_home
        self._rpc_handler = rpc_handler
        self.events: asyncio.Queue = asyncio.Queue()
        self.reader: asyncio.Future = asyncio.get_running_loop().create_future()
        self.rpc_calls: list[tuple[str, dict]] = []

    async def rpc(self, verb: str, **kwargs):
        self.rpc_calls.append((verb, dict(kwargs)))
        return await self._rpc_handler(self, verb, kwargs)


class FakeGatewayConnection:
    def __init__(self, client: FakeGatewayClient):
        self._client = client
        self.exited = False

    async def __aenter__(self):
        return self._client

    async def __aexit__(self, exc_type, exc, tb):
        self.exited = True
        if not self._client.reader.done():
            self._client.reader.set_result(True)
        return False


def _make_gateway_event(session_id: str, seq: int, event_type: str, payload: dict, *, admission_id=None, epoch="ep-1", gen=1):
    params = {
        "session_id": session_id,
        "replay_epoch": epoch,
        "seq": seq,
        "execution_generation": gen,
        "type": event_type,
        "payload": payload,
    }
    if admission_id is not None:
        params["admission_id"] = admission_id
    return {"method": "gateway.event", "params": params}


def _base_snapshot(session_id: str, cwd: str, *, epoch="ep-1", seq=0, gen=1, pending=None, prompts=None):
    return {
        "session_id": session_id,
        "subscription_id": f"sub-{session_id}",
        "replay_epoch": epoch,
        "last_sequence": seq,
        "revision": 1,
        "execution_generation": gen,
        "pending": list(pending or []),
        "prompts": list(prompts or []),
        "messages": [],
        "info": {
            "session_id": session_id,
            "cwd": cwd,
            "model": "gpt-4o",
            "provider": "openai",
            "edit_approval_policy": "ask",
        },
    }


@unittest.skipUnless(HERMES_ROOT.exists(), "Local Hermes v0.23.1 installation required")
class HermesStage2AcpProbes(unittest.IsolatedAsyncioTestCase):
    staged_root: Path
    stage_parent: tempfile.TemporaryDirectory

    @classmethod
    def setUpClass(cls):
        cls.stage_parent = tempfile.TemporaryDirectory(prefix="alex-stage2-native-")
        cls.staged_root = _stage_native_recovery(Path(cls.stage_parent.name))
        sys.path.insert(0, str(cls.staged_root))
        sys._hermes_pin_default_home = True
        import hermes_bootstrap  # noqa: F401

    @classmethod
    def tearDownClass(cls):
        if str(cls.staged_root) in sys.path:
            sys.path.remove(str(cls.staged_root))
        cls.stage_parent.cleanup()

    def test_probe1_acp_surface_and_session_search_isolation_and_lineage_history(self):
        """Probe 1: Tri-state ACP identity, full-path session_search disabling, cross-profile guard, and lineage recall."""
        from agent.alex_acp_surface import classify_session_surface
        from gateway.run_turn import GatewayTurnMixin
        from hermes_state import SessionDB
        from tools.session_search_tool import session_search
        import toolsets

        with tempfile.TemporaryDirectory(prefix="alex-probe1-") as tmp:
            tmp_path = Path(tmp)
            home = tmp_path / "hermes_home"
            home.mkdir(parents=True)
            real_default_home = Path.home() / ".hermes"
            for sub in ("installs", "tools"):
                src_sub = real_default_home / sub
                if src_sub.exists():
                    (home / sub).symlink_to(src_sub)
            recovery_dir = tmp_path / "recovery"
            recovery_dir.mkdir()

            real_proj_cwd = tmp_path / "real_workspace" / "project_alpha"
            real_proj_cwd.mkdir(parents=True)
            symlink_proj_cwd = tmp_path / "symlink_project_alpha"
            symlink_proj_cwd.symlink_to(real_proj_cwd)

            other_cwd = tmp_path / "real_workspace" / "project_beta"
            other_cwd.mkdir(parents=True)

            db = SessionDB(db_path=home / "state.db")
            try:
                # 1. Seed diverse session rows for tri-state classification
                db.create_session("sid-acp", source="acp", model="gpt-4o", cwd=str(real_proj_cwd))
                db.append_message("sid-acp", "user", "规划阶段确认采购单号使用 PO-2026 前缀")

                db.create_session("sid-local-acp", source="local", model="gpt-4o", cwd=str(real_proj_cwd))
                with db._lock, db._conn:
                    db._conn.execute(
                        "UPDATE sessions SET created_source = ?, end_reason = ? WHERE id = ?",
                        ("acp", "compression", "sid-local-acp"),
                    )
                db.append_message("sid-local-acp", "assistant", "旧压缩分片记录供应商账期 T+45 天")

                db.create_session(
                    "sid-compressed-child",
                    source="local",
                    model="gpt-4o",
                    parent_session_id="sid-local-acp",
                    cwd=str(real_proj_cwd),
                )
                db.append_message("sid-compressed-child", "assistant", "迁移前子会话约定默认币种 CNY")

                db.create_session("sid-receipt-acp", source="local", model="gpt-4o", cwd=str(real_proj_cwd))
                with db._lock, db._conn:
                    cols = {r[1] for r in db._conn.execute("PRAGMA table_info(sessions)").fetchall()}
                    if "local_receipt" in cols:
                        db._conn.execute(
                            "UPDATE sessions SET local_receipt = ? WHERE id = ?",
                            (json.dumps({"policy": {"source": "acp"}}), "sid-receipt-acp"),
                        )
                    else:
                        db._conn.execute(
                            "UPDATE sessions SET created_source = ? WHERE id = ?",
                            ("acp", "sid-receipt-acp"),
                        )

                db.create_session("sid-exec-cur", source="acp", model="gpt-4o", cwd=str(real_proj_cwd))
                db.append_message("sid-exec-cur", "user", "正在生成结算单页面")

                db.create_session("sid-unmarked-local", source="local", model="gpt-4o", cwd=str(real_proj_cwd))
                db.create_session("sid-cli", source="cli", model="gpt-4o", cwd=str(real_proj_cwd))
                db.append_message("sid-cli", "user", "CLI 独立会话里的 PO-2026 笔记")
                db.create_session("sid-tui", source="tui", model="gpt-4o", cwd=str(real_proj_cwd))

                db.create_session("sid-other-cwd-acp", source="acp", model="gpt-4o", cwd=str(other_cwd))
                db.append_message("sid-other-cwd-acp", "user", "另一个项目的 PO-2026 机密规则")

                # Verify tri-state classification
                self.assertEqual(classify_session_surface(db, "sid-acp"), "acp")
                self.assertEqual(classify_session_surface(db, "sid-local-acp"), "acp")
                self.assertEqual(classify_session_surface(db, "sid-compressed-child"), "acp")
                self.assertEqual(classify_session_surface(db, "sid-receipt-acp"), "acp")
                self.assertEqual(classify_session_surface(db, None), "unknown")
                self.assertEqual(classify_session_surface(db, ""), "unknown")
                self.assertEqual(classify_session_surface(db, "missing-session-uuid"), "unknown")
                self.assertEqual(classify_session_surface(None, "sid-acp"), "unknown")
                self.assertEqual(classify_session_surface(db, "sid-unmarked-local"), "unknown")
                self.assertEqual(classify_session_surface(db, "sid-cli"), "non_acp")
                self.assertEqual(classify_session_surface(db, "sid-tui"), "non_acp")
            finally:
                db.close()

            # Seed another profile to test @session:<profile>/<id> and profile= cross-profile bypass
            other_profile_dir = home / "profiles" / "other_prof"
            other_profile_dir.mkdir(parents=True)
            other_db = SessionDB(db_path=other_profile_dir / "state.db")
            try:
                other_db.create_session("secret-sess", source="cli", model="gpt-4o", cwd=str(other_cwd))
                other_db.append_message("secret-sess", "user", "CROSS_PROFILE_TOP_SECRET_9912")
            finally:
                other_db.close()

            env_patch = {
                "HERMES_HOME": str(home),
                "ALEX_RECOVERY_DIR": str(recovery_dir),
            }
            old_env = {k: os.environ.get(k) for k in env_patch}
            try:
                os.environ.update(env_patch)

                # 2. Toolset stripping on ACP vs CLI/TUI across toolsets.py and gateway/run_turn.py
                self.assertIn("session_search", toolsets.session_platform_tool_drops("acp"))
                self.assertNotIn("session_search", toolsets.session_platform_tool_drops("cli"))
                self.assertNotIn("session_search", toolsets.session_platform_tool_drops("tui"))

                self.assertIn("session_search", toolsets.session_disabled_toolsets(None, "acp") or [])
                self.assertNotIn("session_search", toolsets.session_disabled_toolsets(None, "cli") or [])
                sample_schemas = [
                    {"type": "function", "function": {"name": "session_search"}},
                    {"type": "function", "function": {"name": "read_file"}},
                ]
                acp_surface = toolsets.agent_tool_surface(SimpleNamespace(platform="acp"), sample_schemas)
                cli_surface = toolsets.agent_tool_surface(SimpleNamespace(platform="cli"), sample_schemas)
                self.assertEqual([t["function"]["name"] for t in acp_surface], ["read_file"])
                self.assertEqual([t["function"]["name"] for t in cli_surface], ["session_search", "read_file"])

                dummy_runner = SimpleNamespace(_resolve_enabled_toolsets_for_source=lambda cfg, src, pk: ["all"])
                _, gw_disabled_acp = GatewayTurnMixin._resolve_turn_toolsets(dummy_runner, {}, None, "acp")
                _, gw_disabled_cli = GatewayTurnMixin._resolve_turn_toolsets(dummy_runner, {}, None, "cli")
                self.assertIn("session_search", gw_disabled_acp or [])
                self.assertNotIn("session_search", gw_disabled_cli or [])

                # 3. Execution-layer guard blocks ACP, local+acp, and unknown callers BEFORE cross-profile swap
                for blocked_caller in ("sid-acp", "sid-local-acp", "sid-compressed-child", None, "", "missing-id", "sid-unmarked-local"):
                    res_plain = json.loads(session_search(query="PO-2026", current_session_id=blocked_caller))
                    self.assertFalse(res_plain.get("success"), f"Expected block for caller={blocked_caller!r}")
                    self.assertIn("protoflow_search_history", res_plain.get("error", ""))

                    res_profile = json.loads(
                        session_search(
                            query="@session:other_prof/secret-sess",
                            profile="other_prof",
                            current_session_id=blocked_caller,
                        )
                    )
                    self.assertFalse(res_profile.get("success"))
                    self.assertNotIn("CROSS_PROFILE_TOP_SECRET_9912", json.dumps(res_profile))

                    res_direct = json.loads(
                        session_search(
                            session_id="secret-sess",
                            profile="other_prof",
                            current_session_id=blocked_caller,
                        )
                    )
                    self.assertFalse(res_direct.get("success"))
                    self.assertNotIn("CROSS_PROFILE_TOP_SECRET_9912", json.dumps(res_direct))

                # Confirmed CLI caller still works
                cli_res = json.loads(session_search(query="PO-2026", current_session_id="sid-cli"))
                self.assertTrue(cli_res.get("success"))

                # 4. Controlled electron/hermes-context.py search_history recalls across lineage + compressed segments + planningSessionId
                def run_context_search(req: dict) -> dict:
                    proc = subprocess.run(
                        [sys.executable, "-I", "-c", CONTEXT_SCRIPT.read_text("utf-8"), str(self.staged_root)],
                        env={**os.environ, **env_patch},
                        input=json.dumps(req),
                        check=True,
                        capture_output=True,
                        text=True,
                    )
                    return json.loads(proc.stdout)

                valid_allowed = [
                    {"sessionId": "sid-exec-cur", "role": "page_execution", "expectedCwd": str(symlink_proj_cwd)},
                    {"sessionId": "sid-compressed-child", "role": "page_execution_prior", "expectedCwd": str(symlink_proj_cwd)},
                    {"sessionId": "sid-acp", "role": "project_planning", "expectedCwd": str(symlink_proj_cwd)},
                ]
                po_hits = run_context_search({
                    "action": "history",
                    "sessionId": "sid-exec-cur",
                    "allowedHistorySessions": valid_allowed,
                    "query": "PO-2026",
                })
                self.assertNotIn("error", po_hits, f"Unexpected error: {po_hits}")
                hit_sessions = {m["sourceSessionId"] for m in po_hits["matches"]}
                self.assertEqual(hit_sessions, {"sid-acp"})

                # Recall compressed parent ("sid-local-acp") via child ("sid-compressed-child") in allowedHistorySessions
                compressed_hits = run_context_search({
                    "action": "history",
                    "sessionId": "sid-exec-cur",
                    "allowedHistorySessions": valid_allowed,
                    "query": "T+45",
                })
                self.assertNotIn("error", compressed_hits)
                self.assertEqual([m["sourceSessionId"] for m in compressed_hits["matches"]], ["sid-compressed-child"])
                self.assertIn("T+45", compressed_hits["matches"][0]["text"])

                # Regular menu conversation (`role="menu_session"`) recalls both `source="acp"` and `local + created_source="acp"`
                menu_hits_acp = run_context_search({
                    "action": "history",
                    "sessionId": "sid-acp",
                    "allowedHistorySessions": [
                        {"sessionId": "sid-acp", "role": "menu_session", "expectedCwd": str(symlink_proj_cwd)},
                    ],
                    "query": "PO-2026",
                })
                self.assertNotIn("error", menu_hits_acp, f"Unexpected error: {menu_hits_acp}")
                self.assertEqual([m["sourceRole"] for m in menu_hits_acp["matches"]], ["menu_session"])

                menu_hits_local_acp = run_context_search({
                    "action": "history",
                    "sessionId": "sid-compressed-child",
                    "allowedHistorySessions": [
                        {"sessionId": "sid-compressed-child", "role": "menu_session", "expectedCwd": str(symlink_proj_cwd)},
                    ],
                    "query": "T+45",
                })
                self.assertNotIn("error", menu_hits_local_acp, f"Unexpected error: {menu_hits_local_acp}")
                self.assertEqual([m["sourceRole"] for m in menu_hits_local_acp["matches"]], ["menu_session"])

                unknown_role_res = run_context_search({
                    "action": "history",
                    "sessionId": "sid-acp",
                    "allowedHistorySessions": [
                        {"sessionId": "sid-acp", "role": "unknown_role", "expectedCwd": str(symlink_proj_cwd)},
                    ],
                    "query": "PO-2026",
                })
                self.assertIn("error", unknown_role_res)

                # Missing/empty allowedHistorySessions, wrong cwd entry, or non-ACP entry fail closed with {"error": ...}
                empty_allow = run_context_search({
                    "action": "history",
                    "sessionId": "sid-exec-cur",
                    "allowedHistorySessions": [],
                    "query": "PO-2026",
                })
                self.assertIn("error", empty_allow)
                self.assertEqual(empty_allow.get("matches", []), [])

                wrong_cwd = run_context_search({
                    "action": "history",
                    "sessionId": "sid-exec-cur",
                    "allowedHistorySessions": [
                        *valid_allowed,
                        {"sessionId": "sid-other-cwd-acp", "role": "conversation", "expectedCwd": str(symlink_proj_cwd)},
                    ],
                    "query": "PO-2026",
                })
                self.assertIn("error", wrong_cwd)

                non_acp_entry = run_context_search({
                    "action": "history",
                    "sessionId": "sid-exec-cur",
                    "allowedHistorySessions": [
                        *valid_allowed,
                        {"sessionId": "sid-cli", "role": "conversation", "expectedCwd": str(real_proj_cwd)},
                    ],
                    "query": "PO-2026",
                })
                self.assertIn("error", non_acp_entry)

                non_acp_caller = run_context_search({
                    "action": "history",
                    "sessionId": "sid-cli",
                    "allowedHistorySessions": [
                        {"sessionId": "sid-cli", "role": "conversation", "expectedCwd": str(real_proj_cwd)},
                    ],
                    "query": "PO-2026",
                })
                self.assertIn("error", non_acp_caller)
            finally:
                for k, v in old_env.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v

    async def test_probe2_raw_gateway_late_frame_attribution_and_host_isolation(self):
        """Probe 2: Late aid_1 frames arriving during run_2 keep alex_run_id='run_1' and are dropped by HermesRuntime."""
        import acp
        from acp_adapter.gateway_server import GatewayACPAgent

        with tempfile.TemporaryDirectory(prefix="alex-probe2-") as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            cwd = str(Path(tmp) / "cwd")
            os.makedirs(cwd, exist_ok=True)
            sid = "exec-sess-p2"

            submit_seq = 0
            run2_started = asyncio.Event()
            allow_run2_finish = asyncio.Event()

            async def rpc_handler(client: FakeGatewayClient, verb: str, kwargs: dict):
                nonlocal submit_seq
                if verb == "runtime.describe":
                    return {
                        "profile_id": str(home.resolve()),
                        "capabilities": ["acp-editor-policy-v1", "acp-session-mcp-v1"],
                        "session_create": {"sources": ["acp"]},
                    }
                if verb == "prompt.submit":
                    submit_seq += 1
                    if submit_seq == 1:
                        client.events.put_nowait(
                            _make_gateway_event(sid, 1, "message.delta", {"text": "RUN1_OK"}, admission_id="aid_1")
                        )
                        client.events.put_nowait(
                            _make_gateway_event(
                                sid, 2, "message.complete", {"text": "RUN1_OK", "outcome": "completed"}, admission_id="aid_1"
                            )
                        )
                        return {"admission_id": "aid_1", "status": "started"}
                    run2_started.set()
                    return {"admission_id": "aid_2", "status": "started"}
                if verb == "prompt.respond":
                    return {"status": "already_resolved"}
                return {}

            old_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = str(home)
            try:
                agent = GatewayACPAgent()
                conn = FakeEditorConn()
                agent._conn = conn
                gw_client = FakeGatewayClient(home, rpc_handler)
                agent._connection = FakeGatewayConnection(gw_client)
                agent._gateway = gw_client
                agent._snapshots[sid] = _base_snapshot(sid, cwd)
                agent._event_task = asyncio.create_task(agent._events())

                try:
                    # Complete run_1
                    res1 = await agent.prompt(
                        [acp.text_block("first prompt")],
                        sid,
                        field_meta={"alex_run_id": "run_1"},
                    )
                    self.assertEqual(res1.stop_reason, "end_turn")

                    # Start run_2 on the exact same session
                    conn.updates.clear()
                    conn.permissions.clear()
                    run2_task = asyncio.create_task(
                        agent.prompt(
                            [acp.text_block("second prompt")],
                            sid,
                            field_meta={"alex_run_id": "run_2"},
                        )
                    )
                    await asyncio.wait_for(run2_started.wait(), timeout=2.0)
                    await asyncio.sleep(0.02)

                    # Inject late aid_1 events into raw gateway.events DURING active run_2!
                    gw_client.events.put_nowait(
                        _make_gateway_event(
                            sid, 3, "message.delta", {"text": "LATE_AID1_POLLUTION "}, admission_id="aid_1"
                        )
                    )
                    gw_client.events.put_nowait(
                        _make_gateway_event(
                            sid,
                            4,
                            "tool.start",
                            {"tool_call_id": "call-late-1", "tool_name": "protoflow_get_project", "args": {}},
                            admission_id="aid_1",
                        )
                    )
                    gw_client.events.put_nowait(
                        _make_gateway_event(
                            sid,
                            5,
                            "clarify.request",
                            {
                                "kind": "clarify",
                                "prompt_id": "clarify-late-1",
                                "execution_generation": 1,
                                "question": "来自旧轮次的迟到提问？",
                                "choices": ["选项A", "选项B"],
                                "multi_select": False,
                                "admission_id": "aid_1",
                            },
                            admission_id="aid_1",
                        )
                    )
                    # Now emit genuine aid_2 output and completion
                    gw_client.events.put_nowait(
                        _make_gateway_event(
                            sid, 6, "message.delta", {"text": "CLEAN_RUN2_TEXT"}, admission_id="aid_2"
                        )
                    )
                    gw_client.events.put_nowait(
                        _make_gateway_event(
                            sid,
                            7,
                            "message.complete",
                            {"text": "CLEAN_RUN2_TEXT", "outcome": "completed"},
                            admission_id="aid_2",
                        )
                    )

                    res2 = await asyncio.wait_for(run2_task, timeout=2.0)
                    self.assertEqual(res2.stop_reason, "end_turn")
                    await asyncio.sleep(0.05)

                    # Verify GatewayACPAgent NEVER stamped run_2 onto aid_1 frames!
                    aid1_updates = [u for u in conn.updates if (u["field_meta"] or {}).get("admission_id") == "aid_1"]
                    aid2_updates = [u for u in conn.updates if (u["field_meta"] or {}).get("admission_id") == "aid_2"]
                    self.assertTrue(len(aid1_updates) >= 2)
                    for u in aid1_updates:
                        self.assertEqual(u["field_meta"], {"admission_id": "aid_1", "alex_run_id": "run_1"})
                    self.assertTrue(len(aid2_updates) >= 1)
                    for u in aid2_updates:
                        self.assertEqual(u["field_meta"], {"admission_id": "aid_2", "alex_run_id": "run_2"})

                    self.assertEqual(len(conn.permissions), 1)
                    self.assertEqual(
                        conn.permissions[0]["field_meta"],
                        {"alex_control_kind": "turn", "admission_id": "aid_1", "alex_run_id": "run_1"},
                    )

                    # Feed the exact wire frames into real HermesRuntime during active run_2
                    wire_frames = []
                    for u in conn.updates:
                        wire_frames.append({
                            "kind": "notification",
                            "method": "session/update",
                            "params": {
                                "sessionId": u["session_id"],
                                "update": u["update"].model_dump(by_alias=True, exclude_none=True),
                                "_meta": u["field_meta"],
                            },
                        })
                    for idx, p in enumerate(conn.permissions):
                        wire_frames.append({
                            "kind": "request",
                            "id": f"perm-{idx}",
                            "method": "session/request_permission",
                            "params": {
                                "sessionId": p["session_id"],
                                "toolCall": p["tool_call"].model_dump(by_alias=True, exclude_none=True),
                                "options": [o.model_dump(by_alias=True, exclude_none=True) for o in p["options"]],
                                "_meta": p["field_meta"],
                            },
                        })

                    host_result = _run_hermes_runtime_wire_probe({
                        "projectId": "proj-p2",
                        "targetPageId": "page-orders",
                        "planningSessionId": "plan-sess-p2",
                        "execSessionId": sid,
                        "running": True,
                        "activeRunId": "run_2",
                        "frames": wire_frames,
                    })
                    self.assertEqual(host_result["sessionText"], "CLEAN_RUN2_TEXT")
                    self.assertNotIn("LATE_AID1_POLLUTION", host_result["sessionText"])
                    self.assertEqual(
                        [e for e in host_result["emitted"] if e.get("type") in ("question", "permission")],
                        [],
                    )
                    self.assertEqual(host_result["clientReplies"], [])
                    self.assertEqual(len(host_result["clientRejects"]), 1)
                    self.assertEqual(host_result["clientRejects"][0]["id"], "perm-0")
                finally:
                    await agent.aclose()
            finally:
                if old_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = old_home

    async def test_probe3_ack_timeout_never_blocks_other_sessions_or_resends(self):
        """Probe 3: First frame arriving before prompt.submit ACK timeout never blocks session_2 or auto-resends."""
        import acp
        from acp_adapter.gateway_server import GatewayACPAgent

        with tempfile.TemporaryDirectory(prefix="alex-probe3-") as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            cwd = str(Path(tmp) / "cwd")
            os.makedirs(cwd, exist_ok=True)
            s1, s2 = "sess-ack-timeout", "sess-healthy"

            s1_submit_entered = asyncio.Event()
            fail_s1_submit = asyncio.Event()

            async def rpc_handler(client: FakeGatewayClient, verb: str, kwargs: dict):
                if verb == "prompt.submit":
                    target = kwargs["session_id"]
                    if target == s1:
                        # Emit s1's first event BEFORE prompt.submit returns its ACK!
                        client.events.put_nowait(
                            _make_gateway_event(s1, 1, "message.delta", {"text": "UNACKED_S1"}, admission_id="aid_s1")
                        )
                        s1_submit_entered.set()
                        await fail_s1_submit.wait()
                        raise TimeoutError("prompt.submit ACK timed out")
                    if target == s2:
                        client.events.put_nowait(
                            _make_gateway_event(s2, 1, "message.delta", {"text": "S2_STREAM_OK"}, admission_id="aid_s2")
                        )
                        client.events.put_nowait(
                            _make_gateway_event(
                                s2, 2, "message.complete", {"text": "S2_STREAM_OK", "outcome": "completed"}, admission_id="aid_s2"
                            )
                        )
                        return {"admission_id": "aid_s2", "status": "started"}
                return {}

            old_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = str(home)
            try:
                agent = GatewayACPAgent()
                conn = FakeEditorConn()
                agent._conn = conn
                gw_client = FakeGatewayClient(home, rpc_handler)
                agent._connection = FakeGatewayConnection(gw_client)
                agent._gateway = gw_client
                agent._snapshots[s1] = _base_snapshot(s1, cwd)
                agent._snapshots[s2] = _base_snapshot(s2, cwd)
                agent._event_task = asyncio.create_task(agent._events())

                try:
                    s1_task = asyncio.create_task(
                        agent.prompt([acp.text_block("slow ack prompt")], s1, field_meta={"alex_run_id": "run_s1"})
                    )
                    await asyncio.wait_for(s1_submit_entered.wait(), timeout=2.0)
                    await asyncio.sleep(0.03)
                    # Verify s1's drainer is parked on SubmitAckGate
                    self.assertIn(s1, agent._submit_gates)
                    self.assertIn(s1, agent._session_drainers)

                    # While s1 is STILL blocked waiting for ACK, run s2 to completion!
                    s2_res = await asyncio.wait_for(
                        agent.prompt([acp.text_block("healthy prompt")], s2, field_meta={"alex_run_id": "run_s2"}),
                        timeout=2.0,
                    )
                    self.assertEqual(s2_res.stop_reason, "end_turn")
                    s2_updates = [u for u in conn.updates if u["session_id"] == s2]
                    self.assertTrue(any(u["field_meta"] == {"admission_id": "aid_s2", "alex_run_id": "run_s2"} for u in s2_updates))

                    # Now fail s1's ACK with TimeoutError
                    fail_s1_submit.set()
                    with self.assertRaises(TimeoutError):
                        await asyncio.wait_for(s1_task, timeout=2.0)
                    await asyncio.sleep(0.05)

                    # 1. Never auto-resent prompt.submit for s1
                    s1_submits = [c for verb, c in gw_client.rpc_calls if verb == "prompt.submit" and c.get("session_id") == s1]
                    self.assertEqual(len(s1_submits), 1)

                    # 2. Unattributed s1 frame resolved with alex_run_id=None (never guessed run_s1!)
                    s1_updates = [u for u in conn.updates if u["session_id"] == s1]
                    self.assertEqual(len(s1_updates), 1)
                    self.assertEqual(s1_updates[0]["field_meta"], {"admission_id": "aid_s1", "alex_run_id": None})

                    # 3. Zero leaked gates or drainers
                    self.assertEqual(agent._submit_gates, {})
                    self.assertEqual(agent._session_drainers, {})
                finally:
                    await agent.aclose()
            finally:
                if old_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = old_home

    async def test_probe4_active_drainer_prevents_complete_and_recover_overtaking(self):
        """Probe 4: Dequeued last delta paused inside await session_update blocks complete/recover overtaking on s1 without blocking s2."""
        import acp
        from acp_adapter.gateway_server import GatewayACPAgent

        with tempfile.TemporaryDirectory(prefix="alex-probe4-") as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            cwd = str(Path(tmp) / "cwd")
            os.makedirs(cwd, exist_ok=True)
            s1, s2 = "sess-paused-send", "sess-parallel"

            s1_paused_in_send = asyncio.Event()
            release_s1_send = asyncio.Event()
            delivered_order: list[str] = []

            async def on_update(record: dict):
                sid = record["session_id"]
                text = getattr(getattr(record["update"], "content", None), "text", "")
                delivered_order.append(f"{sid}:{text}")
                if sid == s1 and text == "CHUNK_1 ":
                    s1_paused_in_send.set()
                    await release_s1_send.wait()

            async def rpc_handler(client: FakeGatewayClient, verb: str, kwargs: dict):
                if verb == "prompt.submit":
                    target = kwargs["session_id"]
                    if target == s1:
                        return {"admission_id": "aid_s1", "status": "started"}
                    if target == s2:
                        client.events.put_nowait(
                            _make_gateway_event(s2, 1, "message.delta", {"text": "S2_DONE"}, admission_id="aid_s2")
                        )
                        client.events.put_nowait(
                            _make_gateway_event(
                                s2, 2, "message.complete", {"text": "S2_DONE", "outcome": "completed"}, admission_id="aid_s2"
                            )
                        )
                        return {"admission_id": "aid_s2", "status": "started"}
                if verb == "prompt.receipt":
                    return {
                        "admission_id": "aid_s1",
                        "status": "terminal",
                        "outcome": "completed",
                        "result": {"final_response": "CHUNK_1 CHUNK_2"},
                    }
                return {}

            old_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = str(home)
            try:
                agent = GatewayACPAgent()
                conn = FakeEditorConn(on_update=on_update)
                agent._conn = conn
                gw_client = FakeGatewayClient(home, rpc_handler)
                agent._connection = FakeGatewayConnection(gw_client)
                agent._gateway = gw_client
                agent._snapshots[s1] = _base_snapshot(s1, cwd)
                agent._snapshots[s2] = _base_snapshot(s2, cwd)
                agent._event_task = asyncio.create_task(agent._events())

                try:
                    s1_task = asyncio.create_task(
                        agent.prompt([acp.text_block("stream order test")], s1, field_meta={"alex_run_id": "run_s1"})
                    )
                    await asyncio.sleep(0.02)

                    # Emit CHUNK_1; drainer pops it (drainer.queue becomes empty!) and pauses inside await session_update
                    gw_client.events.put_nowait(
                        _make_gateway_event(s1, 1, "message.delta", {"text": "CHUNK_1 "}, admission_id="aid_s1")
                    )
                    await asyncio.wait_for(s1_paused_in_send.wait(), timeout=2.0)
                    drainer = agent._session_drainers.get(s1)
                    self.assertIsNotNone(drainer)
                    self.assertEqual(len(drainer.queue), 0)

                    # While drainer.queue is empty and CHUNK_1 send is paused, enqueue CHUNK_2 + message.complete + recovery tuple!
                    gw_client.events.put_nowait(
                        _make_gateway_event(s1, 2, "message.delta", {"text": "CHUNK_2"}, admission_id="aid_s1")
                    )
                    gw_client.events.put_nowait(
                        _make_gateway_event(
                            s1, 3, "message.complete", {"text": "CHUNK_1 CHUNK_2", "outcome": "completed"}, admission_id="aid_s1"
                        )
                    )
                    gw_client.events.put_nowait((s1, "aid_s1"))
                    await asyncio.sleep(0.05)

                    # Neither message.complete nor (s1, aid_s1) may overtake the paused CHUNK_1 send!
                    self.assertFalse(s1_task.done())
                    self.assertEqual([x for x in delivered_order if x.startswith(f"{s1}:")], [f"{s1}:CHUNK_1 "])

                    # Meanwhile s2 runs and completes with zero head-of-line blocking!
                    s2_res = await asyncio.wait_for(
                        agent.prompt([acp.text_block("s2 parallel")], s2, field_meta={"alex_run_id": "run_s2"}),
                        timeout=2.0,
                    )
                    self.assertEqual(s2_res.stop_reason, "end_turn")
                    self.assertIn(f"{s2}:S2_DONE", delivered_order)
                    self.assertFalse(s1_task.done())

                    # Release s1's paused session_update and verify strict FIFO completion
                    release_s1_send.set()
                    s1_res = await asyncio.wait_for(s1_task, timeout=2.0)
                    self.assertEqual(s1_res.stop_reason, "end_turn")
                    await asyncio.sleep(0.03)
                    self.assertEqual(
                        [x for x in delivered_order if x.startswith(f"{s1}:")],
                        [f"{s1}:CHUNK_1 ", f"{s1}:CHUNK_2"],
                    )
                    self.assertEqual(agent._session_drainers, {})
                finally:
                    release_s1_send.set()
                    await agent.aclose()
            finally:
                if old_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = old_home

    async def test_probe5_reconnect_generation_fence_protects_new_gate(self):
        """Probe 5: Dead link=0 reconnects to link=1 BEFORE creating new_gate; delayed link=0 cleanup never touches link=1 gate."""
        from unittest.mock import patch
        import acp
        from acp_adapter.gateway_server import GatewayACPAgent
        from agent.alex_acp_runtime import SubmitAckGate, teardown_alex_link_state

        with tempfile.TemporaryDirectory(prefix="alex-probe5-") as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            cwd = str(Path(tmp) / "cwd")
            os.makedirs(cwd, exist_ok=True)
            sid = "sess-reconnect-fence"

            new_submit_entered = asyncio.Event()
            release_new_ack = asyncio.Event()

            async def new_rpc_handler(client: FakeGatewayClient, verb: str, kwargs: dict):
                if verb == "runtime.describe":
                    return {
                        "profile_id": str(home.resolve()),
                        "capabilities": ["acp-editor-policy-v1", "acp-session-mcp-v1"],
                        "session_create": {"sources": ["acp"]},
                    }
                if verb == "session.resume":
                    return _base_snapshot(sid, cwd, epoch="ep-2", seq=0, gen=2)
                if verb == "config.set":
                    return {"ok": True}
                if verb == "prompt.submit":
                    # First frame on link=1 arrives BEFORE prompt.submit ACK!
                    client.events.put_nowait(
                        _make_gateway_event(
                            sid, 1, "message.delta", {"text": "LINK1_EARLY_DELTA"}, admission_id="aid_link1", epoch="ep-2", gen=2
                        )
                    )
                    new_submit_entered.set()
                    await release_new_ack.wait()
                    client.events.put_nowait(
                        _make_gateway_event(
                            sid,
                            2,
                            "message.complete",
                            {"text": "LINK1_EARLY_DELTA", "outcome": "completed"},
                            admission_id="aid_link1",
                            epoch="ep-2",
                            gen=2,
                        )
                    )
                    return {"admission_id": "aid_link1", "status": "started"}
                return {}

            old_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = str(home)
            try:
                agent = GatewayACPAgent()
                conn = FakeEditorConn()
                agent._conn = conn

                # Set up dead link=0 transport
                dead_client = FakeGatewayClient(home, new_rpc_handler)
                dead_client.reader.set_result(True)  # _transport_closed() == True!
                agent._connection = FakeGatewayConnection(dead_client)
                agent._gateway = dead_client
                agent._snapshots[sid] = _base_snapshot(sid, cwd, epoch="ep-1", seq=0, gen=1)
                self.assertEqual(agent._link, 0)

                stale_gate_0 = SubmitAckGate(sid, "run_stale_link0", 0)
                agent._submit_gates[sid] = stale_gate_0

                live_client = FakeGatewayClient(home, new_rpc_handler)
                live_conn = FakeGatewayConnection(live_client)

                with patch("acp_adapter.gateway_server.connect_gateway", return_value=live_conn):
                    try:
                        prompt_task = asyncio.create_task(
                            agent.prompt(
                                [acp.text_block("reconnect prompt")],
                                sid,
                                field_meta={"alex_run_id": "run_link1"},
                            )
                        )
                        await asyncio.wait_for(new_submit_entered.wait(), timeout=2.0)
                        await asyncio.sleep(0.03)

                        # Verify reconnect incremented _link to 1 BEFORE creating new_gate, and settled stale_gate_0
                        self.assertEqual(agent._link, 1)
                        self.assertTrue(stale_gate_0.done.is_set())
                        new_gate = agent._submit_gates.get(sid)
                        self.assertIsNotNone(new_gate)
                        self.assertIsNot(new_gate, stale_gate_0)
                        self.assertEqual(new_gate.link, 1)
                        self.assertFalse(new_gate.done.is_set())

                        # Simulate delayed link=0 cleanup & delayed old prompt finally unwinding!
                        await teardown_alex_link_state(agent, 0)
                        if agent._submit_gates.get(sid) is stale_gate_0:
                            del agent._submit_gates[sid]

                        # Assert new_gate (link=1) was neither settled nor deleted!
                        self.assertIs(agent._submit_gates.get(sid), new_gate)
                        self.assertFalse(new_gate.done.is_set())

                        # Now release prompt.submit ACK on link=1
                        release_new_ack.set()
                        res = await asyncio.wait_for(prompt_task, timeout=2.0)
                        self.assertEqual(res.stop_reason, "end_turn")
                        await asyncio.sleep(0.03)

                        link1_updates = [
                            u for u in conn.updates if (u["field_meta"] or {}).get("admission_id") == "aid_link1"
                        ]
                        self.assertTrue(len(link1_updates) >= 1)
                        for u in link1_updates:
                            self.assertEqual(u["field_meta"], {"admission_id": "aid_link1", "alex_run_id": "run_link1"})
                    finally:
                        release_new_ack.set()
                        await agent.aclose()
            finally:
                if old_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = old_home

    async def test_probe6_replay_gap_live_turn_vs_adopted_snapshot_permissions_and_clarify(self):
        """Probe 6: PendingControls origin admission_id across session.replay_gap (dropped request & open card) vs foreign adopted snapshot."""
        import threading
        import acp
        from acp.schema import AllowedOutcome, RequestPermissionResponse
        from acp_adapter.gateway_server import GatewayACPAgent
        from gateway.session_pending_controls import PendingControls

        with tempfile.TemporaryDirectory(prefix="alex-probe6-") as tmp:
            home = Path(tmp) / "home"
            home.mkdir()
            cwd = str(Path(tmp) / "cwd")
            os.makedirs(cwd, exist_ok=True)

            # Build real PendingControls backed by a lightweight events bus exposing .lock, .execution, .publish
            published_events = []

            class DummyEventBus:
                def __init__(self):
                    self.lock = threading.RLock()
                    self.execution = {}

                def publish(self, session_id, payload, *, event_type):
                    published_events.append((session_id, event_type, dict(payload)))

            bus = DummyEventBus()
            controls = PendingControls(bus)

            # Verify PendingControls stamps origin admission_id for BOTH approval and clarify when generation matches
            bus.execution = {"admission_id": "aid_live_gap", "execution_generation": 3}
            clarify_entry = SimpleNamespace(
                clarify_id="clar-gap-1",
                question="请选择订单审批流模式",
                choices=["单级审批", "多级会签"],
                multi_select=False,
                event=threading.Event(),
            )
            controls.register_clarify("s-live-gap", 3, clarify_entry)
            controls.remote_responders["clar-gap-1"] = lambda kind, pid, ans: clarify_entry.event.set()

            controls.register(
                "s-live-gap",
                SimpleNamespace(event=threading.Event()),
                3,
                {"request_id": "appr-gap-open", "command": "npm test", "description": "run suite"},
            )
            controls.remote_responders["appr-gap-open"] = lambda kind, pid, choice: None

            snap_prompts = controls.snapshot("s-live-gap", 3)
            by_id = {p["prompt_id"]: p for p in snap_prompts}
            self.assertEqual(by_id["clar-gap-1"].get("admission_id"), "aid_live_gap")
            self.assertEqual(by_id["appr-gap-open"].get("admission_id"), "aid_live_gap")

            # Also build a foreign prompt from an unowned admission_id
            bus_foreign = DummyEventBus()
            bus_foreign.execution = {"admission_id": "aid_foreign_99", "execution_generation": 7}
            controls_foreign = PendingControls(bus_foreign)
            controls_foreign.register(
                "s-foreign",
                SimpleNamespace(event=threading.Event()),
                7,
                {"request_id": "appr-foreign-1", "command": "rm -rf /tmp/x", "description": "foreign cmd"},
            )
            controls_foreign.remote_responders["appr-foreign-1"] = lambda kind, pid, choice: None
            foreign_prompts = controls_foreign.snapshot("s-foreign", 7)
            self.assertEqual(foreign_prompts[0].get("admission_id"), "aid_foreign_99")

            # Sub-cases A & B on s-live-gap:
            # - appr-gap-open card is ALREADY open BEFORE session.replay_gap
            # - clar-gap-1 live event was DROPPED in the gap and reconstructed ONLY from snapshot.prompts!
            open_card_seen = asyncio.Event()
            release_open_card = asyncio.Event()
            clarify_card_seen = asyncio.Event()
            responded_ids: list[str] = []

            async def on_permission(record: dict):
                title = record["tool_call"].title or ""
                if "clarify" in (record["tool_call"].tool_call_id or "") or "审批流模式" in title or any(
                    o.name == "单级审批" for o in record["options"]
                ):
                    clarify_card_seen.set()
                    pick = next(o.option_id for o in record["options"] if o.name == "单级审批")
                    return RequestPermissionResponse(outcome=AllowedOutcome(outcome="selected", option_id=pick))
                if (record["field_meta"] or {}).get("admission_id") == "aid_foreign_99":
                    return RequestPermissionResponse(outcome=AllowedOutcome(outcome="cancelled"))
                open_card_seen.set()
                await release_open_card.wait()
                return RequestPermissionResponse(outcome=AllowedOutcome(outcome="selected", option_id="allow_once"))

            async def rpc_handler(client: FakeGatewayClient, verb: str, kwargs: dict):
                if verb == "runtime.describe":
                    return {
                        "profile_id": str(home.resolve()),
                        "capabilities": ["acp-editor-policy-v1", "acp-session-mcp-v1"],
                        "session_create": {"sources": ["acp"]},
                    }
                if verb == "prompt.submit":
                    # Emit live approval.request BEFORE replay_gap, but DROP clarify.request into the gap!
                    client.events.put_nowait(
                        _make_gateway_event(
                            "s-live-gap",
                            1,
                            "approval.request",
                            by_id["appr-gap-open"],
                            admission_id="aid_live_gap",
                            epoch="ep-1",
                            gen=3,
                        )
                    )
                    return {"admission_id": "aid_live_gap", "status": "started"}
                if verb == "session.info":
                    return _base_snapshot("s-foreign", cwd, epoch="ep-f", seq=5, gen=7)["info"]
                if verb == "session.resume":
                    target = kwargs["session_id"]
                    if target == "s-live-gap":
                        return _base_snapshot(
                            "s-live-gap",
                            cwd,
                            epoch="ep-1",
                            seq=10,
                            gen=3,
                            pending=[{"admission_id": "aid_live_gap", "status": "started"}],
                            prompts=list(snap_prompts),
                        )
                    if target == "s-foreign":
                        return _base_snapshot(
                            "s-foreign",
                            cwd,
                            epoch="ep-f",
                            seq=5,
                            gen=7,
                            pending=[{"admission_id": "aid_foreign_99", "status": "started"}],
                            prompts=list(foreign_prompts),
                        )
                if verb in {"approval.respond", "clarify.respond", "prompt.respond"}:
                    responded_ids.append(kwargs["prompt_id"])
                    if {"appr-gap-open", "clar-gap-1"}.issubset(set(responded_ids)):
                        client.events.put_nowait(
                            _make_gateway_event(
                                "s-live-gap",
                                11,
                                "message.complete",
                                {"text": "GAP_RECOVERED_DONE", "outcome": "completed"},
                                admission_id="aid_live_gap",
                                epoch="ep-1",
                                gen=3,
                            )
                        )
                    return {"status": "resolved"}
                if verb == "config.set" or verb == "session.stats":
                    return {}
                return {}

            old_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = str(home)
            try:
                agent = GatewayACPAgent()
                conn = FakeEditorConn(on_permission=on_permission)
                agent._conn = conn
                gw_client = FakeGatewayClient(home, rpc_handler)
                agent._connection = FakeGatewayConnection(gw_client)
                agent._gateway = gw_client
                agent._snapshots["s-live-gap"] = _base_snapshot("s-live-gap", cwd, epoch="ep-1", seq=0, gen=3)
                agent._event_task = asyncio.create_task(agent._events())

                try:
                    live_task = asyncio.create_task(
                        agent.prompt(
                            [acp.text_block("gap recovery prompt")],
                            "s-live-gap",
                            field_meta={"alex_run_id": "run_live_gap"},
                        )
                    )
                    await asyncio.wait_for(open_card_seen.wait(), timeout=2.0)

                    # Inject session.replay_gap while appr-gap-open card is open AND clar-gap-1 was dropped!
                    gw_client.events.put_nowait(
                        _make_gateway_event("s-live-gap", 2, "session.replay_gap", {}, epoch="ep-1", gen=3)
                    )
                    await asyncio.wait_for(clarify_card_seen.wait(), timeout=2.0)
                    release_open_card.set()

                    res = await asyncio.wait_for(live_task, timeout=2.0)
                    self.assertEqual(res.stop_reason, "end_turn")

                    live_perms = [p for p in conn.permissions if p["session_id"] == "s-live-gap"]
                    # Exactly 2 permission requests (1 pre-gap approval, not duplicated; 1 post-gap clarify from snapshot.prompts)
                    self.assertEqual(len(live_perms), 2)
                    for p in live_perms:
                        self.assertEqual(
                            p["field_meta"],
                            {
                                "alex_control_kind": "turn",
                                "admission_id": "aid_live_gap",
                                "alex_run_id": "run_live_gap",
                            },
                        )

                    # Sub-case C: Adopted snapshot with foreign admission_id -> alex_run_id is None & rejected by HermesRuntime
                    await agent.load_session(cwd=cwd, session_id="s-foreign", mcp_servers=[])
                    await asyncio.sleep(0.05)
                    foreign_perms = [p for p in conn.permissions if p["session_id"] == "s-foreign"]
                    self.assertEqual(len(foreign_perms), 1)
                    self.assertEqual(
                        foreign_perms[0]["field_meta"],
                        {
                            "alex_control_kind": "turn",
                            "admission_id": "aid_foreign_99",
                            "alex_run_id": None,
                        },
                    )
                    self.assertIn("aid_foreign_99", agent._foreign_admissions)

                    fp = foreign_perms[0]
                    host_foreign = _run_hermes_runtime_wire_probe({
                        "projectId": "proj-p6",
                        "targetPageId": "page-orders",
                        "planningSessionId": "plan-p6",
                        "execSessionId": "s-foreign",
                        "running": False,
                        "activeRunId": "",
                        "frames": [{
                            "kind": "request",
                            "id": "foreign-perm-1",
                            "method": "session/request_permission",
                            "params": {
                                "sessionId": fp["session_id"],
                                "toolCall": fp["tool_call"].model_dump(by_alias=True, exclude_none=True),
                                "options": [o.model_dump(by_alias=True, exclude_none=True) for o in fp["options"]],
                                "_meta": fp["field_meta"],
                            },
                        }],
                    })
                    self.assertEqual(
                        [e for e in host_foreign["emitted"] if e.get("type") in ("permission", "question")],
                        [],
                    )
                    self.assertEqual(host_foreign["clientReplies"], [])
                    self.assertEqual(len(host_foreign["clientRejects"]), 1)
                    self.assertEqual(host_foreign["clientRejects"][0]["id"], "foreign-perm-1")
                finally:
                    release_open_card.set()
                    await agent.aclose()
            finally:
                if old_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = old_home

    async def test_probe_07_reasoning_bridge_non_reasoning_model_clear_vs_set_and_fences(self):
        """Probe 7: hermes-reasoning.py allows clearing effort override (`effort: None`) on models with
        no adjustable reasoning levels (e.g. `openai-api:gpt-4.1`), while rejecting concrete levels and
        preserving ACP ownership, revision/generation fences, and mutate ACK checks."""
        import contextlib
        import importlib.util

        reasoning_path = REPO_ROOT / "electron" / "hermes-reasoning.py"
        old_argv = sys.argv[:]
        try:
            sys.argv = [str(reasoning_path), str(HERMES_ROOT)]
            spec = importlib.util.spec_from_file_location("_test_hermes_reasoning", str(reasoning_path))
            assert spec is not None and spec.loader is not None
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        finally:
            sys.argv = old_argv

        with tempfile.TemporaryDirectory(prefix="alex-stage2-p7-") as tmp:
            old_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = tmp
            try:
                rpc_calls = []
                info_sequence = []
                mutate_ack = {
                    "session_id": "s-gpt41",
                    "operation": "reasoning",
                    "effort": None,
                    "execution_generation": 5,
                }

                def base_gpt41_info(source="local", created_source="acp", model="gpt-4.1"):
                    info = {
                        "source": source,
                        "provider": "openai-api",
                        "model": model,
                        "api_mode": "codex_responses",
                        "reasoning_effort": "",
                        "reasoning_effort_wire": "",
                    }
                    if created_source is not None:
                        info["created_source"] = created_source
                    return info

                class FakeReasoningRpcClient:
                    async def rpc(self, method, **kwargs):
                        rpc_calls.append((method, kwargs))
                        if method == "session.info":
                            if info_sequence:
                                return info_sequence.pop(0)
                            return base_gpt41_info()
                        if method == "session.resume":
                            return {
                                "session_id": kwargs["session_id"],
                                "revision": 11,
                                "execution_generation": 4,
                            }
                        if method == "session.mutate":
                            return dict(mutate_ack)
                        raise AssertionError(f"Unexpected RPC {method}")

                @contextlib.asynccontextmanager
                async def fake_connect_gateway():
                    yield FakeReasoningRpcClient()

                mod.connect_gateway = fake_connect_gateway

                # 1. Read-only settings for `openai-api:gpt-4.1` resolves `levels == []` via real Hermes capability logic
                read_res = await mod.main({
                    "sessionId": "s-gpt41",
                    "modelId": "openai-api:gpt-4.1",
                })
                self.assertEqual(read_res["levels"], [])
                self.assertIs(read_res["generalLevels"], False)
                self.assertEqual(read_res["current"], "")
                self.assertEqual(read_res["wire"], "")

                # 2. Setting a concrete level (`effort: 'low'`) on `openai-api:gpt-4.1` MUST still fail closed before mutate
                rpc_calls.clear()
                with self.assertRaisesRegex(mod.SettingError, "当前模型不支持这个推理强度"):
                    await mod.main({
                        "sessionId": "s-gpt41",
                        "modelId": "openai-api:gpt-4.1",
                        "effort": "low",
                    })
                self.assertEqual([m for m, _ in rpc_calls], ["session.info"])

                # 3. Non-string non-null effort (`True` / `123`) fails closed with invalid effort
                rpc_calls.clear()
                with self.assertRaisesRegex(mod.SettingError, "推理强度无效"):
                    await mod.main({
                        "sessionId": "s-gpt41",
                        "modelId": "openai-api:gpt-4.1",
                        "effort": True,
                    })
                self.assertEqual([m for m, _ in rpc_calls], ["session.info"])

                # 4. Clearing override (`effort: None`) on `openai-api:gpt-4.1` SUCCEEDS with full fences + ACK check
                rpc_calls.clear()
                clear_res = await mod.main({
                    "sessionId": "s-gpt41",
                    "modelId": "openai-api:gpt-4.1",
                    "effort": None,
                })
                self.assertEqual(clear_res["sessionId"], "s-gpt41")
                self.assertEqual(clear_res["modelId"], "openai-api:gpt-4.1")
                self.assertEqual(clear_res["levels"], [])
                self.assertEqual(
                    [m for m, _ in rpc_calls],
                    ["session.info", "session.resume", "session.info", "session.mutate", "session.info"],
                )
                mutate_kwargs = rpc_calls[3][1]
                self.assertEqual(mutate_kwargs["session_id"], "s-gpt41")
                self.assertEqual(mutate_kwargs["operation"], "reasoning")
                self.assertEqual(mutate_kwargs["payload"], {"effort": None})
                self.assertEqual(mutate_kwargs["expected_revision"], 11)
                self.assertEqual(mutate_kwargs["expected_generation"], 4)

                # 5. Ownership check preserved on `effort: None`: non-ACP session rejected
                rpc_calls.clear()
                info_sequence[:] = [base_gpt41_info(source="cli", created_source=None)]
                with self.assertRaisesRegex(mod.SettingError, "Hermes 未返回此对话的模型配置"):
                    await mod.main({
                        "sessionId": "s-gpt41",
                        "modelId": "openai-api:gpt-4.1",
                        "effort": None,
                    })
                self.assertEqual([m for m, _ in rpc_calls], ["session.info"])

                # 6. Post-resume concurrent model switch check preserved on `effort: None` before `session.mutate`
                rpc_calls.clear()
                info_sequence[:] = [
                    base_gpt41_info(model="gpt-4.1"),
                    base_gpt41_info(model="gpt-4.1-mini"),
                ]
                with self.assertRaisesRegex(mod.SettingError, "模型已切换，请重新打开推理强度"):
                    await mod.main({
                        "sessionId": "s-gpt41",
                        "modelId": "openai-api:gpt-4.1",
                        "effort": None,
                    })
                self.assertEqual([m for m, _ in rpc_calls], ["session.info", "session.resume", "session.info"])

                # 7. ACK verification preserved on `effort: None`
                rpc_calls.clear()
                info_sequence.clear()
                mutate_ack["effort"] = "low"
                with self.assertRaisesRegex(mod.SettingError, "Hermes 尚未确认设置，请重新读取当前强度"):
                    await mod.main({
                        "sessionId": "s-gpt41",
                        "modelId": "openai-api:gpt-4.1",
                        "effort": None,
                    })
            finally:
                if old_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = old_home


if __name__ == "__main__":
    unittest.main()
