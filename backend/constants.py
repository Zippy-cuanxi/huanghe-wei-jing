# -*- coding: utf-8 -*-
"""契约常量与后端定义的服务端枚举。

说明：
- 本文件中的枚举取值是后端在 B9「配置与字典」职责内的定义项，必须随交付材料
  一并提交双方确认；确认前不得视为已冻结的业务结论。
- 契约已给定的字段名、错误码域保持不变；本文件不新增接口或字段。
"""

CONTRACT_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# 接口编号（与协作文档 §4.2 逐条对应）
# ---------------------------------------------------------------------------
API_IDS = (
    "AUTH-01", "AUTH-02", "AUTH-03", "AUTH-04",
    "FILE-01",
    "RPT-01", "RPT-02",
    "MAP-01",
    "WO-01", "WO-02",
    "REV-01",
    "STAT-01",
    "FB-01",
    "ADM-01",
)

PUBLIC_APIS = {"AUTH-01", "AUTH-02", "MAP-01", "STAT-01"}
HANDLE_ONLY_APIS = {"AUTH-03"}          # 凭持有会话句柄即可登出（幂等语义）
AUTHENTICATED_APIS = set(API_IDS) - PUBLIC_APIS

# 契约通则要求所有写接口带 idempotency_key；§4.2 仅在下列接口列出该字段。
# 参考实现：列出的接口强制要求；AUTH-01/FILE-01 接受可选键；AUTH-02/03 不适用。
IDEMPOTENCY_REQUIRED_APIS = {"RPT-01", "WO-01", "WO-02", "REV-01", "FB-01"}
IDEMPOTENCY_OPTIONAL_APIS = {"AUTH-01", "FILE-01"}

# ---------------------------------------------------------------------------
# 角色（R0 为匿名，不落库）
# ---------------------------------------------------------------------------
ROLES = ("R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8")
STORED_ROLES = ("R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8")
ROLE_LABELS = {
    "R0": "匿名用户",
    "R1": "公众注册用户",
    "R2": "责任单位操作员",
    "R3": "初审员",
    "R4": "复审员",
    "R5": "终审员",
    "R6": "运营管理员",
    "R7": "系统管理员",
    "R8": "审计员",
}

# 角色门槛：未列出的接口仅要求「已认证」，具体归属校验在服务层完成。
ROLE_GATED_OPS = {
    "WO-01": {"R6"},
    "WO-02": {"R2", "R6"},
    "REV-01": {"R3", "R4", "R5"},
    "ADM-01": {"R6", "R7"},
}

AUTHED_BASE_OPS = ("AUTH-03", "AUTH-04", "FILE-01", "RPT-01", "RPT-02", "FB-01")
PUBLIC_OPS = ("AUTH-01", "AUTH-02", "MAP-01", "STAT-01")

# ---------------------------------------------------------------------------
# 服务端枚举定义（由 ADM-01 的 status_enums 下发）
# ---------------------------------------------------------------------------
ENUM_DEFINITIONS = [
    ("account_status", [
        ("ACTIVE", "正常"),
        ("DISABLED", "已停用"),
    ]),
    ("session_status", [
        ("ACTIVE", "有效"),
        ("EXPIRED", "已过期"),
        ("REVOKED", "已注销"),
    ]),
    ("report_status", [
        ("SUBMITTED", "已提交"),
        ("UNDER_REVIEW", "审核中"),
        ("APPROVED", "审核通过"),
        ("REJECTED", "审核不通过"),
        ("RETURNED", "已退回"),
    ]),
    ("review_status", [
        ("PENDING", "待审核"),
        ("IN_PROGRESS", "审核中"),
        ("APPROVED", "审核通过"),
        ("REJECTED", "审核不通过"),
        ("RETURNED", "已退回"),
    ]),
    ("review_level", [
        ("LEVEL_1", "初审"),
        ("LEVEL_2", "复审"),
        ("LEVEL_3", "终审"),
    ]),
    ("review_result", [
        ("APPROVED", "通过"),
        ("REJECTED", "不通过"),
        ("RETURNED", "退回"),
    ]),
    ("work_order_status", [
        ("PENDING_DISPATCH", "待派单"),
        ("DISPATCHED", "已派单"),
        ("CLOSED", "已办结"),
        ("CANCELLED", "已取消"),
    ]),
    ("progress_stage", [
        ("SUBMITTED", "已上报"),
        ("IN_PROGRESS", "处理中"),
        ("COMPLETED", "已办结"),
    ]),
    ("media_type", [
        ("IMAGE_JPEG", "JPEG 图片"),
        ("IMAGE_PNG", "PNG 图片"),
        ("VIDEO_MP4", "MP4 视频"),
    ]),
    ("media_status", [
        ("RESERVED", "已登记"),
        ("UPLOADED", "已上传"),
        ("REJECTED", "已拒绝"),
    ]),
    ("target_type", [
        ("REPORT", "上报线索"),
    ]),
    # 契约未提供独立 scale_levels 字段，参考实现将其纳入同一枚举字典下发。
    ("scale_level", None),   # 运行时从 scale_levels 表读取
    ("role_code", None),     # 运行时由 ROLE_LABELS 生成
    ("metric_key", None),    # 运行时由 METRIC_KEYS 生成
]

