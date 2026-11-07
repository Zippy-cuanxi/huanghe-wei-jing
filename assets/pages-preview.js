/* GitHub Pages 静态演示适配层
 * 仅在 *.github.io（或本地 ?pages=1 预览）时生效；通过 server.py 运行时完全不执行，
 * 因此不改变本地前后端对接后的任何业务行为。
 *
 * 作用：把 14 个契约接口在浏览器内映射到项目自带的权威数据，使公开网页在无 Python
 * 后端的静态托管下仍可完整浏览与交互：
 * 1. 自动以「游客」身份准入，公开页打开即可浏览；
 * 2. MAP-01 / STAT-01 使用 assets/preview/api-snapshot.json（本地后端真实响应的多周期快照）；
 * 3. 其余接口使用 assets/preview/api-demo.json（由 samples/* 权威成功样例生成）；
 * 4. 演示账号来自 demo/demo_ids.json，会话与上报记录保存在本标签页 sessionStorage；
 * 5. 统一四字段信封 + 每次请求独立的 trace_id；不返回降级错误码、不伪造真实业务数据。
 *
 * 所有数据均为样例/快照，不连接任何真实数据库；不是生产数据源。
 */
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var onPages = /(^|\.)github\.io$/i.test(window.location.hostname) || params.get("pages") === "1";
  if (!onPages) return;

  // 兼容既有验证脚本的标记：含义为「静态托管、无真实后端数据库」。
  window.__HH_PAGES_READONLY__ = true;
  window.__HH_PAGES_DEMO__ = true;

  var base = new URL(".", window.location.href).href.replace(/\/$/, "");
  var nativeFetch = window.fetch.bind(window);

  function loadJson(file) {
    return nativeFetch(base + file, { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; });
  }

  var snapshotPromise = loadJson("/assets/preview/api-snapshot.json");
  var samplesPromise = loadJson("/assets/preview/api-demo.json");
  var demoIdsPromise = loadJson("/demo/demo_ids.json");

  /* ---------- 1. 游客准入与演示会话（与 lib.js 的存储契约一致） ---------- */
  var SESSION_STORE = "hh.pages.sessions.v1";
  var REPORT_STORE = "hh.pages.reports.v1";

  function readStore(key, fallback) {
    try {
      var raw = window.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeStore(key, value) {
    try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式忽略 */ }
  }

  var sessions = readStore(SESSION_STORE, {});
  var reports = readStore(REPORT_STORE, []);

  try {
    if (!window.sessionStorage.getItem("hh.guest_session")) {
      window.sessionStorage.setItem("hh.guest_session", JSON.stringify({
        guest_id: "guest-pages-" + Math.random().toString(36).slice(2, 12),
        started_at: new Date().toISOString(),
      }));
    }
    // 只清理不属于本演示层的残留会话句柄，保留已登录的演示账号会话（同标签页可刷新恢复）。
    var handle = window.sessionStorage.getItem("hh.session_handle");
    if (handle && !sessions[handle]) window.sessionStorage.removeItem("hh.session_handle");
  } catch (e) { /* 存储不可用时仍可手动通过游客闸门 */ }

  /* ---------- 2. 工具 ---------- */
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
    return value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));
  }

  function envelope(code, message, data) {
    return {
      code: code,
      message: message,
      data: data === undefined ? null : data,
      trace_id: randomHex(16),
    };
  }

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-HH-Pages-Demo": "1",
      },
    });
  }

  function ok(sample, apiId, data) {
    var s = sample && sample[apiId];
    return jsonResponse(envelope(
      "OK",
      (s && s.message) || "操作成功",
      data === undefined ? clone(s && s.data) : data
    ), 200);
  }

  function fail(code, message, status) {
    return jsonResponse(envelope(code, message, null), status || 400);
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
    try { return init && init.body ? JSON.parse(init.body) : {}; } catch (e) { return {}; }
  }

  function toUrl(input) {
    try {
      return new URL(typeof input === "string" ? input : input.url, window.location.href);
    } catch (e) { return null; }
  }

  // 项目子路径下也可能出现 /huanghe-wei-jing/api/...，统一归一化到 /api/... 或 /demo/...
  function normalizePath(pathname) {
    var api = pathname.indexOf("/api/");
    if (api >= 0) return pathname.slice(api);
    var demo = pathname.indexOf("/demo/");
    if (demo >= 0) return pathname.slice(demo);
    return pathname;
  }

  /* ---------- 3. 角色 → 权限（与 backend/constants.py 的角色门槛一致） ---------- */
  var BASE_PERMISSIONS = [
    "AUTH-01", "AUTH-02", "AUTH-03", "AUTH-04",
    "FILE-01", "RPT-01", "RPT-02", "MAP-01", "STAT-01", "FB-01",
  ];
  var GATED = {
    "WO-01": ["R6"],
    "WO-02": ["R2", "R6"],
    "REV-01": ["R3", "R4", "R5"],
    "ADM-01": ["R6", "R7"],
  };

  function permissionsFor(roles) {
    var list = roles || [];
    var set = {};
    BASE_PERMISSIONS.forEach(function (p) { set[p] = true; });
    Object.keys(GATED).forEach(function (op) {
      if (GATED[op].some(function (r) { return list.indexOf(r) >= 0; })) set[op] = true;
    });
    return Object.keys(set);
  }

  function currentSession(init) {
    var handle = headerValue(init, "X-Session-Handle");
    if (!handle || !sessions[handle]) return null;
    return Object.assign({ handle: handle }, sessions[handle]);
  }

  function profileFor(record) {
    return {
      account_id: record.accountId,
      account_status: "ACTIVE",
      roles: clone(record.roles),
    };
  }

  /* ---------- 4. 契约路由表（与 assets/lib.js 完全一致） ---------- */
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
    { method: "GET", path: "/api/admin/config", id: "ADM-01", auth: true },
  ];

  var READABLE_APIS = { "/api/map/sections": "MAP-01", "/api/statistics": "STAT-01" };
  var DEFAULT_PERIOD = "2026-11";

  function snapshotBody(snap, apiId, url) {
    var table = snap && snap[apiId];
    if (!table) return null;
    var period = url.searchParams.get("period") || DEFAULT_PERIOD;
    var section = url.searchParams.get("section_id") || "";
    return table[period + "|" + section] || table[period + "|"] ||
      table[DEFAULT_PERIOD + "|" + section] || table[DEFAULT_PERIOD + "|"] || null;
  }

  function handleApi(path, method, init, url) {
    var route = null;
    for (var i = 0; i < ROUTES.length; i += 1) {
      if (ROUTES[i].path === path && ROUTES[i].method === method) { route = ROUTES[i]; break; }
    }
    if (!route) return fail("INTERNAL_ERROR", "静态演示不支持该请求：" + method + " " + path, 404);

    return Promise.all([snapshotPromise, samplesPromise, demoIdsPromise]).then(function (loaded) {
      var snap = loaded[0], sample = loaded[1] || {}, demoIds = loaded[2] || {};
      var payload = parseBody(init);
      var current = currentSession(init);

      // 公开数据接口：始终可用，返回本地后端真实响应快照。
      if (method === "GET" && READABLE_APIS[path]) {
        var body = snapshotBody(snap, READABLE_APIS[path], url);
        if (body) return jsonResponse(Object.assign({}, body, { trace_id: randomHex(16) }), 200);
        return ok(sample, READABLE_APIS[path]);
      }

      if (route.auth && !current) {
        return fail("AUTH_SESSION_REQUIRED", "请先登录演示账号后再操作", 401);
      }
      var permissions = current ? current.permissions : [];
      if (current && GATED[route.id] && permissions.indexOf(route.id) < 0) {
        return fail("PERM_ROLE_REQUIRED", "当前演示账号角色无权执行该操作", 403);
      }

      switch (route.id) {
        case "AUTH-01": {
          var accountId = payload.account_id || "demo_guest";
          return ok(sample, "AUTH-01", {
            account_id: accountId, account_status: "ACTIVE", default_role: "R1",
          });
        }

        case "AUTH-02": {
          var demoPassword = demoIds.demo_password || "Demo#Pass2026";
          var accounts = Array.isArray(demoIds.accounts) ? demoIds.accounts : [];
          var account = accounts.find(function (a) { return a.account_id === payload.account_id; });
          if (!account || payload.credential !== demoPassword) {
            return fail("AUTH_INVALID", "账号或凭证不正确；演示口令：" + demoPassword, 401);
          }
          var newHandle = "sh_pages_" + randomHex(24);
          var expiresAt = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
          var roles = clone(account.roles || ["R1"]);
          sessions[newHandle] = {
            accountId: account.account_id,
            roles: roles,
            permissions: permissionsFor(roles),
            expiresAt: expiresAt,
          };
          writeStore(SESSION_STORE, sessions);
          var authData = clone(sample["AUTH-02"] && sample["AUTH-02"].data) || {};
          authData.session_handle = newHandle;
          authData.expires_at = expiresAt;
          authData.account_profile = profileFor(sessions[newHandle]);
          authData.permission_summary = { roles: roles, permissions: permissionsFor(roles) };
          return ok(sample, "AUTH-02", authData);
        }

        case "AUTH-03": {
          if (current) {
            if (payload.scope === "ALL") {
              Object.keys(sessions).forEach(function (h) {
                if (sessions[h].accountId === current.accountId) delete sessions[h];
              });
            } else {
              delete sessions[current.handle];
            }
            writeStore(SESSION_STORE, sessions);
          }
          return ok(sample, "AUTH-03");
        }

        case "AUTH-04": {
          var sessionData = clone(sample["AUTH-04"] && sample["AUTH-04"].data) || {};
          sessionData.session_status = "ACTIVE";
          sessionData.account_profile = profileFor(current);
          sessionData.permission_summary = {
            roles: clone(current.roles), permissions: clone(current.permissions),
          };
          sessionData.expires_at = current.expiresAt;
          return ok(sample, "AUTH-04", sessionData);
        }

        case "FILE-01":
          return ok(sample, "FILE-01", {
            upload_ticket: "up_pages_" + randomHex(16),
            media_ref: "med_pages_" + randomHex(6),
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          });

        case "RPT-01": {
          var reportId = "RPT-PAGES-" + randomHex(5).toUpperCase();
          reports.unshift({
            report_id: reportId,
            report_status: "SUBMITTED",
            work_order_status: "PENDING_DISPATCH",
            progress_stage: "SUBMITTED",
            closed: false,
            submitted_at: new Date().toISOString(),
          });
          writeStore(REPORT_STORE, reports);
          var rpt = clone(sample["RPT-01"] && sample["RPT-01"].data) || {};
          rpt.report_id = reportId;
          return ok(sample, "RPT-01", rpt);
        }

        case "RPT-02": {
          var baseList = clone(sample["RPT-02"] && sample["RPT-02"].data) || { items: [] };
          var all = reports.concat(Array.isArray(baseList.items) ? baseList.items : []);
          var pageNo = Math.max(1, Number(url.searchParams.get("page_no") || 1));
          var pageSize = Math.max(1, Number(url.searchParams.get("page_size") || 20));
          baseList.items = all.slice((pageNo - 1) * pageSize, pageNo * pageSize);
          if (Object.prototype.hasOwnProperty.call(baseList, "total")) baseList.total = all.length;
          return ok(sample, "RPT-02", baseList);
        }

        case "FB-01":
          return ok(sample, "FB-01", { feedback_id: "FB-PAGES-" + randomHex(5).toUpperCase() });

        case "WO-01":
        case "WO-02":
        case "REV-01":
        case "ADM-01":
          return ok(sample, route.id);

        default:
          return fail("INTERNAL_ERROR", "静态演示未实现的接口", 500);
      }
    });
  }

  /* ---------- 5. fetch 拦截 ---------- */
  window.fetch = function (input, init) {
    var url = toUrl(input);
    if (!url) return nativeFetch(input, init);

    var path = normalizePath(url.pathname);
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();

    // lib.js 里的根绝对路径在项目子路径下会 404，直接回放仓库内的演示账号数据。
    if (path === "/demo/demo_ids.json") {
      return demoIdsPromise.then(function (ids) {
        return jsonResponse(ids || { accounts: [] }, 200);
      });
    }
    if (path.indexOf("/api/") === 0) return handleApi(path, method, init, url);
    return nativeFetch(input, init);
  };
})();
