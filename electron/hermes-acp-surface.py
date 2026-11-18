"""Tri-state ACP session surface classification and history ownership verification."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Literal

POLICY_PREFIX = "gateway.local_policy.v1:"
_UNSET_SOURCES = frozenset({None, "", "local", "unknown"})
SurfaceVerdict = Literal["acp", "non_acp", "unknown"]


def normalize_cwd_for_compare(cwd: str | None) -> str:
    try:
        from acp_adapter.session import _normalize_cwd_for_compare
        return _normalize_cwd_for_compare(cwd)
    except Exception:
        expanded = os.path.expanduser(str(cwd or ".").strip() or ".")
        if re.match(r"^/mnt/[A-Za-z]/", expanded):
            expanded = f"/mnt/{expanded[5].lower()}/{expanded[7:]}"
        try:
            return os.path.realpath(expanded)
        except OSError:
            return os.path.normpath(expanded)


def active_physical_id(db: Any, sid: str) -> str:
    try:
        from hermes_state_local import handoff_head
        _owner, head = handoff_head(db, sid)
        if isinstance(head, str) and head:
            return head
    except Exception:
        pass
    try:
        tip = db.get_compression_tip(sid)
        if isinstance(tip, str) and tip:
            return tip
    except Exception:
        pass
    return sid


def _parse_row_cwd(row: dict[str, Any]) -> str | None:
    cwd = row.get("cwd")
    if isinstance(cwd, str) and cwd.strip():
        return cwd
    raw_cfg = row.get("model_config")
    if isinstance(raw_cfg, str) and raw_cfg.strip():
        try:
            cfg = json.loads(raw_cfg)
            if isinstance(cfg, dict) and isinstance(cfg.get("cwd"), str) and cfg["cwd"].strip():
                return cfg["cwd"]
        except (TypeError, ValueError):
            pass
    return None


def _read_policy_receipt(db: Any, owner_id: str) -> dict[str, Any] | None:
    if not isinstance(owner_id, str) or not owner_id:
        return None
    try:
        with db._read_ctx() as conn:
            row = conn.execute(
                "SELECT value FROM state_meta WHERE key = ?",
                (POLICY_PREFIX + owner_id,),
            ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    try:
        parsed = json.loads(row[0])
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _find_receipt_for_segment(db: Any, target_id: str, row: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[str] = [target_id]
    chat_id = row.get("chat_id")
    if isinstance(chat_id, str) and chat_id and chat_id not in candidates:
        candidates.append(chat_id)
    try:
        comp_lineage = db.get_compression_lineage(target_id) or []
        for seg in comp_lineage:
            if isinstance(seg, str) and seg and seg not in candidates:
                candidates.append(seg)
    except Exception:
        pass
    for candidate in candidates:
        receipt = _read_policy_receipt(db, candidate)
        if receipt is None:
            continue
        if candidate == target_id or receipt.get("session_id") == target_id:
            return receipt
        lineage = receipt.get("lineage")
        entry_sid = (receipt.get("entry") or {}).get("session_id") if isinstance(receipt.get("entry"), dict) else None
        if entry_sid == target_id or (isinstance(lineage, list) and target_id in lineage):
            return receipt
    try:
        with db._read_ctx() as conn:
            rows = conn.execute(
                "SELECT value FROM state_meta WHERE key GLOB ?",
                (POLICY_PREFIX + "*",),
            ).fetchall()
    except Exception:
        return None
    for (raw,) in rows:
        try:
            receipt = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if not isinstance(receipt, dict):
            continue
        lineage = receipt.get("lineage")
        entry_sid = (receipt.get("entry") or {}).get("session_id") if isinstance(receipt.get("entry"), dict) else None
        if receipt.get("session_id") == target_id or entry_sid == target_id or (
            isinstance(lineage, list) and target_id in lineage
        ):
            return receipt
    return None


def _classify_label(label: Any) -> SurfaceVerdict:
    if label == "acp":
        return "acp"
    if isinstance(label, str) and label.strip() and label.strip() not in _UNSET_SOURCES:
        return "non_acp"
    return "unknown"


def _classify_single_row(db: Any, target_id: str, row: dict[str, Any] | None, *, _visited: set[str] | None = None) -> SurfaceVerdict:
    if not isinstance(row, dict):
        return "unknown"
    visited = set(_visited or ())
    if target_id in visited:
        return "unknown"
    visited.add(target_id)

    source = row.get("source")
    if source == "acp":
        return "acp"
    if isinstance(source, str) and source.strip() and source not in _UNSET_SOURCES:
        return "non_acp"
    if source != "local":
        return "unknown"

    created = _classify_label(row.get("created_source"))
    if created != "unknown":
        return created

    receipt = _find_receipt_for_segment(db, target_id, row)
    if isinstance(receipt, dict):
        policy = receipt.get("policy")
        if isinstance(policy, dict):
            from_policy = _classify_label(policy.get("source"))
            if from_policy != "unknown":
                return from_policy

    parent_id = row.get("parent_session_id")
    if isinstance(parent_id, str) and parent_id and parent_id not in visited:
        try:
            parent_row = db.get_session(parent_id)
        except Exception:
            parent_row = None
        if parent_row is not None:
            from_parent = _classify_single_row(db, parent_id, parent_row, _visited=visited)
            if from_parent != "unknown":
                return from_parent

    try:
        comp_lineage = db.get_compression_lineage(target_id) or []
    except Exception:
        comp_lineage = []
    if comp_lineage and isinstance(comp_lineage[0], str) and comp_lineage[0] not in visited:
        try:
            root_row = db.get_session(comp_lineage[0])
        except Exception:
            root_row = None
        if root_row is not None:
            from_root = _classify_single_row(db, comp_lineage[0], root_row, _visited=visited)
            if from_root != "unknown":
                return from_root

    return "unknown"


def classify_session_surface(own_db: Any, sid: str | None) -> SurfaceVerdict:
    """Classify *sid* in *own_db* as 'acp', 'non_acp', or 'unknown' (fail-closed)."""
    if own_db is None or not isinstance(sid, str) or not sid.strip():
        return "unknown"
    clean_sid = sid.strip()
    try:
        direct_row = own_db.get_session(clean_sid)
        head_id = active_physical_id(own_db, clean_sid)
        head_row = own_db.get_session(head_id) if head_id != clean_sid else direct_row
    except Exception:
        return "unknown"

    if direct_row is None and head_row is None:
        return "unknown"

    verdicts: set[SurfaceVerdict] = set()
    if direct_row is not None:
        verdicts.add(_classify_single_row(own_db, clean_sid, direct_row))
    if head_row is not None and head_id != clean_sid:
        verdicts.add(_classify_single_row(own_db, head_id, head_row))

    if not verdicts or "unknown" in verdicts or len(verdicts) > 1:
        return "unknown"
    return next(iter(verdicts))


def is_verified_acp_session(own_db: Any, sid: str | None) -> bool:
    return classify_session_surface(own_db, sid) == "acp"


def collect_verified_acp_segments(
    own_db: Any,
    db_path: Path,
    session_id: str,
    expected_cwd: str,
) -> tuple[str, list[str]]:
    """Verify *session_id* and every segment of its lineage are ACP sessions under *expected_cwd*.
    Returns (tip_id, segment_ids); raises ValueError on any ownership or surface mismatch.
    """
    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("invalid sessionId")
    if not isinstance(expected_cwd, str) or not expected_cwd.strip():
        raise ValueError("missing expectedCwd")

    normalized_expected = normalize_cwd_for_compare(expected_cwd)
    logical_id = session_id.strip()
    try:
        from acp_adapter.catalog import logical_session_id
        logical_id = logical_session_id(db_path, logical_id)
    except Exception:
        pass

    tip_id = active_physical_id(own_db, logical_id)
    segment_ids: list[str] = []
    for candidate in (session_id.strip(), logical_id, tip_id):
        if candidate and candidate not in segment_ids:
            segment_ids.append(candidate)

    try:
        for seg in own_db.get_compression_lineage(tip_id) or []:
            if isinstance(seg, str) and seg and seg not in segment_ids:
                segment_ids.append(seg)
    except Exception as exc:
        raise ValueError("compression lineage unavailable") from exc

    try:
        from hermes_state_local import local_conversation_ids
        with own_db._read_ctx() as conn:
            for seg in local_conversation_ids(conn, logical_id) or []:
                if isinstance(seg, str) and seg and seg not in segment_ids:
                    segment_ids.append(seg)
    except Exception:
        pass

    # Walk parent_session_id pointers explicitly as well so no ancestor can hide outside helper queries.
    cursor_idx = 0
    while cursor_idx < len(segment_ids):
        seg_id = segment_ids[cursor_idx]
        cursor_idx += 1
        row = own_db.get_session(seg_id)
        if row is None:
            raise ValueError(f"session segment missing: {seg_id}")
        parent_id = row.get("parent_session_id")
        if isinstance(parent_id, str) and parent_id and parent_id not in segment_ids:
            segment_ids.append(parent_id)

    for seg_id in segment_ids:
        row = own_db.get_session(seg_id)
        if row is None:
            raise ValueError(f"session segment not found: {seg_id}")
        if classify_session_surface(own_db, seg_id) != "acp":
            raise ValueError(f"session segment is not ACP: {seg_id}")
        row_cwd = _parse_row_cwd(row)
        if not row_cwd or normalize_cwd_for_compare(row_cwd) != normalized_expected:
            raise ValueError(f"session cwd mismatch for {seg_id}")

    return tip_id, segment_ids


ALLOWED_HISTORY_SESSION_ROLES = (
    "page_execution",
    "page_execution_prior",
    "project_planning",
    "conversation",
    "menu_session",
)


def verify_allowed_history_sessions(
    own_db: Any,
    db_path: Path,
    caller_sid: str,
    allowed_entries: Any,
) -> list[dict[str, Any]]:
    """Validate host-supplied allowedHistorySessions against own_db and expectedCwd."""
    if not isinstance(allowed_entries, list) or not allowed_entries or len(allowed_entries) > 32:
        raise ValueError("allowedHistorySessions required")
    if classify_session_surface(own_db, caller_sid) != "acp":
        raise ValueError("caller is not a verified ACP session")

    caller_logical = caller_sid
    try:
        from acp_adapter.catalog import logical_session_id
        caller_logical = logical_session_id(db_path, caller_sid)
    except Exception:
        pass

    verified: list[dict[str, Any]] = []
    seen_tips: set[str] = set()
    caller_matched = False

    for entry in allowed_entries:
        if not isinstance(entry, dict):
            raise ValueError("invalid allowedHistorySessions entry")
        entry_sid = entry.get("sessionId")
        role = entry.get("role")
        expected_cwd = entry.get("expectedCwd")
        if (
            not isinstance(entry_sid, str)
            or not entry_sid.strip()
            or role not in ALLOWED_HISTORY_SESSION_ROLES
            or not isinstance(expected_cwd, str)
            or not expected_cwd.strip()
        ):
            raise ValueError("invalid allowedHistorySessions fields")
        tip_id, segments = collect_verified_acp_segments(own_db, db_path, entry_sid.strip(), expected_cwd)
        if entry_sid.strip() == caller_sid or caller_logical in segments or caller_sid in segments:
            caller_matched = True
        if tip_id not in seen_tips:
            seen_tips.add(tip_id)
            verified.append({
                "sessionId": entry_sid.strip(),
                "role": role,
                "expectedCwd": expected_cwd,
                "tipId": tip_id,
                "segments": segments,
            })

    if not caller_matched:
        raise ValueError("caller session not in allowedHistorySessions")
    return verified
