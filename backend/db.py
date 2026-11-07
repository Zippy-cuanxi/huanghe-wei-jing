# -*- coding: utf-8 -*-
"""参考持久化访问层（SQLite 标准库）。

T3 未确认：本层仅为自证与样例生成的参考实现，业务语义不依赖具体存储。
所有服务在明确事务边界内调用本层；审计与业务写入同事务提交。
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .constants import DEFAULT_CONFIGS
from .timeutil import iso, utc_now

_SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(db_path: str) -> sqlite3.Connection:
    # HTTP 适配层使用线程化服务器，并在应用层串行化所有业务调用；
    # 连接本身允许跨线程持有，但同一时刻只有一个 handle() 在读写。
    conn = sqlite3.connect(db_path, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    if db_path != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    schema = _SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema)
    now = iso(utc_now())
    for key, value in DEFAULT_CONFIGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO configs(key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)",
            (key, json.dumps(value, ensure_ascii=False), now, "SYSTEM_INIT"),
        )


@contextmanager
def transaction(conn: sqlite3.Connection):
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def get_config(conn: sqlite3.Connection, key: str, default=None):
    row = conn.execute("SELECT value_json FROM configs WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value_json"])
    except (TypeError, ValueError):
        return default


def set_config(conn: sqlite3.Connection, key: str, value, updated_by: str, now: str) -> None:
    conn.execute(
        """
        INSERT INTO configs(key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
        """,
        (key, json.dumps(value, ensure_ascii=False), now, updated_by),
    )


def row_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None
