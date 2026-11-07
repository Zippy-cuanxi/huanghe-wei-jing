# -*- coding: utf-8 -*-
"""业务配置读取与失效安全。

配置损坏时按最保守口径降级：
- 粗化度非法 -> 0.01（更粗，避免泄露精确点位）
- 审图号非法/缺失 -> null（MAP-01 不下发任何点位）
- 榜单校验不完整 -> 关闭
"""

from __future__ import annotations

import math
import sqlite3
from dataclasses import dataclass

from . import db
from .constants import (
    COARSEN_DEGREE_MAX,
    COARSEN_DEGREE_MIN,
    DEFAULT_CONFIGS,
    MAP_AUDIT_NO_MAX_LEN,
    SECTION_MATCH_RADIUS_MAX,
    SECTION_MATCH_RADIUS_MIN,
)


@dataclass(frozen=True)
class BusinessConfig:
    coarsen_degree: float
    map_audit_no: str | None
    leaderboard_enabled: bool
    min_publish_sample_size: int
    section_match_radius_km: float


def _finite_number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return number


def load_config(conn: sqlite3.Connection) -> BusinessConfig:
    coarsen = _finite_number(db.get_config(conn, "coarsen_degree", DEFAULT_CONFIGS["coarsen_degree"]))
    if coarsen is None or not (COARSEN_DEGREE_MIN <= coarsen <= COARSEN_DEGREE_MAX):
        coarsen = float(DEFAULT_CONFIGS["coarsen_degree"])

    audit_no = db.get_config(conn, "map_audit_no", None)
    if not isinstance(audit_no, str) or not audit_no.strip() or len(audit_no) > MAP_AUDIT_NO_MAX_LEN:
        audit_no = None
    else:
        audit_no = audit_no.strip()

    min_sample = db.get_config(conn, "min_publish_sample_size", 1)
    if isinstance(min_sample, bool) or not isinstance(min_sample, int) or min_sample < 1:
        min_sample = 1

    raw_enabled = db.get_config(conn, "leaderboard_enabled", False) is True
    verified = db.get_config(conn, "leaderboard_sample_verified", False) is True
    verified_size = db.get_config(conn, "leaderboard_verified_sample_size", 0)
    if isinstance(verified_size, bool) or not isinstance(verified_size, int):
        verified_size = 0
    leaderboard = bool(raw_enabled and verified and verified_size >= min_sample)

    radius = _finite_number(
        db.get_config(conn, "section_match_radius_km", DEFAULT_CONFIGS["section_match_radius_km"])
    )
    if radius is None or not (SECTION_MATCH_RADIUS_MIN <= radius <= SECTION_MATCH_RADIUS_MAX):
        radius = float(DEFAULT_CONFIGS["section_match_radius_km"])

    return BusinessConfig(
        coarsen_degree=coarsen,
        map_audit_no=audit_no,
        leaderboard_enabled=leaderboard,
        min_publish_sample_size=min_sample,
        section_match_radius_km=radius,
    )


def validate_coarsen_degree(value) -> float:
    number = _finite_number(value)
    if number is None or not (COARSEN_DEGREE_MIN <= number <= COARSEN_DEGREE_MAX):
        raise ValueError(f"coarsen_degree 必须在 {COARSEN_DEGREE_MIN}-{COARSEN_DEGREE_MAX} 之间")
    return number


def validate_map_audit_no(value) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > MAP_AUDIT_NO_MAX_LEN:
        raise ValueError("map_audit_no 必须是非空字符串且不超过 64 字符")
    return value.strip()


def validate_radius(value) -> float:
    number = _finite_number(value)
    if number is None or not (SECTION_MATCH_RADIUS_MIN <= number <= SECTION_MATCH_RADIUS_MAX):
        raise ValueError(f"section_match_radius_km 必须在 {SECTION_MATCH_RADIUS_MIN}-{SECTION_MATCH_RADIUS_MAX} 之间")
    return number


def validate_min_sample(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("min_publish_sample_size 必须是 >=1 的整数")
    return value
