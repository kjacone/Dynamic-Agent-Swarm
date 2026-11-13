"use client";
import { ChatPopup, Playground } from "langgraph-kit";

const gatewayMode = !!process.env.NEXT_PUBLIC_GATEWAY_URL;

export default function Page() {
  // Gateway mode: the copilot talks to /v1/session + /v1/chat (citations, handoff,
  // feedback). LangGraph mode keeps the original playground with thread history.
  if (gatewayMode) {
    return (
      <ChatPopup
        defaultOpen
        title="NMB Service Assistant"
        suggestions={["Why is my bill higher this month?", "What is the status of ticket 48213?"]}
      />
    );
  }
  return (
    <Playground
      suggestions={["What's the weather in Dar es Salaam?", "Take me to my orders"]}
    />
  );
}
