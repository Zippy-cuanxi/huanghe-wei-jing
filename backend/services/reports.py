# -*- coding: utf-8 -*-
"""RPT-01 / RPT-02：上报受理、岸段匹配、AI 初判回填、我的上报与进度。"""

from __future__ import annotations

import sqlite3

from .. import db, idempotency
from ..adapters import ExternalUnavailable
from ..audit import write_audit
from ..configstore import load_config
from ..constants import REPORT_STATUSES
from ..context import RequestContext
from ..errors import ApiError
from ..geo import nearest_section
from ..security import request_hash
from ..validation import (
    check_fields,
    ensure_idempotency_key,
    get_coordinate,
    get_enum,
    get_pagination,
    get_string,
    get_string_array,
    has_more,
)


def is_closed(work_order_status: str, cleanup_weight_kg) -> bool:
    return work_order_status == "CLOSED" and cleanup_weight_kg is not None and float(cleanup_weight_kg) > 0


def progress_stage(work_order_status: str, cleanup_weight_kg) -> str:
    if is_closed(work_order_status, cleanup_weight_kg):
        return "COMPLETED"
    if work_order_status == "DISPATCHED":
        return "IN_PROGRESS"
    return "SUBMITTED"


def _dict_active(conn: sqlite3.Connection, table: str, code: str) -> bool:
    row = conn.execute(
        f"SELECT 1 FROM {table} WHERE code = ? AND active = 1", (code,)
    ).fetchone()
    return row is not None


def _resolve_ai(app, payload_media: list[str], category: str, scale: str, conn: sqlite3.Connection):
    try:
        result = app.ai.assess(
            media_refs=payload_media,
            declared_category=category,
            declared_scale=scale,
        )
    except ExternalUnavailable:
        return "UNAVAILABLE", None, None, None
    except Exception:
        return "UNAVAILABLE", None, None, None

    ai_category = result.get("category")
    ai_scale = result.get("scale_level")
    confidence = result.get("confidence")
    if not isinstance(ai_category, str) or not _dict_active(conn, "waste_categories", ai_category):
        return "UNAVAILABLE", None, None, None
    if not isinstance(ai_scale, str) or not _dict_active(conn, "scale_levels", ai_scale):
        return "UNAVAILABLE", None, None, None
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        return "UNAVAILABLE", None, None, None
    confidence = float(confidence)
    if not (0.0 <= confidence <= 1.0):
        return "UNAVAILABLE", None, None, None
    return "SUCCEEDED", ai_category, ai_scale, confidence


