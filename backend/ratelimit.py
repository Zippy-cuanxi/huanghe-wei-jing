# -*- coding: utf-8 -*-
"""限流（参考实现）。

- 固定窗口计数落库，跨进程/重启仍生效；
- 仅对可识别主体的操作限流（登录按 account_id 输入、写操作按账号）；
- 匿名公共读在 T2/T11 传输身份未确定前不做主体级限流，避免误伤全部公众。
"""

from __future__ import annotations

import sqlite3

from .constants import DEFAULT_LIMITS


class RateLimiter:
    def __init__(self, conn: sqlite3.Connection, limits: dict | None = None) -> None:
        self.conn = conn
        self.limits = dict(DEFAULT_LIMITS)
        if limits:
            self.limits.update(limits)
        self._calls = 0

    def consume(self, bucket_key: str, limit_name: str, now_epoch: int) -> bool:
        limit, window = self.limits[limit_name]
        window_start = now_epoch - (now_epoch % int(window))
        row = self.conn.execute(
            "SELECT count FROM rate_limit_windows WHERE bucket_key = ? AND window_start = ?",
            (bucket_key, window_start),
        ).fetchone()
        current = int(row["count"]) if row is not None else 0
        if current >= int(limit):
            return False
        self.conn.execute(
            """
            INSERT INTO rate_limit_windows(bucket_key, window_start, count)
            VALUES (?, ?, 1)
            ON CONFLICT(bucket_key, window_start)
            DO UPDATE SET count = count + 1
            """,
            (bucket_key, window_start),
        )
        self._calls += 1
        if self._calls % 100 == 0:
            self.conn.execute(
                "DELETE FROM rate_limit_windows WHERE window_start < ?",
                (now_epoch - 86400,),
            )
        return True

    def retry_after(self, limit_name: str, now_epoch: int) -> int:
        _, window = self.limits[limit_name]
        return int(window) - (now_epoch % int(window))
