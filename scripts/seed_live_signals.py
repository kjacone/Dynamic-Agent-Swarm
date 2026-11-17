"""Install the Live Signals playbooks pack (free public-API workflows) for a tenant.

Idempotent: rerunning upgrades the installed pack in place and keeps the tenant's
prior installs intact.

Usage:
    .venv/bin/python scripts/seed_live_signals.py [--tenant default] [--actor demo@vela.local]
"""
import argparse
import asyncio

from sqlmodel import SQLModel

import nmb_marketplace_agent.config.models  # noqa: F401
from nmb_marketplace_agent.config.database import async_session, engine
from nmb_marketplace_agent.enterprise.solutions import loader


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", default="default")
    ap.add_argument("--actor", default="demo@vela.local")
    args = ap.parse_args()

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    async with async_session() as db:
        inst = await loader.install_solution(db, args.tenant, "live-signals", args.actor)

    print(f"installed live-signals {inst.version} for tenant '{args.tenant}'")
    print("tools:", ", ".join(sorted(inst.created["tools"])))
    for wf in inst.created["workflows"]:
        print(f"workflow: {wf['key']} v{wf['version']}")


if __name__ == "__main__":
    asyncio.run(main())
