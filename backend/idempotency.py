# -*- coding: utf-8 -*-
"""幂等受理。

- 作用域：账号（或注册场景的目标账号）+ 接口编号 + 幂等键；
- 同键同内容：返回首次结果，不重复产生业务记录；
- 同键不同内容：PARAM_IDEMPOTENCY_KEY_REUSED；
- 幂等记录与业务写入同事务提交。
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

from .errors import ApiError


@dataclass
class Replay:
    code: str
    message: str
    data: dict


def lookup(
    conn: sqlite3.Connection,
    *,
    scope_key: str,
    api: str,
    idem_key: str,
    request_hash: str,
) -> Replay | None:
    row = conn.execute(
        """
        SELECT request_hash, response_code, response_message, response_data_json
        FROM idempotency_records
        WHERE scope_key = ? AND api = ? AND idem_key = ?
        """,
        (scope_key, api, idem_key),
    ).fetchone()
    if row is None:
        return None
    if row["request_hash"] != request_hash:
        raise ApiError(
            "PARAM_IDEMPOTENCY_KEY_REUSED",
            "同一幂等键被用于不同请求内容，请使用新的幂等键",
        )
    return Replay(
        code=row["response_code"],
        message=row["response_message"],
        data=json.loads(row["response_data_json"]),
    )


def store(
    conn: sqlite3.Connection,
    *,
    scope_key: str,
    api: str,
    idem_key: str,
    request_hash: str,
    code: str,
    message: str,
    data: dict,
    now: str,
) -> None:
    conn.execute(
        """
        INSERT INTO idempotency_records(
          scope_key, api, idem_key, request_hash, response_code,
          response_message, response_data_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            scope_key,
            api,
            idem_key,
            request_hash,
            code,
            message,
            json.dumps(data, ensure_ascii=False),
            now,
        ),
    )


def account_scope(account_pk: int) -> str:
    return f"acct:{account_pk}"


def registration_scope(account_id: str) -> str:
    return f"reg:{account_id}"
