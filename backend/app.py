# -*- coding: utf-8 -*-
"""参考调用入口（传输无关）。

说明：
- 通信风格/地址/序列化格式属于 T2 未确认项。本入口只提供「接口编号 + payload」
  的参考调用信封，用于本侧自测与权威样例生成，不构成协议选型结论。
- 统一响应严格为 code / message / data / trace_id 四字段。
- 业务规则、状态机、鉴权与审计全部在本层及 services 内完成，前端不参与裁决。
"""

from __future__ import annotations

import logging

from . import db
from .adapters import AIAdapter, StorageAdapter, VerificationAdapter
from .audit import audit_rejection, standalone_audit
from .constants import API_IDS, ROLE_GATED_OPS
from .context import RequestContext
from .errors import ApiError, domain_of
from .ratelimit import RateLimiter
from .security import IdFactory
from .services import admin, auth, feedback, mapstats, media, reports, reviews, workorders
from .timeutil import Clock, iso

logger = logging.getLogger("backend.app")

PUBLIC_APIS = {"AUTH-01", "AUTH-02", "MAP-01", "STAT-01"}
HANDLE_ONLY_APIS = {"AUTH-03"}

SUCCESS_MESSAGES = {
    "AUTH-01": "注册成功",
    "AUTH-02": "登录成功",
    "AUTH-03": "登出成功",
    "AUTH-04": "会话有效",
    "FILE-01": "上传凭证已签发",
    "RPT-01": "上报已受理",
    "RPT-02": "查询成功",
    "MAP-01": "查询成功",
    "WO-01": "工单已转派",
    "WO-02": "工单已办结",
    "REV-01": "审核已记录",
    "STAT-01": "查询成功",
    "FB-01": "评价已提交",
    "ADM-01": "查询成功",
}


def _envelope(code: str, message: str, data, trace_id: str) -> dict:
    return {"code": code, "message": message, "data": data, "trace_id": trace_id}


