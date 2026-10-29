import os

from langchain_core.tools import tool

_client = None


def _get_client():
    global _client
    if _client is None:
        from tavily import TavilyClient
        _client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])
    return _client


@tool
def tavily_search(query: str, max_results: int = 5) -> str:
    """Search the web for current information."""
    res = _get_client().search(query=query, max_results=max_results)
    return "\n\n---\n\n".join(
        f"{r['title']}\n{r['url']}\n{r['content']}" for r in res["results"]
    )
