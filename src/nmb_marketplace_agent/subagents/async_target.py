"""Target graph for AsyncSubAgent(graph_id='researcher')."""
from deepagents import create_deep_agent
from langchain_core.runnables import RunnableConfig

from nmb_marketplace_agent.checkpoint_store import install_checkpoint_encryption
from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.enterprise.hooks import guard_agent_tools
from nmb_marketplace_agent.subagents.defaults import RESEARCHER_PROMPT
from nmb_marketplace_agent.tools.builtin.search import tavily_search

install_checkpoint_encryption()  # Aegra loads graph modules after the checkpointer exists


async def make_researcher_graph(config: RunnableConfig):
    install_checkpoint_encryption()
    cfgurable = (config or {}).get("configurable", {}) or {}
    tenant_id = cfgurable.get("tenant_id")
    if not tenant_id:
        # Fail closed: never run a researcher graph with an ambiguous tenant.
        # Invoked via AsyncSubAgent from the supervisor this is always present;
        # a direct LangGraph API call without it is a misconfiguration.
        raise ValueError(
            "researcher graph requires configurable.tenant_id; "
            "invoke it via the supervisor, or pass tenant_id explicitly"
        )
    subagent_id = cfgurable.get("subagent_id", "researcher")

    tools = await guard_agent_tools([tavily_search], tenant_id, subagent_id)

    return create_deep_agent(
        model=settings.main_model,
        tools=tools,
        system_prompt=RESEARCHER_PROMPT,
    )