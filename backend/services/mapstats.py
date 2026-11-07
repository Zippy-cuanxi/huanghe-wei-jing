# -*- coding: utf-8 -*-
"""MAP-01 热力与岸段查询；STAT-01 看板/公示指标。"""

from __future__ import annotations

import sqlite3

from ..configstore import load_config
from ..context import RequestContext
from ..errors import ApiError
from ..geo import coarsen
from ..timeutil import parse_period
from ..validation import (
    check_fields,
    ensure_metric_keys,
    get_pagination,
    get_string,
    has_more,
)


def _get_section(conn: sqlite3.Connection, section_id: str | None):
    if section_id is None:
        return None
    row = conn.execute(
        "SELECT section_id FROM sections WHERE section_id = ?", (section_id,)
    ).fetchone()
    if row is None:
        raise ApiError("PARAM_TARGET_NOT_FOUND", "岸段不存在")
    return section_id


def map_query(conn: sqlite3.Connection, ctx: RequestContext, payload: dict) -> dict:
    allowed = {"section_id", "period", "page_no", "page_size"}
    required = {"period", "page_no", "page_size"}
    check_fields(payload, allowed, required)
    section_id = get_string(payload, "section_id", min_len=1, max_len=64, required=False)
    _get_section(conn, section_id)
    start, end = parse_period(get_string(payload, "period", min_len=1, max_len=16))
    page_no, page_size = get_pagination(payload)
    config = load_config(conn)

    # 合规闸门：审图号缺失时，任何点位都不下发（sections 为空）。
    if config.map_audit_no is None:
        return {
            "sections": [],
            "map_audit_no": None,
            "coarsen_degree": config.coarsen_degree,
            "total": 0,
            "has_more": False,
        }

    where = []
    params: list = []
    if section_id is not None:
        where.append("section_id = ?")
        params.append(section_id)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT COUNT(*) AS n FROM sections{where_sql}", tuple(params)).fetchone()["n"]
    rows = conn.execute(
        f"""
        SELECT section_id, name, responsible_org, center_lat, center_lng
        FROM sections{where_sql}
        ORDER BY section_id ASC
        LIMIT ? OFFSET ?
        """,
        tuple(params) + (page_size, (page_no - 1) * page_size),
    ).fetchall()

    heat_rows = conn.execute(
        """
        SELECT matched_section_id AS section_id, COUNT(*) AS heat
        FROM reports
        WHERE report_status = 'APPROVED'
          AND approved_at IS NOT NULL
          AND approved_at >= ? AND approved_at < ?
          AND matched_section_id IS NOT NULL
        GROUP BY matched_section_id
        """,
        (start, end),
    ).fetchall()
    heat_by_section = {row["section_id"]: int(row["heat"]) for row in heat_rows}

    cleanup_rows = conn.execute(
        """
        SELECT section_id, COALESCE(SUM(cleanup_weight_kg), 0) AS kg
        FROM work_orders
        WHERE work_order_status = 'CLOSED'
          AND closed_at IS NOT NULL
          AND closed_at >= ? AND closed_at < ?
          AND section_id IS NOT NULL
        GROUP BY section_id
        """,
        (start, end),
    ).fetchall()
    cleanup_by_section = {row["section_id"]: round(float(row["kg"]), 3) for row in cleanup_rows}

    sections = []
    for row in rows:
        sections.append(
            {
                "section_id": row["section_id"],
                "name": row["name"],
                "coarse_lat": coarsen(float(row["center_lat"]), config.coarsen_degree),
                "coarse_lng": coarsen(float(row["center_lng"]), config.coarsen_degree),
                "heat_value": heat_by_section.get(row["section_id"], 0),
                "cleanup_kg_total": cleanup_by_section.get(row["section_id"], 0.0),
                "responsible_org": row["responsible_org"],
            }
        )
    return {
        "sections": sections,
        "map_audit_no": config.map_audit_no,
        "coarsen_degree": config.coarsen_degree,
        "total": int(total),
        "has_more": has_more(int(total), page_no, page_size),
    }


def stat_query(conn: sqlite3.Connection, ctx: RequestContext, payload: dict) -> dict:
    allowed = {"period", "section_id", "metric_keys"}
    required = {"period", "metric_keys"}
    check_fields(payload, allowed, required)
    section_id = get_string(payload, "section_id", min_len=1, max_len=64, required=False)
    _get_section(conn, section_id)
    start, end = parse_period(get_string(payload, "period", min_len=1, max_len=16))
    metric_keys = ensure_metric_keys(payload.get("metric_keys"))
    config = load_config(conn)

    section_clause_wo = " AND section_id = ?" if section_id is not None else ""
    section_clause_rp = " AND matched_section_id = ?" if section_id is not None else ""
    params_wo = (start, end) + ((section_id,) if section_id is not None else ())
    params_rp = (start, end) + ((section_id,) if section_id is not None else ())

    metrics = []
    for key in metric_keys:
        if key == "cleanup_kg_total":
            row = conn.execute(
                f"""
                SELECT COUNT(*) AS n, COALESCE(SUM(cleanup_weight_kg), 0) AS total
                FROM work_orders
                WHERE work_order_status = 'CLOSED'
                  AND closed_at IS NOT NULL
                  AND closed_at >= ? AND closed_at < ?{section_clause_wo}
                """,
                params_wo,
            ).fetchone()
            sample_size = int(row["n"])
            value = round(float(row["total"]), 3)
            unit = "kg"
        elif key in ("approved_report_count", "closed_work_order_count"):
            if key == "approved_report_count":
                row = conn.execute(
                    f"""
                    SELECT COUNT(*) AS n FROM reports
                    WHERE report_status = 'APPROVED'
                      AND approved_at IS NOT NULL
                      AND approved_at >= ? AND approved_at < ?{section_clause_rp}
                    """,
                    params_rp,
                ).fetchone()
            else:
                row = conn.execute(
                    f"""
                    SELECT COUNT(*) AS n FROM work_orders
                    WHERE work_order_status = 'CLOSED'
                      AND closed_at IS NOT NULL
                      AND closed_at >= ? AND closed_at < ?{section_clause_wo}
                    """,
                    params_wo,
                ).fetchone()
            sample_size = int(row["n"])
            value = sample_size
            unit = "count"
        else:  # ensure_metric_keys 已拦截，此处只做防御
            raise ApiError("PARAM_UNKNOWN_METRIC_KEY", "未定义的指标键")
        metrics.append(
            {
                "metric_key": key,
                "value": value,
                "unit": unit,
                "sample_size": sample_size,
                "published": sample_size >= config.min_publish_sample_size,
            }
        )

    return {
        "metrics": metrics,
        "leaderboard_enabled": config.leaderboard_enabled,
    }
