# -*- coding: utf-8 -*-
"""WO-01 工单转派；WO-02 工单办结（闭环唯一判定点）。"""

from __future__ import annotations

import sqlite3

from .. import db, idempotency
from ..audit import write_audit
from ..context import RequestContext
from ..errors import ApiError
from ..security import request_hash
from ..validation import (
    check_fields,
    ensure_idempotency_key,
    ensure_weight,
    get_number,
    get_string,
    get_string_array,
)


def _load_work_order(conn: sqlite3.Connection, work_order_id: str):
    return conn.execute(
        "SELECT * FROM work_orders WHERE work_order_id = ?", (work_order_id,)
    ).fetchone()


def dispatch(app, conn: sqlite3.Connection, ctx: RequestContext, payload: dict, idem_key: str | None) -> dict:
    allowed = {"work_order_id", "target_org_id"}
    check_fields(payload, allowed, allowed)
    work_order_id = get_string(payload, "work_order_id", min_len=1, max_len=64)
    target_org_id = get_string(payload, "target_org_id", min_len=1, max_len=64)
    assert work_order_id is not None and target_org_id is not None

    actor = ctx.actor
    assert actor is not None
    key = ensure_idempotency_key(idem_key)
    if not app.rate.consume(f"write:{actor.account_pk}", "write_account", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试")

    hash_input = {"work_order_id": work_order_id, "target_org_id": target_org_id}
    scope = idempotency.account_scope(actor.account_pk)
    replay = idempotency.lookup(
        conn,
        scope_key=scope,
        api="WO-01",
        idem_key=key,
        request_hash=request_hash(hash_input),
    )
    if replay is not None:
        ctx.replayed = True
        return replay.data

    org = conn.execute("SELECT org_id FROM orgs WHERE org_id = ?", (target_org_id,)).fetchone()
    if org is None:
        raise ApiError("PARAM_TARGET_ORG_NOT_FOUND", "目标责任单位不存在")

    wo = _load_work_order(conn, work_order_id)
    if wo is None:
        raise ApiError("PARAM_TARGET_NOT_FOUND", "工单不存在")
    if wo["work_order_status"] not in ("PENDING_DISPATCH", "DISPATCHED"):
        raise ApiError("STATE_INVALID_TRANSITION", "当前工单状态不允许转派")

    data = {"work_order_id": work_order_id, "work_order_status": "DISPATCHED"}
    with db.transaction(conn):
        cur = conn.execute(
            """
            UPDATE work_orders
            SET work_order_status = 'DISPATCHED', assigned_org_id = ?, dispatched_at = ?
            WHERE work_order_id = ? AND work_order_status IN ('PENDING_DISPATCH','DISPATCHED')
            """,
            (target_org_id, ctx.now, work_order_id),
        )
        if cur.rowcount != 1:
            raise ApiError("STATE_INVALID_TRANSITION", "当前工单状态不允许转派")
        write_audit(
            conn,
            trace_id=ctx.trace_id,
            event_type="WORK_ORDER_DISPATCHED",
            outcome="SUCCESS",
            now=ctx.now,
            actor_account_id=actor.account_id,
            actor_roles=actor.roles,
            target_type="WORK_ORDER",
            target_id=work_order_id,
            details={
                "target_org_id": target_org_id,
                "previous_status": wo["work_order_status"],
                "previous_org_id": wo["assigned_org_id"],
            },
        )
        idempotency.store(
            conn,
            scope_key=scope,
            api="WO-01",
            idem_key=key,
            request_hash=request_hash(hash_input),
            code="OK",
            message="工单已转派",
            data=data,
            now=ctx.now,
        )
    return data


def close(app, conn: sqlite3.Connection, ctx: RequestContext, payload: dict, idem_key: str | None) -> dict:
    allowed = {"work_order_id", "cleanup_weight_kg", "evidence_refs"}
    check_fields(payload, allowed, allowed)
    work_order_id = get_string(payload, "work_order_id", min_len=1, max_len=64)
    weight = ensure_weight(get_number(payload, "cleanup_weight_kg"))
    evidence_refs = get_string_array(payload, "evidence_refs", min_items=1, max_items=9, required=True)
    assert work_order_id is not None and evidence_refs is not None

    actor = ctx.actor
    assert actor is not None
    key = ensure_idempotency_key(idem_key)
    if not app.rate.consume(f"write:{actor.account_pk}", "write_account", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试")

    hash_input = {
        "work_order_id": work_order_id,
        "cleanup_weight_kg": weight,
        "evidence_refs": evidence_refs,
    }
    scope = idempotency.account_scope(actor.account_pk)
    replay = idempotency.lookup(
        conn,
        scope_key=scope,
        api="WO-02",
        idem_key=key,
        request_hash=request_hash(hash_input),
    )

    is_admin = actor.has_role("R6")
    wo = _load_work_order(conn, work_order_id)
    if is_admin:
        if wo is None:
            raise ApiError("PARAM_TARGET_NOT_FOUND", "工单不存在")
    else:
        # R2 数据级权限：不区分「不存在」与「不属于本组织」，统一拒绝。
        # 资源级鉴权必须在幂等回放之前执行，确保权限变更对回放同样即时生效。
        if wo is None or wo["assigned_org_id"] not in actor.org_ids:
            raise ApiError("PERM_RESOURCE_FORBIDDEN", "无权访问该资源")
        if not actor.has_role("R2"):
            raise ApiError("PERM_ROLE_REQUIRED", "当前角色无权执行该操作")

    if replay is not None:
        ctx.replayed = True
        return replay.data

    if wo["work_order_status"] != "DISPATCHED":
        raise ApiError("STATE_INVALID_TRANSITION", "仅已派单工单允许办结")

    from .media import validate_owned_refs

    validate_owned_refs(conn, evidence_refs, actor.account_pk)

    cleanup_record_id = app.ids.public_id("CLN-")
    data = {
        "work_order_id": work_order_id,
        "work_order_status": "CLOSED",
        "closed": True,
        "progress_stage": "COMPLETED",
    }
    with db.transaction(conn):
        cur = conn.execute(
            """
            UPDATE work_orders
            SET work_order_status = 'CLOSED', cleanup_weight_kg = ?, closed_at = ?
            WHERE work_order_id = ? AND work_order_status = 'DISPATCHED'
            """,
            (weight, ctx.now, work_order_id),
        )
        if cur.rowcount != 1:
            raise ApiError("STATE_INVALID_TRANSITION", "仅已派单工单允许办结")
        conn.execute(
            """
            INSERT INTO cleanup_records(
              cleanup_record_id, work_order_id, cleanup_weight_kg,
              recorded_by_account_pk, recorded_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (cleanup_record_id, work_order_id, weight, actor.account_pk, ctx.now),
        )
        for position, ref in enumerate(evidence_refs, start=1):
            conn.execute(
                "INSERT INTO cleanup_media(cleanup_record_id, media_ref, position) VALUES (?, ?, ?)",
                (cleanup_record_id, ref, position),
            )
        write_audit(
            conn,
            trace_id=ctx.trace_id,
            event_type="WORK_ORDER_CLOSED",
            outcome="SUCCESS",
            now=ctx.now,
            actor_account_id=actor.account_id,
            actor_roles=actor.roles,
            target_type="WORK_ORDER",
            target_id=work_order_id,
            details={
                "cleanup_record_id": cleanup_record_id,
                "cleanup_weight_kg": weight,
                "evidence_count": len(evidence_refs),
                "assigned_org_id": wo["assigned_org_id"],
            },
        )
        idempotency.store(
            conn,
            scope_key=scope,
            api="WO-02",
            idem_key=key,
            request_hash=request_hash(hash_input),
            code="OK",
            message="工单已办结",
            data=data,
            now=ctx.now,
        )
    return data
