# -*- coding: utf-8 -*-
"""外部能力适配边界（B10）。

Q8/Q9/T8/T9/T10 未确认：本文件只定义可替换适配器与安全降级语义，
不接入任何具体外部服务，也不把外部能力作为业务受理的前置条件。
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime

from .constants import VERIFY_TOKEN_WINDOW_SECONDS


class ExternalUnavailable(Exception):
    pass


class VerificationAdapter:
    """注册验证码适配器（参考实现，仅用于本侧自测）。

    - 真实渠道（短信/邮箱/第三方）未确认，生产必须替换；
    - 令牌为 6 位数字，当前与上一个时间窗有效；
    - 不可用时注册返回 DEP_EXTERNAL_UNAVAILABLE，绝不跳过校验。
    """

    def __init__(self, secret: bytes = b"reference-only-verification-secret-v1", available: bool = True) -> None:
        self.secret = secret
        self.available = available

    def _window(self, at: datetime) -> int:
        return int(at.timestamp()) // VERIFY_TOKEN_WINDOW_SECONDS

    def _token_for_window(self, account_id: str, window: int) -> str:
        msg = f"verify:{account_id}:{window}".encode("utf-8")
        digest = hmac.new(self.secret, msg, hashlib.sha256).digest()
        return f"{int.from_bytes(digest[:8], 'big') % 1_000_000:06d}"

    def issue_token(self, account_id: str, at: datetime) -> str:
        return self._token_for_window(account_id, self._window(at))

    def verify(self, account_id: str, token: str, at: datetime) -> bool:
        if not self.available:
            return False
        window = self._window(at)
        for candidate_window in (window, window - 1):
            expected = self._token_for_window(account_id, candidate_window)
            if hmac.compare_digest(expected, token):
                return True
        return False


class AIAdapter:
    """AI 初判适配器（T9 未确认）。

    默认不可用：上报仍可受理，ai_status=UNAVAILABLE，人工审核不被绕过。
    """

    def __init__(self, available: bool = False, fixed_result: dict | None = None) -> None:
        self.available = available
        self.fixed_result = fixed_result

    def assess(self, *, media_refs: list[str], declared_category: str, declared_scale: str) -> dict:
        if not self.available:
            raise ExternalUnavailable("ai adapter not configured")
        if self.fixed_result is not None:
            return dict(self.fixed_result)
        raise ExternalUnavailable("ai adapter has no provider")


class StorageAdapter:
    """文件/对象存储适配器（T6 未确认）。

    参考实现只校验存储可用性并签发受限凭证；不产生真实上传地址。
    """

    def __init__(self, available: bool = True) -> None:
        self.available = available

    def ensure_available(self) -> None:
        if not self.available:
            raise ExternalUnavailable("storage adapter not configured")
