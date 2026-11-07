# -*- coding: utf-8 -*-
"""凭证、令牌与标识生成（参考实现）。

T4 未确认：此处 PBKDF2-HMAC-SHA256 / 随机会话句柄仅为参考实现，
不构成认证机制选型结论。凭证与句柄只以哈希形式落库。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets

from .constants import CREDENTIAL_SALT_BYTES, PBKDF2_ITERATIONS


def new_salt() -> str:
    return secrets.token_hex(CREDENTIAL_SALT_BYTES)


def hash_credential(credential: str, salt_hex: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        credential.encode("utf-8"),
        bytes.fromhex(salt_hex),
        iterations,
    )
    return dk.hex()


def verify_credential(
    credential: str,
    salt_hex: str,
    expected_hash: str,
    iterations: int = PBKDF2_ITERATIONS,
) -> bool:
    actual = hash_credential(credential, salt_hex, iterations)
    return hmac.compare_digest(actual, expected_hash)


_DUMMY_SALT = "00" * CREDENTIAL_SALT_BYTES
_DUMMY_HASH = hash_credential("__dummy_credential_for_timing__", _DUMMY_SALT)


def dummy_verify(credential: str) -> None:
    """对不存在的账号也执行一次等价开销，降低时间侧信道差异。"""
    verify_credential(credential, _DUMMY_SALT, _DUMMY_HASH)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def credential_fingerprint(account_id: str, credential: str) -> str:
    """用于注册接口幂等指纹：不让快速哈希直接覆盖低熵凭证。

    以 account_id 派生盐，使用与凭证存储同强度的 PBKDF2，再参与请求哈希。
    该值本身不落库，只作为请求哈希的输入。
    """
    salt = hashlib.sha256(f"idem:{account_id}".encode("utf-8")).digest()
    dk = hashlib.pbkdf2_hmac("sha256", credential.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return dk.hex()


def canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def request_hash(payload: dict) -> str:
    return sha256_hex(canonical_json(payload))


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(str(a), str(b))


class IdFactory:
    """random（默认）用于运行；deterministic 仅用于可复现的权威样例生成。"""

    def __init__(self, deterministic: bool = False) -> None:
        self.deterministic = deterministic
        self._counter = 0

    def _next_counter(self) -> int:
        self._counter += 1
        return self._counter

    def public_id(self, prefix: str) -> str:
        if self.deterministic:
            n = self._next_counter()
            return f"{prefix}{n:012x}"
        return f"{prefix}{secrets.token_hex(6)}"

    def secret(self, prefix: str, nbytes: int = 32) -> str:
        if self.deterministic:
            n = self._next_counter()
            digest = hmac.new(
                b"reference-sample-ids",
                f"{prefix}:{n}".encode("utf-8"),
                hashlib.sha256,
            ).digest()
            token = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
            return prefix + token
        return prefix + secrets.token_urlsafe(nbytes)

    def trace_id(self) -> str:
        if self.deterministic:
            n = self._next_counter()
            return f"{n:032x}"[-32:]
        return secrets.token_hex(16)
