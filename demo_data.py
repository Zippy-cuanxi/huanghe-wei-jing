# -*- coding: utf-8 -*-
"""演示数据初始化（仅本地演示，不是契约接口）。

首次启动时：
- 写入组织、岸段、字典与演示账号；
- 通过正式的 BackendApp.handle 业务入口生成一组上报/审核/工单数据，
  不使用直接 SQL 伪造业务状态；
- 为本地演示配置一个 SAMPLE-ONLY 审图号（生产必须替换/清除，见 CR-013）。

这里的数据仅用于让 Vue 页面在没有外部数据源时可运行、可点通；
所有业务规则仍由 backend.services 裁决。
"""

from __future__ import annotations

import hashlib
import json
import secrets
from pathlib import Path

from backend import seed
from backend.timeutil import iso, utc_now

DEMO_PASSWORD = seed.DEMO_PASSWORD
SAMPLE_AUDIT_NO = "SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO"
ROOT = Path(__file__).resolve().parent
DEMO_FILE = ROOT / "demo" / "demo_ids.json"


def _key(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(8)}"


def _call(app, api: str, payload: dict, session: str | None = None, idem: str | None = None) -> dict:
    result = app.handle(
        {
            "api": api,
            "payload": payload,
            "session_handle": session,
            "idempotency_key": idem,
        }
    )
    if result.get("code") != "OK":
        raise RuntimeError(f"demo seed {api} failed: {result.get('code')} {result.get('message')}")
    return result["data"]


def _login(app, account_id: str) -> str:
    data = _call(
        app,
        "AUTH-02",
        {
            "account_id": account_id,
            "credential": DEMO_PASSWORD,
            "device_tag": "demo-seed",
        },
    )
    return data["session_handle"]


def _file(app, session: str, name: str) -> str:
    checksum = hashlib.sha256(name.encode("utf-8")).hexdigest()
    data = _call(
        app,
        "FILE-01",
        {"media_type": "IMAGE_JPEG", "size_bytes": 2048, "checksum": checksum},
        session=session,
        idem=_key("demo-file"),
    )
    return data["media_ref"]


def _report(app, session: str, *, lat: float, lng: float, category: str, scale: str, label: str) -> dict:
    ref = _file(app, session, label)
    data = _call(
        app,
        "RPT-01",
        {
            "raw_lat": lat,
            "raw_lng": lng,
            "waste_category": category,
            "scale_level": scale,
            "media_refs": [ref],
        },
        session=session,
        idem=_key("demo-report"),
    )
    return data


def _work_order_id(conn, report_id: str) -> str:
    row = conn.execute(
        "SELECT work_order_id FROM work_orders WHERE report_id = ?", (report_id,)
    ).fetchone()
    if row is None:
        raise RuntimeError(f"work order missing for {report_id}")
    return row["work_order_id"]


def _review(app, session: str, report_id: str, level: str, result: str, comment: str) -> dict:
    return _call(
        app,
        "REV-01",
        {
            "target_type": "REPORT",
            "target_id": report_id,
            "review_level": level,
            "review_result": result,
            "comment": comment,
        },
        session=session,
        idem=_key("demo-review"),
    )


def _dispatch(app, session: str, work_order_id: str, org_id: str) -> dict:
    return _call(
        app,
        "WO-01",
        {"work_order_id": work_order_id, "target_org_id": org_id},
        session=session,
        idem=_key("demo-dispatch"),
    )


def _close(app, session: str, work_order_id: str, weight: float, label: str) -> dict:
    evidence = _file(app, session, label)
    return _call(
        app,
        "WO-02",
        {
            "work_order_id": work_order_id,
            "cleanup_weight_kg": weight,
            "evidence_refs": [evidence],
        },
        session=session,
        idem=_key("demo-close"),
    )


