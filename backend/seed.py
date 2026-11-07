# -*- coding: utf-8 -*-
"""演示/自测夹具与运维配给操作（非对外接口）。

Q3/T5 未确认：责任单位、岸段、角色账号的配给没有契约接口，本文件提供带审计的
运维工具函数，仅用于本侧自测与样例生成；生产环境须由双方确认配给流程。
"""

from __future__ import annotations

import json
import secrets
import sqlite3

from . import db
from .audit import write_audit
from .configstore import (
    load_config,
    validate_coarsen_degree,
    validate_map_audit_no,
    validate_min_sample,
    validate_radius,
)
from .constants import DEFAULT_CONFIGS, PBKDF2_ITERATIONS, STORED_ROLES
from .security import hash_credential, new_salt

DEMO_PASSWORD = "Demo#Pass2026"

ORGS = [
    ("ORG-YR-01", "示例责任单位甲"),
    ("ORG-YR-02", "示例责任单位乙"),
]

SECTIONS = [
    ("SEC-001", "示例岸段一", "ORG-YR-01", 36.0611, 103.8343),
    ("SEC-002", "示例岸段二", "ORG-YR-02", 36.5811, 103.2343),
    ("SEC-003", "示例岸段三", "ORG-YR-01", 35.6011, 103.0343),
]

CATEGORIES = [
    ("RECYCLABLE", "可回收物", "可回收利用的纸、塑料、金属、玻璃等", 1),
    ("HAZARDOUS", "有害垃圾", "电池、灯管、药品等需要安全处置的垃圾", 2),
    ("KITCHEN", "厨余垃圾", "易腐食物残余等", 3),
    ("OTHER", "其他垃圾", "除上述类别外的岸线垃圾", 4),
]

SCALE_LEVELS = [
    ("SMALL", "小型", 1),
    ("MEDIUM", "中型", 2),
    ("LARGE", "大型", 3),
]

DEMO_ACCOUNTS = [
    ("user_r1", ("R1",), ()),
    ("org_a_op", ("R1", "R2"), ("ORG-YR-01",)),
    ("org_b_op", ("R1", "R2"), ("ORG-YR-02",)),
    ("rev_l1", ("R1", "R3"), ()),
    ("rev_l2", ("R1", "R4"), ()),
    ("rev_l3", ("R1", "R5"), ()),
    ("rev_multi", ("R1", "R3", "R4"), ()),
    ("ops_admin", ("R1", "R6"), ()),
    ("sys_admin", ("R1", "R7"), ()),
    ("auditor", ("R1", "R8"), ()),
]


def _trace(trace_id: str | None) -> str:
    return trace_id or secrets.token_hex(16)


def seed_demo(conn: sqlite3.Connection, now: str, password: str = DEMO_PASSWORD, trace_id: str | None = None) -> dict:
    trace = _trace(trace_id)
    counts = {"orgs": 0, "sections": 0, "accounts": 0, "roles": 0}
    with db.transaction(conn):
        for org_id, name in ORGS:
            cur = conn.execute(
                "INSERT OR IGNORE INTO orgs(org_id, name, created_at) VALUES (?, ?, ?)",
                (org_id, name, now),
            )
            counts["orgs"] += cur.rowcount
        for section_id, name, org_id, lat, lng in SECTIONS:
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO sections(
                  section_id, name, responsible_org, center_lat, center_lng, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (section_id, name, org_id, lat, lng, now),
            )
            counts["sections"] += cur.rowcount
        for code, label, description, order in CATEGORIES:
            conn.execute(
                """
                INSERT OR IGNORE INTO waste_categories(code, label, description, active, sort_order)
                VALUES (?, ?, ?, 1, ?)
                """,
                (code, label, description, order),
            )
        for code, label, order in SCALE_LEVELS:
            conn.execute(
                "INSERT OR IGNORE INTO scale_levels(code, label, active, sort_order) VALUES (?, ?, 1, ?)",
                (code, label, order),
            )

        for account_id, roles, org_ids in DEMO_ACCOUNTS:
            existing = conn.execute("SELECT id FROM accounts WHERE account_id = ?", (account_id,)).fetchone()
            if existing is None:
                salt = new_salt()
                cred_hash = hash_credential(password, salt, PBKDF2_ITERATIONS)
                cur = conn.execute(
                    """
                    INSERT INTO accounts(
                      account_id, credential_hash, credential_salt, credential_iterations,
                      account_status, default_role, agreement_accepted, created_at
                    ) VALUES (?, ?, ?, ?, 'ACTIVE', 'R1', 1, ?)
                    """,
                    (account_id, cred_hash, salt, PBKDF2_ITERATIONS, now),
                )
                account_pk = cur.lastrowid
                counts["accounts"] += 1
            else:
                account_pk = existing["id"]
            for role in roles:
                if role == "R7" and conn.execute(
                    "SELECT 1 FROM account_roles WHERE account_pk = ? AND role_code = 'R5'", (account_pk,)
                ).fetchone():
                    raise ValueError("R7 与 R5 互斥")
                cur = conn.execute(
                    "INSERT OR IGNORE INTO account_roles(account_pk, role_code, granted_by, granted_at) VALUES (?, ?, 'SEED', ?)",
                    (account_pk, role, now),
                )
                counts["roles"] += cur.rowcount
            for org_id in org_ids:
                conn.execute(
                    "INSERT OR IGNORE INTO account_orgs(account_pk, org_id) VALUES (?, ?)",
                    (account_pk, org_id),
                )
        for key, value in DEFAULT_CONFIGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO configs(key, value_json, updated_at, updated_by) VALUES (?, ?, ?, 'SEED')",
                (key, json.dumps(value, ensure_ascii=False), now),
            )
        write_audit(
            conn,
            trace_id=trace,
            event_type="SEED_APPLIED",
            outcome="SUCCESS",
            now=now,
            actor_account_id="SYSTEM_SEED",
            target_type="FIXTURE",
            target_id="DEMO",
            details=counts,
        )
    return counts


