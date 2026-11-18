"""ACP event attribution, non-blocking per-session projection, and control metadata helpers."""
from __future__ import annotations

import asyncio
import re
from collections import OrderedDict, deque
from typing import Any

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


def extract_field_meta(kwargs: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(kwargs, dict):
        return {}
    meta = kwargs.get("field_meta")
    if isinstance(meta, dict):
        return meta
    raw = kwargs.get("_meta")
    if isinstance(raw, dict):
        return raw
    return kwargs


def wire_meta_kwargs(meta: dict[str, Any] | None) -> dict[str, Any]:
    """``acp.agent.connection.AgentSideConnection`` packs ``**kwargs`` into ``SessionNotification.field_meta`` /
    ``RequestPermissionRequest.field_meta`` (which serializes on the JSON-RPC wire as ``params._meta``)."""
    return dict(meta) if isinstance(meta, dict) and meta else {}


def valid_alex_request_id(meta: dict[str, Any]) -> str | None:
    candidate = meta.get("alex_request_id")
    if isinstance(candidate, str) and _REQUEST_ID_RE.match(candidate):
        return candidate
    return None


def valid_alex_token(meta: dict[str, Any], key: str) -> str | None:
    candidate = meta.get(key)
    if isinstance(candidate, str) and candidate.strip() and len(candidate) <= 128:
        return candidate.strip()
    return None


class BoundedAdmissionRunMap:
    """Bounded LRU map from Gateway admission_id -> host alex_run_id.
    Entries are retained after turn completion so late frames from aid_1
    continue resolving to run_1 instead of null or run_2.
    """

    def __init__(self, max_size: int = 512):
        self._max_size = max_size
        self._entries: OrderedDict[str, str] = OrderedDict()

    def bind(self, admission_id: str | None, alex_run_id: str | None) -> None:
        if (
            not isinstance(admission_id, str)
            or not admission_id
            or not isinstance(alex_run_id, str)
            or not alex_run_id
        ):
            return
        self._entries[admission_id] = alex_run_id
        self._entries.move_to_end(admission_id)
        while len(self._entries) > self._max_size:
            self._entries.popitem(last=False)

    def get(self, admission_id: str | None) -> str | None:
        if not isinstance(admission_id, str) or not admission_id:
            return None
        val = self._entries.get(admission_id)
        if val is not None:
            self._entries.move_to_end(admission_id)
        return val

    def __contains__(self, admission_id: object) -> bool:
        return isinstance(admission_id, str) and admission_id in self._entries


class SubmitAckGate:
    """Connection-generation-bound gate correlating first turn events with prompt.submit receipt."""

    def __init__(self, session_id: str, alex_run_id: str | None, link: int):
        self.session_id = session_id
        self.alex_run_id = alex_run_id
        self.link = link
        self.done = asyncio.Event()
        self.outcome: str = "pending"
        self.admission_id: str | None = None

    def settle(self, outcome: str, admission_id: str | None = None) -> bool:
        if self.done.is_set():
            return False
        self.outcome = outcome
        self.admission_id = admission_id if outcome == "acked" else None
        self.done.set()
        return True


class SessionDrainer:
    """Single asynchronous projector for one session under a specific connection generation."""

    def __init__(self, link: int, first_item: Any):
        self.link = link
        self.queue: deque[Any] = deque([first_item])
        self.task: asyncio.Task[Any] | None = None


def init_alex_gateway_state(agent: Any) -> None:
    agent._admission_runs = BoundedAdmissionRunMap(512)
    agent._foreign_admissions = OrderedDict()
    agent._submit_gates = {}
    agent._session_drainers = {}
    agent._slash_runs = {}


def note_snapshot_foreign_admissions(agent: Any, snapshot: dict[str, Any] | None) -> None:
    if not isinstance(snapshot, dict):
        return
    for row in snapshot.get("pending") or ():
        if not isinstance(row, dict):
            continue
        aid = row.get("admission_id")
        if isinstance(aid, str) and aid and aid not in agent._admission_runs:
            agent._foreign_admissions[aid] = True
            agent._foreign_admissions.move_to_end(aid)
            while len(agent._foreign_admissions) > 512:
                agent._foreign_admissions.popitem(last=False)


def turn_update_meta(agent: Any, aid: str | None) -> dict[str, Any] | None:
    if not isinstance(aid, str) or not aid:
        return {"admission_id": None, "alex_run_id": None}
    return {
        "admission_id": aid,
        "alex_run_id": agent._admission_runs.get(aid),
    }


def turn_control_meta(agent: Any, aid: str | None) -> dict[str, Any]:
    clean_aid = aid if isinstance(aid, str) and aid else None
    return {
        "alex_control_kind": "turn",
        "admission_id": clean_aid,
        "alex_run_id": agent._admission_runs.get(clean_aid) if clean_aid else None,
    }


def model_switch_meta(model_op_id: str | None = None, slash_run_id: str | None = None) -> dict[str, Any] | None:
    if isinstance(model_op_id, str) and model_op_id:
        return {
            "alex_control_kind": "model_switch",
            "alex_model_op_id": model_op_id,
        }
    if isinstance(slash_run_id, str) and slash_run_id:
        return {
            "alex_control_kind": "slash_model_switch",
            "alex_run_id": slash_run_id,
        }
    return None


def slash_reply_meta(alex_run_id: str | None) -> dict[str, Any] | None:
    if isinstance(alex_run_id, str) and alex_run_id:
        return {
            "alex_slash_reply": True,
            "alex_run_id": alex_run_id,
        }
    return None


def resolve_live_prompt_admission(event: dict[str, Any], payload: Any) -> tuple[bool, str | None]:
    env_aid = event.get("admission_id") if isinstance(event, dict) else None
    pay_aid = payload.get("admission_id") if isinstance(payload, dict) else None
    env_ok = isinstance(env_aid, str) and bool(env_aid)
    pay_ok = isinstance(pay_aid, str) and bool(pay_aid)
    if env_ok and pay_ok and env_aid != pay_aid:
        return False, None
    return True, (env_aid if env_ok else (pay_aid if pay_ok else None))


def resolve_snapshot_prompt_admission(prompt: Any) -> str | None:
    pay_aid = prompt.get("admission_id") if isinstance(prompt, dict) else None
    return pay_aid if isinstance(pay_aid, str) and pay_aid else None


def frame_needs_ack_gate(agent: Any, sid: str, frame: Any) -> bool:
    gate = agent._submit_gates.get(sid)
    if gate is None or gate.link != agent._link or gate.done.is_set():
        return False
    if isinstance(frame, tuple):
        return False
    event = frame.get("params", {}) if isinstance(frame, dict) and "params" in frame else frame
    if not isinstance(event, dict):
        return False
    kind = event.get("type")
    if kind in {"session.info", "session.updated", "session.usage", "session.tools_changed"}:
        return False
    if kind == "session.replay_gap":
        return True
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    aid = event.get("admission_id") or payload.get("admission_id")
    if not isinstance(aid, str) or not aid:
        return False
    if aid in agent._admission_runs or aid in agent._foreign_admissions:
        return False
    return True


async def dispatch_session_item(agent: Any, sid: str, frame: Any) -> None:
    if isinstance(frame, tuple):
        await agent._recover(*frame)
        return
    event = frame.get("params", {})
    snapshot = agent._snapshots.get(sid)
    if snapshot is None:
        return
    epoch, seq = event.get("replay_epoch"), event.get("seq", 0)
    if epoch == snapshot.get("replay_epoch") and seq <= snapshot.get("last_sequence", 0):
        return
    snapshot.update(
        replay_epoch=epoch,
        last_sequence=seq,
        execution_generation=event.get("execution_generation", snapshot.get("execution_generation")),
    )
    await agent._project(event)


async def run_session_drainer(agent: Any, sid: str, drainer: SessionDrainer) -> None:
    try:
        while drainer.queue:
            item = drainer.queue.popleft()
            gate = agent._submit_gates.get(sid)
            if (
                gate is not None
                and gate.link == drainer.link
                and not gate.done.is_set()
                and frame_needs_ack_gate(agent, sid, item)
            ):
                await gate.done.wait()
            if drainer.link != agent._link:
                return
            await dispatch_session_item(agent, sid, item)
        if agent._session_drainers.get(sid) is drainer:
            del agent._session_drainers[sid]
    except asyncio.CancelledError:
        if agent._session_drainers.get(sid) is drainer:
            del agent._session_drainers[sid]
        raise
    except Exception as exc:
        if agent._session_drainers.get(sid) is drainer:
            del agent._session_drainers[sid]
        async with agent._changed:
            agent._failure = exc
            agent._changed.notify_all()


async def dispatch_gateway_frame(agent: Any, frame: Any) -> None:
    if isinstance(frame, tuple):
        sid = frame[0]
    else:
        event = frame.get("params", {})
        sid = event.get("session_id")
        if sid not in agent._snapshots:
            return
    drainer = agent._session_drainers.get(sid)
    if drainer is not None and drainer.link == agent._link:
        drainer.queue.append(frame)
        return
    drainer = SessionDrainer(agent._link, frame)
    agent._session_drainers[sid] = drainer
    drainer.task = asyncio.create_task(run_session_drainer(agent, sid, drainer))


async def teardown_alex_link_state(agent: Any, torn_link: int, *, all_links: bool = False) -> None:
    for sid, gate in list(agent._submit_gates.items()):
        if all_links or gate.link == torn_link:
            gate.settle("teardown")
            if agent._submit_gates.get(sid) is gate:
                del agent._submit_gates[sid]
    stale = [
        (sid, drainer)
        for sid, drainer in list(agent._session_drainers.items())
        if all_links or drainer.link == torn_link
    ]
    for sid, drainer in stale:
        if agent._session_drainers.get(sid) is drainer:
            del agent._session_drainers[sid]
        if drainer.task is not None:
            drainer.task.cancel()
    tasks = [drainer.task for _, drainer in stale if drainer.task is not None]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