def create_report(app, conn: sqlite3.Connection, ctx: RequestContext, payload: dict, idem_key: str | None) -> dict:
    allowed = {"raw_lat", "raw_lng", "waste_category", "scale_level", "media_refs"}
    check_fields(payload, allowed, allowed)
    raw_lat = get_coordinate(payload, "raw_lat", -90.0, 90.0)
    raw_lng = get_coordinate(payload, "raw_lng", -180.0, 180.0)
    waste_category = get_string(payload, "waste_category", min_len=1, max_len=64)
    scale_level = get_string(payload, "scale_level", min_len=1, max_len=64)
    if waste_category is None or not _dict_active(conn, "waste_categories", waste_category):
        raise ApiError("PARAM_INVALID_ENUM", "字段取值不在允许范围内：waste_category")
    if scale_level is None or not _dict_active(conn, "scale_levels", scale_level):
        raise ApiError("PARAM_INVALID_ENUM", "字段取值不在允许范围内：scale_level")
    media_refs = get_string_array(payload, "media_refs", min_items=1, max_items=9, required=True)
    assert media_refs is not None

    actor = ctx.actor
    assert actor is not None
    # 媒体归属与状态校验（与入库触发器双重保障）
    from .media import validate_owned_refs

    validate_owned_refs(conn, media_refs, actor.account_pk)

    key = ensure_idempotency_key(idem_key)
    if not app.rate.consume(f"write:{actor.account_pk}", "write_account", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试")

    hash_input = {
        "raw_lat": raw_lat,
        "raw_lng": raw_lng,
        "waste_category": waste_category,
        "scale_level": scale_level,
        "media_refs": media_refs,
    }
    scope = idempotency.account_scope(actor.account_pk)
    replay = idempotency.lookup(
        conn,
        scope_key=scope,
        api="RPT-01",
        idem_key=key,
        request_hash=request_hash(hash_input),
    )
    if replay is not None:
        ctx.replayed = True
        return replay.data

    config = load_config(conn)
    ai_status, ai_category, ai_scale, ai_confidence = _resolve_ai(
        app, media_refs, waste_category, scale_level, conn
    )

    sections = [
        dict(row)
        for row in conn.execute(
            "SELECT section_id, center_lat, center_lng FROM sections"
        ).fetchall()
    ]
    matched = nearest_section(raw_lat, raw_lng, sections, config.section_match_radius_km)
    matched_section_id = matched["section_id"] if matched is not None else None

    report_id = app.ids.public_id("RPT-")
    work_order_id = app.ids.public_id("WO-")
    data = {
        "report_id": report_id,
        "report_status": "SUBMITTED",
    }
    if matched_section_id is not None:
        data["matched_section_id"] = matched_section_id

    with db.transaction(conn):
        conn.execute(
            """
            INSERT INTO reports(
              report_id, owner_account_pk, raw_lat, raw_lng, waste_category, scale_level,
              matched_section_id, report_status, review_status, current_review_level,
              ai_status, ai_category, ai_scale_level, ai_confidence, submitted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 'PENDING', 'LEVEL_1', ?, ?, ?, ?, ?)
            """,
            (
                report_id,
                actor.account_pk,
                raw_lat,
                raw_lng,
                waste_category,
                scale_level,
                matched_section_id,
                ai_status,
                ai_category,
                ai_scale,
                ai_confidence,
                ctx.now,
            ),
        )
        for position, ref in enumerate(media_refs, start=1):
            conn.execute(
                "INSERT INTO report_media(report_id, media_ref, position) VALUES (?, ?, ?)",
                (report_id, ref, position),
            )
        conn.execute(
            """
            INSERT INTO work_orders(
              work_order_id, report_id, section_id, assigned_org_id,
              work_order_status, created_at
            ) VALUES (?, ?, ?, NULL, 'PENDING_DISPATCH', ?)
            """,
            (work_order_id, report_id, matched_section_id, ctx.now),
        )
        write_audit(
            conn,
            trace_id=ctx.trace_id,
            event_type="REPORT_CREATED",
            outcome="SUCCESS",
            now=ctx.now,
            actor_account_id=actor.account_id,
            actor_roles=actor.roles,
            target_type="REPORT",
            target_id=report_id,
            details={
                "waste_category": waste_category,
                "scale_level": scale_level,
                "matched_section_id": matched_section_id,
                "ai_status": ai_status,
                "media_count": len(media_refs),
            },
        )
        idempotency.store(
            conn,
            scope_key=scope,
            api="RPT-01",
            idem_key=key,
            request_hash=request_hash(hash_input),
            code="OK",
            message="上报已受理",
            data=data,
            now=ctx.now,
        )
    return data


def list_my_reports(conn: sqlite3.Connection, ctx: RequestContext, payload: dict) -> dict:
    allowed = {"page_no", "page_size", "report_status"}
    required = {"page_no", "page_size"}
    check_fields(payload, allowed, required)
    page_no, page_size = get_pagination(payload)
    status = get_enum(payload, "report_status", REPORT_STATUSES, required=False)

    actor = ctx.actor
    assert actor is not None
    where = ["r.owner_account_pk = ?"]
    params: list = [actor.account_pk]
    if status is not None:
        where.append("r.report_status = ?")
        params.append(status)
    where_sql = " AND ".join(where)

    total = conn.execute(
        f"SELECT COUNT(*) AS n FROM reports r JOIN work_orders w ON w.report_id = r.report_id WHERE {where_sql}",
        tuple(params),
    ).fetchone()["n"]
    rows = conn.execute(
        f"""
        SELECT r.report_id, r.report_status, r.submitted_at,
               w.work_order_status, w.cleanup_weight_kg
        FROM reports r
        JOIN work_orders w ON w.report_id = r.report_id
        WHERE {where_sql}
        ORDER BY r.submitted_at DESC, r.id DESC
        LIMIT ? OFFSET ?
        """,
        tuple(params) + (page_size, (page_no - 1) * page_size),
    ).fetchall()

    items = []
    for row in rows:
        closed = is_closed(row["work_order_status"], row["cleanup_weight_kg"])
        items.append(
            {
                "report_id": row["report_id"],
                "report_status": row["report_status"],
                "work_order_status": row["work_order_status"],
                "progress_stage": progress_stage(row["work_order_status"], row["cleanup_weight_kg"]),
                "closed": closed,
                "submitted_at": row["submitted_at"],
            }
        )
    return {
        "items": items,
        "total": int(total),
        "has_more": has_more(int(total), page_no, page_size),
    }
