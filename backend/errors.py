# -*- coding: utf-8 -*-
"""统一业务错误。

约束：
- 对外只暴露 code / message / data=null / trace_id；
- message 为可直接展示的中文文案，不回显用户输入值、凭证、坐标或内部字段；
- 不携带堆栈。内部异常由 app 层记录，对外统一 INTERNAL_ERROR。
"""

from __future__ import annotations


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        audit_target_type: str | None = None,
        audit_target_id: str | None = None,
        audit_detail: dict | None = None,
        actor_hint: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.audit_target_type = audit_target_type
        self.audit_target_id = audit_target_id
        self.audit_detail = audit_detail or {}
        self.actor_hint = actor_hint or {}


# 错误码目录：code -> (错误域, 建议用途)。文案在抛出点按字段生成，保持可展示。
ERROR_CATALOG = {
    # PARAM
    "PARAM_MISSING_FIELD": ("PARAM", "缺少必填字段"),
    "PARAM_INVALID_TYPE": ("PARAM", "字段类型不正确"),
    "PARAM_INVALID_VALUE": ("PARAM", "字段取值不合法"),
    "PARAM_INVALID_ENUM": ("PARAM", "字段取值不在枚举范围"),
    "PARAM_UNKNOWN_FIELD": ("PARAM", "请求包含契约外字段"),
    "PARAM_UNKNOWN_API": ("PARAM", "未知接口编号"),
    "PARAM_INVALID_PAGINATION": ("PARAM", "分页参数越界"),
    "PARAM_INVALID_IDEMPOTENCY_KEY": ("PARAM", "幂等键格式不合法"),
    "PARAM_IDEMPOTENCY_KEY_REUSED": ("PARAM", "幂等键被复用于不同请求"),
    "PARAM_INVALID_COORDINATE": ("PARAM", "坐标超出有效范围"),
    "PARAM_INVALID_WEIGHT": ("PARAM", "清理量必须为大于 0 的千克数值"),
    "PARAM_INVALID_MEDIA_TYPE": ("PARAM", "媒体类型不受支持"),
    "PARAM_MEDIA_SIZE_EXCEEDED": ("PARAM", "媒体大小超过上限"),
    "PARAM_INVALID_CHECKSUM": ("PARAM", "校验和格式不合法"),
    "PARAM_INVALID_PERIOD": ("PARAM", "统计周期格式不合法"),
    "PARAM_INVALID_RATING": ("PARAM", "评分必须为 1-5 的整数"),
    "PARAM_UNKNOWN_METRIC_KEY": ("PARAM", "请求了未定义的指标键"),
    "PARAM_INVALID_SCOPE": ("PARAM", "配置范围取值不合法"),
    "PARAM_TARGET_NOT_FOUND": ("PARAM", "目标不存在"),
    "PARAM_TARGET_ORG_NOT_FOUND": ("PARAM", "目标责任单位不存在"),
    "PARAM_AGREEMENT_REQUIRED": ("PARAM", "未接受用户协议"),
    # AUTH
    "AUTH_INVALID": ("AUTH", "账号或凭证不正确（统一失败语义）"),
    "AUTH_LOCKED": ("AUTH", "连续失败导致临时锁定"),
    "AUTH_SESSION_REQUIRED": ("AUTH", "缺少会话凭证"),
    "AUTH_SESSION_INVALID": ("AUTH", "会话不存在或格式无效"),
    "AUTH_SESSION_EXPIRED": ("AUTH", "会话已过期"),
    "AUTH_SESSION_REVOKED": ("AUTH", "会话已注销或账号已停用"),
    "AUTH_ACCOUNT_EXISTS": ("AUTH", "账号已存在"),
    "AUTH_CREDENTIAL_TOO_WEAK": ("AUTH", "凭证强度不足"),
    "AUTH_VERIFY_FAILED": ("AUTH", "验证凭证不正确或已失效"),
    # PERM
    "PERM_ROLE_REQUIRED": ("PERM", "当前角色无权执行该操作"),
    "PERM_RESOURCE_FORBIDDEN": ("PERM", "无权访问该资源（不区分是否存在）"),
    "PERM_SOD_VIOLATION": ("PERM", "违反审核职责分离约束"),
    # STATE
    "STATE_INVALID_TRANSITION": ("STATE", "当前状态不允许该流转"),
    "STATE_REVIEW_LEVEL_MISMATCH": ("STATE", "审核级别与当前流程不一致"),
    "STATE_CLOSED_REQUIRED": ("STATE", "工单未办结，不允许评价"),
    "STATE_FEEDBACK_DUPLICATE": ("STATE", "该工单已提交过评价"),
    # RATE
    "RATE_LIMITED": ("RATE", "请求过于频繁"),
    # DEP
    "DEP_EXTERNAL_UNAVAILABLE": ("DEP", "外部能力不可用，安全降级"),
    # INTERNAL
    "INTERNAL_ERROR": ("INTERNAL", "内部错误，已隐藏细节"),
}

ERROR_DOMAINS = tuple(("PARAM", "AUTH", "PERM", "STATE", "RATE", "DEP", "INTERNAL"))


def domain_of(code: str) -> str:
    return ERROR_CATALOG.get(code, ("INTERNAL", ""))[0]
