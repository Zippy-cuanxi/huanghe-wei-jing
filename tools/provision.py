# -*- coding: utf-8 -*-
"""运维配给 CLI（非对外接口，全部写审计）。

本工具仅用于本侧自测与演示，弥补契约未提供「组织/角色/字典/合规配置写接口」的缺口
（见契约变更请求 CR-016）。生产配给流程须双方确认。

示例：
    python tools/provision.py set-coarsen --value 0.01
    python tools/provision.py set-audit-no --value "<授权审图号>" --confirm
    python tools/provision.py enable-leaderboard --verified-sample-size 30 --confirm
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import seed  # noqa: E402
from backend.app import BackendApp  # noqa: E402
from backend.timeutil import iso, utc_now  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(ROOT / "var" / "app.db"))
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add-org")
    p.add_argument("--org-id", required=True)
    p.add_argument("--name", required=True)

    p = sub.add_parser("add-section")
    p.add_argument("--section-id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--org", required=True)
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lng", type=float, required=True)

    p = sub.add_parser("add-category")
    p.add_argument("--code", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--description", default="")
    p.add_argument("--sort", type=int, default=100)

    p = sub.add_parser("add-scale")
    p.add_argument("--code", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--sort", type=int, default=100)

    p = sub.add_parser("grant-role")
    p.add_argument("--account", required=True)
    p.add_argument("--role", required=True)

    p = sub.add_parser("revoke-role")
    p.add_argument("--account", required=True)
    p.add_argument("--role", required=True)

    p = sub.add_parser("disable-account")
    p.add_argument("--account", required=True)

    p = sub.add_parser("set-coarsen")
    p.add_argument("--value", type=float, required=True)

    p = sub.add_parser("set-radius")
    p.add_argument("--value", type=float, required=True)

    p = sub.add_parser("set-min-sample")
    p.add_argument("--value", type=int, required=True)

    p = sub.add_parser("set-audit-no")
    p.add_argument("--value", required=True)
    p.add_argument("--confirm", action="store_true")

    p = sub.add_parser("clear-audit-no")
    p.add_argument("--confirm", action="store_true")

    p = sub.add_parser("enable-leaderboard")
    p.add_argument("--verified-sample-size", type=int, required=True)
    p.add_argument("--confirm", action="store_true")

    p = sub.add_parser("disable-leaderboard")
    p.add_argument("--confirm", action="store_true")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    app = BackendApp(str(db_path))
    now = iso(utc_now())
    trace = app.ids.trace_id()
    try:
        if args.cmd == "add-org":
            seed.add_org(app.conn, args.org_id, args.name, now, trace)
        elif args.cmd == "add-section":
            seed.add_section(app.conn, args.section_id, args.name, args.org,
                             args.lat, args.lng, now, trace)
        elif args.cmd == "add-category":
            seed.add_category(app.conn, args.code, args.label, args.description,
                              args.sort, now, trace)
        elif args.cmd == "add-scale":
            seed.add_scale_level(app.conn, args.code, args.label, args.sort, now, trace)
        elif args.cmd == "grant-role":
            seed.grant_role(app.conn, args.account, args.role, now, trace)
        elif args.cmd == "revoke-role":
            seed.revoke_role(app.conn, args.account, args.role, now, trace)
        elif args.cmd == "disable-account":
            seed.disable_account(app.conn, args.account, now, trace)
        elif args.cmd == "set-coarsen":
            seed.set_coarsen_degree(app.conn, args.value, now, trace)
        elif args.cmd == "set-radius":
            seed.set_section_radius(app.conn, args.value, now, trace)
        elif args.cmd == "set-min-sample":
            seed.set_min_publish_sample(app.conn, args.value, now, trace)
        elif args.cmd == "set-audit-no":
            seed.set_map_audit_no(app.conn, args.value, now, confirmed=args.confirm, trace_id=trace)
        elif args.cmd == "clear-audit-no":
            seed.set_map_audit_no(app.conn, None, now, confirmed=args.confirm, trace_id=trace)
        elif args.cmd == "enable-leaderboard":
            seed.enable_leaderboard(app.conn, enabled=True,
                                    verified_sample_size=args.verified_sample_size,
                                    now=now, confirmed=args.confirm, trace_id=trace)
        elif args.cmd == "disable-leaderboard":
            seed.enable_leaderboard(app.conn, enabled=False, verified_sample_size=0,
                                    now=now, confirmed=args.confirm, trace_id=trace)
        print(f"OK: {args.cmd}")
        return 0
    except (ValueError, sqlite3.IntegrityError) as exc:
        print(f"失败：{exc}", file=sys.stderr)
        return 1
    finally:
        app.close()


if __name__ == "__main__":
    sys.exit(main())
