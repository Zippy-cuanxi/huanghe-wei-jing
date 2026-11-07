# -*- coding: utf-8 -*-
"""REV-01：三审三校（当前仅 REPORT 目标）、退回与职责分离强制校验。"""

from __future__ import annotations

import sqlite3

from .. import db, idempotency
from ..audit import write_audit
from ..constants import REVIEW_LEVEL_ROLE, REVIEW_LEVELS, REVIEW_RESULTS, TARGET_TYPES
from ..context import RequestContext
from ..errors import ApiError
from ..security import request_hash
from ..validation import check_fields, ensure_comment, ensure_idempotency_key, get_enum, get_string


def review(app, conn: sqlite3.Connection, ctx: RequestContext, payload: dict, idem_key: str | None) -> dict:
    allowed = {"target_type", "target_id", "review_level", "review_result", "comment"}
    check_fields(payload, allowed, allowed)
    target_type = get_enum(payload, "target_type", TARGET_TYPES)
    target_id = get_string(payload, "target_id", min_len=1, max_len=64)
    level = get_enum(payload, "review_level", REVIEW_LEVELS)
    result = get_enum(payload, "review_result", REVIEW_RESULTS)
    comment = ensure_comment(get_string(payload, "comment", min_len=0, max_len=1000))
    assert target_id is not None and level is not None and result is not None

    if result in ("REJECTED", "RETURNED") and not comment.strip():
        raise ApiError("PARAM_INVALID_VALUE", "不通过或退回时必须填写审核意见")

    actor = ctx.actor
    assert actor is not None
    key = ensure_idempotency_key(idem_key)
    if not app.rate.consume(f"write:{actor.account_pk}", "write_account", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试")

    hash_input = {
        "target_type": target_type,
        "target_id": target_id,
        "review_level": level,
        "review_result": result,
        "comment": comment,
    }
    scope = idempotency.account_scope(actor.account_pk)
    replay = idempotency.lookup(
        conn,
        scope_key=scope,
        api="REV-01",
        idem_key=key,
        request_hash=request_hash(hash_input),
    )

    report = conn.execute(
        "SELECT * FROM reports WHERE report_id = ?", (target_id,)
    ).fetchone()
    if report is None:
        raise ApiError("PARAM_TARGET_NOT_FOUND", "审核目标不存在")

    # 系统管理员不兼终审（先于角色校验，确保明确返回职责分离语义）
    if level == "LEVEL_3" and actor.has_role("R7"):
        raise ApiError("PERM_SOD_VIOLATION", "系统管理员不得担任终审", audit_target_type="REPORT", audit_target_id=target_id)

    required_role = REVIEW_LEVEL_ROLE[level]
    if not actor.has_role(required_role):
        raise ApiError("PERM_ROLE_REQUIRED", "当前角色无权执行该级审核", audit_target_type="REPORT", audit_target_id=target_id)

    # 幂等回放仍需通过当前角色与目标存在性校验；但不重复执行状态与 SoD 校验。
    if replay is not None:
        ctx.replayed = True
        return replay.data

    if report["review_status"] not in ("PENDING", "IN_PROGRESS"):
        raise ApiError("STATE_INVALID_TRANSITION", "当前上报状态不允许继续审核", audit_target_type="REPORT", audit_target_id=target_id)
    if report["current_review_level"] != level:
        raise ApiError(
            "STATE_REVIEW_LEVEL_MISMATCH",
            "审核级别与当前流程不一致",
            audit_target_type="REPORT",
            audit_target_id=target_id,
        )

    last = conn.execute(
        """
        SELECT reviewer_account_pk, review_level
        FROM review_records
        WHERE target_type = 'REPORT' AND target_id = ?
        ORDER BY id DESC LIMIT 1
        """,
        (target_id,),
    ).fetchone()
    if last is not None and int(last["reviewer_account_pk"]) == actor.account_pk:
        raise ApiError(
            "PERM_SOD_VIOLATION",
            "同一审核人不得连续执行两级审核",
            audit_target_type="REPORT",
            audit_target_id=target_id,
        )

    approved_at = None
    decided_at = None
    next_level = None
    cancel_work_order = False

    if result == "APPROVED":
        if level == "LEVEL_1":
            new_review_status, new_report_status, next_level = "IN_PROGRESS", "UNDER_REVIEW", "LEVEL_2"
        elif level == "LEVEL_2":
            new_review_status, new_report_status, next_level = "IN_PROGRESS", "UNDER_REVIEW", "LEVEL_3"
        else:
            new_review_status, new_report_status = "APPROVED", "APPROVED"
            approved_at = ctx.now
            decided_at = ctx.now
    elif result == "REJECTED":
        new_review_status, new_report_status = "REJECTED", "REJECTED"
        decided_at = ctx.now
        cancel_work_order = True
    else:  # RETURNED
        if level == "LEVEL_1":
            new_review_status, new_report_status = "RETURNED", "RETURNED"
            decided_at = ctx.now
        elif level == "LEVEL_2":
            new_review_status, new_report_status, next_level = "IN_PROGRESS", "UNDER_REVIEW", "LEVEL_1"
        else:
            new_review_status, new_report_status, next_level = "IN_PROGRESS", "UNDER_REVIEW", "LEVEL_2"

    review_record_id = app.ids.public_id("REV-")
    data = {
        "review_status": new_review_status,
        "review_record_id": review_record_id,
    }
    if next_level is not None:
        data["next_review_level"] = next_level

    with db.transaction(conn):
        conn.execute(
            """
            INSERT INTO review_records(
              review_record_id, target_type, target_id, review_level, review_result,
              reviewer_account_pk, reviewer_role, comment, created_at
            ) VALUES (?, 'REPORT', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                review_record_id,
                target_id,
                level,
                result,
                actor.account_pk,
                required_role,
                comment,
                ctx.now,
            ),
        )
        cur = conn.execute(
            """
            UPDATE reports
            SET review_status = ?, report_status = ?, current_review_level = ?,
                approved_at = ?, decided_at = ?
            WHERE report_id = ?
              AND review_status IN ('PENDING','IN_PROGRESS')
              AND current_review_level = ?
            """,
            (
                new_review_status,
                new_report_status,
                next_level,
                approved_at,
                decided_at,
                target_id,
                level,
            ),
        )
        if cur.rowcount != 1:
            raise ApiError(
                "STATE_INVALID_TRANSITION",
                "当前上报状态不允许继续审核",
                audit_target_type="REPORT",
                audit_target_id=target_id,
            )
        cancelled = 0
        if cancel_work_order:
            cur = conn.execute(
                """
                UPDATE work_orders SET work_order_status = 'CANCELLED'
                WHERE report_id = ? AND work_order_status IN ('PENDING_DISPATCH','DISPATCHED')
                """,
                (target_id,),
            )
            cancelled = cur.rowcount
        write_audit(
            conn,
            trace_id=ctx.trace_id,
            event_type="REVIEW_RECORDED",
            outcome="SUCCESS",
            now=ctx.now,
            actor_account_id=actor.account_id,
            actor_roles=actor.roles,
            target_type="REPORT",
            target_id=target_id,
            details={
                "review_record_id": review_record_id,
                "review_level": level,
                "review_result": result,
                "next_review_level": next_level,
                "work_orders_cancelled": cancelled,
            },
        )
        idempotency.store(
            conn,
            scope_key=scope,
            api="REV-01",
            idem_key=key,
            request_hash=request_hash(hash_input),
            code="OK",
            message="审核已记录",
            data=data,
            now=ctx.now,
        )
    return data
