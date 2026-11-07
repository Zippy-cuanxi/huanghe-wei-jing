/* GitHub Pages 静态只读适配层
 * 仅在 *.github.io（或本地 ?pages=1 预览）时生效；通过 server.py 运行时完全不执行，
 * 因此不改变本地前后端对接后的任何业务行为。
 *
 * 作用：
 * 1. 自动以「游客」身份准入，公开页打开即可浏览，无需登录或点击闸门按钮；
 * 2. 把公开 GET 接口 /api/map/sections、/api/statistics 映射到仓库内的真实响应快照；
 * 3. 修正 /demo/demo_ids.json 这类根绝对路径，使其指向 Pages 项目子路径；
 * 4. 所有提交类接口返回明确的「只读演示」提示，不伪造成功、不产生网络错误。
 */
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var onPages = /(^|\.)github\.io$/i.test(window.location.hostname) || params.get("pages") === "1";
  if (!onPages) return;

  window.__HH_PAGES_READONLY__ = true;

  /* ---------- 1. 游客自动准入（与 lib.js 的存储契约一致） ---------- */
  try {
    var GUEST_KEY = "hh.guest_session";
    if (!sessionStorage.getItem(GUEST_KEY)) {
      sessionStorage.setItem(GUEST_KEY, JSON.stringify({
        guest_id: "guest-pages-" + Math.random().toString(36).slice(2, 12),
        started_at: new Date().toISOString(),
      }));
    }
    // 清掉可能残留的本地后端会话句柄，避免刷新会话时请求失效的 /api/auth/session。
    sessionStorage.removeItem("hh.session_handle");
  } catch (e) { /* 存储不可用时仍可手动通过游客闸门 */ }

  /* ---------- 2. API 静态快照映射 ---------- */
  var base = new URL(".", window.location.href).href.replace(/\/$/, "");
  var nativeFetch = window.fetch.bind(window);
  var snapshotPromise = nativeFetch(base + "/assets/preview/api-snapshot.json", { cache: "no-store" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .catch(function () { return null; });

  var READABLE_APIS = {
    "/api/map/sections": "MAP-01",
    "/api/statistics": "STAT-01",
  };
  var DEFAULT_PERIOD = "2026-11";
  var TRACE = "00000000000000000000000000000000";

  function envelope(code, message, data) {
    return { code: code, message: message, data: data || null, trace_id: TRACE };
  }

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  function toUrl(input) {
    try {
      return new URL(typeof input === "string" ? input : input.url, window.location.href);
    } catch (e) { return null; }
  }

  window.fetch = function (input, init) {
    var url = toUrl(input);
    if (!url) return nativeFetch(input, init);
    var path = url.pathname;

    // lib.js 里的根绝对路径在项目子路径下会 404，重写为仓库内地址。
    if (path === "/demo/demo_ids.json") {
      return nativeFetch(base + "/demo/demo_ids.json", init);
    }
    if (path.indexOf("/api/") !== 0) return nativeFetch(input, init);

    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();

    if (method === "GET" && READABLE_APIS[path]) {
      var period = url.searchParams.get("period") || DEFAULT_PERIOD;
      var section = url.searchParams.get("section_id") || "";
      return snapshotPromise.then(function (snap) {
        var table = snap && snap[READABLE_APIS[path]];
        var body = table && (table[period + "|" + section] || table[period + "|"]);
        if (!body) body = table && (table[DEFAULT_PERIOD + "|" + section] || table[DEFAULT_PERIOD + "|"]);
        if (!body) {
          return jsonResponse(envelope("DEP_EXTERNAL_UNAVAILABLE", "在线演示数据快照暂不可用，请刷新后重试。"), 503);
        }
        return jsonResponse(body, 200);
      });
    }

    if (path === "/api/auth/session") {
      return Promise.resolve(jsonResponse(
        envelope("AUTH_SESSION_INVALID", "在线演示为游客只读模式。"), 401
      ));
    }

    // 注册 / 登录 / 上报 / 审核等提交类接口：明确告知只读，不伪造成功。
    return Promise.resolve(jsonResponse(
      envelope("DEP_EXTERNAL_UNAVAILABLE", "GitHub Pages 在线演示为静态只读快照；提交类操作请在本地运行 server.py 后使用。"),
      503
    ));
  };

  /* ---------- 3. 一次性只读说明（可关闭，不改动任何页面结构） ---------- */
  try {
    if (sessionStorage.getItem("hh.pages.notice.dismissed")) return;
    function mountNotice() {
      var box = document.createElement("div");
      box.setAttribute("role", "status");
      box.style.cssText = [
        "position:fixed", "z-index:9999", "max-width:360px",
        "padding:10px 34px 10px 14px", "border-radius:12px",
        "background:rgba(11,65,72,.94)", "color:#f7f4ec",
        "font:13px/1.6 system-ui,-apple-system,'Microsoft YaHei',sans-serif",
        "box-shadow:0 8px 28px rgba(6,31,46,.24)", "pointer-events:auto",
      ].join(";");
      box.textContent = "在线演示为静态只读版：地图与成效数据为示例快照，上报、登录等提交功能请在本地运行 server.py 后使用。";

      var close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "关闭提示");
      close.textContent = "×";
      close.style.cssText = "position:absolute;top:4px;right:8px;border:0;background:none;color:inherit;font-size:18px;line-height:1;cursor:pointer;opacity:.75;";
      close.onclick = function () {
        try { sessionStorage.setItem("hh.pages.notice.dismissed", "1"); } catch (e) {}
        box.remove();
      };
      box.appendChild(close);

      function place() {
        var narrow = window.innerWidth <= 720;
        box.style.left = narrow ? "12px" : "auto";
        box.style.right = narrow ? "12px" : "20px";
        box.style.bottom = narrow ? "78px" : "20px";
      }
      place();
      window.addEventListener("resize", place);
      document.body.appendChild(box);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountNotice);
    } else {
      mountNotice();
    }
  } catch (e) { /* 提示为渐进增强 */ }
})();
