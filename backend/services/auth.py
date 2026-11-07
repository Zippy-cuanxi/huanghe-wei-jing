# -*- coding: utf-8 -*-
"""AUTH-01 ~ AUTH-04：注册、登录、登出、会话态查询。"""

from __future__ import annotations

import sqlite3

from .. import db, idempotency
from ..audit import write_audit
from ..constants import (
    AUTHED_BASE_OPS,
    LOGIN_FAILURE_THRESHOLD,
    LOGIN_LOCK_SECONDS,
    PBKDF2_ITERATIONS,
    PUBLIC_OPS,
    ROLE_GATED_OPS,
    ROLES,
    SESSION_TTL_SECONDS,
)
from ..context import Actor, RequestContext
from ..errors import ApiError
from ..security import (
    credential_fingerprint,
    hash_credential,
    new_salt,
    request_hash,
    sha256_hex,
    verify_credential,
    dummy_verify,
)
from ..timeutil import add_seconds
from ..validation import (
    check_fields,
    ensure_account_id,
    ensure_credential,
    ensure_device_tag,
    ensure_optional_idempotency_key,
    ensure_session_handle,
    ensure_verify_token,
    get_bool,
    get_enum,
    get_string,
)


def _role_sort_key(role: str) -> int:
    return ROLES.index(role)


def load_roles(conn: sqlite3.Connection, account_pk: int) -> tuple[str, ...]:
    rows = conn.execute(
        "SELECT role_code FROM account_roles WHERE account_pk = ?", (account_pk,)
    ).fetchall()
    return tuple(sorted((r["role_code"] for r in rows), key=_role_sort_key))


def load_orgs(conn: sqlite3.Connection, account_pk: int) -> tuple[str, ...]:
    rows = conn.execute(
        "SELECT org_id FROM account_orgs WHERE account_pk = ?", (account_pk,)
    ).fetchall()
    return tuple(sorted(r["org_id"] for r in rows))


def build_profile(account: dict, roles: tuple[str, ...]) -> dict:
    return {
        "account_id": account["account_id"],
        "account_status": account["account_status"],
        "roles": list(roles),
    }


def build_permission_summary(roles: tuple[str, ...]) -> dict:
    allowed = set(PUBLIC_OPS) | set(AUTHED_BASE_OPS)
    for op, required_roles in ROLE_GATED_OPS.items():
        if set(roles) & required_roles:
            allowed.add(op)
    from ..constants import API_IDS

    return {
        "roles": list(roles),
        "permissions": [op for op in API_IDS if op in allowed],
    }


def authenticate(conn: sqlite3.Connection, session_handle: str | None, now_iso: str) -> tuple[Actor, sqlite3.Row]:
    handle = ensure_session_handle(session_handle)
    row = conn.execute(
        """
        SELECT s.id AS session_pk, s.session_status, s.expires_at,
               a.id AS account_pk, a.account_id, a.account_status
        FROM sessions s
        JOIN accounts a ON a.id = s.account_pk
        WHERE s.session_handle_hash = ?
        """,
        (sha256_hex(handle),),
    ).fetchone()
    if row is None:
        raise ApiError("AUTH_SESSION_INVALID", "会话无效或已注销")
    if row["session_status"] == "REVOKED":
        raise ApiError("AUTH_SESSION_REVOKED", "会话已注销，请重新登录")
    if now_iso >= row["expires_at"]:
        raise ApiError("AUTH_SESSION_EXPIRED", "会话已过期，请重新登录")
    if row["account_status"] != "ACTIVE":
        raise ApiError("AUTH_SESSION_REVOKED", "账号已停用，会话已失效")
    roles = load_roles(conn, row["account_pk"])
    org_ids = load_orgs(conn, row["account_pk"])
    actor = Actor(
        account_pk=row["account_pk"],
        account_id=row["account_id"],
        account_status=row["account_status"],
        roles=roles,
        org_ids=org_ids,
    )
    return actor, row


