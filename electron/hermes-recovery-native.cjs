const bundledFs = require('node:fs');
const fs = (() => {
  if (process.versions?.electron) {
    try { return require('original-fs'); } catch {}
  }
  return bundledFs;
})();
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

// The adapter is a private source distribution, never a modification of the
// selected Hermes installation. Unknown source revisions fail closed.
const VERIFIED_HERMES_COMMIT = '3b421578588243f920886e6fe79a6faa87ea026e';
const VERIFIED_HERMES_VERSION = '0.23.1';
const SUPPORTED = {
  'agent/turn_api_call.py': '3e3dcd8d1e680f6dc3b4d7fa5b2b3d421c531c8f5d35b648b2cec1676c636f05',
  'agent/turn_api_error.py': '72bc6884422211b19edf0fdd25c72bac01767042e3b4596427a3bcc39c011736',
  'agent/agent_runtime_helpers.py': '6445f8e6b2a728c7622f0176c34250a61fd79a17d9858c719388066c66be751f',
  'agent/chat_completion_helpers.py': 'd96cb8a345b4b42535f8a5daf78a9277d1d77536089391d11ac9e10ad2f44ba0',
  'agent/codex_runtime.py': '50721ff3c0634a8825dd5396b3ed8aee4fd92b04cfc09a105a94420d61c3748f',
  'gateway/status.py': '21b32179f5922d753a7ae118c10b353ebc17302e029bd5bcedef847390e4d9ef',
  'pm/environments.py': '9cbcc0583da807d71e877790fac5d6bd995136a05cd6c6f41d97c1cf4e84c828',
  'toolsets.py': 'ac6691b02d1fbe0a20a6d936588d28c86cdf53b9d56bdfbf4a183b357b0cc467',
  'gateway/run_turn.py': '32de792e49dbe085fca9ce17cf75e522a7ef67dcc375bd465e274127f089e333',
  'tools/session_search_tool.py': 'efddaa1df4d73d859938d24ae5bdcc6fdfa631a64f760a5c71fa42bb169398ea',
  'gateway/session_pending_controls.py': 'c8ae36accdce384e09c62025bbe93ef11b07e82139b11625f1c94ccc0d56d3f1',
  'acp_adapter/gateway_server.py': '85690c6491e9f1eb88b10bbd0609ec2a74bd2e167c9b36dbbfac282b17ea4a18',
  'acp_adapter/gateway_reply.py': '0d6d0924c17d3db473d308f72a3c020b5410844c3108a5c79247f009e02f03ae',
  'acp_adapter/gateway_commands.py': '5f1fa46fca87ada716e8fee9fb580e7495f8d332c58e0f486c495f1bb0bd42a9',
};
const ADDED_FILES = [
  'agent/alex_rate_limit.py',
  'agent/alex_acp_surface.py',
  'agent/alex_acp_runtime.py',
];
const digest = data => createHash('sha256').update(data).digest('hex');
const excludedNames = new Set([
  '.git',
  '.hermes',
  '.hermes-runtime',
  '.venv',
  'venv',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.cache',
]);
const excludedTopLevel = new Set([
  'apps',
  'website',
  'tests',
  'tests-js',
  'docs',
  'evals',
]);
function shouldExclude(root, filePath) {
  const rel = path.relative(root, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  if (excludedTopLevel.has(parts[0])) return true;
  return parts.some(part => excludedNames.has(part));
}
function sourceFingerprint(root) {
  const resolvedRoot = path.resolve(root);
  const hash = createHash('sha256');
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (shouldExclude(resolvedRoot, file)) continue;
      const stat = fs.lstatSync(file);
      hash.update(JSON.stringify([path.relative(resolvedRoot, file), entry.isDirectory() ? 0 : stat.size, entry.isDirectory() ? 0 : stat.mtimeMs, entry.isSymbolicLink() ? fs.readlinkSync(file) : null]));
      if (entry.isDirectory()) visit(file);
    }
  };
  visit(resolvedRoot);
  return hash.digest('hex');
}
function verify(root) {
  for (const [name, hash] of Object.entries(SUPPORTED)) {
    if (digest(fs.readFileSync(path.join(root, name))) !== hash)
      throw new Error('当前 Hermes 源码与 Alex 的运行时适配不兼容。请在 AI 管理中心选择“使用 Alex 托管运行时”。');
  }
}
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Hermes 恢复适配位置不匹配');
  return source.replace(before, after);
}
async function prepareNativeRecovery(root, dataDir) {
  const resolvedRoot = path.resolve(root);
  verify(resolvedRoot);
  const parent = path.join(dataDir, 'native-recovery');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const policy = bundledFs.readFileSync(path.join(__dirname, 'hermes-rate-limit.py'));
  const acpSurface = bundledFs.readFileSync(path.join(__dirname, 'hermes-acp-surface.py'));
  const acpRuntime = bundledFs.readFileSync(path.join(__dirname, 'hermes-acp-runtime.py'));
  const recoveryPolicy = 'bounded-provider-v2:' + digest(Buffer.concat([
    // The patched PM binds dependencies to this source installation. Two
    // release slots sharing a profile must not attach to each other's gateway.
    Buffer.from(JSON.stringify(fs.realpathSync(resolvedRoot))),
    policy,
    acpSurface,
    acpRuntime,
    bundledFs.readFileSync(__filename),
  ]));
  const fingerprint = sourceFingerprint(resolvedRoot);
  const finalDir = path.join(parent, digest(JSON.stringify([root, fingerprint, recoveryPolicy, 2])));
  if (fs.existsSync(path.join(finalDir, 'alex-adapter.json'))) {
    const manifest = JSON.parse(fs.readFileSync(path.join(finalDir, 'alex-adapter.json'), 'utf8'));
    const expectedFiles = [...Object.keys(SUPPORTED), ...ADDED_FILES].sort();
    if (manifest.version === 2 && manifest.source === root && manifest.recoveryPolicy === recoveryPolicy &&
        JSON.stringify(Object.keys(manifest.patchedHashes || {}).sort()) === JSON.stringify(expectedFiles) &&
        Object.entries(manifest.patchedHashes).every(([name, hash]) => digest(fs.readFileSync(path.join(finalDir, name))) === hash)) return finalDir;
    throw new Error('本地 Hermes 恢复副本校验失败，未加载被修改的适配');
  }
  const copy = path.join(parent, randomUUID());
  try {
    await fs.promises.cp(resolvedRoot, copy, {
      recursive: true,
      filter: file => !shouldExclude(resolvedRoot, file),
    });
    verify(copy);

    let file = path.join(copy, 'agent/turn_api_call.py');
    let source = fs.readFileSync(file, 'utf8');
    source = replaceOnce(source, 'api_kwargs, _perform_api_call, original_request=_original_api_kwargs,',
      'api_kwargs, lambda request: alex_execute(agent, request, _perform_api_call), original_request=_original_api_kwargs,');
    source = replaceOnce(source, '    from hermes_cli.middleware import run_llm_execution_middleware',
      '    from agent.alex_rate_limit import execute as alex_execute\n    from hermes_cli.middleware import run_llm_execution_middleware');
    fs.writeFileSync(file, source);

    file = path.join(copy, 'agent/turn_api_error.py');
    source = replaceOnce(fs.readFileSync(file, 'utf8'), '    _recovered, active_system_prompt = recover_before_classification(',
      `    from agent.alex_rate_limit import RecoveryStopped
    if isinstance(api_error, RecoveryStopped):
        agent._persist_session(messages, conversation_history)
        return _verdict("return", {
            "final_response": "模型请求恢复已停止，候选修改由宿主保留。",
            "messages": messages, "api_calls": api_call_count, "completed": False,
            "failed": True, "error": api_error.reason, "failure_reason": api_error.reason,
            "failure_retryable": False,
        })

    _recovered, active_system_prompt = recover_before_classification(`);
    fs.writeFileSync(file, source);

    fs.writeFileSync(path.join(copy, 'agent/alex_rate_limit.py'), policy);
    fs.writeFileSync(path.join(copy, 'agent/alex_acp_surface.py'), acpSurface);
    fs.writeFileSync(path.join(copy, 'agent/alex_acp_runtime.py'), acpRuntime);

    file = path.join(copy, 'agent/chat_completion_helpers.py');
    source = replaceOnce(fs.readFileSync(file, 'utf8'),
      '        self.worker = None  # request thread; None in inline mode',
      '        self.alex_bounded_recovery = getattr(agent, "_alex_request_recovery_active", False)\n        self.worker = None  # request thread; None in inline mode');
    source = replaceOnce(source, '        import httpx as _httpx\n        # Our own interrupt force-close:',
      `        if self.alex_bounded_recovery:
            if self._request_cancelled["value"]:
                return False
            from agent.alex_rate_limit import RecoveryStopped, provider_diagnostic
            if self.first_delta_fired["done"] or self.deltas_were_sent["yes"] or self.result.get("partial_tool_names"):
                e = RecoveryStopped("partial-response", provider_diagnostic(e))
            elif isinstance(e, EmptyStreamError):
                e = RecoveryStopped("request-outcome-unknown", provider_diagnostic(e))
            self.result["error"] = e
            return False
        import httpx as _httpx
        # Our own interrupt force-close:`);
    source = replaceOnce(source, '        if error is not None:\n            if self.deltas_were_sent["yes"]:',
      '        if error is not None:\n            if self.alex_bounded_recovery:\n                raise error\n            if self.deltas_were_sent["yes"]:');
    source = replaceOnce(source, '        if response is not None:\n            _reset_stale_streak(self.agent)',
      `        if response is not None:
            if self.alex_bounded_recovery and getattr(response, "id", None) == PARTIAL_STREAM_STUB_ID:
                from agent.alex_rate_limit import RecoveryStopped
                raise RecoveryStopped("partial-response")
            _reset_stale_streak(self.agent)`);
    fs.writeFileSync(file, source);

    file = path.join(copy, 'agent/codex_runtime.py');
    source = replaceOnce(fs.readFileSync(file, 'utf8'),
      '    on_first_delta=None, on_event=None, interrupt_check=None,',
      '    on_first_delta=None, on_event=None, interrupt_check=None, _alex_agent=None,');
    source = replaceOnce(source, '    for event in event_iter:',
      '    if _alex_agent is not None:\n        from agent.alex_rate_limit import observe_responses\n        event_iter = observe_responses(_alex_agent, event_iter)\n    for event in event_iter:');
    source = replaceOnce(source, '    max_stream_retries, model = 1, api_kwargs.get("model")',
      '    max_stream_retries, model = (0 if getattr(agent, "_alex_request_recovery_active", False) else 1), api_kwargs.get("model")');
    source = replaceOnce(source, '                    on_event=_fenced(_on_event), interrupt_check=_interrupt_or_superseded,',
      '                    on_event=_fenced(_on_event), interrupt_check=_interrupt_or_superseded, _alex_agent=agent,');
    fs.writeFileSync(file, source);

    file = path.join(copy, 'gateway/status.py');
    fs.writeFileSync(file, replaceOnce(fs.readFileSync(file, 'utf8'),
      'return {"code_sha": identity.get("sha"), "code_version": identity.get("version")}',
      `return {"code_sha": identity.get("sha"), "code_version": identity.get("version"), "alex_recovery_policy": ${JSON.stringify(recoveryPolicy)}, "alex_recovery_channel": __import__("hashlib").sha256(os.environ.get("ALEX_RECOVERY_DIR", "").encode()).hexdigest()}`));

    file = path.join(copy, 'pm/environments.py');
    fs.writeFileSync(file, replaceOnce(fs.readFileSync(file, 'utf8'),
      'def install_state_dir(project_root: Path) -> Path:\n    return installs_root() / install_key(project_root)',
      `def install_state_dir(project_root: Path) -> Path:
    if project_root.resolve() == Path(__file__).resolve().parents[1]:
        project_root = Path(${JSON.stringify(fs.realpathSync(resolvedRoot))})
    return installs_root() / install_key(project_root)`));

    // Stage 2: Disable native session_search on ACP sessions across all agent build/refresh paths.
    file = path.join(copy, 'toolsets.py');
    source = fs.readFileSync(file, 'utf8');
    source = replaceOnce(source,
      `def session_platform_tool_drops(platform: Optional[str]) -> frozenset:
    """Tools of every platform-gated toolset that a session on *platform* does not get."""
    return frozenset(tool for name, platforms in TOOLSET_SESSION_PLATFORMS.items() if platform not in platforms
                     for tool in resolve_toolset(name))`,
      `def session_platform_tool_drops(platform: Optional[str]) -> frozenset:
    """Tools of every platform-gated toolset that a session on *platform* does not get."""
    extra = frozenset(resolve_toolset("session_search")) if platform == "acp" and __import__("os").environ.get("ALEX_RECOVERY_DIR") else frozenset()
    return extra | frozenset(tool for name, platforms in TOOLSET_SESSION_PLATFORMS.items() if platform not in platforms
                     for tool in resolve_toolset(name))`);
    source = replaceOnce(source,
      `    gated = [name for name, platforms in TOOLSET_SESSION_PLATFORMS.items() if platform not in platforms]
    gated += ONESHOT_DISABLED_TOOLSETS if oneshot else ()`,
      `    gated = [name for name, platforms in TOOLSET_SESSION_PLATFORMS.items() if platform not in platforms]
    if platform == "acp" and __import__("os").environ.get("ALEX_RECOVERY_DIR") and "session_search" not in gated:
        gated.append("session_search")
    gated += ONESHOT_DISABLED_TOOLSETS if oneshot else ()`);
    fs.writeFileSync(file, source);

    file = path.join(copy, 'gateway/run_turn.py');
    fs.writeFileSync(file, replaceOnce(fs.readFileSync(file, 'utf8'),
      `        disabled = parse_config_string_list((user_config.get("agent") or {}).get("disabled_toolsets")) or None
        return enabled, disabled`,
      `        disabled = parse_config_string_list((user_config.get("agent") or {}).get("disabled_toolsets")) or None
        if platform_key == "acp" and __import__("os").environ.get("ALEX_RECOVERY_DIR"):
            disabled = [*(disabled or ()), "session_search"] if "session_search" not in (disabled or ()) else disabled
        return enabled, disabled`));

    // Stage 2: Enforce tri-state caller identity check at the top of session_search BEFORE cross-profile DB swap.
    file = path.join(copy, 'tools/session_search_tool.py');
    fs.writeFileSync(file, replaceOnce(fs.readFileSync(file, 'utf8'),
      `    from hermes_constants import get_hermes_home
    from hermes_state import SessionDB, format_session_db_unavailable
    from hermes_state_registry import release_or_close
    owned_dbs: list[Any] = []`,
      `    from hermes_constants import get_hermes_home
    from hermes_state import SessionDB, format_session_db_unavailable
    from hermes_state_registry import release_or_close
    if __import__("os").environ.get("ALEX_RECOVERY_DIR"):
        from agent.alex_acp_surface import classify_session_surface
        try:
            from hermes_cli.gateway_runtime import gateway_profile_home as _alex_profile_home
            _alex_home = _alex_profile_home(get_hermes_home())
        except Exception:
            _alex_home = get_hermes_home()
        _alex_guard_db = _quiet(
            lambda: SessionDB(db_path=_alex_home / "state.db", read_only=True),
            None, "SessionDB unavailable for ACP session_search guard",
        )
        try:
            _alex_verdict = classify_session_surface(_alex_guard_db, current_session_id)
        finally:
            if _alex_guard_db is not None:
                _quiet(lambda: release_or_close(_alex_guard_db), None, "Failed to close guard SessionDB")
        if _alex_verdict != "non_acp":
            return tool_error(
                "session_search is disabled for ACP sessions; use protoflow_search_history instead.",
                success=False,
            )
    owned_dbs: list[Any] = []`));

    // Stage 2: Stamp origin admission_id onto PendingControls prompt records for snapshot.prompts recovery.
    file = path.join(copy, 'gateway/session_pending_controls.py');
    source = fs.readFileSync(file, 'utf8');
    source = replaceOnce(source,
      `            prompt = {'kind': 'approval', 'prompt_id': prompt_id,
                      'execution_generation': generation,`,
      `            origin_aid = (self.events.execution.get('admission_id')
                          if self.events.execution.get('execution_generation') == generation else None)
            prompt = {'kind': 'approval', 'prompt_id': prompt_id,
                      'execution_generation': generation,
                      **({'admission_id': origin_aid} if isinstance(origin_aid, str) and origin_aid else {}),`);
    source = replaceOnce(source,
      `            prompt = {"kind": "clarify", "prompt_id": entry.clarify_id,
                      "execution_generation": generation,`,
      `            origin_aid = (self.events.execution.get("admission_id")
                          if self.events.execution.get("execution_generation") == generation else None)
            prompt = {"kind": "clarify", "prompt_id": entry.clarify_id,
                      "execution_generation": generation,
                      **({"admission_id": origin_aid} if isinstance(origin_aid, str) and origin_aid else {}),`);
    fs.writeFileSync(file, source);

    // Stage 2: Propagate turn admission/run _meta on GatewayReplyMixin updates.
    file = path.join(copy, 'acp_adapter/gateway_reply.py');
    source = fs.readFileSync(file, 'utf8');
    source = replaceOnce(source,
      `            if self._conn:
                await self._conn.session_update(session_id=editor_id, update=build_tool_start(call_id, tool_name, args))
            return
        name, args, _ = self._tool_args.pop((sid, call_id), (tool_name, {}, aid))
        result = payload.get("result")
        if self._conn:
            # \`\`is_error\`\` is the executor's verdict: a cancelled or failed tool may return plain text the
            # result heuristic reads as success.
            await self._conn.session_update(session_id=editor_id, update=build_tool_complete(
                call_id, name, result=result if isinstance(result, str) else None, function_args=args,
                is_error=payload.get("is_error") is True))`,
      `            from agent.alex_acp_runtime import turn_update_meta, wire_meta_kwargs
            if self._conn:
                await self._conn.session_update(session_id=editor_id, update=build_tool_start(call_id, tool_name, args), **wire_meta_kwargs(turn_update_meta(self, aid)))
            return
        from agent.alex_acp_runtime import turn_update_meta, wire_meta_kwargs
        name, args, _ = self._tool_args.pop((sid, call_id), (tool_name, {}, aid))
        result = payload.get("result")
        if self._conn:
            # \`\`is_error\`\` is the executor's verdict: a cancelled or failed tool may return plain text the
            # result heuristic reads as success.
            await self._conn.session_update(session_id=editor_id, update=build_tool_complete(
                call_id, name, result=result if isinstance(result, str) else None, function_args=args,
                is_error=payload.get("is_error") is True), **wire_meta_kwargs(turn_update_meta(self, aid)))`);
    source = replaceOnce(source,
      `        remainder = self._final_remainder(aid, payload)
        if remainder and self._conn:
            await self._conn.session_update(session_id=editor_id, update=self._chunk(sid, remainder))`,
      `        from agent.alex_acp_runtime import turn_update_meta, wire_meta_kwargs
        remainder = self._final_remainder(aid, payload)
        if remainder and self._conn:
            await self._conn.session_update(session_id=editor_id, update=self._chunk(sid, remainder), **wire_meta_kwargs(turn_update_meta(self, aid)))`);
    source = replaceOnce(source,
      `        for key in [key for key, held in self._tool_args.items() if key[0] == sid and held[2] == aid]:
            name, _, _ = self._tool_args.pop(key)
            if self._conn:
                await self._conn.session_update(session_id=editor_id, update=build_tool_abandoned(key[1], name))`,
      `        from agent.alex_acp_runtime import turn_update_meta, wire_meta_kwargs
        for key in [key for key, held in self._tool_args.items() if key[0] == sid and held[2] == aid]:
            name, _, _ = self._tool_args.pop(key)
            if self._conn:
                await self._conn.session_update(session_id=editor_id, update=build_tool_abandoned(key[1], name), **wire_meta_kwargs(turn_update_meta(self, aid)))`);
    source = replaceOnce(source,
      `    async def _project_side_update(self, kind, sid, editor_id, payload):`,
      `    async def _project_side_update(self, kind, sid, editor_id, payload, aid=None):`);
    source = replaceOnce(source,
      `        if update is not None and self._conn:
            await self._conn.session_update(session_id=editor_id, update=update)`,
      `        if update is not None and self._conn:
            from agent.alex_acp_runtime import turn_update_meta, wire_meta_kwargs
            await self._conn.session_update(session_id=editor_id, update=update, **wire_meta_kwargs(turn_update_meta(self, aid)))`);
    source = replaceOnce(source,
      `    async def _close_card(self, editor_id, tool_call, options, response):`,
      `    async def _close_card(self, editor_id, tool_call, options, response, aid=None):`);
    source = replaceOnce(source,
      `            await self._conn.session_update(session_id=editor_id, update=acp.update_tool_call(
                tool_call.tool_call_id, status="completed" if allowed else "failed"))`,
      `            from agent.alex_acp_runtime import turn_update_meta, wire_meta_kwargs
            await self._conn.session_update(session_id=editor_id, update=acp.update_tool_call(
                tool_call.tool_call_id, status="completed" if allowed else "failed"), **wire_meta_kwargs(turn_update_meta(self, aid)))`);
    fs.writeFileSync(file, source);

    // Stage 2: GatewayACPAgent non-blocking per-session single projector, generation-fenced ACK gate,
    // idempotent session/new alex_request_id, and split turn vs model_switch permissions.
    file = path.join(copy, 'acp_adapter/gateway_server.py');
    source = fs.readFileSync(file, 'utf8');
    source = replaceOnce(source,
      `        self._usage = {}
        self._background = set()`,
      `        self._usage = {}
        self._background = set()
        from agent.alex_acp_runtime import init_alex_gateway_state
        init_alex_gateway_state(self)`);
    source = replaceOnce(source,
      `            for pending in snapshot.get("prompts", []):
                self._permission(session_id, pending)
            await self._notify_unknown(session_id)`,
      `            for pending in snapshot.get("prompts", []):
                self._permission(session_id, pending, from_snapshot=True)
            await self._notify_unknown(session_id)`);
    source = replaceOnce(source,
      `        async with self._changed:  # its pending rows and controls may settle or block a waiter
            self._snapshots[session_id] = snapshot`,
      `        from agent.alex_acp_runtime import note_snapshot_foreign_admissions
        note_snapshot_foreign_admissions(self, snapshot)
        async with self._changed:  # its pending rows and controls may settle or block a waiter
            self._snapshots[session_id] = snapshot`);
    source = replaceOnce(source,
      `    async def _teardown(self):
        task, connection = self._event_task, self._connection
        self._event_task = self._connection = self._gateway = None
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if connection is not None:
            await connection.__aexit__(None, None, None)`,
      `    async def _teardown(self):
        from agent.alex_acp_runtime import teardown_alex_link_state
        torn_link = self._link
        task, connection = self._event_task, self._connection
        self._event_task = self._connection = self._gateway = None
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        await teardown_alex_link_state(self, torn_link)
        if connection is not None:
            await connection.__aexit__(None, None, None)`);
    source = replaceOnce(source,
      `        snapshot = await client.rpc("session.create", request_id=uuid.uuid4().hex,`,
      `        from agent.alex_acp_runtime import extract_field_meta, valid_alex_request_id
        _alex_req_id = valid_alex_request_id(extract_field_meta(kwargs)) or uuid.uuid4().hex
        snapshot = await client.rpc("session.create", request_id=_alex_req_id,`);
    source = replaceOnce(source,
      `        for pending in snapshot.get("prompts", []):
            self._permission(session_id, pending)
        await self._notify_unknown(session_id)
        await self._request_live_reasoning(client, session_id)`,
      `        for pending in snapshot.get("prompts", []):
            self._permission(session_id, pending, from_snapshot=True)
        await self._notify_unknown(session_id)
        await self._request_live_reasoning(client, session_id)`);
    source = replaceOnce(source,
      `        result = await self._mutations.apply(client, session_id, 'model', payload,
                                             confirm=self._model_confirmer(session_id))`,
      `        from agent.alex_acp_runtime import extract_field_meta, valid_alex_token
        _alex_model_op_id = valid_alex_token(extract_field_meta(kwargs), 'alex_model_op_id')
        result = await self._mutations.apply(client, session_id, 'model', payload,
                                             confirm=self._model_confirmer(session_id, model_op_id=_alex_model_op_id))`);
    source = replaceOnce(source,
      `    def _model_confirmer(self, session_id):`,
      `    def _model_confirmer(self, session_id, *, model_op_id=None):`);
    source = replaceOnce(source,
      `            response = await self._conn.request_permission(session_id=self._editor_id(session_id),
                                                           tool_call=tool_call, options=options)`,
      `            from agent.alex_acp_runtime import model_switch_meta, wire_meta_kwargs
            _alex_meta = model_switch_meta(model_op_id=model_op_id, slash_run_id=self._slash_runs.get(session_id))
            response = await self._conn.request_permission(session_id=self._editor_id(session_id),
                                                           tool_call=tool_call, options=options,
                                                           **wire_meta_kwargs(_alex_meta))`);
    source = replaceOnce(source,
      `        elif config_id == "model":
            if not isinstance(value, str):
                raise GatewayClientError("invalid_params")
            await self.set_session_model(model_id=value, session_id=editor_id)`,
      `        elif config_id == "model":
            if not isinstance(value, str):
                raise GatewayClientError("invalid_params")
            await self.set_session_model(model_id=value, session_id=editor_id, **kwargs)`);
    source = replaceOnce(source,
      `        retry_key, input_id, staged = prepared
        text, attachments = staged
        answered, text = await self._run_slash(held_id, session_id, text) if not attachments else (False, text)
        if answered:
            return PromptResponse(stop_reason='end_turn')
        # ... and every prepared control's (a slash keeps its own key: apply retires the rest).
        self._mutations.retire(session_id)
        submit = {'text': text}
        if attachments:
            submit['attachments'] = attachments
        self._submitting.add(session_id)
        try:
            # Inside the try: a failed reconnect is as ambiguous for a retained identity as a lost ack.
            client = await self._client()
            link, resumes = self._link, self._resumes.get(session_id, 0)
            receipt = await client.rpc("prompt.submit", session_id=session_id, input_id=input_id, **submit)
        except BaseException as exc:
            from hermes_cli.gateway_client import GatewayRPCError
            if not isinstance(exc, GatewayRPCError):
                # Transport loss, timeout or cancel before the ack: the owner may hold this admission.
                # Keep its identity for the editor's retry of the same prompt (latest 64 sessions).
                self._unacked[session_id] = (retry_key, input_id, staged)
                while len(self._unacked) > 64:
                    self._unacked.pop(next(iter(self._unacked)))
            self._pending_cancels.discard(session_id)
            raise
        finally:
            self._submitting.discard(session_id)
        admission_id = await self._admission_from_receipt(client, held_id, session_id, receipt)`,
      `        from agent.alex_acp_runtime import SubmitAckGate, extract_field_meta, valid_alex_token
        _alex_run_id = valid_alex_token(extract_field_meta(kwargs), 'alex_run_id')
        retry_key, input_id, staged = prepared
        text, attachments = staged
        answered, text = await self._run_slash(held_id, session_id, text, alex_run_id=_alex_run_id) if not attachments else (False, text)
        if answered:
            return PromptResponse(stop_reason='end_turn')
        # ... and every prepared control's (a slash keeps its own key: apply retires the rest).
        self._mutations.retire(session_id)
        submit = {'text': text}
        if attachments:
            submit['attachments'] = attachments
        gate = None
        cancelled_exc = False
        try:
            self._submitting.add(session_id)
            try:
                # Inside the try: a failed reconnect is as ambiguous for a retained identity as a lost ack.
                client = await self._client()
                link, resumes = self._link, self._resumes.get(session_id, 0)
                prev_gate = self._submit_gates.get(session_id)
                if prev_gate is not None and not prev_gate.done.is_set():
                    prev_gate.settle("failed")
                gate = SubmitAckGate(session_id, _alex_run_id, link)
                self._submit_gates[session_id] = gate
                receipt = await client.rpc("prompt.submit", session_id=session_id, input_id=input_id, **submit)
            except BaseException as exc:
                cancelled_exc = isinstance(exc, asyncio.CancelledError)
                from hermes_cli.gateway_client import GatewayRPCError
                if not isinstance(exc, GatewayRPCError):
                    self._unacked[session_id] = (retry_key, input_id, staged)
                    while len(self._unacked) > 64:
                        self._unacked.pop(next(iter(self._unacked)))
                self._pending_cancels.discard(session_id)
                if gate is not None:
                    gate.settle("cancelled" if cancelled_exc else "failed")
                raise
            finally:
                self._submitting.discard(session_id)
            admission_id = await self._admission_from_receipt(
                client, held_id, session_id, receipt, alex_run_id=_alex_run_id, gate=gate,
            )
        finally:
            if gate is not None:
                if not gate.done.is_set():
                    gate.settle("cancelled" if cancelled_exc else "failed")
                if self._submit_gates.get(session_id) is gate:
                    del self._submit_gates[session_id]`);
    source = replaceOnce(source,
      `    async def _admission_from_receipt(self, client, held_id, session_id, receipt):
        """The admission a \`\`prompt.submit\`\` receipt names, or None when the owner admitted nothing."""
        if receipt.get("voice_stopped") is True:
            # TUI-26: a bare stop phrase typed into this LOCAL session's voice chat ended the chat on
            # the owner and admitted nothing, so no turn will settle: the prompt ends here.
            self._pending_cancels.discard(session_id)
            if self._conn:
                from agent.i18n import t
                await self._conn.session_update(session_id=held_id, update=acp.update_agent_message_text(
                    t('cli.voice.stop_phrase_typed') + '\\n'))
            return None
        admission_id = receipt["admission_id"]
        self._admissions[session_id] = admission_id
        if receipt.get("status") == "terminal":
            # A retry of an un-acked submit whose turn already settled: report that turn once.
            await self._settled_receipt(client, held_id, session_id, receipt)
        elif receipt.get("status") == "unknown":
            # A retry of an un-acked submit the owner lost in a restart: never a second turn.
            self._admissions.pop(session_id, None)
            raise GatewayClientError(self._unknown_recovery(session_id, admission_id))
        return admission_id`,
      `    async def _admission_from_receipt(self, client, held_id, session_id, receipt, *, alex_run_id=None, gate=None):
        """The admission a \`\`prompt.submit\`\` receipt names, or None when the owner admitted nothing."""
        from agent.alex_acp_runtime import slash_reply_meta, wire_meta_kwargs
        if receipt.get("voice_stopped") is True:
            if gate is not None:
                gate.settle("failed")
            self._pending_cancels.discard(session_id)
            if self._conn:
                from agent.i18n import t
                _slash_meta = slash_reply_meta(alex_run_id)
                await self._conn.session_update(
                    session_id=held_id,
                    update=acp.update_agent_message_text(t('cli.voice.stop_phrase_typed') + '\\n'),
                    **wire_meta_kwargs(_slash_meta),
                )
            return None
        admission_id = receipt["admission_id"]
        if receipt.get("status") == "unknown":
            if gate is not None:
                gate.settle("failed")
            self._admissions.pop(session_id, None)
            raise GatewayClientError(self._unknown_recovery(session_id, admission_id))
        self._admission_runs.bind(admission_id, alex_run_id)
        if gate is not None:
            gate.settle("acked", admission_id)
        self._admissions[session_id] = admission_id
        if receipt.get("status") == "terminal":
            await self._settled_receipt(client, held_id, session_id, receipt)
        return admission_id`);
    source = replaceOnce(source,
      `    async def _run_slash(self, held_id, session_id, text):
        """Run a slash command's local half: \`\`(answered, text to submit)\`\`; answered ends the prompt."""
        command = _slash_command(text)
        if command is None:
            return False, text
        from acp_adapter.gateway_commands import CommandRefused, run_command
        parts = text.strip().split(None, 1)
        try:
            reply, text = await run_command(self, session_id, command, parts[1].strip() if len(parts) > 1 else '')
        except CommandRefused as exc:
            # A named refusal is the command's answer, shown to the user; never a failed prompt.
            reply = str(exc)
        if reply is None:
            return False, text
        if self._conn:
            await self._conn.session_update(session_id=held_id, update=acp.update_agent_message_text(reply + '\\n'))
        return True, None`,
      `    async def _run_slash(self, held_id, session_id, text, *, alex_run_id=None):
        """Run a slash command's local half: \`\`(answered, text to submit)\`\`; answered ends the prompt."""
        command = _slash_command(text)
        if command is None:
            return False, text
        from acp_adapter.gateway_commands import CommandRefused, run_command
        from agent.alex_acp_runtime import slash_reply_meta, wire_meta_kwargs
        parts = text.strip().split(None, 1)
        if alex_run_id:
            self._slash_runs[session_id] = alex_run_id
        try:
            try:
                reply, text = await run_command(self, session_id, command, parts[1].strip() if len(parts) > 1 else '')
            except CommandRefused as exc:
                reply = str(exc)
        finally:
            if self._slash_runs.get(session_id) == alex_run_id:
                self._slash_runs.pop(session_id, None)
        if reply is None:
            return False, text
        if self._conn:
            _slash_meta = slash_reply_meta(alex_run_id)
            await self._conn.session_update(
                session_id=held_id,
                update=acp.update_agent_message_text(reply + '\\n'),
                **wire_meta_kwargs(_slash_meta),
            )
        return True, None`);
    source = replaceOnce(source,
      `            while True:
                frame = await gateway.events.get()
                if isinstance(frame, Exception):
                    raise frame
                if isinstance(frame, tuple):  # a post-ack recovery (\`\`_after_ack\`\`), behind every frame so far
                    await self._recover(*frame)
                    continue
                event = frame.get("params", {})
                sid = event.get("session_id")
                snapshot = self._snapshots.get(sid)
                if snapshot is None:
                    continue
                epoch, seq = event.get("replay_epoch"), event.get("seq", 0)
                if epoch == snapshot.get("replay_epoch") and seq <= snapshot.get("last_sequence", 0):
                    continue
                snapshot.update(replay_epoch=epoch, last_sequence=seq,
                    execution_generation=event.get("execution_generation", snapshot.get("execution_generation")))
                await self._project(event)`,
      `            from agent.alex_acp_runtime import dispatch_gateway_frame
            while True:
                frame = await gateway.events.get()
                if isinstance(frame, Exception):
                    raise frame
                await dispatch_gateway_frame(self, frame)`);
    source = replaceOnce(source,
      `        if kind in {"approval.request", "clarify.request"}:
            self._permission(sid, payload)
            return`,
      `        if kind in {"approval.request", "clarify.request"}:
            from agent.alex_acp_runtime import resolve_live_prompt_admission
            _ok_aid, _prompt_aid = resolve_live_prompt_admission(event, payload)
            if _ok_aid:
                self._permission(sid, payload, admission_id=_prompt_aid, from_snapshot=False)
            return`);
    source = replaceOnce(source,
      `        if kind in {"reasoning.delta", "todo.updated"}:
            await self._project_side_update(kind, sid, editor_id, payload)
            return`,
      `        if kind in {"reasoning.delta", "todo.updated"}:
            await self._project_side_update(kind, sid, editor_id, payload, aid=aid)
            return`);
    source = replaceOnce(source,
      `        if kind == "message.delta":
            text = _text(payload)
            self._streamed[aid] = self._streamed.get(aid, "") + text
            if text and self._conn:
                await self._conn.session_update(session_id=editor_id, update=self._chunk(sid, text))
        elif kind == "message.interim":
            # Commentary the owner could not stream (\`\`already_streamed\`\` false) reaches viewers
            # only here; streamed commentary is already on screen. Either way it is its own segment.
            self._close_segment(aid)
            text = _text(payload)
            self._end_message(sid)
            if not payload.get("already_streamed") and text.strip():
                self._segments.setdefault(aid, []).append(text)
                if self._conn:
                    await self._conn.session_update(session_id=editor_id, update=self._chunk(sid, text + "\\n\\n"))
                self._end_message(sid)`,
      `        if kind == "message.delta":
            from agent.alex_acp_runtime import turn_update_meta, wire_meta_kwargs
            text = _text(payload)
            self._streamed[aid] = self._streamed.get(aid, "") + text
            if text and self._conn:
                await self._conn.session_update(session_id=editor_id, update=self._chunk(sid, text), **wire_meta_kwargs(turn_update_meta(self, aid)))
        elif kind == "message.interim":
            from agent.alex_acp_runtime import turn_update_meta, wire_meta_kwargs
            self._close_segment(aid)
            text = _text(payload)
            self._end_message(sid)
            if not payload.get("already_streamed") and text.strip():
                self._segments.setdefault(aid, []).append(text)
                if self._conn:
                    await self._conn.session_update(session_id=editor_id, update=self._chunk(sid, text + "\\n\\n"), **wire_meta_kwargs(turn_update_meta(self, aid)))
                self._end_message(sid)`);
    source = replaceOnce(source,
      `            for prompt in snapshot.get("prompts", []):
                self._permission(sid, prompt)`,
      `            for prompt in snapshot.get("prompts", []):
                self._permission(sid, prompt, from_snapshot=True)`);
    source = replaceOnce(source,
      `    def _permission(self, session_id, prompt):
        answer = {"approval": self._answer_permission, "clarify": self._answer_clarify}.get(prompt.get("kind"))
        if answer is None or self._conn is None:
            return
        key = (session_id, prompt["prompt_id"], prompt["execution_generation"])
        if key not in self._permissions:
            task = asyncio.create_task(answer(session_id, prompt))
            self._permissions[key] = task
            task.add_done_callback(lambda done: self._retire_unanswered(key, done))`,
      `    def _permission(self, session_id, prompt, *, admission_id=None, from_snapshot=False):
        from agent.alex_acp_runtime import resolve_snapshot_prompt_admission
        answer = {"approval": self._answer_permission, "clarify": self._answer_clarify}.get(prompt.get("kind"))
        if answer is None or self._conn is None:
            return
        resolved_aid = resolve_snapshot_prompt_admission(prompt) if from_snapshot else admission_id
        key = (session_id, prompt["prompt_id"], prompt["execution_generation"])
        if key not in self._permissions:
            task = asyncio.create_task(answer(session_id, prompt, resolved_aid))
            self._permissions[key] = task
            task.add_done_callback(lambda done: self._retire_unanswered(key, done))`);
    source = replaceOnce(source,
      `    async def _answer_clarify(self, session_id, prompt):
        from acp.schema import AllowedOutcome
        from acp_adapter.elicitation import (
            ELICITATION_METHOD, SKIP_OPTION, build_clarify_elicitation, build_clarify_permission,
            elicited_answer,
        )
        editor_id = self._editor_id(session_id)
        try:
            if self._form_elicitation:
                answer = elicited_answer(await self._conn._conn.send_request(
                    ELICITATION_METHOD, build_clarify_elicitation(editor_id, prompt)))
            else:
                tool_call, options, answers = build_clarify_permission(prompt)
                response = await self._conn.request_permission(
                    session_id=editor_id, tool_call=tool_call, options=options)
                await self._close_card(editor_id, tool_call, options, response)`,
      `    async def _answer_clarify(self, session_id, prompt, aid=None):
        from acp.schema import AllowedOutcome
        from acp_adapter.elicitation import (
            ELICITATION_METHOD, SKIP_OPTION, build_clarify_elicitation, build_clarify_permission,
            elicited_answer,
        )
        from agent.alex_acp_runtime import turn_control_meta, wire_meta_kwargs
        editor_id = self._editor_id(session_id)
        ctrl_meta = turn_control_meta(self, aid)
        try:
            if self._form_elicitation:
                answer = elicited_answer(await self._conn._conn.send_request(
                    ELICITATION_METHOD, {**build_clarify_elicitation(editor_id, prompt), "_meta": ctrl_meta}))
            else:
                tool_call, options, answers = build_clarify_permission(prompt)
                response = await self._conn.request_permission(
                    session_id=editor_id, tool_call=tool_call, options=options, **wire_meta_kwargs(ctrl_meta))
                await self._close_card(editor_id, tool_call, options, response, aid=aid)`);
    source = replaceOnce(source,
      `    async def _answer_permission(self, session_id, prompt):
        from acp.schema import AllowedOutcome
        from acp_adapter.permissions import (
            _build_permission_options, _build_permission_tool_call, _OPTION_ID_TO_HERMES,
        )
        choices = prompt["choices"]
        options = [option for option in _build_permission_options(
            allow_permanent="always" in choices, allow_session="session" in choices)
            if _OPTION_ID_TO_HERMES[option.option_id] in choices]
        try:
            if 'edit' in prompt:
                from acp_adapter.edit_approval import EditProposal, build_acp_edit_tool_call
                tool_call = build_acp_edit_tool_call(EditProposal(**prompt['edit']))
            else:
                tool_call = _build_permission_tool_call(prompt.get('command', ''), prompt.get('description', ''))
            response = await self._conn.request_permission(session_id=self._editor_id(session_id),
                tool_call=tool_call, options=options)
            await self._close_card(self._editor_id(session_id), tool_call, options, response)`,
      `    async def _answer_permission(self, session_id, prompt, aid=None):
        from acp.schema import AllowedOutcome
        from acp_adapter.permissions import (
            _build_permission_options, _build_permission_tool_call, _OPTION_ID_TO_HERMES,
        )
        from agent.alex_acp_runtime import turn_control_meta, wire_meta_kwargs
        ctrl_meta = turn_control_meta(self, aid)
        choices = prompt["choices"]
        options = [option for option in _build_permission_options(
            allow_permanent="always" in choices, allow_session="session" in choices)
            if _OPTION_ID_TO_HERMES[option.option_id] in choices]
        try:
            if 'edit' in prompt:
                from acp_adapter.edit_approval import EditProposal, build_acp_edit_tool_call
                tool_call = build_acp_edit_tool_call(EditProposal(**prompt['edit']))
            else:
                tool_call = _build_permission_tool_call(prompt.get('command', ''), prompt.get('description', ''))
            response = await self._conn.request_permission(session_id=self._editor_id(session_id),
                tool_call=tool_call, options=options, **wire_meta_kwargs(ctrl_meta))
            await self._close_card(self._editor_id(session_id), tool_call, options, response, aid=aid)`);
    source = replaceOnce(source,
      `    async def aclose(self):
        # Post-attach notices first: one paused mid-notice would otherwise resume after the
        # teardown and open a fresh gateway connection through \`\`_client\`\`.`,
      `    async def aclose(self):
        from agent.alex_acp_runtime import teardown_alex_link_state
        await teardown_alex_link_state(self, self._link, all_links=True)
        # Post-attach notices first: one paused mid-notice would otherwise resume after the
        # teardown and open a fresh gateway connection through \`\`_client\`\`.`);
    fs.writeFileSync(file, source);

    file = path.join(copy, 'acp_adapter/gateway_commands.py');
    fs.writeFileSync(file, replaceOnce(fs.readFileSync(file, 'utf8'),
      `        if reply.get('notice') and agent._conn:
            await agent._conn.session_update(session_id=agent._editor_id(session_id),
                                             update=acp.update_agent_message_text(reply['notice'] + '\\n'))`,
      `        if reply.get('notice') and agent._conn:
            from agent.alex_acp_runtime import slash_reply_meta, wire_meta_kwargs
            _slash_meta = slash_reply_meta(getattr(agent, '_slash_runs', {}).get(session_id))
            await agent._conn.session_update(session_id=agent._editor_id(session_id),
                                             update=acp.update_agent_message_text(reply['notice'] + '\\n'),
                                             **wire_meta_kwargs(_slash_meta))`));

    if (sourceFingerprint(resolvedRoot) !== fingerprint) throw new Error('Hermes 安装正在变化，请更新完成后重新连接');
    const patchedHashes = Object.fromEntries([...Object.keys(SUPPORTED), ...ADDED_FILES].map(name => [name, digest(fs.readFileSync(path.join(copy, name)))]));
    fs.writeFileSync(path.join(copy, 'alex-adapter.json'), JSON.stringify({ version: 2, source: root, recoveryPolicy, hashes: SUPPORTED, patchedHashes }), { mode: 0o600 });
    fs.renameSync(copy, finalDir);
    return finalDir;
  } catch (error) {
    fs.rmSync(copy, { recursive: true, force: true });
    throw error;
  }
}
const launchScript = 'import sys, runpy; sys.path.insert(0, sys.argv.pop(1)); sys._hermes_pin_default_home=True; import hermes_bootstrap; sys.argv[0]="hermes"; runpy.run_module("hermes_cli.main", run_name="__main__", alter_sys=True)';
module.exports = { prepareNativeRecovery, launchScript, SUPPORTED, ADDED_FILES, verify, VERIFIED_HERMES_COMMIT, VERIFIED_HERMES_VERSION };
