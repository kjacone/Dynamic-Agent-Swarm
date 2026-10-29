"use client";
import { Playground } from "langgraph-kit";

// 1) Standalone workspace, like agent-ui: endpoint, auth, agent picker, history, chat.
export default function Page() {
  return <Playground suggestions={["What's the weather in Dar es Salaam?", "Take me to my orders"]} />;
}
