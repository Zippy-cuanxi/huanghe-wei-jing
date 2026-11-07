# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Actor:
    account_pk: int
    account_id: str
    account_status: str
    roles: tuple[str, ...]
    org_ids: tuple[str, ...]

    def has_role(self, role: str) -> bool:
        return role in self.roles

    def has_any_role(self, roles: set[str] | tuple[str, ...]) -> bool:
        return bool(set(self.roles) & set(roles))


@dataclass
class RequestContext:
    trace_id: str
    api: str
    now: str
    now_epoch: int
    actor: Actor | None = None
    replayed: bool = False
    extra: dict = field(default_factory=dict)