REPORT_STATUSES = ("SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "RETURNED")
REVIEW_STATUSES = ("PENDING", "IN_PROGRESS", "APPROVED", "REJECTED", "RETURNED")
REVIEW_LEVELS = ("LEVEL_1", "LEVEL_2", "LEVEL_3")
REVIEW_RESULTS = ("APPROVED", "REJECTED", "RETURNED")
WORK_ORDER_STATUSES = ("PENDING_DISPATCH", "DISPATCHED", "CLOSED", "CANCELLED")
PROGRESS_STAGES = ("SUBMITTED", "IN_PROGRESS", "COMPLETED")
MEDIA_TYPES = ("IMAGE_JPEG", "IMAGE_PNG", "VIDEO_MP4")
MEDIA_STATUSES = ("RESERVED", "UPLOADED", "REJECTED")
TARGET_TYPES = ("REPORT",)
ACCOUNT_STATUSES = ("ACTIVE", "DISABLED")
SESSION_STATUSES = ("ACTIVE", "EXPIRED", "REVOKED")

REVIEW_LEVEL_ROLE = {
    "LEVEL_1": "R3",
    "LEVEL_2": "R4",
    "LEVEL_3": "R5",
}
LEVEL_ORDER = {"LEVEL_1": 1, "LEVEL_2": 2, "LEVEL_3": 3}

# ---------------------------------------------------------------------------
# 统计指标（STAT-01）
# ---------------------------------------------------------------------------
METRIC_DEFINITIONS = [
    ("cleanup_kg_total", "kg", "已办结工单清理量合计"),
    ("approved_report_count", "count", "审核通过上报数"),
    ("closed_work_order_count", "count", "已办结工单数"),
]
METRIC_KEYS = tuple(m[0] for m in METRIC_DEFINITIONS)
METRIC_UNITS = {m[0]: m[1] for m in METRIC_DEFINITIONS}

# ---------------------------------------------------------------------------
# 业务配置默认值（写入 configs 表；可由运维配给工具变更并审计）
# ---------------------------------------------------------------------------
DEFAULT_CONFIGS = {
    "coarsen_degree": 0.01,
    "map_audit_no": None,
    "leaderboard_enabled": False,
    "leaderboard_sample_verified": False,
    "leaderboard_verified_sample_size": 0,
    "min_publish_sample_size": 1,
    "section_match_radius_km": 5.0,
}

COARSEN_DEGREE_MIN = 0.001
COARSEN_DEGREE_MAX = 1.0
SECTION_MATCH_RADIUS_MIN = 0.1
SECTION_MATCH_RADIUS_MAX = 100.0
MAP_AUDIT_NO_MAX_LEN = 64

# ---------------------------------------------------------------------------
# 运行参数（参考实现；T2/T4/T11/T12 未确认，不构成选型结论）
# ---------------------------------------------------------------------------
PBKDF2_ITERATIONS = 200_000
CREDENTIAL_SALT_BYTES = 16
SESSION_TTL_SECONDS = 12 * 3600
UPLOAD_TICKET_TTL_SECONDS = 15 * 60
LOGIN_FAILURE_THRESHOLD = 5
LOGIN_LOCK_SECONDS = 15 * 60
VERIFY_TOKEN_WINDOW_SECONDS = 10 * 60

MAX_PAGE_SIZE = 100
MAX_WEIGHT_KG = 1_000_000.0
WEIGHT_DECIMALS = 3
MAX_MEDIA_REFS = 9
MAX_COMMENT_LEN = 1000
MAX_FEEDBACK_CONTENT_LEN = 500

MEDIA_SIZE_LIMITS = {
    "IMAGE_JPEG": 10 * 1024 * 1024,
    "IMAGE_PNG": 10 * 1024 * 1024,
    "VIDEO_MP4": 100 * 1024 * 1024,
}

DEFAULT_LIMITS = {
    "login_account": (20, 60),
    "login_device": (60, 60),
    "register_account": (5, 300),
    "write_account": (60, 60),
    "file_account": (30, 60),
}
