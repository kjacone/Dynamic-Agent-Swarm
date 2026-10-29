import { initApiPassthrough } from "langgraph-nextjs-api-passthrough";

/**
 * Production proxy: the browser talks to /api, this route adds your LangSmith key on the
 * server. Point <LangGraphKitProvider apiUrl="https://your-site.com/api" /> at it.
 *
 * WARNING: this does NOT authenticate your callers. Anyone who can reach this route can
 * read and delete every thread and start runs billed to you. Before deploying, add custom
 * auth on your LangGraph deployment (or your own session check here) and keep the key
 * server-side. See "Going to production" in the agent-chat-ui README.
 */
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, runtime } = initApiPassthrough({
  apiUrl: process.env.LANGGRAPH_API_URL ?? "remove-me",
  apiKey: process.env.LANGSMITH_API_KEY ?? "remove-me",
  runtime: "edge",
});