class BackendApp:
    def __init__(
        self,
        db_path: str,
        *,
        clock: Clock | None = None,
        ids: IdFactory | None = None,
        verification: VerificationAdapter | None = None,
        ai: AIAdapter | None = None,
        storage: StorageAdapter | None = None,
        limits: dict | None = None,
        fault_hook=None,
    ) -> None:
        self.conn = db.connect(db_path)
        db.init_db(self.conn)
        self.clock = clock or Clock()
        self.ids = ids or IdFactory()
        self.verification = verification or VerificationAdapter()
        self.ai = ai or AIAdapter()
        self.storage = storage or StorageAdapter()
        self.rate = RateLimiter(self.conn, limits)
        # 仅测试/样例夹具可注入；不可由请求输入触发。
        self.fault_hook = fault_hook

    def close(self) -> None:
        self.conn.close()

    # ------------------------------------------------------------------
    def handle(self, request, trace_id: str | None = None) -> dict:
        trace = trace_id or self.ids.trace_id()
        now_dt = self.clock.now().replace(microsecond=0)
        ctx = RequestContext(
            trace_id=trace,
            api="UNKNOWN",
            now=iso(now_dt),
            now_epoch=int(now_dt.timestamp()),
        )
        try:
            api, payload, session_handle, idem_key = self._parse_envelope(request)
            ctx.api = api
            ctx.extra["payload"] = payload

            # 1) 认证：匿名白名单外一律要求有效会话。
            if api not in PUBLIC_APIS and api not in HANDLE_ONLY_APIS:
                actor, _session_row = auth.authenticate(self.conn, session_handle, ctx.now)
                ctx.actor = actor

            # 2) 逐请求角色门槛（资源级权限在服务层继续裁决）。
            required_roles = ROLE_GATED_OPS.get(api)
            if required_roles is not None:
                if ctx.actor is None or not ctx.actor.has_any_role(required_roles):
                    raise ApiError("PERM_ROLE_REQUIRED", "当前角色无权执行该操作")

            # 3) 仅测试夹具：故障注入，验证 INTERNAL 信封不泄露内部信息。
            if self.fault_hook is not None:
                self.fault_hook(api, payload)

            data = self._dispatch(api, ctx, payload, session_handle, idem_key)
            if ctx.replayed:
                standalone_audit(
                    self.conn,
                    trace_id=ctx.trace_id,
                    event_type="IDEMPOTENT_REPLAY",
                    outcome="INFO",
                    now=ctx.now,
                    actor_account_id=ctx.actor.account_id if ctx.actor else None,
                    actor_roles=ctx.actor.roles if ctx.actor else None,
                    target_type="API",
                    target_id=api,
                    details={"api": api},
                )
            return _envelope("OK", SUCCESS_MESSAGES[api], data, trace)

        except ApiError as exc:
            self._audit_error(ctx, exc)
            return _envelope(exc.code, exc.message, None, trace)

        except Exception as exc:  # 不对外暴露堆栈或内部字段
            logger.exception("unhandled error trace_id=%s api=%s", trace, ctx.api)
            try:
                standalone_audit(
                    self.conn,
                    trace_id=trace,
                    event_type="INTERNAL_ERROR",
                    outcome="FAILURE",
                    now=ctx.now,
                    actor_account_id=ctx.actor.account_id if ctx.actor else None,
                    actor_roles=ctx.actor.roles if ctx.actor else None,
                    target_type="API",
                    target_id=ctx.api,
                    details={"api": ctx.api, "exception_type": type(exc).__name__},
                )
            except Exception:
                logger.exception("internal-error audit failed trace_id=%s", trace)
            return _envelope("INTERNAL_ERROR", "系统繁忙，请稍后重试", None, trace)

    # ------------------------------------------------------------------
    def _parse_envelope(self, request) -> tuple[str, dict, str | None, str | None]:
        if not isinstance(request, dict):
            raise ApiError("PARAM_INVALID_TYPE", "字段类型不正确：request")
        unknown = sorted(set(request.keys()) - {"api", "payload", "session_handle", "idempotency_key"})
        if unknown:
            raise ApiError("PARAM_UNKNOWN_FIELD", f"请求包含契约外字段：{unknown[0]}")
        if "api" not in request or request["api"] is None:
            raise ApiError("PARAM_MISSING_FIELD", "缺少必填字段：api")
        api = request["api"]
        if not isinstance(api, str):
            raise ApiError("PARAM_INVALID_TYPE", "字段类型不正确：api")
        if api not in API_IDS:
            raise ApiError("PARAM_UNKNOWN_API", "未知接口编号")
        if "payload" not in request or request["payload"] is None:
            raise ApiError("PARAM_MISSING_FIELD", "缺少必填字段：payload")
        payload = request["payload"]
        if not isinstance(payload, dict):
            raise ApiError("PARAM_INVALID_TYPE", "字段类型不正确：payload")
        session_handle = request.get("session_handle")
        if session_handle is not None and not isinstance(session_handle, str):
            raise ApiError("PARAM_INVALID_TYPE", "字段类型不正确：session_handle")
        idem_key = request.get("idempotency_key")
        if idem_key is not None and not isinstance(idem_key, str):
            raise ApiError("PARAM_INVALID_TYPE", "字段类型不正确：idempotency_key")
        return api, payload, session_handle, idem_key

    def _dispatch(self, api: str, ctx: RequestContext, payload: dict, session_handle, idem_key):
        if api == "AUTH-01":
            return auth.register(self, self.conn, ctx, payload, idem_key)
        if api == "AUTH-02":
            return auth.login(self, self.conn, ctx, payload)
        if api == "AUTH-03":
            return auth.logout(self, self.conn, ctx, session_handle, payload)
        if api == "AUTH-04":
            return auth.session_info(self, self.conn, ctx, session_handle, payload)
        if api == "FILE-01":
            return media.issue_ticket(self, self.conn, ctx, payload, idem_key)
        if api == "RPT-01":
            return reports.create_report(self, self.conn, ctx, payload, idem_key)
        if api == "RPT-02":
            return reports.list_my_reports(self.conn, ctx, payload)
        if api == "MAP-01":
            return mapstats.map_query(self.conn, ctx, payload)
        if api == "WO-01":
            return workorders.dispatch(self, self.conn, ctx, payload, idem_key)
        if api == "WO-02":
            return workorders.close(self, self.conn, ctx, payload, idem_key)
        if api == "REV-01":
            return reviews.review(self, self.conn, ctx, payload, idem_key)
        if api == "STAT-01":
            return mapstats.stat_query(self.conn, ctx, payload)
        if api == "FB-01":
            return feedback.submit(self, self.conn, ctx, payload, idem_key)
        if api == "ADM-01":
            return admin.get_config(self.conn, ctx, payload)
        raise ApiError("PARAM_UNKNOWN_API", "未知接口编号")

    def _audit_error(self, ctx: RequestContext, exc: ApiError) -> None:
        if domain_of(exc.code) == "PARAM":
            return
        actor_id = ctx.actor.account_id if ctx.actor else exc.actor_hint.get("account_id")
        roles = ctx.actor.roles if ctx.actor else None
        audit_rejection(
            self.conn,
            trace_id=ctx.trace_id,
            api=ctx.api,
            code=exc.code,
            now=ctx.now,
            actor_account_id=actor_id,
            actor_roles=roles,
            target_type=exc.audit_target_type,
            target_id=exc.audit_target_id,
            detail=exc.audit_detail,
            actor_hint=exc.actor_hint,
        )
