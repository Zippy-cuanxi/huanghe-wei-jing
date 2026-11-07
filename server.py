# -*- coding: utf-8 -*-
"""HTTP 适配层：把 14 个契约接口绑定到明确的 URL，并托管 Vue 单页。

- 业务规则、鉴权、状态机、审计全部复用 backend/，本文件只做传输适配。
- 统一响应仍严格为 code/message/data/trace_id 四字段。
- 传输约定见 docs/接口对接说明.md。
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app import BackendApp  # noqa: E402
from backend.errors import domain_of  # noqa: E402
from demo_data import build_demo_payload, ensure_demo_data  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

APP_LOCK = threading.Lock()

# API 编号 ↔ HTTP 方法/路径。请求体是契约 payload，不包含 api/session_handle/idempotency_key。
ROUTES = {
    ("POST", "/api/auth/register"): "AUTH-01",
    ("POST", "/api/auth/login"): "AUTH-02",
    ("POST", "/api/auth/logout"): "AUTH-03",
    ("GET", "/api/auth/session"): "AUTH-04",
    ("POST", "/api/media/tickets"): "FILE-01",
    ("POST", "/api/reports"): "RPT-01",
    ("GET", "/api/reports/mine"): "RPT-02",
    ("GET", "/api/map/sections"): "MAP-01",
    ("POST", "/api/work-orders/dispatch"): "WO-01",
    ("POST", "/api/work-orders/close"): "WO-02",
    ("POST", "/api/reviews"): "REV-01",
    ("GET", "/api/statistics"): "STAT-01",
    ("POST", "/api/feedback"): "FB-01",
    ("GET", "/api/admin/config"): "ADM-01",
}

GET_ALLOWED = {
    "AUTH-04": set(),
    "RPT-02": {"page_no", "page_size", "report_status"},
    "MAP-01": {"section_id", "period", "page_no", "page_size"},
    "STAT-01": {"period", "section_id", "metric_keys"},
    "ADM-01": {"config_scope"},
}

INT_QUERY = {"page_no", "page_size"}
MIME_OVERRIDES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".geojson": "application/geo+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}

MAX_BODY_BYTES = 2 * 1024 * 1024


def envelope(code: str, message: str, data, trace_id: str) -> dict:
    return {"code": code, "message": message, "data": data, "trace_id": trace_id}


def http_status(code: str) -> int:
    if code == "OK":
        return 200
    if code == "PARAM_UNKNOWN_API":
        return 404
    if code == "AUTH_LOCKED":
        return 423
    if code == "AUTH_ACCOUNT_EXISTS":
        return 409
    if code == "AUTH_CREDENTIAL_TOO_WEAK":
        return 400
    return {
        "PARAM": 400,
        "AUTH": 401,
        "PERM": 403,
        "STATE": 409,
        "RATE": 429,
        "DEP": 503,
        "INTERNAL": 500,
    }.get(domain_of(code), 500)


def _query_payload(api: str, query: str) -> dict:
    params = parse_qs(query, keep_blank_values=True)
    allowed = GET_ALLOWED[api]
    payload: dict = {}
    for key in params:
        if key not in allowed:
            # 交给后端严格白名单拒绝，保持契约外字段的错误码。
            payload[key] = params[key][-1]
    if api == "AUTH-04":
        # 该接口 payload 为空；把未知 query 交给后端严格白名单拒绝。
        return {key: params[key][-1] for key in params if key not in allowed}
    if api == "ADM-01":
        payload["config_scope"] = params.get("config_scope", ["ALL"])[-1]
        return payload
    if api == "STAT-01":
        if "period" in params:
            payload["period"] = params["period"][-1]
        if "section_id" in params and params["section_id"][-1] != "":
            payload["section_id"] = params["section_id"][-1]
        payload["metric_keys"] = params.get("metric_keys", [])
        return payload
    if api in ("MAP-01", "RPT-02"):
        if "page_no" in params:
            payload["page_no"] = _maybe_int(params["page_no"][-1])
        if "page_size" in params:
            payload["page_size"] = _maybe_int(params["page_size"][-1])
        if api == "MAP-01":
            if "period" in params:
                payload["period"] = params["period"][-1]
            if "section_id" in params and params["section_id"][-1] != "":
                payload["section_id"] = params["section_id"][-1]
        else:
            if "report_status" in params and params["report_status"][-1] != "":
                payload["report_status"] = params["report_status"][-1]
        return payload
    return payload


def _maybe_int(value: str):
    """合法十进制整数转换为 int；非法值保留字符串，由后端返回类型错误。"""
    try:
        if value.strip() == "" or any(ch not in "0123456789" for ch in value):
            return value
        return int(value)
    except Exception:
        return value


class Handler(BaseHTTPRequestHandler):
    server_version = "HuangheMapHTTP/1.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------------
    def do_GET(self) -> None:
        self._handle("GET")

    def do_HEAD(self) -> None:
        self._handle("HEAD")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_OPTIONS(self) -> None:
        self._send_text(204, "", extra={"Allow": "GET, HEAD, POST, OPTIONS"})

    # ------------------------------------------------------------------
    def _handle(self, method: str) -> None:
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            if method == "HEAD":
                self._send_api_error("PARAM_UNKNOWN_API", "该接口不支持 HEAD 请求", 405, "HEAD")
                return
            api = ROUTES.get((method, path))
            if api is None:
                # 已知路径但方法不对，返回 405；完全未知路径返回 404。
                known_paths = {route[1] for route in ROUTES}
                if path in known_paths:
                    self._send_api_error("PARAM_UNKNOWN_API", "该接口不支持此请求方法", 405, method)
                else:
                    self._send_api_error("PARAM_UNKNOWN_API", "未知接口路径", 404, method)
                return
            self._handle_api(api, method, parsed.query)
            return

        if method not in ("GET", "HEAD"):
            self._send_api_error("PARAM_UNKNOWN_API", "静态资源不支持该请求方法", 405, method)
            return
        if path == "/demo/demo_ids.json":
            # 动态演示辅助：只读导出当前数据库中的 ID，不是契约接口。
            with APP_LOCK:
                payload = build_demo_payload(self.server.app.conn)
            self._send_json(200, payload)
            return
        self._serve_static(path, head_only=(method == "HEAD"))

    def _handle_api(self, api: str, method: str, query: str) -> None:
        trace = None
        try:
            if method == "POST":
                body = self._read_json_body()
                if not isinstance(body, dict):
                    self._send_api_error("PARAM_INVALID_TYPE", "请求体必须是 JSON 对象", 400, method)
                    return
                payload = body
            else:
                payload = _query_payload(api, query)

            session_handle = self.headers.get("X-Session-Handle")
            idempotency_key = self.headers.get("Idempotency-Key")
            request = {
                "api": api,
                "payload": payload,
                "session_handle": session_handle,
                "idempotency_key": idempotency_key,
            }
            with APP_LOCK:
                result = self.server.app.handle(request)
            self._send_json(http_status(result["code"]), result)
        except BodyTooLarge:
            self._send_api_error("PARAM_INVALID_VALUE", "请求体超过大小上限", 413, method)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_api_error("PARAM_INVALID_TYPE", "请求体不是合法 JSON", 400, method)
        except Exception:
            # handle() 已兜底业务异常；此处只处理传输层异常，不泄露堆栈。
            trace = self.server.app.ids.trace_id()
            self._send_json(500, envelope("INTERNAL_ERROR", "系统繁忙，请稍后重试", None, trace))

    # ------------------------------------------------------------------
    def _read_json_body(self) -> dict:
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            return {}
        try:
            length = int(raw_len)
        except ValueError:
            raise json.JSONDecodeError("bad content-length", "", 0)
        if length < 0:
            raise json.JSONDecodeError("bad content-length", "", 0)
        if length > MAX_BODY_BYTES:
            raise BodyTooLarge()
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _send_api_error(self, code: str, message: str, status: int, method: str) -> None:
        if status == 405:
            # 让客户端知道正确方法，但仍使用统一信封。
            self._send_json(
                status,
                envelope(code, message, None, self.server.app.ids.trace_id()),
                extra={"Allow": "GET, HEAD, POST, OPTIONS"},
            )
        else:
            self._send_json(status, envelope(code, message, None, self.server.app.ids.trace_id()))

    def _send_json(self, status: int, payload: dict, extra: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": str(len(body)),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
        }
        if extra:
            headers.update(extra)
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # ------------------------------------------------------------------
    def _serve_static(self, path: str, *, head_only: bool) -> None:
        if path in ("/", ""):
            rel = "index.html"
        elif path == "/favicon.ico":
            self._send_text(204, "")
            return
        elif path == "/index.html":
            rel = "index.html"
        elif path.startswith("/assets/") or path.startswith("/demo/"):
            rel = path.lstrip("/")
        else:
            self._send_text(404, "Not Found")
            return

        target = (ROOT / rel).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            self._send_text(403, "Forbidden")
            return
        if not target.is_file():
            self._send_text(404, "Not Found")
            return
        data = target.read_bytes()
        content_type = MIME_OVERRIDES.get(target.suffix.lower())
        if content_type is None:
            content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if not head_only:
            self.wfile.write(data)

    def _send_text(self, status: int, text: str, extra: dict | None = None) -> None:
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if extra:
            for key, value in extra.items():
                self.send_header(key, value)
        self.end_headers()
        if text and self.command != "HEAD":
            self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[http] %s - %s\n" % (self.address_string(), fmt % args))


class BodyTooLarge(Exception):
    pass


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    parser = argparse.ArgumentParser(description="黄河垃圾热力地图 - HTTP + Vue 单页")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", default=str(ROOT / "var" / "app.db"))
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    app = BackendApp(str(db_path))
    ensure_demo_data(app)

    server = AppServer((args.host, args.port), Handler)
    server.app = app
    shown_host = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    url = f"http://{shown_host}:{args.port}/"
    print("=" * 68)
    print("黄河垃圾热力地图 · 可运行交付")
    print(f"页面: {url}")
    print("演示账号（口令均为 Demo#Pass2026）：")
    print("  ops_admin  R1/R6  推荐：上报/个人中心/工单/看板/字典")
    print("  user_r1    R1     上报/个人中心（无 ADM-01 字典权限）")
    print("  rev_l1 / rev_l2 / rev_l3  R3/R4/R5 审核")
    print("  org_a_op / org_b_op       R2 责任单位办结")
    print("  sys_admin  R7     字典/看板（不兼终审）")
    print("按 Ctrl+C 停止；数据库与演示 ID 位于 var/ 与 demo/。")
    print("=" * 68)

    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()
        app.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
