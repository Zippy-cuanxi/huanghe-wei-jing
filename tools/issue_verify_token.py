# -*- coding: utf-8 -*-
"""签发参考注册验证码（仅参考验证适配器/自测使用）。

真实短信/邮箱/第三方验证渠道未确认（T10/B10），生产必须替换该适配器。
令牌为 6 位数字，当前与上一时间窗有效（每窗 10 分钟）。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.adapters import VerificationAdapter  # noqa: E402
from backend.timeutil import parse_iso, utc_now  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--at", default=None, help="可选：固定时刻（ISO UTC），用于复现")
    args = parser.parse_args()

    adapter = VerificationAdapter()
    at = parse_iso(args.at) if args.at else utc_now()
    token = adapter.issue_token(args.account_id, at)
    print(f"account_id={args.account_id} verify_token={token}")
    print("注意：仅参考验证适配器有效；令牌限时，生产渠道待 T10/B10 确认。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
