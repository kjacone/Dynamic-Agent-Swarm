"use client";
import { createContext, useContext } from "react";
import type { useAgent } from "./use-agent";

export type AgentApi = ReturnType<typeof useAgent>;

export const AgentContext = createContext<AgentApi | null>(null);

/**
 * The agent that the surrounding <Chat> is driving. Use it inside custom tool cards,
 * interrupt UIs and generative-UI components, e.g. to call `send()` from a button.
 */
export function useAgentContext(): AgentApi {
  const v = useContext(AgentContext);
  if (!v) throw new Error("langgraph-kit: useAgentContext must be used inside <Chat> (or Playground / ChatPopup / ChatSidebar)");
  return v;
}
