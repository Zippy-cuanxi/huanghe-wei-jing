# -*- coding: utf-8 -*-
"""ADM-01：字典与配置下发（R6/R7）。"""

from __future__ import annotations

import sqlite3

from ..audit import standalone_audit
from ..configstore import load_config
from ..constants import (
    ENUM_DEFINITIONS,
    METRIC_DEFINITIONS,
    ROLE_LABELS,
    ROLES,
)
from ..context import RequestContext
from ..errors import ApiError
from ..validation import check_fields, get_string


def _enum_values(conn: sqlite3.Connection, enum_name: str, static_values):
    if static_values is not None:
        return [{"value": v, "label": label} for v, label in static_values]
    if enum_name == "scale_level":
        rows = conn.execute(
            "SELECT code, label FROM scale_levels WHERE active = 1 ORDER BY sort_order, code"
        ).fetchall()
        return [{"value": r["code"], "label": r["label"]} for r in rows]
    if enum_name == "role_code":
        return [{"value": r, "label": ROLE_LABELS[r]} for r in ROLES]
    if enum_name == "metric_key":
        return [{"value": key, "label": label} for key, _unit, label in METRIC_DEFINITIONS]
    return []


def get_config(conn: sqlite3.Connection, ctx: RequestContext, payload: dict) -> dict:
    check_fields(payload, {"config_scope"}, {"config_scope"})
    scope = get_string(payload, "config_scope", min_len=1, max_len=32)
    if scope != "ALL":
        raise ApiError("PARAM_INVALID_SCOPE", "config_scope 当前仅支持 ALL")

    config = load_config(conn)
    categories = [
        {"code": r["code"], "label": r["label"], "description": r["description"]}
        for r in conn.execute(
            "SELECT code, label, description FROM waste_categories WHERE active = 1 ORDER BY sort_order, code"
        ).fetchall()
    ]
    sections = [
        {"section_id": r["section_id"], "name": r["name"], "responsible_org": r["responsible_org"]}
        for r in conn.execute(
            "SELECT section_id, name, responsible_org FROM sections ORDER BY section_id"
        ).fetchall()
    ]
    status_enums = [
        {"enum_name": name, "values": _enum_values(conn, name, values)}
        for name, values in ENUM_DEFINITIONS
    ]

    actor = ctx.actor
    assert actor is not None
    standalone_audit(
        conn,
        trace_id=ctx.trace_id,
        event_type="ADMIN_CONFIG_READ",
        outcome="SUCCESS",
        now=ctx.now,
        actor_account_id=actor.account_id,
        actor_roles=actor.roles,
        target_type="CONFIG",
        target_id=scope,
        details={"config_scope": scope},
    )

    return {
        "waste_categories": categories,
        "sections": sections,
        "status_enums": status_enums,
        "coarsen_degree": config.coarsen_degree,
        "leaderboard_enabled": config.leaderboard_enabled,
        "map_audit_no": config.map_audit_no,
    }
