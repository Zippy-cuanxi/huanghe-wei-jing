# -*- coding: utf-8 -*-
"""FILE-01：取上传凭证；媒体引用的归属与可用性校验。"""

from __future__ import annotations

import sqlite3

from .. import db, idempotency
from ..adapters import ExternalUnavailable
from ..audit import write_audit
from ..constants import MEDIA_SIZE_LIMITS, MEDIA_TYPES, UPLOAD_TICKET_TTL_SECONDS
from ..context import RequestContext
from ..errors import ApiError
from ..security import request_hash, sha256_hex
from ..timeutil import add_seconds, parse_iso
from ..validation import check_fields, ensure_checksum, ensure_optional_idempotency_key, get_int, get_string


def issue_ticket(app, conn: sqlite3.Connection, ctx: RequestContext, payload: dict, idem_key: str | None) -> dict:
    allowed = {"media_type", "size_bytes", "checksum"}
    check_fields(payload, allowed, allowed)
    media_type = get_string(payload, "media_type", min_len=1, max_len=32)
    if media_type not in MEDIA_TYPES:
        raise ApiError("PARAM_INVALID_MEDIA_TYPE", "媒体类型不受支持")
    size_bytes = get_int(payload, "size_bytes", min_value=1, required=True)
    checksum = ensure_checksum(get_string(payload, "checksum", min_len=1, max_len=128))
    limit = MEDIA_SIZE_LIMITS[media_type]
    if size_bytes is not None and size_bytes > limit:
        raise ApiError("PARAM_MEDIA_SIZE_EXCEEDED", "媒体大小超过该类型上限")

    actor = ctx.actor
    assert actor is not None
    if not app.rate.consume(f"file:{actor.account_pk}", "file_account", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试")

    key = ensure_optional_idempotency_key(idem_key)
    hash_input = {"media_type": media_type, "size_bytes": size_bytes, "checksum": checksum}
    scope = idempotency.account_scope(actor.account_pk)
    if key is not None:
        replay = idempotency.lookup(
            conn,
            scope_key=scope,
            api="FILE-01",
            idem_key=key,
            request_hash=request_hash(hash_input),
        )
        if replay is not None:
            # 幂等记录只保存 media_ref，不在库中保存凭证明文。
            # 回放时保持 media_ref 不变，重新签发限时凭证并作废旧凭证。
            media_ref = replay.data.get("media_ref")
            asset = conn.execute(
                "SELECT media_ref FROM media_assets WHERE media_ref = ? AND owner_account_pk = ?",
                (media_ref, actor.account_pk),
            ).fetchone()
            if asset is None:
                raise ApiError("PARAM_INVALID_VALUE", "媒体引用无效")
            new_ticket = app.ids.secret("up_")
            new_expires_at = add_seconds(parse_iso(ctx.now), UPLOAD_TICKET_TTL_SECONDS)
            with db.transaction(conn):
                conn.execute(
                    "UPDATE media_assets SET upload_ticket_hash = ?, ticket_expires_at = ? WHERE media_ref = ?",
                    (sha256_hex(new_ticket), new_expires_at, media_ref),
                )
                write_audit(
                    conn,
                    trace_id=ctx.trace_id,
                    event_type="MEDIA_TICKET_REISSUED",
                    outcome="SUCCESS",
                    now=ctx.now,
                    actor_account_id=actor.account_id,
                    actor_roles=actor.roles,
                    target_type="MEDIA",
                    target_id=media_ref,
                    details={"reason": "idempotent_replay"},
                )
            ctx.replayed = True
            return {
                "upload_ticket": new_ticket,
                "media_ref": media_ref,
                "expires_at": new_expires_at,
            }

    try:
        app.storage.ensure_available()
    except ExternalUnavailable:
        raise ApiError("DEP_EXTERNAL_UNAVAILABLE", "存储服务暂不可用，请稍后重试")

    upload_ticket = app.ids.secret("up_")
    media_ref = app.ids.public_id("med_")
    expires_at = add_seconds(parse_iso(ctx.now), UPLOAD_TICKET_TTL_SECONDS)
    data = {
        "upload_ticket": upload_ticket,
        "media_ref": media_ref,
        "expires_at": expires_at,
    }
    with db.transaction(conn):
        conn.execute(
            """
            INSERT INTO media_assets(
              media_ref, upload_ticket_hash, owner_account_pk, media_type,
              size_bytes, checksum, media_status, ticket_expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?)
            """,
            (
                media_ref,
                sha256_hex(upload_ticket),
                actor.account_pk,
                media_type,
                size_bytes,
                checksum,
                expires_at,
                ctx.now,
            ),
        )
        write_audit(
            conn,
            trace_id=ctx.trace_id,
            event_type="MEDIA_TICKET_ISSUED",
            outcome="SUCCESS",
            now=ctx.now,
            actor_account_id=actor.account_id,
            actor_roles=actor.roles,
            target_type="MEDIA",
            target_id=media_ref,
            details={"media_type": media_type, "size_bytes": size_bytes},
        )
        if key is not None:
            idempotency.store(
                conn,
                scope_key=scope,
                api="FILE-01",
                idem_key=key,
                request_hash=request_hash(hash_input),
                code="OK",
                message="上传凭证已签发",
                # 仅保存业务标识，不保存 upload_ticket 明文
                data={"media_ref": media_ref},
                now=ctx.now,
            )
    return data


def validate_owned_refs(
    conn: sqlite3.Connection,
    refs: list[str],
    owner_account_pk: int,
) -> None:
    """媒体引用必须存在、属于操作者、处于可用状态；统一失败文案，不区分原因。"""
    for ref in refs:
        row = conn.execute(
            "SELECT owner_account_pk, media_status FROM media_assets WHERE media_ref = ?",
            (ref,),
        ).fetchone()
        if row is None:
            raise ApiError("PARAM_INVALID_VALUE", "媒体引用无效")
        if int(row["owner_account_pk"]) != int(owner_account_pk):
            raise ApiError("PARAM_INVALID_VALUE", "媒体引用无效")
        if row["media_status"] not in ("RESERVED", "UPLOADED"):
            raise ApiError("PARAM_INVALID_VALUE", "媒体引用无效")
