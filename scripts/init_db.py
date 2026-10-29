import asyncio

from nmb_marketplace_agent.config.database import init_db

if __name__ == "__main__":
    asyncio.run(init_db())
    print("DB initialized.")