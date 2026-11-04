/*
 * GitHub Pages 静态演示适配层（仅用于静态托管镜像，不属于原项目交付）
 *
 * 原项目是 Vue 3 单页 + 同源 Python 后端，浏览器会向 /api/* 发起 fetch。
 * GitHub Pages 只能托管静态文件、无法运行 Python，因此这里在浏览器内
 * 覆盖 window.fetch，把 14 个契约接口映射到项目自带的权威响应样例
 * （samples 目录下的各接口 success 样例），使页面在纯静态环境下仍可完整浏览与交互。
 *
 * 注意：这是「演示镜像」，所有数据均为样例，没有真实数据库、鉴权与审计；
 * 写入类接口只在 localStorage 里做轻量状态记录，刷新后可保留。
 */
(function () {
  "use strict";

  var FIX = window.__HH_FIXTURES__ || {};
  var DEMO_IDS = window.__HH_DEMO_IDS__ || { accounts: [] };
  var nativeFetch = window.fetch.bind(window);
  var STORE_KEY = "hh.pages-demo.state.v1";
  var DEMO_PASSWORD = "Demo#Pass2026";

  /* ---------------- 基础角色 → 权限（与 README 演示账号表一致） ---------------- */
  var BASE_PERMISSIONS = [
    "AUTH-01", "AUTH-02", "AUTH-03", "AUTH-04",
    "FILE-01", "RPT-01", "RPT-02", "MAP-01", "STAT-01", "FB-01"
  ];

  function permissionsFor(roles) {
    var set = new Set(BASE_PERMISSIONS);
    if (roles.indexOf("R2") >= 0) set.add("WO-02");
    if (roles.some(function (r) { return r === "R3" || r === "R4" || r === "R5"; })) set.add("REV-01");
    if (roles.indexOf("R6") >= 0) {
      ["ADM-01", "REV-01", "WO-01", "WO-02"].forEach(function (p) { set.add(p); });
    }
    if (roles.indexOf("R7") >= 0) set.add("ADM-01");
    return Array.from(set);
  }

  /* ---------------- 轻量本地状态 ---------------- */
  function readState() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return {
        sessions: parsed.sessions || {},
        reports: Array.isArray(parsed.reports) ? parsed.reports : []
      };
    } catch (e) {
      return { sessions: {}, reports: [] };
    }
  }

  function writeState(state) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  var state = readState();

  function randomHex(bytes) {
    var out = "";
    if (window.crypto && window.crypto.getRandomValues) {
      var arr = new Uint8Array(bytes);
      window.crypto.getRandomValues(arr);
      for (var i = 0; i < arr.length; i += 1) out += arr[i].toString(16).padStart(2, "0");
    } else {
      for (var j = 0; j < bytes * 2; j += 1) out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function envelope(code, message, data) {
    return { code: code, message: message, data: data === undefined ? null : data, trace_id: randomHex(16) };
  }

  function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status || 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-HH-Pages-Demo": "1"
      }
    });
  }

  function ok(apiId, data) {
    var base = FIX[apiId] || { message: "操作成功", data: null };
    return jsonResponse(envelope("OK", base.message || "操作成功", data === undefined ? clone(base.data) : data), 200);
  }

  function fail(code, message, status) {
    return jsonResponse(envelope(code, message, null), status || 400);
  }

  /* ---------------- 契约路由表（与 assets/lib.js 完全一致） ---------------- */
  var ROUTES = [
    { method: "POST", path: "/api/auth/register", id: "AUTH-01", auth: false },
    { method: "POST", path: "/api/auth/login", id: "AUTH-02", auth: false },
    { method: "POST", path: "/api/auth/logout", id: "AUTH-03", auth: true },
    { method: "GET", path: "/api/auth/session", id: "AUTH-04", auth: true },
    { method: "POST", path: "/api/media/tickets", id: "FILE-01", auth: true },
    { method: "POST", path: "/api/reports", id: "RPT-01", auth: true },
    { method: "GET", path: "/api/reports/mine", id: "RPT-02", auth: true },
    { method: "GET", path: "/api/map/sections", id: "MAP-01", auth: false },
    { method: "POST", path: "/api/work-orders/dispatch", id: "WO-01", auth: true },
    { method: "POST", path: "/api/work-orders/close", id: "WO-02", auth: true },
    { method: "POST", path: "/api/reviews", id: "REV-01", auth: true },
    { method: "GET", path: "/api/statistics", id: "STAT-01", auth: false },
    { method: "POST", path: "/api/feedback", id: "FB-01", auth: true },
    { method: "GET", path: "/api/admin/config", id: "ADM-01", auth: true }
  ];

  function normalizePath(pathname) {
    var idx = pathname.indexOf("/api/");
    if (idx >= 0) return pathname.slice(idx);
    var demoIdx = pathname.indexOf("/demo/");
    if (demoIdx >= 0) return pathname.slice(demoIdx);
    return pathname;
  }

  function headerValue(init, name) {
    var headers = (init && init.headers) || {};
    if (typeof headers.get === "function") return headers.get(name);
    var target = name.toLowerCase();
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].toLowerCase() === target) return headers[keys[i]];
    }
    return null;
  }

  function parseBody(init) {
    try {
      var body = init && init.body;
      return body ? JSON.parse(body) : {};
    } catch (e) {
      return {};
    }
  }

  function currentSession(init) {
    var handle = headerValue(init, "X-Session-Handle");
    if (!handle) return null;
    var record = state.sessions[handle];
    return record ? Object.assign({ handle: handle }, record) : null;
  }

  function profileFor(record) {
    return {
      account_id: record.accountId,
      account_status: "ACTIVE",
      roles: clone(record.roles)
    };
  }

  function summaryFor(record) {
    return { roles: clone(record.roles), permissions: clone(record.permissions) };
  }

  /* ---------------- 接口分发 ---------------- */
  function handleApi(apiPath, method, init, url) {
    var route = null;
    for (var i = 0; i < ROUTES.length; i += 1) {
      if (ROUTES[i].path === apiPath && ROUTES[i].method === method) { route = ROUTES[i]; break; }
    }
    if (!route) return fail("INTERNAL_ERROR", "静态演示镜像不支持该请求：" + method + " " + apiPath, 404);

    var payload = parseBody(init);
    var current = currentSession(init);

    if (route.auth && !current) {
      return fail("AUTH_SESSION_REQUIRED", "请先登录（静态演示镜像）", 401);
    }
    if (route.id === "ADM-01" && current && current.permissions.indexOf("ADM-01") < 0) {
      return fail("PERM_ROLE_REQUIRED", "当前角色无权读取业务字典；请用 ops_admin 或 sys_admin 登录", 403);
    }

    switch (route.id) {
      case "AUTH-01": {
        var accountId = payload.account_id || "demo_guest";
        return ok("AUTH-01", {
          account_id: accountId,
          account_status: "ACTIVE",
          default_role: "R1"
        });
      }

      case "AUTH-02": {
        var account = DEMO_IDS.accounts.find(function (a) { return a.account_id === payload.account_id; });
        if (!account || payload.credential !== DEMO_PASSWORD) {
          return fail("AUTH_INVALID", "账号或凭证不正确；演示口令：" + DEMO_PASSWORD, 401);
        }
        var handle = "sh_pages_" + randomHex(24);
        var expiresAt = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
        state.sessions[handle] = {
          accountId: account.account_id,
          roles: clone(account.roles),
          permissions: permissionsFor(account.roles),
          expiresAt: expiresAt
        };
        writeState(state);
        return ok("AUTH-02", {
          session_handle: handle,
          expires_at: expiresAt,
          account_profile: profileFor(state.sessions[handle]),
          permission_summary: summaryFor(state.sessions[handle])
        });
      }

      case "AUTH-03": {
        if (current) {
          delete state.sessions[current.handle];
          writeState(state);
        }
        return ok("AUTH-03");
      }

      case "AUTH-04": {
        return ok("AUTH-04", {
          session_status: "ACTIVE",
          account_profile: profileFor(current),
          permission_summary: summaryFor(current),
          expires_at: current.expiresAt
        });
      }

      case "MAP-01": {
        // 审图号保留为 SAMPLE-ONLY 占位：前端会显示「当前审图号为演示占位」警示。
        // 静态镜像不按周期/分页做真实过滤，仅回放权威样例夹具。
        return ok("MAP-01");
      }

      case "STAT-01":
        return ok("STAT-01");

      case "ADM-01":
        return ok("ADM-01");

      case "RPT-02": {
        var base = clone((FIX["RPT-02"] || {}).data) || { items: [] };
        var items = Array.isArray(base.items) ? state.reports.concat(base.items) : state.reports;
        var pageNo = Number(url.searchParams.get("page_no") || 1);
        var pageSize = Number(url.searchParams.get("page_size") || 20);
        base.items = items.slice((pageNo - 1) * pageSize, pageNo * pageSize);
        if (Object.prototype.hasOwnProperty.call(base, "total")) base.total = items.length;
        return ok("RPT-02", base);
      }

      case "RPT-01": {
        var reportId = "RPT-PAGES-" + randomHex(4).toUpperCase();
        state.reports.unshift({
          report_id: reportId,
          report_status: "SUBMITTED",
          work_order_status: "PENDING_DISPATCH",
          progress_stage: "SUBMITTED",
          closed: false,
          submitted_at: new Date().toISOString()
        });
        writeState(state);
        return ok("RPT-01", {
          report_id: reportId,
          report_status: "SUBMITTED",
          matched_section_id: "SEC-001"
        });
      }

      case "FILE-01": {
        var mediaRef = "med_pages_" + randomHex(6);
        return ok("FILE-01", {
          upload_ticket: "up_pages_" + randomHex(16),
          media_ref: mediaRef,
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });
      }

      case "REV-01":
        return ok("REV-01");

      case "WO-01":
        return ok("WO-01");

      case "WO-02":
        return ok("WO-02");

      case "FB-01":
        return ok("FB-01", { feedback_id: "FB-PAGES-" + randomHex(4).toUpperCase() });

      default:
        return fail("INTERNAL_ERROR", "未实现的演示接口", 500);
    }
  }

  /* ---------------- fetch 拦截 ---------------- */
  window.fetch = function (input, init) {
    var rawUrl = typeof input === "string" ? input : (input && input.url) || "";
    var url;
    try {
      url = new URL(rawUrl, window.location.href);
    } catch (e) {
      return nativeFetch(input, init);
    }
    if (url.origin !== window.location.origin) return nativeFetch(input, init);

    var path = normalizePath(url.pathname);
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

    if (path === "/demo/demo_ids.json") {
      return Promise.resolve(jsonResponse(DEMO_IDS, 200));
    }
    if (path.indexOf("/api/") === 0) {
      return Promise.resolve(handleApi(path, method, init, url));
    }
    return nativeFetch(input, init);
  };

  /* ---------------- 常驻说明横幅（合规标注 + 演示说明） ---------------- */
  function mountBanner() {
    if (!document.body || document.getElementById("hh-pages-banner")) return;
    var box = document.createElement("div");
    box.id = "hh-pages-banner";
    box.setAttribute("role", "note");
    box.style.cssText = [
      "box-sizing:border-box", "width:100%", "padding:10px 16px",
      "background:#fff4d6", "color:#5c4310", "border-bottom:1px solid #e2c274",
      "font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif",
      "text-align:center", "position:relative", "z-index:9999", "color-scheme:light"
    ].join(";");
    box.innerHTML =
      '<strong>静态演示镜像</strong>　·　GitHub Pages 无法运行 Python 后端，14 个接口由浏览器本地模拟，' +
      '全部数据来自项目自带样例，不含真实业务数据、账号或数据库。<br>' +
      '地图为示意网格，<strong>非标准地图</strong>；SAMPLE-ONLY 审图号为占位，不作为测绘、地理或合规依据。' +
      '　演示账号：<code>ops_admin</code> / <code>user_r1</code> / <code>rev_l1</code> / <code>sys_admin</code>，' +
      '统一口令 <code>Demo#Pass2026</code>。';
    document.body.insertBefore(box, document.body.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountBanner, { once: true });
  } else {
    mountBanner();
  }
})();
