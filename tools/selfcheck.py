# -*- coding: utf-8 -*-
"""后端侧自证：不依赖前端即可跑通契约、硬规则、异常与审计。

运行：
    python tools/selfcheck.py [--verbose] [--output docs/selfcheck_result.txt]

退出码 0 表示全部通过；1 表示存在失败项。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import db, seed  # noqa: E402
from backend.app import BackendApp  # noqa: E402
from backend.constants import API_IDS, CONTRACT_VERSION  # noqa: E402
from backend.errors import domain_of  # noqa: E402
from backend.timeutil import FixedClock  # noqa: E402

logging.disable(logging.CRITICAL)

NOW = "2026-11-04T12:00:00Z"
PASSWORD = seed.DEMO_PASSWORD

REQUIRED_DATA_KEYS = {
    "AUTH-01": {"account_id", "account_status", "default_role"},
    "AUTH-02": {"session_handle", "expires_at", "account_profile", "permission_summary"},
    "AUTH-03": {"revoked"},
    "AUTH-04": {"session_status", "account_profile", "permission_summary", "expires_at"},
    "FILE-01": {"upload_ticket", "media_ref", "expires_at"},
    "RPT-01": {"report_id", "report_status"},
    "MAP-01": {"sections", "map_audit_no", "coarsen_degree", "total", "has_more"},
    "RPT-02": {"items", "total", "has_more"},
    "WO-01": {"work_order_id", "work_order_status"},
    "WO-02": {"work_order_id", "work_order_status", "closed", "progress_stage"},
    "REV-01": {"review_status", "review_record_id"},
    "STAT-01": {"metrics", "leaderboard_enabled"},
    "FB-01": {"feedback_id"},
    "ADM-01": {"waste_categories", "sections", "status_enums", "coarsen_degree",
               "leaderboard_enabled", "map_audit_no"},
}
ALLOWED_DATA_KEYS = dict(REQUIRED_DATA_KEYS)
ALLOWED_DATA_KEYS["RPT-01"] = {"report_id", "report_status", "matched_section_id"}
ALLOWED_DATA_KEYS["REV-01"] = {"review_status", "next_review_level", "review_record_id"}
# MAP-01 / RPT-02 的分页扩展字段已包含在 REQUIRED 中


class Harness:
    def __init__(self) -> None:
        self.tmpdir = tempfile.mkdtemp(prefix="huanghe_selfcheck_")
        self.db_path = os.path.join(self.tmpdir, "selfcheck.db")
        self.clock = FixedClock(NOW)
        self.app = BackendApp(self.db_path, clock=self.clock)
        self.conn = self.app.conn
        self.trace_counter = 0
        seed.seed_demo(self.conn, NOW, PASSWORD, trace_id=self._next_trace())
        self.responses: list[tuple[str, dict]] = []
        self.checks: list[dict] = []
        self.report_ids: dict[str, str] = {}
        self.success_apis: set[str] = set()
        self.group_name = "未分组"
        self.verbose = False
        self.lines: list[str] = []
        self.output_path: Path | None = None

    # ------------------------------------------------------------------
    def group(self, name: str) -> None:
        self.group_name = name

    def check(self, name: str, condition, detail: str = "") -> None:
        passed = bool(condition)
        self.checks.append({"group": self.group_name, "name": name, "passed": passed,
                            "detail": "" if passed else detail})
        line = (f"[{'PASS' if passed else 'FAIL'}] {self.group_name} | {name}"
                + (f" | {detail}" if not passed and detail else ""))
        self.lines.append(line)
        if self.verbose or not passed:
            print(line)

    def _next_trace(self) -> str:
        self.trace_counter += 1
        return f"{self.trace_counter:032x}"

    def call(self, label: str, api: str, payload: dict | None = None, session: str | None = None,
             idem: str | None = None, expect="OK") -> dict:
        request = {"api": api, "payload": payload if payload is not None else {}}
        if session is not None:
            request["session_handle"] = session
        if idem is not None:
            request["idempotency_key"] = idem
        return self._handle(label, api, request, expect)

    def _handle(self, label: str, api: str, request: dict, expect="OK") -> dict:
        resp = self.app.handle(request, trace_id=self._next_trace())
        self.responses.append((label, resp))
        self._check_envelope(label, api, resp)
        if resp["code"] == "OK":
            self.success_apis.add(api)
        if expect is not None:
            if isinstance(expect, tuple):
                self.check(f"{label} -> {expect}", resp["code"] in expect,
                           f"got {resp['code']}: {resp['message']}")
            else:
                self.check(f"{label} -> {expect}", resp["code"] == expect,
                           f"got {resp['code']}: {resp['message']}")
        return resp

    def _check_envelope(self, label: str, api: str, resp: dict) -> None:
        self.check(f"{label} | 信封四字段", set(resp.keys()) == {"code", "message", "data", "trace_id"},
                   f"keys={list(resp.keys())}")
        self.check(f"{label} | trace_id", isinstance(resp.get("trace_id"), str) and len(resp["trace_id"]) == 32,
                   f"trace_id={resp.get('trace_id')!r}")
        if resp.get("code") == "OK":
            data = resp.get("data")
            ok = isinstance(data, dict)
            self.check(f"{label} | 成功 data 非空", ok, f"data={data!r}")
            if ok and api in ALLOWED_DATA_KEYS:
                keys = set(data.keys())
                self.check(f"{label} | 成功字段均在契约内", keys <= ALLOWED_DATA_KEYS[api], f"extra={keys - ALLOWED_DATA_KEYS[api]}")
                self.check(f"{label} | 关键字段齐备", REQUIRED_DATA_KEYS[api] <= keys, f"missing={REQUIRED_DATA_KEYS[api] - keys}")
        else:
            self.check(f"{label} | 错误 data 为 null", resp.get("data") is None, f"data={resp.get('data')!r}")
            self.check(f"{label} | 错误 message 可展示",
                       isinstance(resp.get("message"), str) and bool(resp["message"]), f"message={resp.get('message')!r}")

    # ------------------------------------------------------------------
    def login(self, account_id: str, label: str | None = None, expect="OK", device="selfcheck") -> str | None:
        resp = self.call(label or f"login:{account_id}", "AUTH-02",
                         {"account_id": account_id, "credential": PASSWORD, "device_tag": device}, expect=expect)
        return resp["data"]["session_handle"] if resp.get("code") == "OK" else None

    def register(self, account_id: str, label: str, *, key: str | None = None, credential=PASSWORD,
                 agreement=True, token: str | None = None, expect="OK") -> dict:
        if token is None:
            token = self.app.verification.issue_token(account_id, self.clock.now())
        return self.call(label, "AUTH-01",
                         {"account_id": account_id, "credential": credential,
                          "verify_token": token, "agreement_accepted": agreement},
                         idem=key, expect=expect)

    def make_media(self, session: str, tag: str, *, idem: str | None = None, media_type="IMAGE_JPEG",
                   size=2048, checksum="a" * 64, expect="OK") -> dict:
        return self.call(f"file:{tag}", "FILE-01",
                         {"media_type": media_type, "size_bytes": size, "checksum": checksum},
                         session=session, idem=idem if idem is not None else f"idem-file-{tag}", expect=expect)

    def make_report(self, session: str, tag: str, media_ref: str, *, lat=36.0611, lng=103.8343,
                    category="OTHER", scale="SMALL", idem: str | None = None, expect="OK") -> dict:
        resp = self.call(f"report:{tag}", "RPT-01",
                         {"raw_lat": lat, "raw_lng": lng, "waste_category": category,
                          "scale_level": scale, "media_refs": [media_ref]},
                         session=session, idem=idem if idem is not None else f"idem-report-{tag}", expect=expect)
        if resp.get("code") == "OK":
            self.report_ids[tag] = resp["data"]["report_id"]
        return resp

    def review(self, session: str, report_id: str, level: str, result: str, tag: str,
               comment="审核意见", expect="OK") -> dict:
        return self.call(f"review:{tag}", "REV-01",
                         {"target_type": "REPORT", "target_id": report_id, "review_level": level,
                          "review_result": result, "comment": comment},
                         session=session, idem=f"idem-review-{tag}", expect=expect)

    def dispatch(self, session: str, work_order_id: str, org_id: str, tag: str, expect="OK") -> dict:
        return self.call(f"wo01:{tag}", "WO-01",
                         {"work_order_id": work_order_id, "target_org_id": org_id},
                         session=session, idem=f"idem-wo01-{tag}", expect=expect)

    def close(self, session: str, work_order_id: str, weight, refs: list[str], tag: str, expect="OK") -> dict:
        return self.call(f"wo02:{tag}", "WO-02",
                         {"work_order_id": work_order_id, "cleanup_weight_kg": weight, "evidence_refs": refs},
                         session=session, idem=f"idem-wo02-{tag}", expect=expect)

    def feedback(self, session: str, work_order_id: str, rating, content: str, tag: str, expect="OK") -> dict:
        return self.call(f"fb:{tag}", "FB-01",
                         {"work_order_id": work_order_id, "rating": rating, "content": content},
                         session=session, idem=f"idem-fb-{tag}", expect=expect)

    # ------------------------------------------------------------------
    def q(self, sql: str, params=()):
        return self.conn.execute(sql, params).fetchone()

    def n(self, sql: str, params=()) -> int:
        row = self.q(sql, params)
        return int(row[0]) if row is not None else 0

    def wo_of(self, report_id: str) -> dict:
        row = self.q("SELECT * FROM work_orders WHERE report_id = ?", (report_id,))
        return dict(row) if row is not None else {}

    def account_pk(self, account_id: str) -> int:
        return int(self.q("SELECT id FROM accounts WHERE account_id = ?", (account_id,))["id"])

    def audits(self, event_type: str | None = None) -> list[dict]:
        if event_type is None:
            rows = self.conn.execute("SELECT * FROM audit_logs ORDER BY id").fetchall()
        else:
            rows = self.conn.execute("SELECT * FROM audit_logs WHERE event_type = ? ORDER BY id",
                                     (event_type,)).fetchall()
        return [dict(r) for r in rows]

    def _emit(self, line: str = "") -> None:
        self.lines.append(line)
        print(line)

    def finish(self) -> int:
        self._final_checks()
        total = len(self.checks)
        failed = [c for c in self.checks if not c["passed"]]
        self._emit("\n" + "=" * 76)
        groups: dict[str, list[int]] = {}
        for c in self.checks:
            g = groups.setdefault(c["group"], [0, 0])
            g[0] += 1
            if not c["passed"]:
                g[1] += 1
        for name, (count, bad) in groups.items():
            self._emit(f"{name:<30} {'PASS' if bad == 0 else 'FAIL(' + str(bad) + ')':<12} {count} 项")
        self._emit("-" * 76)
        self._emit(f"总计 {total} 项，通过 {total - len(failed)} 项，失败 {len(failed)} 项；"
                   f"contract_version={CONTRACT_VERSION}")
        if failed:
            self._emit("\n失败明细：")
            for c in failed:
                self._emit(f"  - [{c['group']}] {c['name']} {c['detail']}")
        self._emit(f"\n自检数据库：{self.db_path}")
        if self.output_path is not None:
            self.output_path.parent.mkdir(parents=True, exist_ok=True)
            header = [
                "# 后端自检运行结果（自动生成）",
                "",
                f"- contract_version：{CONTRACT_VERSION}",
                f"- 固定时钟：{NOW}",
                f"- 检查项：{total}，通过 {total - len(failed)}，失败 {len(failed)}",
                "- 说明：本文件由 tools/selfcheck.py 生成，包含逐项 PASS/FAIL 记录。",
                "",
            ]
            self.output_path.write_text(
                "\n".join(header + self.lines) + "\n", encoding="utf-8"
            )
        return 0 if not failed else 1

    # ------------------------------------------------------------------
    def _final_checks(self) -> None:
        self.group("合规扫描")
        forbidden_key_parts = ("raw", "person", "renci", "participant", "visitor", "人次")
        bad_keys: list[str] = []
        bad_values: list[str] = []

        def walk(obj, path=""):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if any(part in str(k).lower() for part in forbidden_key_parts):
                        bad_keys.append(f"{path}.{k}")
                    walk(v, f"{path}.{k}")
            elif isinstance(obj, list):
                for i, v in enumerate(obj):
                    walk(v, f"{path}[{i}]")
            elif isinstance(obj, str) and "人次" in obj:
                bad_values.append(f"{path}={obj!r}")

        for label, resp in self.responses:
            walk(resp, label)
        self.check("响应无原始坐标/人次类字段", not bad_keys, str(bad_keys[:5]))
        self.check("响应无『人次』文本", not bad_values, str(bad_values[:5]))

        domains = {d: set() for d in ("PARAM", "AUTH", "PERM", "STATE", "RATE", "DEP", "INTERNAL")}
        for _label, resp in self.responses:
            if resp["code"] != "OK":
                domains[domain_of(resp["code"])].add(resp["code"])
        for domain, codes in domains.items():
            self.check(f"错误码域覆盖：{domain}", bool(codes), "未触发")

        # 字段名可以出现在可展示文案中；原始坐标的“数值”不得出现。
        forbidden_message_parts = ("Traceback", "sqlite", "SELECT ", "INSERT ", "UPDATE ",
                                   "credential", "password", "session_handle", "upload_ticket",
                                   "36.0611", "103.8343", "RuntimeError", "injected")
        leaks = []
        for label, resp in self.responses:
            if resp["code"] != "OK":
                for part in forbidden_message_parts:
                    if part in resp["message"]:
                        leaks.append(f"{label}:{part}")
        self.check("错误文案无内部细节/凭证", not leaks, str(leaks[:5]))

        self.check("数据库：CLOSED 必有 cleanup_weight_kg>0",
                   self.n("SELECT COUNT(*) FROM work_orders WHERE work_order_status='CLOSED' "
                          "AND (cleanup_weight_kg IS NULL OR cleanup_weight_kg<=0)") == 0)
        self.check("数据库：非 CLOSED 无清理量",
                   self.n("SELECT COUNT(*) FROM work_orders WHERE work_order_status<>'CLOSED' "
                          "AND cleanup_weight_kg IS NOT NULL") == 0)
        self.check("数据库：APPROVED 均有 approved_at",
                   self.n("SELECT COUNT(*) FROM reports WHERE report_status='APPROVED' AND approved_at IS NULL") == 0)
        self.check("数据库：R7 与 R5 不共存",
                   self.n("SELECT COUNT(*) FROM account_roles a JOIN account_roles b "
                          "ON a.account_pk=b.account_pk AND a.role_code='R7' AND b.role_code='R5'") == 0)

        secrets: list[str] = []
        for _label, resp in self.responses:
            data = resp.get("data")
            if isinstance(data, dict):
                for key in ("session_handle", "upload_ticket"):
                    if isinstance(data.get(key), str):
                        secrets.append(data[key])
        secrets.append(PASSWORD)
        audit_blob = "\n".join(json.dumps(a, ensure_ascii=False) for a in self.audits())
        leaked = [s for s in secrets if s and s in audit_blob]
        self.check("审计未落凭证/会话句柄/上传凭证", not leaked, f"{len(leaked)} 项")
        self.check("审计未落原始坐标", not any(p in audit_blob for p in ("raw_lat", "raw_lng", "36.0611", "103.8343")))

        blocked_update = False
        try:
            with db.transaction(self.conn):
                self.conn.execute("UPDATE audit_logs SET outcome='FAILURE' WHERE id=1")
        except sqlite3.IntegrityError:
            blocked_update = True
        self.check("审计记录不可更新", blocked_update)

        blocked_delete = False
        try:
            with db.transaction(self.conn):
                self.conn.execute("DELETE FROM audit_logs WHERE id=1")
        except sqlite3.IntegrityError:
            blocked_delete = True
        self.check("审计记录不可删除", blocked_delete)

        self.check("外键一致性", len(self.conn.execute("PRAGMA foreign_key_check").fetchall()) == 0)
        self.check("数据库 integrity_check", self.conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok")

        traces = [resp["trace_id"] for _label, resp in self.responses]
        self.check("trace_id 逐请求唯一", len(traces) == len(set(traces)), f"{len(traces)} vs {len(set(traces))}")
        self.check("14 个接口均有成功响应", set(API_IDS) <= self.success_apis,
                   f"missing={set(API_IDS) - self.success_apis}")


def _expect_integrity_error(conn, sql, params) -> bool:
    try:
        with db.transaction(conn):
            conn.execute(sql, params)
        return False
    except sqlite3.IntegrityError:
        return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--output", default=str(ROOT / "docs" / "selfcheck_result.txt"))
    args = parser.parse_args()

    h = Harness()
    h.verbose = args.verbose
    h.output_path = Path(args.output)

    # ================= 契约表面 =================
    h.group("契约表面")
    h.call("unknown-api", "XXX-99", {}, expect="PARAM_UNKNOWN_API")
    envelope_extra = h.app.handle(
        {"api": "MAP-01", "payload": {"period": "2026-11", "page_no": 1, "page_size": 10}, "x": 1},
        trace_id=h._next_trace())
    h.responses.append(("envelope-extra", envelope_extra))
    h._check_envelope("envelope-extra", "MAP-01", envelope_extra)
    h.check("信封未知字段 -> PARAM_UNKNOWN_FIELD", envelope_extra["code"] == "PARAM_UNKNOWN_FIELD",
            envelope_extra["code"])
    missing_payload = h.app.handle({"api": "MAP-01"}, trace_id=h._next_trace())
    h.responses.append(("map-missing-payload", missing_payload))
    h._check_envelope("map-missing-payload", "MAP-01", missing_payload)
    h.check("缺 payload -> PARAM_MISSING_FIELD", missing_payload["code"] == "PARAM_MISSING_FIELD",
            missing_payload["code"])
    payload_list = h.app.handle({"api": "MAP-01", "payload": []}, trace_id=h._next_trace())
    h.responses.append(("map-payload-list", payload_list))
    h._check_envelope("map-payload-list", "MAP-01", payload_list)
    h.check("payload 非对象 -> PARAM_INVALID_TYPE", payload_list["code"] == "PARAM_INVALID_TYPE",
            payload_list["code"])
    h.call("map-unknown-field", "MAP-01",
           {"period": "2026-11", "page_no": 1, "page_size": 10, "closed": True}, expect="PARAM_UNKNOWN_FIELD")
    h.call("map-bad-page", "MAP-01", {"period": "2026-11", "page_no": 1, "page_size": 101},
           expect="PARAM_INVALID_PAGINATION")
    h.call("map-bad-period", "MAP-01", {"period": "2026-13", "page_no": 1, "page_size": 10},
           expect="PARAM_INVALID_PERIOD")
    h.call("map-bad-section", "MAP-01",
           {"period": "2026-11", "section_id": "SEC-XXX", "page_no": 1, "page_size": 10},
           expect="PARAM_TARGET_NOT_FOUND")

    map0 = h.call("map-default-no-audit-no", "MAP-01",
                  {"period": "2026-11", "page_no": 1, "page_size": 20}, expect="OK")
    h.check("MAP-01 审图号缺失 -> 不下发点位",
            map0["data"]["sections"] == [] and map0["data"]["map_audit_no"] is None,
            json.dumps(map0["data"], ensure_ascii=False), )
    stat0 = h.call("stat-default", "STAT-01", {"period": "2026-11", "metric_keys": []}, expect="OK")
    h.check("STAT-01 默认榜单关闭", stat0["data"]["leaderboard_enabled"] is False)
    h.check("STAT-01 零样本不发布", all(m["published"] is False for m in stat0["data"]["metrics"]))
    h.call("stat-unknown-metric", "STAT-01", {"period": "2026-11", "metric_keys": ["unknown_metric"]},
           expect="PARAM_UNKNOWN_METRIC_KEY")
    h.call("stat-bad-period", "STAT-01", {"period": "bad", "metric_keys": []}, expect="PARAM_INVALID_PERIOD")
    h.call("map-with-stale-session", "MAP-01",
           {"period": "2026-11", "page_no": 1, "page_size": 10}, session="sh_" + "x" * 43, expect="OK")
    h.call("stat-with-stale-session", "STAT-01", {"period": "2026-11", "metric_keys": []},
           session="sh_" + "x" * 43, expect="OK")

    # ================= 认证 =================
    h.group("认证组")
    h.call("rpt-no-session", "RPT-01",
           {"raw_lat": 36.06, "raw_lng": 103.83, "waste_category": "OTHER",
            "scale_level": "SMALL", "media_refs": ["med_000000000000"]}, expect="AUTH_SESSION_REQUIRED")
    h.call("auth04-no-session", "AUTH-04", {}, expect="AUTH_SESSION_REQUIRED")
    h.call("auth03-no-handle", "AUTH-03", {"scope": "CURRENT"}, expect="AUTH_SESSION_REQUIRED")
    h.call("adm-no-session", "ADM-01", {"config_scope": "ALL"}, expect="AUTH_SESSION_REQUIRED")

    reg = h.register("sample_reg_ok", "register-success", key="idem-reg-0001")
    h.check("注册返回默认角色 R1", reg["data"]["default_role"] == "R1")
    h.check("注册返回 ACTIVE", reg["data"]["account_status"] == "ACTIVE")
    h.register("sample_reg_ok", "register-replay", key="idem-reg-0001")
    h.check("注册幂等：仅 1 条账号",
            h.n("SELECT COUNT(*) FROM accounts WHERE account_id='sample_reg_ok'") == 1)
    h.register("sample_reg_ok", "register-key-conflict", key="idem-reg-0001",
               credential="Different#Pass9", expect="PARAM_IDEMPOTENCY_KEY_REUSED")
    h.register("sample_reg_ok", "register-duplicate", expect="AUTH_ACCOUNT_EXISTS")
    h.register("sample_reg_no_key", "register-no-key", key=None)
    h.check("AUTH-01 无幂等键可用",
            h.n("SELECT COUNT(*) FROM accounts WHERE account_id='sample_reg_no_key'") == 1)
    h.register("sample_reg_bad", "register-missing-token", token="", expect="PARAM_INVALID_VALUE")
    h.register("sample_reg_bad", "register-short-password", credential="short",
               expect="AUTH_CREDENTIAL_TOO_WEAK")
    h.register("sample_reg_bad", "register-agreement", agreement=False, expect="PARAM_AGREEMENT_REQUIRED")
    h.register("ab", "register-bad-account-id", expect="PARAM_INVALID_VALUE")
    correct = h.app.verification.issue_token("sample_reg_bad", h.clock.now())
    wrong = "000001" if correct == "000000" else "000000"
    h.register("sample_reg_bad", "register-wrong-token", token=wrong, expect="AUTH_VERIFY_FAILED")
    h.app.verification.available = False
    h.register("sample_reg_dep", "register-dep", expect="DEP_EXTERNAL_UNAVAILABLE")
    h.app.verification.available = True
    h.check("DEP 降级不创建账号", h.n("SELECT COUNT(*) FROM accounts WHERE account_id='sample_reg_dep'") == 0)

    s_user = h.login("user_r1", "login-user_r1")
    h.check("登录返回会话句柄", isinstance(s_user, str) and s_user.startswith("sh_"))
    h.call("login-second-factor-ignored", "AUTH-02",
           {"account_id": "user_r1", "credential": PASSWORD, "device_tag": "selfcheck-2",
            "second_factor": "123456"}, expect="OK")
    bad_existing = h.call("login-wrong-existing", "AUTH-02",
                          {"account_id": "user_r1", "credential": "Wrong#Pass999", "device_tag": "selfcheck"},
                          expect="AUTH_INVALID")
    bad_missing = h.call("login-wrong-nonexistent", "AUTH-02",
                         {"account_id": "no_such_user_01", "credential": "Wrong#Pass999",
                          "device_tag": "selfcheck"}, expect="AUTH_INVALID")
    h.check("登录失败不泄露账号存在性（同码同文案）",
            bad_existing["code"] == bad_missing["code"] and bad_existing["message"] == bad_missing["message"])

    for _ in range(5):
        h.call("login-lock-fail", "AUTH-02",
               {"account_id": "lock_probe_01", "credential": "Wrong#Pass999", "device_tag": "selfcheck"},
               expect=None)
    h.call("login-locked", "AUTH-02",
           {"account_id": "lock_probe_01", "credential": "Wrong#Pass999", "device_tag": "selfcheck"},
           expect="AUTH_LOCKED")
    for _ in range(20):
        h.call("login-rate-attempt", "AUTH-02",
               {"account_id": "rate_probe_01", "credential": "Wrong#Pass999", "device_tag": "selfcheck"},
               expect=None)
    h.call("login-rate-limited", "AUTH-02",
           {"account_id": "rate_probe_01", "credential": "Wrong#Pass999", "device_tag": "selfcheck"},
           expect="RATE_LIMITED")

    h.register("temp_user_01", "register-temp")
    s_temp = h.login("temp_user_01", "login-temp")
    seed.disable_account(h.conn, "temp_user_01", NOW, trace_id=h._next_trace())
    h.call("login-disabled", "AUTH-02",
           {"account_id": "temp_user_01", "credential": PASSWORD, "device_tag": "selfcheck"},
           expect="AUTH_INVALID")
    h.call("auth04-disabled-session", "AUTH-04", {}, session=s_temp, expect="AUTH_SESSION_REVOKED")

    # ================= 会话 =================
    h.group("会话组")
    h.register("temp_session_02", "register-temp-session")
    s_a = h.login("temp_session_02", "login-temp-session-a", device="device-a")
    s_b = h.login("temp_session_02", "login-temp-session-b", device="device-b")
    info = h.call("auth04-success", "AUTH-04", {}, session=s_a, expect="OK")
    h.check("AUTH-04 返回 ACTIVE", info["data"]["session_status"] == "ACTIVE")
    h.call("logout-current", "AUTH-03", {"scope": "CURRENT"}, session=s_a, expect="OK")
    h.call("auth04-after-logout", "AUTH-04", {}, session=s_a, expect="AUTH_SESSION_REVOKED")
    h.call("logout-again", "AUTH-03", {"scope": "CURRENT"}, session=s_a, expect="OK")
    h.call("logout-all", "AUTH-03", {"scope": "ALL"}, session=s_b, expect="OK")
    h.call("auth04-other-session-revoked", "AUTH-04", {}, session=s_b, expect="AUTH_SESSION_REVOKED")
    h.call("logout-unknown-handle", "AUTH-03", {"scope": "CURRENT"}, session="sh_" + "y" * 43, expect="OK")
    h.call("logout-bad-scope", "AUTH-03", {"scope": "SOMETHING"}, session=s_b, expect="PARAM_INVALID_ENUM")
    h.call("auth04-bad-handle", "AUTH-04", {}, session="sh_" + "z" * 43, expect="AUTH_SESSION_INVALID")

    # ================= 权限即时生效 =================
    h.group("权限即时生效")
    s_l1 = h.login("rev_l1", "login-rev_l1")
    h.register("temp_perm_01", "register-perm")
    s_perm = h.login("temp_perm_01", "login-perm")
    perm_ref = h.call("perm-media", "FILE-01",
                      {"media_type": "IMAGE_JPEG", "size_bytes": 1024, "checksum": "b" * 64},
                      session=s_perm, idem="idem-perm-media", expect="OK")["data"]["media_ref"]
    perm_report = h.make_report(s_perm, "perm", perm_ref, idem="idem-perm-report")
    perm_rid = perm_report["data"]["report_id"]
    seed.revoke_role(h.conn, "rev_l1", "R3", NOW, trace_id=h._next_trace())
    h.call("permission-revoked-immediate", "REV-01",
           {"target_type": "REPORT", "target_id": perm_rid, "review_level": "LEVEL_1",
            "review_result": "APPROVED", "comment": "ok"},
           session=s_l1, idem="idem-perm-review-1", expect="PERM_ROLE_REQUIRED")
    seed.grant_role(h.conn, "rev_l1", "R3", NOW, trace_id=h._next_trace())
    h.call("permission-restored-immediate", "REV-01",
           {"target_type": "REPORT", "target_id": perm_rid, "review_level": "LEVEL_1",
            "review_result": "APPROVED", "comment": "ok"},
           session=s_l1, idem="idem-perm-review-2", expect="OK")

    # ================= 权限矩阵 =================
    h.group("权限矩阵")
    s_ops = h.login("ops_admin", "login-ops")
    s_sys = h.login("sys_admin", "login-sys")
    s_auditor = h.login("auditor", "login-auditor")
    s_org_a = h.login("org_a_op", "login-org_a")
    s_org_b = h.login("org_b_op", "login-org_b")
    s_l2 = h.login("rev_l2", "login-rev_l2")
    s_l3 = h.login("rev_l3", "login-rev_l3")
    s_multi = h.login("rev_multi", "login-rev_multi")
    h.call("perm-r1-adm", "ADM-01", {"config_scope": "ALL"}, session=s_user, expect="PERM_ROLE_REQUIRED")
    h.call("perm-r1-wo01", "WO-01", {"work_order_id": "WO-XXX", "target_org_id": "ORG-YR-01"},
           session=s_user, expect="PERM_ROLE_REQUIRED")
    h.call("perm-r1-rev", "REV-01",
           {"target_type": "REPORT", "target_id": "RPT-XXX", "review_level": "LEVEL_1",
            "review_result": "APPROVED", "comment": "ok"}, session=s_user, expect="PERM_ROLE_REQUIRED")
    h.call("perm-r8-adm", "ADM-01", {"config_scope": "ALL"}, session=s_auditor, expect="PERM_ROLE_REQUIRED")
    profile = h.call("auth04-ops-summary", "AUTH-04", {}, session=s_ops, expect="OK")
    perms = profile["data"]["permission_summary"]["permissions"]
    h.check("运营管理员权限摘要含 WO-01/WO-02/ADM-01", {"WO-01", "WO-02", "ADM-01"} <= set(perms), str(perms))
    profile_r1 = h.call("auth04-r1-summary", "AUTH-04", {}, session=s_user, expect="OK")
    h.check("R1 摘要不含管理操作",
            not ({"WO-01", "WO-02", "REV-01", "ADM-01"}
                 & set(profile_r1["data"]["permission_summary"]["permissions"])))

    # ================= 媒体 =================
    h.group("媒体组")
    media = h.make_media(s_user, "main")
    h.call("file-no-key", "FILE-01",
           {"media_type": "IMAGE_JPEG", "size_bytes": 1024, "checksum": "c" * 64},
           session=s_user, expect="OK")
    h.make_media(s_user, "bad-type", media_type="IMAGE_GIF", expect="PARAM_INVALID_MEDIA_TYPE")
    h.make_media(s_user, "oversize", size=20 * 1024 * 1024, expect="PARAM_MEDIA_SIZE_EXCEEDED")
    h.make_media(s_user, "bad-checksum", checksum="xyz", expect="PARAM_INVALID_CHECKSUM")
    h.make_media(s_user, "bad-size-type", size="abc", expect="PARAM_INVALID_TYPE")
    idem_media = h.make_media(s_user, "idem", idem="idem-media-001")["data"]["media_ref"]
    idem_media2 = h.make_media(s_user, "idem", idem="idem-media-001")["data"]["media_ref"]
    h.check("FILE-01 幂等回放同一 media_ref", idem_media == idem_media2)

    # ================= 上报 =================
    h.group("上报组")
    h.register("temp_other_01", "register-other")
    s_other = h.login("temp_other_01", "login-other")
    other_media = h.make_media(s_other, "other")["data"]["media_ref"]

    rep_main = h.make_report(s_user, "main", media["data"]["media_ref"], idem="idem-report-main")
    rid_main = rep_main["data"]["report_id"]
    h.check("上报匹配岸段 SEC-001", rep_main["data"].get("matched_section_id") == "SEC-001",
            json.dumps(rep_main["data"], ensure_ascii=False))
    h.check("上报初始 SUBMITTED", rep_main["data"]["report_status"] == "SUBMITTED")
    count_before = h.n("SELECT COUNT(*) FROM reports")
    h.make_report(s_user, "main", media["data"]["media_ref"], idem="idem-report-main")
    h.check("RPT-01 幂等不产生重复上报", h.n("SELECT COUNT(*) FROM reports") == count_before)
    h.make_report(s_user, "main-key-conflict", media["data"]["media_ref"], category="RECYCLABLE",
                  idem="idem-report-main", expect="PARAM_IDEMPOTENCY_KEY_REUSED")
    no_key_resp = h.app.handle({"api": "RPT-01", "session_handle": s_user, "payload": {
        "raw_lat": 36.0611, "raw_lng": 103.8343, "waste_category": "OTHER",
        "scale_level": "SMALL", "media_refs": [media["data"]["media_ref"]]}}, trace_id=h._next_trace())
    h.responses.append(("report-no-key", no_key_resp))
    h._check_envelope("report-no-key", "RPT-01", no_key_resp)
    h.check("RPT-01 缺幂等键 -> PARAM_MISSING_FIELD", no_key_resp["code"] == "PARAM_MISSING_FIELD",
            no_key_resp["code"])
    h.make_report(s_user, "bad-coord", media["data"]["media_ref"], lat=120,
                  expect="PARAM_INVALID_COORDINATE")
    h.make_report(s_user, "bad-category", media["data"]["media_ref"], category="UNKNOWN",
                  expect="PARAM_INVALID_ENUM")
    h.make_report(s_user, "bad-scale", media["data"]["media_ref"], scale="HUGE", expect="PARAM_INVALID_ENUM")
    h.make_report(s_user, "foreign-media", other_media, expect="PARAM_INVALID_VALUE")
    h.check("原始坐标仅上行、不入报告响应",
            "raw_lat" not in json.dumps(rep_main["data"]) and "raw_lng" not in json.dumps(rep_main["data"]))
    ai = h.q("SELECT ai_status FROM reports WHERE report_id = ?", (rid_main,))
    h.check("AI 不可用时上报仍受理且标记 UNAVAILABLE", ai["ai_status"] == "UNAVAILABLE", str(dict(ai)))
    h.check("上报创建与工单初始化同事务",
            h.n("SELECT COUNT(*) FROM work_orders WHERE report_id = ?", (rid_main,)) == 1)
    h.check("上报媒体关系落库", h.n("SELECT COUNT(*) FROM report_media WHERE report_id = ?", (rid_main,)) == 1)

    for tag, lat, lng in [
        ("unapproved", 36.0611, 103.8343),
        ("reject", 36.0611, 103.8343),
        ("return", 36.0611, 103.8343),
        ("sod", 36.0611, 103.8343),
        ("r7", 36.0611, 103.8343),
        ("pending", 36.0611, 103.8343),
        ("sec2", 36.5811, 103.2343),
    ]:
        ref = h.make_media(s_user, f"ref-{tag}", idem=f"idem-file-{tag}")["data"]["media_ref"]
        h.make_report(s_user, tag, ref, lat=lat, lng=lng, idem=f"idem-report-{tag}")
    h.check("SEC-002 上报匹配 SEC-002",
            h.q("SELECT matched_section_id FROM reports WHERE report_id=?",
                (h.report_ids["sec2"],))["matched_section_id"] == "SEC-002")

    # ================= 审核 =================
    h.group("审核组")
    rid_main = h.report_ids["main"]
    rid_unapproved = h.report_ids["unapproved"]
    rid_reject = h.report_ids["reject"]
    rid_return = h.report_ids["return"]
    rid_sod = h.report_ids["sod"]
    rid_r7 = h.report_ids["r7"]
    rid_pending = h.report_ids["pending"]
    rid_sec2 = h.report_ids["sec2"]

    h.call("review-level-mismatch", "REV-01",
           {"target_type": "REPORT", "target_id": rid_return, "review_level": "LEVEL_3",
            "review_result": "APPROVED", "comment": "ok"}, session=s_l3, idem="idem-rev-mismatch",
           expect="STATE_REVIEW_LEVEL_MISMATCH")
    h.call("review-wrong-role", "REV-01",
           {"target_type": "REPORT", "target_id": rid_return, "review_level": "LEVEL_2",
            "review_result": "APPROVED", "comment": "ok"}, session=s_l1, idem="idem-rev-wrong-role",
           expect="PERM_ROLE_REQUIRED")
    h.review(s_l1, rid_main, "LEVEL_1", "APPROVED", "main-l1")
    h.review(s_l2, rid_main, "LEVEL_2", "APPROVED", "main-l2")
    h.review(s_l3, rid_main, "LEVEL_3", "APPROVED", "main-l3")
    h.check("三审通过后 APPROVED",
            h.q("SELECT report_status FROM reports WHERE report_id=?", (rid_main,))["report_status"] == "APPROVED")
    h.check("终审通过写入 approved_at",
            h.q("SELECT approved_at FROM reports WHERE report_id=?", (rid_main,))["approved_at"] is not None)
    rev_before = h.n("SELECT COUNT(*) FROM review_records WHERE target_id=?", (rid_main,))
    h.review(s_l1, rid_main, "LEVEL_1", "APPROVED", "main-l1")
    h.check("REV-01 幂等不新增审核记录",
            h.n("SELECT COUNT(*) FROM review_records WHERE target_id=?", (rid_main,)) == rev_before)

    h.review(s_multi, rid_sod, "LEVEL_1", "APPROVED", "sod-l1")
    h.review(s_multi, rid_sod, "LEVEL_2", "APPROVED", "sod-l2", expect="PERM_SOD_VIOLATION")
    h.review(s_l2, rid_sod, "LEVEL_2", "APPROVED", "sod-l2b")
    h.review(s_l3, rid_sod, "LEVEL_3", "APPROVED", "sod-l3")

    # 让系统管理员具备一个非终审角色，以触达服务层的「不兼终审」闸门
    seed.grant_role(h.conn, "sys_admin", "R4", NOW, trace_id=h._next_trace())
    h.review(s_l1, rid_r7, "LEVEL_1", "APPROVED", "r7-l1")
    h.review(s_l2, rid_r7, "LEVEL_2", "APPROVED", "r7-l2")
    h.review(s_sys, rid_r7, "LEVEL_3", "APPROVED", "r7-l3-banned", expect="PERM_SOD_VIOLATION")
    h.review(s_l3, rid_r7, "LEVEL_3", "APPROVED", "r7-l3")

    h.review(s_l1, rid_return, "LEVEL_1", "APPROVED", "return-l1")
    h.review(s_l2, rid_return, "LEVEL_2", "RETURNED", "return-l2-return", comment="请补充照片后重走")
    rr = h.q("SELECT review_status, current_review_level FROM reports WHERE report_id=?", (rid_return,))
    h.check("L2 退回后回到 L1 且未终结",
            rr["review_status"] == "IN_PROGRESS" and rr["current_review_level"] == "LEVEL_1", str(dict(rr)))
    h.review(s_l1, rid_return, "LEVEL_1", "APPROVED", "return-l1-rewalk")
    h.review(s_l2, rid_return, "LEVEL_2", "APPROVED", "return-l2-rewalk")
    h.review(s_l3, rid_return, "LEVEL_3", "APPROVED", "return-l3")

    h.review(s_l1, rid_reject, "LEVEL_1", "APPROVED", "reject-l1")
    h.review(s_l2, rid_reject, "LEVEL_2", "REJECTED", "reject-l2", comment="线索不实")
    h.check("不通过后 REJECTED",
            h.q("SELECT report_status FROM reports WHERE report_id=?", (rid_reject,))["report_status"] == "REJECTED")
    h.check("不通过取消未办结工单", h.wo_of(rid_reject)["work_order_status"] == "CANCELLED",
            h.wo_of(rid_reject)["work_order_status"])
    h.review(s_l3, rid_reject, "LEVEL_3", "APPROVED", "reject-l3", expect="STATE_INVALID_TRANSITION")

    h.call("review-target-missing", "REV-01",
           {"target_type": "REPORT", "target_id": "RPT-UNKNOWN", "review_level": "LEVEL_1",
            "review_result": "APPROVED", "comment": "ok"}, session=s_l1, idem="idem-rev-missing",
           expect="PARAM_TARGET_NOT_FOUND")
    h.call("review-bad-level", "REV-01",
           {"target_type": "REPORT", "target_id": rid_pending, "review_level": "LEVEL_9",
            "review_result": "APPROVED", "comment": "ok"}, session=s_l1, idem="idem-rev-bad-level",
           expect="PARAM_INVALID_ENUM")
    h.call("review-reject-no-comment", "REV-01",
           {"target_type": "REPORT", "target_id": rid_pending, "review_level": "LEVEL_1",
            "review_result": "REJECTED", "comment": "  "}, session=s_l1, idem="idem-rev-no-comment",
           expect="PARAM_INVALID_VALUE")
    h.call("review-bad-target-type", "REV-01",
           {"target_type": "CONTENT", "target_id": rid_pending, "review_level": "LEVEL_1",
            "review_result": "APPROVED", "comment": "ok"}, session=s_l1, idem="idem-rev-bad-type",
           expect="PARAM_INVALID_ENUM")
    h.call("review-missing-key", "REV-01",
           {"target_type": "REPORT", "target_id": rid_pending, "review_level": "LEVEL_1",
            "review_result": "APPROVED", "comment": "ok"}, session=s_l1, expect="PARAM_MISSING_FIELD")

    # ================= 工单 =================
    h.group("工单组")
    wo_main = h.wo_of(rid_main)["work_order_id"]
    wo_unapproved = h.wo_of(rid_unapproved)["work_order_id"]
    wo_pending = h.wo_of(rid_pending)["work_order_id"]
    wo_sec2 = h.wo_of(rid_sec2)["work_order_id"]

    h.dispatch(s_ops, wo_main, "ORG-YR-01", "main")
    h.check("转派后 DISPATCHED", h.wo_of(rid_main)["work_order_status"] == "DISPATCHED")
    h.dispatch(s_ops, wo_main, "ORG-YR-01", "main-again")
    h.check("重复转派幂等结果", h.wo_of(rid_main)["work_order_status"] == "DISPATCHED")
    h.dispatch(s_user, wo_pending, "ORG-YR-01", "r1-denied", expect="PERM_ROLE_REQUIRED")
    h.dispatch(s_ops, "WO-UNKNOWN", "ORG-YR-01", "unknown", expect="PARAM_TARGET_NOT_FOUND")
    h.dispatch(s_ops, wo_pending, "ORG-UNKNOWN", "unknown-org", expect="PARAM_TARGET_ORG_NOT_FOUND")
    h.call("wo01-missing-key", "WO-01", {"work_order_id": wo_pending, "target_org_id": "ORG-YR-01"},
           session=s_ops, expect="PARAM_MISSING_FIELD")

    evidence_a = h.make_media(s_org_a, "evidence-a", idem="idem-file-evidence-a")["data"]["media_ref"]
    evidence_a2 = h.make_media(s_org_a, "evidence-a2", idem="idem-file-evidence-a2")["data"]["media_ref"]
    evidence_ops = h.make_media(s_ops, "evidence-ops", idem="idem-file-evidence-ops")["data"]["media_ref"]

    h.close(s_ops, wo_pending, 5.0, [evidence_ops], "pending-close", expect="STATE_INVALID_TRANSITION")
    h.close(s_org_a, wo_pending, 5.0, [evidence_a], "pending-r2", expect="PERM_RESOURCE_FORBIDDEN")
    h.dispatch(s_ops, wo_sec2, "ORG-YR-02", "sec2")
    h.close(s_ops, wo_sec2, 0, [evidence_ops], "zero", expect="PARAM_INVALID_WEIGHT")
    h.close(s_ops, wo_sec2, -1, [evidence_ops], "negative", expect="PARAM_INVALID_WEIGHT")
    h.close(s_ops, wo_sec2, 1.2345, [evidence_ops], "too-many-decimals", expect="PARAM_INVALID_WEIGHT")
    h.close(s_org_a, wo_main, 12.5, [evidence_a], "main")
    h.check("办结后 CLOSED", h.wo_of(rid_main)["work_order_status"] == "CLOSED")
    replay = h.close(s_org_a, wo_main, 12.5, [evidence_a], "main")
    h.check("重复办结幂等且进度走满",
            replay["data"]["closed"] is True and replay["data"]["progress_stage"] == "COMPLETED")
    h.check("办结写清理记录",
            h.n("SELECT COUNT(*) FROM cleanup_records WHERE work_order_id=?", (wo_main,)) == 1)
    h.check("办结写证据关系",
            h.n("SELECT COUNT(*) FROM cleanup_media WHERE cleanup_record_id="
                "(SELECT cleanup_record_id FROM cleanup_records WHERE work_order_id=?)", (wo_main,)) == 1)
    h.close(s_org_a, wo_main, 12.5, [evidence_a], "main-new-key", expect="STATE_INVALID_TRANSITION")
    h.close(s_org_b, wo_main, 12.5, [evidence_a], "org-b", expect="PERM_RESOURCE_FORBIDDEN")
    h.close(s_org_b, "WO-UNKNOWN", 12.5, [evidence_a], "org-b-unknown", expect="PERM_RESOURCE_FORBIDDEN")
    h.close(s_ops, "WO-UNKNOWN", 12.5, [evidence_ops], "ops-unknown", expect="PARAM_TARGET_NOT_FOUND")
    h.close(s_ops, wo_sec2, 1.0, [media["data"]["media_ref"]], "foreign-evidence",
            expect="PARAM_INVALID_VALUE")
    h.close(s_ops, wo_sec2, 4.0, [evidence_ops], "sec2")
    h.check("R6 可跨组织办结", h.wo_of(rid_sec2)["work_order_status"] == "CLOSED")

    h.dispatch(s_ops, wo_unapproved, "ORG-YR-01", "unapproved")
    h.close(s_org_a, wo_unapproved, 3.0, [evidence_a2], "unapproved")
    h.check("未审核上报可办结但上报未 APPROVED",
            h.wo_of(rid_unapproved)["work_order_status"] == "CLOSED"
            and h.q("SELECT report_status FROM reports WHERE report_id=?",
                    (rid_unapproved,))["report_status"] != "APPROVED")

    h.call("wo02-missing-key", "WO-02",
           {"work_order_id": wo_main, "cleanup_weight_kg": 1.0, "evidence_refs": [evidence_a]},
           session=s_org_a, expect="PARAM_MISSING_FIELD")

    closed_without_weight = False
    try:
        with db.transaction(h.conn):
            h.conn.execute(
                "UPDATE work_orders SET work_order_status='CLOSED', closed_at=? WHERE work_order_id=?",
                (NOW, wo_pending),
            )
    except sqlite3.IntegrityError:
        closed_without_weight = True
    h.check("数据库拒绝无清理量的 CLOSED", closed_without_weight)
    h.check("数据库拒绝 R7+R5", _expect_integrity_error(
        h.conn,
        "INSERT INTO account_roles(account_pk, role_code, granted_by, granted_at) VALUES (?, 'R5', 'TEST', ?)",
        (h.account_pk("sys_admin"), NOW)))

    # ================= 进度 =================
    h.group("进度组")
    mine = h.call("rpt02-mine", "RPT-02", {"page_no": 1, "page_size": 20}, session=s_user, expect="OK")
    total_mine = mine["data"]["total"]
    h.check("RPT-02 只返回本人上报（8 条）", total_mine == 8, f"total={total_mine}")
    closed_items = [i for i in mine["data"]["items"] if i["closed"]]
    h.check("RPT-02 closed 项数 = 3", len(closed_items) == 3, f"count={len(closed_items)}")
    h.check("RPT-02 closed 仅来自 CLOSED 工单", all(
        h.wo_of(i["report_id"])["work_order_status"] == "CLOSED" for i in closed_items))
    h.check("RPT-02 闭环项 progress COMPLETED",
            all(i["progress_stage"] == "COMPLETED" for i in closed_items))
    h.check("RPT-02 closed 与工单状态严格对应", all(
        (h.wo_of(i["report_id"])["work_order_status"] == "CLOSED") == i["closed"]
        for i in mine["data"]["items"]
    ))
    h.check("RPT-02 不返回原始坐标",
            "raw_lat" not in json.dumps(mine["data"]) and "raw_lng" not in json.dumps(mine["data"]))
    h.check("RPT-02 条目字段严格", all(
        set(i.keys()) == {"report_id", "report_status", "work_order_status", "progress_stage",
                          "closed", "submitted_at"} for i in mine["data"]["items"]))
    paged = h.call("rpt02-page1", "RPT-02", {"page_no": 1, "page_size": 2}, session=s_user, expect="OK")
    h.check("RPT-02 分页 total/has_more",
            paged["data"]["total"] == total_mine and paged["data"]["has_more"] is True)
    last_page = h.call("rpt02-page-last", "RPT-02", {"page_no": 4, "page_size": 2}, session=s_user, expect="OK")
    h.check("RPT-02 末页 has_more=false", last_page["data"]["has_more"] is False)
    h.call("rpt02-bad-status", "RPT-02", {"page_no": 1, "page_size": 10, "report_status": "DONE"},
           session=s_user, expect="PARAM_INVALID_ENUM")
    h.call("rpt02-bad-page", "RPT-02", {"page_no": 0, "page_size": 10}, session=s_user,
           expect="PARAM_INVALID_PAGINATION")
    other_list = h.call("rpt02-other-user", "RPT-02", {"page_no": 1, "page_size": 10}, session=s_other,
                        expect="OK")
    h.check("RPT-02 他人无法看到本人上报", other_list["data"]["total"] == 0)
    h.call("rpt02-bad-session", "RPT-02", {"page_no": 1, "page_size": 10}, session="sh_" + "q" * 43,
           expect="AUTH_SESSION_INVALID")

    # ================= 地图与统计 =================
    h.group("地图统计组")
    h.call("map-still-no-audit", "MAP-01", {"period": "2026-11", "page_no": 1, "page_size": 20},
           expect="OK")
    seed.set_map_audit_no(h.conn, "SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO", NOW, confirmed=True,
                          trace_id=h._next_trace())
    mp = h.call("map-with-audit", "MAP-01", {"period": "2026-11", "page_no": 1, "page_size": 20},
                expect="OK")
    sec1 = next((s for s in mp["data"]["sections"] if s["section_id"] == "SEC-001"), None)
    sec2 = next((s for s in mp["data"]["sections"] if s["section_id"] == "SEC-002"), None)
    h.check("MAP-01 下发审图号", mp["data"]["map_audit_no"] == "SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO")
    h.check("MAP-01 岸段对象字段严格", all(
        set(s.keys()) == {"section_id", "name", "coarse_lat", "coarse_lng", "heat_value",
                          "cleanup_kg_total", "responsible_org"} for s in mp["data"]["sections"]))
    h.check("MAP-01 粗化坐标 SEC-001",
            sec1 is not None and sec1["coarse_lat"] == 36.06 and sec1["coarse_lng"] == 103.83,
            json.dumps(sec1, ensure_ascii=False))
    h.check("MAP-01 热力只计 APPROVED（SEC-001=4）", sec1 is not None and sec1["heat_value"] == 4,
            f"heat={sec1['heat_value'] if sec1 else None}")
    h.check("MAP-01 清理量（SEC-001=15.5）",
            sec1 is not None and sec1["cleanup_kg_total"] == 15.5,
            f"kg={sec1['cleanup_kg_total'] if sec1 else None}")
    h.check("MAP-01 清理量（SEC-002=4.0）", sec2 is not None and sec2["cleanup_kg_total"] == 4.0)
    h.check("MAP-01 未审核上报不计热力", sec2 is not None and sec2["heat_value"] == 0)
    h.check("MAP-01 不返回原始坐标",
            "raw_lat" not in json.dumps(mp["data"]) and "raw_lng" not in json.dumps(mp["data"]))
    mp_page = h.call("map-page1", "MAP-01", {"period": "2026-11", "page_no": 1, "page_size": 2},
                     expect="OK")
    h.check("MAP-01 分页", mp_page["data"]["total"] == 3 and len(mp_page["data"]["sections"]) == 2
            and mp_page["data"]["has_more"] is True)
    mp_filter = h.call("map-filter-sec2", "MAP-01",
                       {"period": "2026-11", "section_id": "SEC-002", "page_no": 1, "page_size": 10},
                       expect="OK")
    h.check("MAP-01 section_id 过滤", len(mp_filter["data"]["sections"]) == 1
            and mp_filter["data"]["sections"][0]["section_id"] == "SEC-002")

    st = h.call("stat-with-data", "STAT-01", {"period": "2026-11", "metric_keys": []}, expect="OK")
    metrics = {m["metric_key"]: m for m in st["data"]["metrics"]}
    h.check("STAT-01 清理量汇总 19.5kg", metrics["cleanup_kg_total"]["value"] == 19.5,
            str(metrics["cleanup_kg_total"]))
    h.check("STAT-01 清理量单位 kg", metrics["cleanup_kg_total"]["unit"] == "kg")
    h.check("STAT-01 通过上报数 4", metrics["approved_report_count"]["value"] == 4,
            str(metrics["approved_report_count"]))
    h.check("STAT-01 办结工单数 3", metrics["closed_work_order_count"]["value"] == 3,
            str(metrics["closed_work_order_count"]))
    h.check("STAT-01 指标字段严格", all(
        set(m.keys()) == {"metric_key", "value", "unit", "sample_size", "published"}
        for m in st["data"]["metrics"]))
    h.check("STAT-01 有样本则 published",
            all(m["published"] for m in st["data"]["metrics"] if m["sample_size"] > 0))
    st_sec2 = h.call("stat-sec2", "STAT-01",
                     {"period": "2026-11", "section_id": "SEC-002",
                      "metric_keys": ["cleanup_kg_total"]}, expect="OK")
    h.check("STAT-01 section_id 过滤", st_sec2["data"]["metrics"][0]["value"] == 4.0)
    h.check("STAT-01 榜单默认关闭", st["data"]["leaderboard_enabled"] is False)
    db.set_config(h.conn, "leaderboard_enabled", True, "SELFCHECK", NOW)
    st_flag = h.call("stat-leaderboard-flag-only", "STAT-01",
                     {"period": "2026-11", "metric_keys": []}, expect="OK")
    h.check("榜单仅开关不足以开启（需样本量核实）", st_flag["data"]["leaderboard_enabled"] is False)
    seed.enable_leaderboard(h.conn, enabled=True, verified_sample_size=1, now=NOW, confirmed=True,
                            trace_id=h._next_trace())
    st_on = h.call("stat-leaderboard-verified", "STAT-01",
                   {"period": "2026-11", "metric_keys": []}, expect="OK")
    h.check("人工核实样本量后可开启榜单", st_on["data"]["leaderboard_enabled"] is True)
    seed.enable_leaderboard(h.conn, enabled=False, verified_sample_size=0, now=NOW, confirmed=True,
                            trace_id=h._next_trace())
    st_off = h.call("stat-leaderboard-off", "STAT-01", {"period": "2026-11", "metric_keys": []},
                    expect="OK")
    h.check("榜单可关闭", st_off["data"]["leaderboard_enabled"] is False)

    # ================= 字典 =================
    h.group("字典组")
    adm = h.call("adm-ops", "ADM-01", {"config_scope": "ALL"}, session=s_ops, expect="OK")
    h.check("ADM-01 四类垃圾", len(adm["data"]["waste_categories"]) == 4)
    h.check("ADM-01 岸段无坐标", all(
        set(s.keys()) == {"section_id", "name", "responsible_org"} for s in adm["data"]["sections"]))
    enum_names = {e["enum_name"] for e in adm["data"]["status_enums"]}
    h.check("ADM-01 枚举字典含状态/规模/角色/指标",
            {"report_status", "work_order_status", "scale_level", "role_code", "metric_key"} <= enum_names,
            str(enum_names))
    scale_enum = next(e for e in adm["data"]["status_enums"] if e["enum_name"] == "scale_level")
    h.check("ADM-01 规模字典 3 值", len(scale_enum["values"]) == 3)
    h.check("ADM-01 审图号透出", adm["data"]["map_audit_no"] == "SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO")
    h.check("ADM-01 榜单默认关闭", adm["data"]["leaderboard_enabled"] is False)
    h.call("adm-sys", "ADM-01", {"config_scope": "ALL"}, session=s_sys, expect="OK")
    h.call("adm-r1", "ADM-01", {"config_scope": "ALL"}, session=s_user, expect="PERM_ROLE_REQUIRED")
    h.call("adm-bad-scope", "ADM-01", {"config_scope": "MAP"}, session=s_ops, expect="PARAM_INVALID_SCOPE")
    h.call("adm-missing-scope", "ADM-01", {}, session=s_ops, expect="PARAM_MISSING_FIELD")

    # ================= 评价 =================
    h.group("评价组")
    fb = h.feedback(s_user, wo_main, 5, "治理及时，岸线明显改善", "main")
    h.check("评价返回 feedback_id", fb["data"]["feedback_id"].startswith("FB-"))
    fb2 = h.feedback(s_user, wo_main, 5, "治理及时，岸线明显改善", "main")
    h.check("评价幂等回放同一 feedback_id", fb2["data"]["feedback_id"] == fb["data"]["feedback_id"])
    h.check("评价唯一记录", h.n("SELECT COUNT(*) FROM feedbacks WHERE work_order_id=?", (wo_main,)) == 1)
    h.feedback(s_user, wo_main, 4, "再次评价", "main-dup", expect="STATE_FEEDBACK_DUPLICATE")
    h.feedback(s_auditor, wo_main, 4, "非本人", "other", expect="PERM_RESOURCE_FORBIDDEN")
    h.feedback(s_user, wo_pending, 5, "未办结", "pending", expect="STATE_CLOSED_REQUIRED")
    h.feedback(s_user, wo_main, 6, "评分越界", "bad-rating", expect="PARAM_INVALID_RATING")
    h.call("fb-missing-content", "FB-01", {"work_order_id": wo_main, "rating": 5}, session=s_user,
           expect="PARAM_MISSING_FIELD")
    h.call("fb-missing-key", "FB-01", {"work_order_id": wo_main, "rating": 5, "content": "无键"},
           session=s_user, expect="PARAM_MISSING_FIELD")
    h.feedback(s_user, "WO-UNKNOWN", 5, "不存在", "unknown", expect="PERM_RESOURCE_FORBIDDEN")

    # ================= 审计 =================
    h.group("审计组")
    for event in ("AUTH_REGISTER", "AUTH_LOGIN_SUCCESS", "AUTH_LOGOUT", "MEDIA_TICKET_ISSUED",
                  "REPORT_CREATED", "REVIEW_RECORDED", "WORK_ORDER_DISPATCHED", "WORK_ORDER_CLOSED",
                  "FEEDBACK_SUBMITTED", "ADMIN_CONFIG_READ", "API_REJECTED", "IDEMPOTENT_REPLAY",
                  "ROLE_REVOKED", "COMPLIANCE_CONFIG_CHANGED", "SEED_APPLIED"):
        h.check(f"审计事件存在：{event}", len(h.audits(event)) > 0)
    h.check("越权拒绝写审计", any(
        a["event_type"] == "API_REJECTED" and "PERM_ROLE_REQUIRED" in a["detail_json"]
        for a in h.audits()))
    trace_ok = h.q("SELECT trace_id FROM audit_logs WHERE event_type='REPORT_CREATED' "
                   "ORDER BY id DESC LIMIT 1")
    h.check("关键事件带 trace_id", trace_ok is not None and len(trace_ok["trace_id"]) == 32)
    review_rows = h.n("SELECT COUNT(*) FROM review_records")
    update_blocked = False
    try:
        with db.transaction(h.conn):
            h.conn.execute("UPDATE review_records SET comment='tamper' WHERE id=1")
    except sqlite3.IntegrityError:
        update_blocked = True
    h.check("审核记录不可更新", update_blocked)
    h.check("审核记录数未被篡改影响", h.n("SELECT COUNT(*) FROM review_records") == review_rows)

    # ================= 越权不暴露存在性 =================
    h.group("越权不暴露存在性")
    r_absent = h.call("wo02-r2-absent", "WO-02",
                      {"work_order_id": "WO-NOT-EXIST", "cleanup_weight_kg": 1,
                       "evidence_refs": [evidence_a]}, session=s_org_b,
                      idem="idem-wo02-r2-absent", expect="PERM_RESOURCE_FORBIDDEN")
    r_other = h.call("wo02-r2-other-org", "WO-02",
                     {"work_order_id": wo_main, "cleanup_weight_kg": 1,
                      "evidence_refs": [evidence_a]}, session=s_org_b,
                     idem="idem-wo02-r2-other", expect="PERM_RESOURCE_FORBIDDEN")
    h.check("R2 对不存在与他组织返回同码同文案",
            r_absent["code"] == r_other["code"] and r_absent["message"] == r_other["message"])
    fb_absent = h.call("fb-absent", "FB-01",
                       {"work_order_id": "WO-NOT-EXIST", "rating": 5, "content": "x"},
                       session=s_user, idem="idem-fb-absent", expect="PERM_RESOURCE_FORBIDDEN")
    fb_other = h.call("fb-other", "FB-01",
                      {"work_order_id": wo_main, "rating": 5, "content": "x"},
                      session=s_auditor, idem="idem-fb-other", expect="PERM_RESOURCE_FORBIDDEN")
    h.check("评价对不存在与非本人同码同文案",
            fb_absent["code"] == fb_other["code"] and fb_absent["message"] == fb_other["message"])

    # ================= 异常：INTERNAL =================
    h.group("异常组")
    def boom(api, payload):
        if api == "MAP-01":
            raise RuntimeError("injected-fault")
    h.app.fault_hook = boom
    internal = h.call("internal-injected", "MAP-01",
                      {"period": "2026-11", "page_no": 1, "page_size": 10}, expect="INTERNAL_ERROR")
    h.app.fault_hook = None
    h.check("INTERNAL 不泄露注入信息",
            "injected" not in internal["message"] and "RuntimeError" not in internal["message"])
    h.check("INTERNAL_ERROR 审计存在", len(h.audits("INTERNAL_ERROR")) > 0)

    # ================= 审图号闸门收尾 =================
    h.group("合规闸门")
    seed.set_map_audit_no(h.conn, None, NOW, confirmed=True, trace_id=h._next_trace())
    mp_none = h.call("map-audit-cleared", "MAP-01",
                     {"period": "2026-11", "page_no": 1, "page_size": 20}, expect="OK")
    h.check("清除审图号后立即不下发点位",
            mp_none["data"]["sections"] == [] and mp_none["data"]["map_audit_no"] is None)
    seed.set_map_audit_no(h.conn, "SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO", NOW, confirmed=True,
                          trace_id=h._next_trace())

    # ================= 会话过期（最后执行，时钟前移后恢复） =================
    h.group("会话过期")
    h.register("temp_expire_01", "register-expire")
    s_exp = h.login("temp_expire_01", "login-expire")
    h.clock.advance(13 * 3600)
    h.call("auth04-expired", "AUTH-04", {}, session=s_exp, expect="AUTH_SESSION_EXPIRED")
    h.call("logout-expired-still-revoked", "AUTH-03", {"scope": "CURRENT"}, session=s_exp, expect="OK")
    h.clock.set(NOW)

    # ================= 子结构形状 =================
    h.group("契约字段")
    h.check("account_profile 字段",
            set(profile_r1["data"]["account_profile"].keys()) == {"account_id", "account_status", "roles"})
    h.check("permission_summary 字段",
            set(profile_r1["data"]["permission_summary"].keys()) == {"roles", "permissions"})
    h.check("waste_category 字段", all(
        set(c.keys()) == {"code", "label", "description"} for c in adm["data"]["waste_categories"]))
    h.check("status_enum 结构", all(
        set(e.keys()) == {"enum_name", "values"}
        and all(set(v.keys()) == {"value", "label"} for v in e["values"])
        for e in adm["data"]["status_enums"]))

    return h.finish()


if __name__ == "__main__":
    sys.exit(main())