def _create_reports(app) -> None:
    sessions = {
        "ops_admin": _login(app, "ops_admin"),
        "user_r1": _login(app, "user_r1"),
        "rev_l1": _login(app, "rev_l1"),
        "rev_l2": _login(app, "rev_l2"),
        "rev_l3": _login(app, "rev_l3"),
        "org_a_op": _login(app, "org_a_op"),
        "org_b_op": _login(app, "org_b_op"),
    }
    # 每个演示账号的坐标都落在对应示例岸段附近。
    coords = {
        "SEC-001": (36.0611, 103.8343),
        "SEC-002": (36.5811, 103.2343),
        "SEC-003": (35.6011, 103.0343),
    }

    # A：审核通过 + 已派单 + 已办结（热力/清理量/闭环示例）
    report_a = _report(app, sessions["ops_admin"], lat=coords["SEC-001"][0], lng=coords["SEC-001"][1],
                       category="OTHER", scale="SMALL", label="demo-a")
    _review(app, sessions["rev_l1"], report_a["report_id"], "LEVEL_1", "APPROVED", "初审通过（演示）")
    _review(app, sessions["rev_l2"], report_a["report_id"], "LEVEL_2", "APPROVED", "复审通过（演示）")
    _review(app, sessions["rev_l3"], report_a["report_id"], "LEVEL_3", "APPROVED", "终审通过（演示）")
    wo_a = _work_order_id(app.conn, report_a["report_id"])
    _dispatch(app, sessions["ops_admin"], wo_a, "ORG-YR-01")
    _close(app, sessions["org_a_op"], wo_a, 12.5, "demo-a-close")

    # B：只过初审，停留在待复审（L2 审核演示）
    report_b = _report(app, sessions["ops_admin"], lat=coords["SEC-001"][0], lng=coords["SEC-001"][1],
                       category="RECYCLABLE", scale="MEDIUM", label="demo-b")
    _review(app, sessions["rev_l1"], report_b["report_id"], "LEVEL_1", "APPROVED", "初审通过（演示）")

    # C：待初审（L1 审核演示）
    _report(app, sessions["ops_admin"], lat=coords["SEC-002"][0], lng=coords["SEC-002"][1],
            category="HAZARDOUS", scale="SMALL", label="demo-c")

    # D：初审不通过（驳回示例）
    report_d = _report(app, sessions["ops_admin"], lat=coords["SEC-003"][0], lng=coords["SEC-003"][1],
                       category="KITCHEN", scale="LARGE", label="demo-d")
    _review(app, sessions["rev_l1"], report_d["report_id"], "LEVEL_1", "REJECTED", "现场证据不足（演示）")

    # E：公众用户待初审（个人中心列表示例）
    report_e = _report(app, sessions["user_r1"], lat=coords["SEC-001"][0], lng=coords["SEC-001"][1],
                       category="OTHER", scale="SMALL", label="demo-e")
    _ = report_e

    # F：公众用户审核通过 + 已办结（评价演示，特意不提交评价）
    report_f = _report(app, sessions["user_r1"], lat=coords["SEC-002"][0], lng=coords["SEC-002"][1],
                       category="RECYCLABLE", scale="MEDIUM", label="demo-f")
    _review(app, sessions["rev_l1"], report_f["report_id"], "LEVEL_1", "APPROVED", "初审通过（演示）")
    _review(app, sessions["rev_l2"], report_f["report_id"], "LEVEL_2", "APPROVED", "复审通过（演示）")
    _review(app, sessions["rev_l3"], report_f["report_id"], "LEVEL_3", "APPROVED", "终审通过（演示）")
    wo_f = _work_order_id(app.conn, report_f["report_id"])
    _dispatch(app, sessions["ops_admin"], wo_f, "ORG-YR-02")
    _close(app, sessions["org_b_op"], wo_f, 8.0, "demo-f-close")

    # G：已过初审 + 已派单（办结演示）
    report_g = _report(app, sessions["ops_admin"], lat=coords["SEC-001"][0], lng=coords["SEC-001"][1],
                       category="OTHER", scale="SMALL", label="demo-g")
    _review(app, sessions["rev_l1"], report_g["report_id"], "LEVEL_1", "APPROVED", "初审通过（演示）")
    wo_g = _work_order_id(app.conn, report_g["report_id"])
    _dispatch(app, sessions["ops_admin"], wo_g, "ORG-YR-01")

    # H：待派单（转派演示）
    _report(app, sessions["ops_admin"], lat=coords["SEC-003"][0], lng=coords["SEC-003"][1],
            category="OTHER", scale="MEDIUM", label="demo-h")

    # I：初审+复审通过，停留在待终审（L3 审核演示）
    report_i = _report(app, sessions["ops_admin"], lat=coords["SEC-002"][0], lng=coords["SEC-002"][1],
                       category="RECYCLABLE", scale="SMALL", label="demo-i")
    _review(app, sessions["rev_l1"], report_i["report_id"], "LEVEL_1", "APPROVED", "初审通过（演示）")
    _review(app, sessions["rev_l2"], report_i["report_id"], "LEVEL_2", "APPROVED", "复审通过（演示）")


