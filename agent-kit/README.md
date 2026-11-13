# langgraph-kit

A CopilotKit-style React layer for any **LangGraph API** server (`langgraph dev`, LangGraph Platform, or self-hosted `langgraph-api`). Built on `@langchain/langgraph-sdk`, with an [agent-ui](https://github.com/agno-agi/agent-ui)-style playground.

| You get | What it is |
|---|---|
| `<LangGraphKitProvider>` | Connection (URL, assistant, token), thread state, tool and readable registries |
| `<Playground>` | Full workspace like agent-ui: endpoint, auth, agent picker, chat history, streaming chat |
| `<ChatSidebar>` / `<ChatPopup>` / `<Chat>` | Drop-in chat surfaces for your own app |
| `useAgentTool` | **Frontend actions**: the agent calls a function in the browser, and can render a custom card for any tool call |
| `useAgentReadable` | Share app state with the agent (like `useCopilotReadable`) |
| `useAgent` | Headless hook (messages, `send`, `stop`, interrupts, threads) if you build your own UI |
| `useAssistants`, `useThreads` | Lists from the server |

Streaming, tool calls and results, reasoning blocks, markdown, human-in-the-loop interrupts, thread history, light/dark theme.

## Install

```bash
npm install langgraph-kit @langchain/langgraph-sdk react react-dom
```
```tsx
import "langgraph-kit/styles.css";
```

## Usage

```tsx
// layout: wrap once
<LangGraphKitProvider apiUrl="http://localhost:2024" assistantId="agent">{children}</LangGraphKitProvider>

// 1) standalone workspace
<Playground suggestions={["Take me to my orders"]} />

// 2) copilot next to your app
useAgentReadable("Orders page filter", { filter });          // agent can see this
useAgentTool({ name: "navigate", handler: ({ path }) => { router.push(path); return { ok: true }; } });

<ChatSidebar title="Orders assistant"><YourApp /></ChatSidebar>

// 3) floating widget
<ChatPopup title="Help" />
```
Full Next.js examples are in `examples/next-app`.

### Provider props
`apiUrl`, `assistantId` (UUID or graph id), `token` + `authScheme` (`"bearer"` default or `"api-key"` for `X-Api-Key`), `headers`, `threadId` / `onThreadIdChange` (controlled thread, e.g. for URL sync), `configurable` (extra `config.configurable` on every run), `persistKey` (remember connection in localStorage).

### NMB gateway mode (no LangGraph server)

```tsx
<LangGraphKitProvider
  gateway={{ baseUrl: "https://agents.bank.co", publishableKey: "pk_live_…", userId: currentUser.id }}
>
  <ChatPopup title="NMB Assist" />
</LangGraphKitProvider>
```

The kit exchanges the publishable key for a short-lived session at `/v1/session`, streams `/v1/chat` over SSE through the SDK's custom transport, and adds:

- `agent.sources` — citations rendered under the last reply.
- `agent.handoff`, `agent.requestHuman(reason?)`, `agent.handoffMessages` — human handoff and staff replies.
- `agent.feedback("up" | "down")` — sends `/v1/feedback`.
- `useAgentReadable` values and per-send `context` are forwarded as fenced host-app context; the gateway screens them with the tenant policy.

Gateway mode does not support graph commands (frontend-tool resumes), thread history or branching yet. Only ever ship a `pk_` key to the browser; allow your site origin in the gateway's `CORS_ORIGINS` and in `connect-src` / `script-src`.

### Custom tool UI
```tsx
useAgentTool({ name: "get_weather", render: ({ args, status, result }) => <WeatherCard {...} /> });
```
`render` works for server-side tools too. Without it, tool calls show as a collapsible card with input and output.

### Theming
Override CSS variables on `.lgk`: `--lgk-accent`, `--lgk-bg`, `--lgk-panel`, `--lgk-ink`, `--lgk-line`, `--lgk-radius`, `--lgk-font`. Dark mode follows `prefers-color-scheme`, or set `data-theme="dark|light"` on `<html>`.

## Backend contract

Your graph needs a `messages` key in state. Everything else is opt-in. See `examples/backend/agent.py` for a working graph.

- **Readables**: arrive as `config["configurable"]["readables"]` = `[{description, value}]`. Sent on every run, including the resume after a frontend tool.
- **Frontend tools**: declare the tool schema on the server so the model can call it, then when the model calls it, pause with
  ```python
  reply = interrupt({"type": "tool", "tool_call": {"id": call["id"], "name": call["name"], "args": call["args"]}})
  value = reply.get(call["id"], reply)   # resume value is {tool_call_id: result}
  ```
  The browser runs your `useAgentTool` handler and resumes. If the handler throws, the graph receives `{"error": "..."}`.
- **Human-in-the-loop**: any other `interrupt(...)` shows a card in the chat. Customize with `<Chat renderInterrupt={({ value, resume }) => ...} />`.
- **Reasoning**: `thinking` / `reasoning` content blocks render in a collapsible "Reasoning" section.

Run the example: `cd examples/backend && pip install "langgraph-cli[inmem]" langchain langchain-openai && langgraph dev`.

## Production notes
- **Don't ship a long-lived API key to the browser.** Point `apiUrl` at a proxy of your own that adds credentials server-side (agent-chat-ui uses `langgraph-nextjs-api-passthrough` for this), or use the graph's custom auth with per-user tokens.
- **CORS**: for deployed servers allow your origin under `http.cors` in `langgraph.json` (see the example).
- `persistKey` stores the token in localStorage. Fine for a dev playground, not for end users.

## Behavior to know about
- Call `useAgent` once per tree (`Chat`, `ChatPopup`, `ChatSidebar` and `Playground` each call it). Two chats at once means two streams.
- `useAgentTool` keeps the latest `handler` closure, but a `render` closure that depends on local state won't re-render the chat. Read state from the tool's `args` / `result` instead.
- Frontend tools run when the stream is idle, then resume with your readables attached. The SDK's built-in `tools` option is deliberately not used, because it resumes while the previous stream is still open and cannot pass `config`.
- Targets `@langchain/langgraph-sdk` 1.x.
