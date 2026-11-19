"use client";
import { Playground } from "langgraph-kit";
import { GatewayAgents } from "./components/gateway-agents";

const gatewayMode = !!process.env.NEXT_PUBLIC_GATEWAY_URL;

export default function Page() {
  // Gateway mode: the customer wrapper lists the agents its publishable key may
  // use and chats with the chosen one (citations, handoff, feedback).
  // LangGraph mode keeps the original playground with thread history.
  if (gatewayMode) {
    return <GatewayAgents />;
  }
  return (
    <Playground
      suggestions={["What's the weather in Dar es Salaam?", "Take me to my orders"]}
    />
  );
}
