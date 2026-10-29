"""Target graph for AsyncSubAgent(graph_id='researcher')."""
from langchain_core.runnables import RunnableConfig

from deepagents import create_deep_agent
from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.subagents.defaults import RESEARCHER_PROMPT
from nmb_marketplace_agent.tools.builtin.search import tavily_search


def make_researcher_graph(config: RunnableConfig):
    return create_deep_agent(
        model=settings.main_model,
        tools=[tavily_search],
        system_prompt=RESEARCHER_PROMPT,
    )
