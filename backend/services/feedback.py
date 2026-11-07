# -*- coding: utf-8 -*-
"""FB-01：办结评价。仅上报本人、且工单 closed=true 后允许。"""

from __future__ import annotations

import sqlite3

from .. import db, idempotency
from ..audit import write_audit
from ..context import RequestContext
from ..errors import ApiError
from ..security import request_hash
from ..validation import (
    check_fields,
    ensure_feedback_content,
    ensure_idempotency_key,
    get_int,
    get_string,
)


def submit(app, conn: sqlite3.Connection, ctx: RequestContext, payload: dict, idem_key: str | None) -> dict:
    allowed = {"work_order_id", "rating", "content"}
    check_fields(payload, allowed, allowed)
    work_order_id = get_string(payload, "work_order_id", min_len=1, max_len=64)
    rating = get_int(payload, "rating", required=True)
    if rating is None or not (1 <= rating <= 5):
        raise ApiError("PARAM_INVALID_RATING", "评分必须为 1-5 的整数")
    content = ensure_feedback_content(get_string(payload, "content", min_len=1, max_len=500))
    assert work_order_id is not None

    actor = ctx.actor
    assert actor is not None
    key = ensure_idempotency_key(idem_key)
    if not app.rate.consume(f"write:{actor.account_pk}", "write_account", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试")

    hash_input = {"work_order_id": work_order_id, "rating": rating, "content": content}
    scope = idempotency.account_scope(actor.account_pk)
    replay = idempotency.lookup(
        conn,
        scope_key=scope,
        api="FB-01",
        idem_key=key,
        request_hash=request_hash(hash_input),
    )

    row = conn.execute(
        """
        SELECT w.work_order_status, w.cleanup_weight_kg, r.owner_account_pk
        FROM work_orders w JOIN reports r ON r.report_id = w.report_id
        WHERE w.work_order_id = ?
        """,
        (work_order_id,),
    ).fetchone()
    # 归属校验先于幂等回放，且不区分不存在/非本人。
    if row is None or int(row["owner_account_pk"]) != actor.account_pk:
        raise ApiError("PERM_RESOURCE_FORBIDDEN", "无权访问该资源")

    if replay is not None:
        ctx.replayed = True
        return replay.data

    closed = row["work_order_status"] == "CLOSED" and row["cleanup_weight_kg"] is not None and float(row["cleanup_weight_kg"]) > 0
    if not closed:
        raise ApiError("STATE_CLOSED_REQUIRED", "工单尚未办结，不允许评价", audit_target_type="WORK_ORDER", audit_target_id=work_order_id)

    existing = conn.execute(
        "SELECT feedback_id FROM feedbacks WHERE work_order_id = ? AND account_pk = ?",
        (work_order_id, actor.account_pk),
    ).fetchone()
    if existing is not None:
        raise ApiError(
            "STATE_FEEDBACK_DUPLICATE",
            "该工单已提交过评价",
            audit_target_type="WORK_ORDER",
            audit_target_id=work_order_id,
        )

    feedback_id = app.ids.public_id("FB-")
    data = {"feedback_id": feedback_id}
    with db.transaction(conn):
        conn.execute(
            """
            INSERT INTO feedbacks(feedback_id, work_order_id, account_pk, rating, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (feedback_id, work_order_id, actor.account_pk, rating, content, ctx.now),
        )
        write_audit(
            conn,
            trace_id=ctx.trace_id,
            event_type="FEEDBACK_SUBMITTED",
            outcome="SUCCESS",
            now=ctx.now,
            actor_account_id=actor.account_id,
            actor_roles=actor.roles,
            target_type="WORK_ORDER",
            target_id=work_order_id,
            details={"feedback_id": feedback_id, "rating": rating},
        )
        idempotency.store(
            conn,
            scope_key=scope,
            api="FB-01",
            idem_key=key,
            request_hash=request_hash(hash_input),
            code="OK",
            message="评价已提交",
            data=data,
            now=ctx.now,
        )
    return data
