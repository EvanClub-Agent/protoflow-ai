const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

function classifyRpcGatewayOutcome(rpcError, method) {
  if (!rpcError || typeof rpcError !== "object") return undefined;
  const data = rpcError.data && typeof rpcError.data === "object" ? rpcError.data : null;
  const details = typeof data?.details === "string" ? data.details.trim() : null;
  const reason =
    typeof data?.reason === "string"
      ? data.reason.trim()
      : typeof data?.outcome === "string"
        ? data.outcome.trim()
        : null;
  const message = typeof rpcError.message === "string" ? rpcError.message.trim() : "";
  const probes = [details, reason, message].filter((v) => typeof v === "string" && v.length > 0);
  if (details === "admitted_turn_failed" || reason === "admitted_turn_failed") {
    return "admitted_turn_failed";
  }
  if (
    rpcError.code === -32602 ||
    probes.some(
      (v) =>
        v === "Gateway disconnected before the request was sent; nothing was sent." ||
        v === "not_found" ||
        v === "session_busy" ||
        v === "profile_mismatch",
    )
  ) {
    return "not_sent";
  }
  if (
    probes.some((v) =>
      /\bunknown_execution\b|unrecovered external turn outcome|lost when the gateway restarted|wait for the lost turn/i.test(v),
    )
  ) {
    return "unknown_execution";
  }
  if (probes.some((v) => /\bsession_replay_gap\b/i.test(v))) {
    return "session_replay_gap";
  }
  if (probes.some((v) => /Gateway disconnected;\s*turn outcome is unknown|turn outcome is unknown|outcome is unknown/i.test(v))) {
    return "gateway_disconnected";
  }
  if (method === "session/prompt" && typeof data?.details === "string") {
    return "gateway_outcome_unknown";
  }
  return undefined;
}

/** ACP JSON-RPC over newline-delimited stdio. Only this client owns its child. */
class AcpClient extends EventEmitter {
  constructor(binary, { home, env = process.env, spawnProcess = spawn, args = ['acp'] } = {}) {
    super();
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.closed = false;
    this.child = spawnProcess(binary, args, {
      env: { ...env, HERMES_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      if (this.buffer.length > 32 * 1024 * 1024)
        return this.fail(new Error("Hermes 协议帧过大"));
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          this.fail(new Error("Hermes ACP 返回了无效 JSON"));
          return;
        }
        this.receive(frame);
      }
    });
    // Do not forward raw stderr: provider diagnostics can contain credentials.
    this.child.stderr.on("data", () => {});
    this.child.on("error", (error) => this.fail(error));
    this.child.on("close", (code) =>
      this.fail(new Error(`Hermes 连接已关闭 (${code})`)),
    );
  }
  receive(frame) {
    if (this.closed) return;
    if (frame.method) {
      if (frame.id !== undefined) this.emit("request", frame);
      else this.emit("notification", frame);
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.error) {
      const error = new Error(frame.error.message || "Hermes 请求失败");
      if (Number.isInteger(frame.error.code)) error.rpcCode = frame.error.code;
      error.rpcMethod = pending.method;
      const gatewayOutcome = classifyRpcGatewayOutcome(frame.error, pending.method);
      if (gatewayOutcome) error.gatewayOutcome = gatewayOutcome;
      // error.data may include credentials or raw prompts; never retain it.
      pending.reject(error);
    } else pending.resolve(frame.result);
  }
  write(frame) {
    if (this.closed) throw new Error("Hermes 尚未连接");
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...frame }) + "\n");
  }
  request(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, method, promptSessionId: method === "session/prompt" ? params.sessionId : undefined };
      if (timeoutMs !== null) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Hermes 请求超时：${method}`));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  notify(method, params) {
    this.write({ method, params });
    if (method === "session/cancel") {
      // Only a user-cancelled prompt has a deadline. Its terminal reply fences
      // the old turn before a retry can reuse the same session and staging file.
      const prompt = [...this.pending.values()].find(p => p.promptSessionId === params.sessionId);
      if (prompt && !prompt.timer) {
        prompt.timer = setTimeout(() => this.fail(new Error("Hermes 未响应停止请求，连接已重置")), 5000);
      }
    }
  }
  reply(id, result) {
    this.write({ id, result });
  }
  reject(id, message) {
    this.write({ id, error: { code: -32601, message } });
  }
  fail(error, reason = "connection-lost") {
    if (this.closed) return;
    this.closed = true;
    if (error && typeof error === "object" && reason !== "closed") error.acpDisconnected = true;
    this.child.kill("SIGTERM");
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit("disconnect", error.message, reason);
  }
  close() {
    this.fail(new Error("Hermes 已断开"), "closed");
  }
}
module.exports = { AcpClient };
