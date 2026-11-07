# -*- coding: utf-8 -*-
"""坐标与岸段匹配（参考实现）。

硬规则：
- raw_lat/raw_lng 只上行、只落服务端库，永不出现在任何响应、样例响应或审计明细；
- 对外只输出 coarse_lat/coarse_lng，按 coarsen_degree 四舍五入到网格。
"""

from __future__ import annotations

import math


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def coarsen(value: float, degree: float) -> float:
    """四舍五入到粗化网格，保留 6 位小数，避免浮点尾差。"""
    if degree <= 0:
        raise ValueError("coarsen degree must be positive")
    snapped = math.floor(value / degree + 0.5) * degree
    return round(snapped, 6)


def nearest_section(lat: float, lng: float, sections: list[dict], radius_km: float) -> dict | None:
    best = None
    best_dist = None
    for s in sections:
        d = haversine_km(lat, lng, s["center_lat"], s["center_lng"])
        if d <= radius_km and (best is None or d < best_dist or (d == best_dist and s["section_id"] < best["section_id"])):
            best = s
            best_dist = d
    return best