def build_demo_payload(conn) -> dict:
    now = iso(utc_now())
    period = now[:7]
    accounts = []
    for row in conn.execute("SELECT account_id FROM accounts ORDER BY account_id"):
        account_id = row["account_id"]
        roles = [
            r["role_code"]
            for r in conn.execute(
                """
                SELECT ar.role_code FROM account_roles ar
                JOIN accounts a ON a.id = ar.account_pk
                WHERE a.account_id = ?
                ORDER BY ar.role_code
                """,
                (account_id,),
            )
        ]
        orgs = [
            r["org_id"]
            for r in conn.execute(
                """
                SELECT ao.org_id FROM account_orgs ao
                JOIN accounts a ON a.id = ao.account_pk
                WHERE a.account_id = ?
                ORDER BY ao.org_id
                """,
                (account_id,),
            )
        ]
        accounts.append({"account_id": account_id, "roles": roles, "org_ids": orgs})

    reports = []
    for row in conn.execute(
        """
        SELECT r.report_id, r.report_status, r.review_status, r.current_review_level,
               a.account_id AS owner_account_id,
               w.work_order_id, w.work_order_status, w.cleanup_weight_kg,
               w.section_id, w.assigned_org_id
        FROM reports r
        JOIN accounts a ON a.id = r.owner_account_pk
        JOIN work_orders w ON w.report_id = r.report_id
        ORDER BY r.id ASC
        """
    ):
        closed = row["work_order_status"] == "CLOSED" and row["cleanup_weight_kg"] is not None and float(row["cleanup_weight_kg"]) > 0
        reports.append(
            {
                "report_id": row["report_id"],
                "owner_account_id": row["owner_account_id"],
                "report_status": row["report_status"],
                "review_status": row["review_status"],
                "current_review_level": row["current_review_level"],
                "work_order_id": row["work_order_id"],
                "work_order_status": row["work_order_status"],
                "closed": closed,
                "section_id": row["section_id"],
                "assigned_org_id": row["assigned_org_id"],
            }
        )

    def by_level(level: str) -> list[dict]:
        return [
            item for item in reports
            if item["review_status"] in ("PENDING", "IN_PROGRESS")
            and item["current_review_level"] == level
        ]

    def by_wo_status(status: str) -> list[dict]:
        return [item for item in reports if item["work_order_status"] == status]

    def feedback_targets() -> list[dict]:
        rows = conn.execute(
            """
            SELECT w.work_order_id, w.report_id, w.cleanup_weight_kg
            FROM work_orders w
            WHERE w.work_order_status = 'CLOSED'
              AND w.cleanup_weight_kg IS NOT NULL AND w.cleanup_weight_kg > 0
              AND NOT EXISTS (
                SELECT 1 FROM feedbacks f
                WHERE f.work_order_id = w.work_order_id
              )
            ORDER BY w.id ASC
            """
        )
        return [
            {
                "work_order_id": r["work_order_id"],
                "report_id": r["report_id"],
                "cleanup_weight_kg": r["cleanup_weight_kg"],
            }
            for r in rows
        ]

    return {
        "generated_at": now,
        "period": period,
        "map_audit_no": SAMPLE_AUDIT_NO,
        "accounts": accounts,
        "reports": reports,
        "targets": {
            "review_level_1": by_level("LEVEL_1"),
            "review_level_2": by_level("LEVEL_2"),
            "review_level_3": by_level("LEVEL_3"),
            "dispatch": by_wo_status("PENDING_DISPATCH"),
            "close": by_wo_status("DISPATCHED"),
            "feedback": feedback_targets(),
        },
        "notes": [
            "演示辅助数据，不是契约接口，不得作为生产数据源。",
            "SAMPLE-ONLY 审图号仅用于本地演示；生产必须配置授权审图号。",
            "上报/审核/工单状态均为后端服务实际产生；本文件只读导出 ID。",
        ],
    }


def ensure_demo_data(app) -> None:
    conn = app.conn
    now = iso(utc_now())
    counts = seed.seed_demo(conn, now, DEMO_PASSWORD, trace_id=app.ids.trace_id())
    del counts

    config_row = conn.execute(
        "SELECT value_json, updated_by FROM configs WHERE key = 'map_audit_no'"
    ).fetchone()
    # 只替换系统初始化的 null；运维工具显式清除后的 null 必须保留（合规闸门）。
    if config_row is None or config_row["updated_by"] == "SYSTEM_INIT":
        seed.set_map_audit_no(
            conn,
            SAMPLE_AUDIT_NO,
            now,
            confirmed=True,
            trace_id=app.ids.trace_id(),
        )

    report_count = conn.execute("SELECT COUNT(*) AS n FROM reports").fetchone()["n"]
    if report_count == 0:
        _create_reports(app)

    DEMO_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = build_demo_payload(conn)
    tmp = DEMO_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(DEMO_FILE)

    print(f"[demo] database ready; reports={len(payload['reports'])}; period={payload['period']}")
    print(f"[demo] demo targets: {DEMO_FILE}")