def register(app, conn: sqlite3.Connection, ctx: RequestContext, payload: dict, idem_key: str | None) -> dict:
    allowed = {"account_id", "credential", "verify_token", "agreement_accepted"}
    check_fields(payload, allowed, allowed)
    account_id = ensure_account_id(get_string(payload, "account_id", min_len=1, max_len=64))
    credential = get_string(payload, "credential", min_len=1, max_len=128)
    if credential is None:
        raise ApiError("PARAM_MISSING_FIELD", "缺少必填字段：credential")
    ensure_credential(credential)
    verify_token = ensure_verify_token(get_string(payload, "verify_token", min_len=1, max_len=32))
    agreement = get_bool(payload, "agreement_accepted")
    if not agreement:
        raise ApiError("PARAM_AGREEMENT_REQUIRED", "必须先同意用户协议")

    if not app.rate.consume(f"register:{account_id}", "register_account", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试", actor_hint={"account_id": account_id})

    key = ensure_optional_idempotency_key(idem_key)
    scope = idempotency.registration_scope(account_id)
    if key is not None:
        # 幂等指纹不包含 verify_token，且 credential 以强哈希代入，避免快速哈希覆盖低熵凭证。
        hash_payload = {
            "account_id": account_id,
            "credential_fingerprint": credential_fingerprint(account_id, credential),
            "agreement_accepted": True,
        }
        replay = idempotency.lookup(
            conn,
            scope_key=scope,
            api="AUTH-01",
            idem_key=key,
            request_hash=request_hash(hash_payload),
        )
        if replay is not None:
            ctx.replayed = True
            return replay.data

    if not app.verification.available:
        raise ApiError(
            "DEP_EXTERNAL_UNAVAILABLE",
            "验证服务暂不可用，请稍后重试",
            actor_hint={"account_id": account_id},
        )
    if not app.verification.verify(account_id, verify_token, ctx_now_datetime(ctx)):
        raise ApiError(
            "AUTH_VERIFY_FAILED",
            "验证凭证不正确或已失效",
            actor_hint={"account_id": account_id},
        )

    existing = conn.execute("SELECT id FROM accounts WHERE account_id = ?", (account_id,)).fetchone()
    if existing is not None:
        raise ApiError("AUTH_ACCOUNT_EXISTS", "账号已存在", actor_hint={"account_id": account_id})

    salt = new_salt()
    credential_hash = hash_credential(credential, salt, PBKDF2_ITERATIONS)
    data = {
        "account_id": account_id,
        "account_status": "ACTIVE",
        "default_role": "R1",
    }
    with db.transaction(conn):
        cur = conn.execute(
            """
            INSERT INTO accounts(
              account_id, credential_hash, credential_salt, credential_iterations,
              account_status, default_role, agreement_accepted, created_at
            ) VALUES (?, ?, ?, ?, 'ACTIVE', 'R1', 1, ?)
            """,
            (account_id, credential_hash, salt, PBKDF2_ITERATIONS, ctx.now),
        )
        account_pk = cur.lastrowid
        conn.execute(
            "INSERT INTO account_roles(account_pk, role_code, granted_by, granted_at) VALUES (?, 'R1', 'AUTH-01', ?)",
            (account_pk, ctx.now),
        )
        write_audit(
            conn,
            trace_id=ctx.trace_id,
            event_type="AUTH_REGISTER",
            outcome="SUCCESS",
            now=ctx.now,
            actor_account_id=account_id,
            actor_roles=("R1",),
            target_type="ACCOUNT",
            target_id=account_id,
            details={"default_role": "R1"},
        )
        if key is not None:
            idempotency.store(
                conn,
                scope_key=scope,
                api="AUTH-01",
                idem_key=key,
                request_hash=request_hash(hash_payload),
                code="OK",
                message="注册成功",
                data=data,
                now=ctx.now,
            )
    return data


def ctx_now_datetime(ctx: RequestContext):
    from ..timeutil import parse_iso

    return parse_iso(ctx.now)


def _record_login_failure(conn: sqlite3.Connection, account_id: str, ctx: RequestContext) -> None:
    with db.transaction(conn):
        row = conn.execute(
            "SELECT failed_count FROM login_attempts WHERE account_id_input = ?", (account_id,)
        ).fetchone()
        count = (int(row["failed_count"]) if row is not None else 0) + 1
        locked_until = None
        if count >= LOGIN_FAILURE_THRESHOLD:
            locked_until = add_seconds(ctx_now_datetime(ctx), LOGIN_LOCK_SECONDS)
        conn.execute(
            """
            INSERT INTO login_attempts(account_id_input, failed_count, last_failed_at, locked_until)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(account_id_input) DO UPDATE SET
              failed_count = excluded.failed_count,
              last_failed_at = excluded.last_failed_at,
              locked_until = excluded.locked_until
            """,
            (account_id, count, ctx.now, locked_until),
        )


def _reset_login_failures(conn: sqlite3.Connection, account_id: str) -> None:
    conn.execute(
        "UPDATE login_attempts SET failed_count = 0, locked_until = NULL WHERE account_id_input = ?",
        (account_id,),
    )


def login(app, conn: sqlite3.Connection, ctx: RequestContext, payload: dict) -> dict:
    allowed = {"account_id", "credential", "device_tag", "second_factor"}
    required = {"account_id", "credential", "device_tag"}
    check_fields(payload, allowed, required)
    account_id = ensure_account_id(get_string(payload, "account_id", min_len=1, max_len=64))
    # 登录不校验强度，避免旧凭证/边界输入产生额外泄露；只做类型与长度约束。
    credential = get_string(payload, "credential", min_len=1, max_len=128)
    if credential is None:
        raise ApiError("PARAM_MISSING_FIELD", "缺少必填字段：credential")
    device_tag = ensure_device_tag(get_string(payload, "device_tag", min_len=1, max_len=64))
    second_factor = get_string(payload, "second_factor", min_len=1, max_len=32, required=False)
    _ = second_factor  # T4 未确认：不实现二因子，也不记录其取值

    if not app.rate.consume(f"login:account:{account_id}", "login_account", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试", actor_hint={"account_id": account_id})
    if not app.rate.consume(f"login:device:{device_tag}", "login_device", ctx.now_epoch):
        raise ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试", actor_hint={"account_id": account_id})

    attempt = conn.execute(
        "SELECT failed_count, locked_until FROM login_attempts WHERE account_id_input = ?",
        (account_id,),
    ).fetchone()
    if attempt is not None and attempt["locked_until"]:
        if ctx.now < attempt["locked_until"]:
            raise ApiError(
                "AUTH_LOCKED",
                "尝试次数过多，请稍后再试",
                actor_hint={"account_id": account_id},
            )
        with db.transaction(conn):
            _reset_login_failures(conn, account_id)

    account = conn.execute(
        "SELECT * FROM accounts WHERE account_id = ?", (account_id,)
    ).fetchone()

    if account is None:
        dummy_verify(credential)
        _record_login_failure(conn, account_id, ctx)
        raise ApiError("AUTH_INVALID", "账号或凭证不正确", actor_hint={"account_id": account_id})

    if account["account_status"] != "ACTIVE":
        dummy_verify(credential)
        _record_login_failure(conn, account_id, ctx)
        raise ApiError("AUTH_INVALID", "账号或凭证不正确", actor_hint={"account_id": account_id})

    if not verify_credential(
        credential,
        account["credential_salt"],
        account["credential_hash"],
        int(account["credential_iterations"]),
    ):
        _record_login_failure(conn, account_id, ctx)
        raise ApiError("AUTH_INVALID", "账号或凭证不正确", actor_hint={"account_id": account_id})

    roles = load_roles(conn, account["id"])
    expires_at = add_seconds(ctx_now_datetime(ctx), SESSION_TTL_SECONDS)
    handle = app.ids.secret("sh_")
    data = {
        "session_handle": handle,
        "expires_at": expires_at,
        "account_profile": build_profile(dict(account), roles),
        "permission_summary": build_permission_summary(roles),
    }
    with db.transaction(conn):
        _reset_login_failures(conn, account_id)
        conn.execute(
            """
            INSERT INTO sessions(
              session_handle_hash, account_pk, device_tag, session_status, issued_at, expires_at
            ) VALUES (?, ?, ?, 'ACTIVE', ?, ?)
            """,
            (sha256_hex(handle), account["id"], device_tag, ctx.now, expires_at),
        )
        write_audit(
            conn,
            trace_id=ctx.trace_id,
            event_type="AUTH_LOGIN_SUCCESS",
            outcome="SUCCESS",
            now=ctx.now,
            actor_account_id=account_id,
            actor_roles=roles,
            target_type="ACCOUNT",
            target_id=account_id,
            details={"device_tag": device_tag},
        )
    return data


def logout(app, conn: sqlite3.Connection, ctx: RequestContext, session_handle: str | None, payload: dict) -> dict:
    check_fields(payload, {"scope"}, {"scope"})
    scope = get_enum(payload, "scope", ("CURRENT", "ALL"))
    handle = ensure_session_handle(session_handle)
    row = conn.execute(
        """
        SELECT s.id AS session_pk, s.account_pk, a.account_id
        FROM sessions s JOIN accounts a ON a.id = s.account_pk
        WHERE s.session_handle_hash = ?
        """,
        (sha256_hex(handle),),
    ).fetchone()

    if row is not None:
        roles = load_roles(conn, row["account_pk"])
        with db.transaction(conn):
            if scope == "CURRENT":
                cur = conn.execute(
                    """
                    UPDATE sessions SET session_status = 'REVOKED', revoked_at = ?
                    WHERE id = ? AND session_status = 'ACTIVE'
                    """,
                    (ctx.now, row["session_pk"]),
                )
            else:
                cur = conn.execute(
                    """
                    UPDATE sessions SET session_status = 'REVOKED', revoked_at = ?
                    WHERE account_pk = ? AND session_status = 'ACTIVE'
                    """,
                    (ctx.now, row["account_pk"]),
                )
            write_audit(
                conn,
                trace_id=ctx.trace_id,
                event_type="AUTH_LOGOUT",
                outcome="SUCCESS",
                now=ctx.now,
                actor_account_id=row["account_id"],
                actor_roles=roles,
                target_type="SESSION",
                target_id=str(row["session_pk"]),
                details={"scope": scope, "revoked_count": cur.rowcount},
            )
    return {"revoked": True}


def session_info(app, conn: sqlite3.Connection, ctx: RequestContext, session_handle: str | None, payload: dict | None = None) -> dict:
    check_fields(payload or {}, set(), set())
    actor, row = authenticate(conn, session_handle, ctx.now)
    account = conn.execute("SELECT * FROM accounts WHERE id = ?", (actor.account_pk,)).fetchone()
    return {
        "session_status": "ACTIVE",
        "account_profile": build_profile(dict(account), actor.roles),
        "permission_summary": build_permission_summary(actor.roles),
        "expires_at": row["expires_at"],
    }
