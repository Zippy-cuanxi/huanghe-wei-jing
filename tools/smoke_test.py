# -*- coding: utf-8 -*-
"""HTTP 对接烟雾测试（需先启动 server.py）。

只读 + 登录/登出，不改业务数据；用于确认 14 接口的 HTTP 绑定、统一信封、
认证头、错误码与 trace_id 在真实服务上可用。
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = "http://127.0.0.1:8000"
PASSWORD = "Demo#Pass2026"
TRACE_RE = re.compile(r"^[0-9a-f]{32}$")
checks = []


def check(name, condition, detail=""):
    checks.append((name, bool(condition), detail))
    print(("PASS " if condition else "FAIL ") + name + ((" :: " + detail) if detail and not condition else ""))


def call(path, method="GET", body=None, session=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if session:
        req.add_header("X-Session-Handle", session)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def envelope_ok(env, ok):
    if not isinstance(env, dict):
        return False
    if sorted(env.keys()) != ["code", "data", "message", "trace_id"]:
        return False
    if not isinstance(env["message"], str) or not TRACE_RE.match(str(env["trace_id"])):
        return False
    if ok:
        return env["code"] == "OK" and isinstance(env["data"], dict)
    return env["code"] != "OK" and env["data"] is None


def main():
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    status, env = call(f"/api/map/sections?period={period}&page_no=1&page_size=20")
    check("MAP-01 200 + 信封 + 无原始坐标", status == 200 and envelope_ok(env, True)
          and all("raw_lat" not in s and "raw_lng" not in s for s in env["data"]["sections"]))

    status, env = call(f"/api/statistics?period={period}")
    check("STAT-01 200 + 信封 + 指标数组", status == 200 and envelope_ok(env, True)
          and isinstance(env["data"].get("metrics"), list))

    status, env = call(f"/api/map/sections?period=bad&page_no=1&page_size=20")
    check("PARAM_INVALID_PERIOD 400", status == 400 and envelope_ok(env, False)
          and env["code"] == "PARAM_INVALID_PERIOD")

    status, env = call("/api/does-not-exist")
    check("未知路径 404 + PARAM_UNKNOWN_API", status == 404 and envelope_ok(env, False)
          and env["code"] == "PARAM_UNKNOWN_API")

    status, env = call("/api/admin/config?config_scope=ALL")
    check("未登录 ADM-01 401", status == 401 and envelope_ok(env, False)
          and env["code"] in ("AUTH_SESSION_REQUIRED", "AUTH_SESSION_INVALID"))

    status, env = call("/api/auth/login", "POST",
                       {"account_id": "ops_admin", "credential": PASSWORD, "device_tag": "smoke-test"})
    check("AUTH-02 登录 200", status == 200 and envelope_ok(env, True) and env["data"].get("session_handle"))
    session = env["data"]["session_handle"] if env.get("data") else None

    status, env = call("/api/auth/session", session=session)
    check("AUTH-04 会话 ACTIVE", status == 200 and envelope_ok(env, True)
          and env["data"].get("session_status") == "ACTIVE")

    status, env = call("/api/admin/config?config_scope=ALL", session=session)
    check("ADM-01 200 + 字典", status == 200 and envelope_ok(env, True)
          and isinstance(env["data"].get("status_enums"), list))

    status, env = call("/api/reports/mine?page_no=1&page_size=10", session=session)
    check("RPT-02 200 + items/total", status == 200 and envelope_ok(env, True)
          and isinstance(env["data"].get("items"), list) and isinstance(env["data"].get("total"), int))

    status, env = call("/api/auth/logout", "POST", {"scope": "CURRENT"}, session=session)
    check("AUTH-03 登出 200", status == 200 and envelope_ok(env, True) and env["data"].get("revoked") is True)

    status, env = call("/api/auth/session", session=session)
    check("旧句柄被拒绝", status == 401 and envelope_ok(env, False)
          and env["code"] in ("AUTH_SESSION_REVOKED", "AUTH_SESSION_INVALID", "AUTH_SESSION_EXPIRED"))

    passed = sum(1 for _, ok, _ in checks if ok)
    print("-" * 56)
    print(f"{passed}/{len(checks)} passed")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
