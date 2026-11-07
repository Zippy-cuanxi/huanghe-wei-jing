# -*- coding: utf-8 -*-
"""审计留痕。

- 成功的关键事件：与业务写入同事务提交（无审计即无业务提交）。
- 被拒绝的请求：在错误处理后独立事务尽力写入，不因审计失败改变拒绝结果。
- 明细字段做强制脱敏：凭证、验证码、会话句柄、上传凭证、原始坐标一律不落审计。
"""

from __future__ import annotations

import json
import logging
import sqlite3

from .db import transaction

logger = logging.getLogger("backend.audit")

FORBIDDEN_KEY_PARTS = (
    "credential",
    "password",
    "verify_token",
    "second_factor",
    "session_handle",
    "upload_ticket",
    "raw_lat",
    "raw_lng",
    "token",
)


def sanitize_details(details: dict | None) -> dict:
    if not details:
        return {}

    def clean(value):
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                lowered = str(key).lower()
                if any(part in lowered for part in FORBIDDEN_KEY_PARTS):
                    result[key] = "[REDACTED]"
                else:
                    result[key] = clean(item)
            return result
        if isinstance(value, list):
            return [clean(item) for item in value]
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        return str(value)

    return clean(details)


def write_audit(
    conn: sqlite3.Connection,
    *,
    trace_id: str,
    event_type: str,
    outcome: str,
    now: str,
    actor_account_id: str | None = None,
    actor_roles: tuple[str, ...] | list[str] | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO audit_logs(
          trace_id, event_type, actor_account_id, actor_roles, target_type,
          target_id, outcome, detail_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            trace_id,
            event_type,
            actor_account_id,
            json.dumps(list(actor_roles), ensure_ascii=False) if actor_roles is not None else None,
            target_type,
            target_id,
            outcome,
            json.dumps(sanitize_details(details), ensure_ascii=False, sort_keys=True),
            now,
        ),
    )


def standalone_audit(conn: sqlite3.Connection, **kwargs) -> None:
    """独立事务写审计；失败仅记录到服务端日志，不影响对外响应。"""
    try:
        with transaction(conn):
            write_audit(conn, **kwargs)
    except Exception:  # pragma: no cover - 防御性兜底
        logger.exception("audit write failed trace_id=%s event=%s", kwargs.get("trace_id"), kwargs.get("event_type"))


def audit_rejection(
    conn: sqlite3.Connection,
    *,
    trace_id: str,
    api: str,
    code: str,
    now: str,
    actor_account_id: str | None = None,
    actor_roles: tuple[str, ...] | list[str] | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: dict | None = None,
    actor_hint: dict | None = None,
) -> None:
    payload = {"api": api, "code": code}
    if actor_hint:
        payload.update(actor_hint)
    if detail:
        payload.update(detail)
    outcome = "DENIED" if code.split("_", 1)[0] in {"AUTH", "PERM", "STATE", "RATE"} else "FAILURE"
    standalone_audit(
        conn,
        trace_id=trace_id,
        event_type="API_REJECTED",
        outcome=outcome,
        now=now,
        actor_account_id=actor_account_id,
        actor_roles=actor_roles,
        target_type=target_type,
        target_id=target_id,
        details=payload,
    )