# ---------------------------------------------------------------------------
# 运维配给（审计 + 校验；非契约接口）
# ---------------------------------------------------------------------------
def add_org(conn: sqlite3.Connection, org_id: str, name: str, now: str, trace_id: str | None = None) -> None:
    with db.transaction(conn):
        conn.execute("INSERT INTO orgs(org_id, name, created_at) VALUES (?, ?, ?)", (org_id, name, now))
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="ORG", target_id=org_id,
            details={"change": "add_org", "name": name},
        )


def add_section(
    conn: sqlite3.Connection,
    section_id: str,
    name: str,
    responsible_org: str,
    center_lat: float,
    center_lng: float,
    now: str,
    trace_id: str | None = None,
) -> None:
    with db.transaction(conn):
        conn.execute(
            """
            INSERT INTO sections(section_id, name, responsible_org, center_lat, center_lng, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (section_id, name, responsible_org, center_lat, center_lng, now),
        )
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="SECTION", target_id=section_id,
            details={"change": "add_section", "responsible_org": responsible_org},
        )


def add_category(
    conn: sqlite3.Connection,
    code: str,
    label: str,
    description: str,
    sort_order: int,
    now: str,
    trace_id: str | None = None,
) -> None:
    with db.transaction(conn):
        conn.execute(
            "INSERT INTO waste_categories(code, label, description, active, sort_order) VALUES (?, ?, ?, 1, ?)",
            (code, label, description, sort_order),
        )
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="WASTE_CATEGORY", target_id=code,
            details={"change": "add_category", "label": label},
        )


def add_scale_level(
    conn: sqlite3.Connection,
    code: str,
    label: str,
    sort_order: int,
    now: str,
    trace_id: str | None = None,
) -> None:
    with db.transaction(conn):
        conn.execute(
            "INSERT INTO scale_levels(code, label, active, sort_order) VALUES (?, ?, 1, ?)",
            (code, label, sort_order),
        )
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="SCALE_LEVEL", target_id=code,
            details={"change": "add_scale_level", "label": label},
        )


def grant_role(conn: sqlite3.Connection, account_id: str, role: str, now: str, trace_id: str | None = None) -> None:
    if role not in STORED_ROLES:
        raise ValueError("未知角色")
    row = conn.execute("SELECT id FROM accounts WHERE account_id = ?", (account_id,)).fetchone()
    if row is None:
        raise ValueError("账号不存在")
    account_pk = row["id"]
    if role in ("R5", "R7"):
        other = "R7" if role == "R5" else "R5"
        if conn.execute(
            "SELECT 1 FROM account_roles WHERE account_pk = ? AND role_code = ?", (account_pk, other)
        ).fetchone():
            raise ValueError("系统管理员与终审角色互斥")
    with db.transaction(conn):
        conn.execute(
            "INSERT INTO account_roles(account_pk, role_code, granted_by, granted_at) VALUES (?, ?, 'PROVISIONING_TOOL', ?)",
            (account_pk, role, now),
        )
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="ROLE_GRANTED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="ACCOUNT", target_id=account_id,
            details={"role": role},
        )


def revoke_role(conn: sqlite3.Connection, account_id: str, role: str, now: str, trace_id: str | None = None) -> None:
    if role not in STORED_ROLES:
        raise ValueError("未知角色")
    row = conn.execute("SELECT id FROM accounts WHERE account_id = ?", (account_id,)).fetchone()
    if row is None:
        raise ValueError("账号不存在")
    with db.transaction(conn):
        cur = conn.execute(
            "DELETE FROM account_roles WHERE account_pk = ? AND role_code = ?",
            (row["id"], role),
        )
        if cur.rowcount != 1:
            raise ValueError("该账号未持有此角色")
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="ROLE_REVOKED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="ACCOUNT", target_id=account_id,
            details={"role": role},
        )


def disable_account(conn: sqlite3.Connection, account_id: str, now: str, trace_id: str | None = None) -> None:
    with db.transaction(conn):
        cur = conn.execute(
            "UPDATE accounts SET account_status = 'DISABLED' WHERE account_id = ?", (account_id,)
        )
        if cur.rowcount != 1:
            raise ValueError("账号不存在")
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="ACCOUNT_DISABLED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="ACCOUNT", target_id=account_id,
            details={"change": "disable_account"},
        )


def set_coarsen_degree(conn: sqlite3.Connection, value, now: str, trace_id: str | None = None) -> None:
    degree = validate_coarsen_degree(value)
    with db.transaction(conn):
        db.set_config(conn, "coarsen_degree", degree, "PROVISIONING_TOOL", now)
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="CONFIG", target_id="coarsen_degree",
            details={"change": "set_coarsen_degree", "value": degree},
        )


def set_section_radius(conn: sqlite3.Connection, value, now: str, trace_id: str | None = None) -> None:
    radius = validate_radius(value)
    with db.transaction(conn):
        db.set_config(conn, "section_match_radius_km", radius, "PROVISIONING_TOOL", now)
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="CONFIG", target_id="section_match_radius_km",
            details={"change": "set_section_radius", "value": radius},
        )


def set_min_publish_sample(conn: sqlite3.Connection, value, now: str, trace_id: str | None = None) -> None:
    sample = validate_min_sample(value)
    with db.transaction(conn):
        db.set_config(conn, "min_publish_sample_size", sample, "PROVISIONING_TOOL", now)
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="CONFIG", target_id="min_publish_sample_size",
            details={"change": "set_min_publish_sample", "value": sample},
        )


def set_map_audit_no(
    conn: sqlite3.Connection,
    audit_no: str | None,
    now: str,
    *,
    confirmed: bool,
    trace_id: str | None = None,
) -> None:
    if not confirmed:
        raise ValueError("设置或清除审图号必须显式确认")
    value = validate_map_audit_no(audit_no) if audit_no is not None else None
    with db.transaction(conn):
        db.set_config(conn, "map_audit_no", value, "PROVISIONING_TOOL", now)
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="COMPLIANCE_CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="CONFIG", target_id="map_audit_no",
            details={"change": "set_map_audit_no", "configured": value is not None},
        )


def enable_leaderboard(
    conn: sqlite3.Connection,
    *,
    enabled: bool,
    verified_sample_size: int,
    now: str,
    confirmed: bool,
    trace_id: str | None = None,
) -> None:
    if not confirmed:
        raise ValueError("榜单开关必须显式确认")
    sample = validate_min_sample(verified_sample_size) if enabled else 0
    config = load_config(conn)
    if enabled and sample < config.min_publish_sample_size:
        raise ValueError("样本量未达到发布门槛，不能开启榜单")
    with db.transaction(conn):
        db.set_config(conn, "leaderboard_enabled", bool(enabled), "PROVISIONING_TOOL", now)
        db.set_config(conn, "leaderboard_sample_verified", bool(enabled), "PROVISIONING_TOOL", now)
        db.set_config(conn, "leaderboard_verified_sample_size", sample, "PROVISIONING_TOOL", now)
        write_audit(
            conn, trace_id=_trace(trace_id), event_type="COMPLIANCE_CONFIG_CHANGED", outcome="SUCCESS", now=now,
            actor_account_id="PROVISIONING_TOOL", target_type="CONFIG", target_id="leaderboard_enabled",
            details={
                "change": "enable_leaderboard",
                "enabled": bool(enabled),
                "verified_sample_size": sample,
            },
        )
