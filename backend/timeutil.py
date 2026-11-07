# -*- coding: utf-8 -*-
"""时间口径（参考实现）。

- 对外时间统一 ISO-8601 UTC：YYYY-MM-DDTHH:MM:SSZ（T12 未确认，作为参考口径）。
- `period` 支持两种取值：
    * YYYY-MM       自然月
    * YYYY-Www      ISO 周（周一 00:00 UTC 起）
  该格式为参考实现定义，T12 确认后由契约变更同步。
"""

from __future__ import annotations

import calendar
import re
from datetime import date, datetime, timedelta, timezone

from .errors import ApiError

ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_WEEK_RE = re.compile(r"^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$")


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


class Clock:
    def now(self) -> datetime:
        return utc_now()


class FixedClock(Clock):
    """测试/样例用固定时钟，可前进后再固定。"""

    def __init__(self, value: datetime | str) -> None:
        if isinstance(value, str):
            value = datetime.strptime(value, ISO_FORMAT).replace(tzinfo=timezone.utc)
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        self._value = value.replace(microsecond=0)

    def now(self) -> datetime:
        return self._value

    def advance(self, seconds: int) -> None:
        self._value = self._value + timedelta(seconds=seconds)

    def set(self, value: datetime | str) -> None:
        if isinstance(value, str):
            value = datetime.strptime(value, ISO_FORMAT).replace(tzinfo=timezone.utc)
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        self._value = value.replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime(ISO_FORMAT)


def add_seconds(dt: datetime, seconds: int) -> str:
    return iso(dt + timedelta(seconds=seconds))


def parse_iso(value: str) -> datetime:
    return datetime.strptime(value, ISO_FORMAT).replace(tzinfo=timezone.utc)


def parse_period(period: str) -> tuple[str, str]:
    """返回 [start_iso, end_iso)；非法格式一律 PARAM_INVALID_PERIOD。"""
    if not isinstance(period, str):
        raise ApiError("PARAM_INVALID_PERIOD", "统计周期格式不合法，请使用 YYYY-MM 或 YYYY-Www")

    m = _MONTH_RE.match(period)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        start = datetime(year, month, 1, tzinfo=timezone.utc)
        if month == 12:
            end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
        return iso(start), iso(end)

    m = _WEEK_RE.match(period)
    if m:
        year, week = int(m.group(1)), int(m.group(2))
        try:
            monday = date.fromisocalendar(year, week, 1)
        except ValueError:
            raise ApiError("PARAM_INVALID_PERIOD", "统计周期格式不合法，请使用 YYYY-MM 或 YYYY-Www")
        start = datetime(monday.year, monday.month, monday.day, tzinfo=timezone.utc)
        end = start + timedelta(days=7)
        return iso(start), iso(end)

    raise ApiError("PARAM_INVALID_PERIOD", "统计周期格式不合法，请使用 YYYY-MM 或 YYYY-Www")


def period_of_now(dt: datetime) -> str:
    """测试辅助：当前时刻所属自然月。"""
    return f"{dt.year:04d}-{dt.month:02d}"


def month_bounds(year: int, month: int) -> tuple[str, str]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    last_day = calendar.monthrange(year, month)[1]
    end = start + timedelta(days=last_day)
    return iso(start), iso(end)
