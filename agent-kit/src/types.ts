import type { ReactNode } from "react";

export type ToolStatus = "running" | "done" | "error" | "pending";

export interface ToolRenderProps<A = any, R = unknown> {
  name: string;
  args: A;
  status: ToolStatus;
  /** Parsed tool output once the tool has finished. */
  result?: R;
}

/**
 * A tool the UI knows about.
 * - with `handler`: runs in the browser when the graph interrupts with a
 *   headless tool call (frontend action).
 * - with `render`: draws a custom card for that tool call in the chat
 *   (works for server-side tools too).
 */
export interface AgentToolDefinition<A = any, R = unknown> {
  name: string;
  handler?: (args: A) => R | Promise<R>;
  render?: (props: ToolRenderProps<A, R>) => ReactNode;
}

export interface Connection {
  /** LangGraph API base URL, e.g. http://localhost:2024 */
  apiUrl: string;
  /** Assistant UUID or graph id (e.g. "agent"). */
  assistantId: string;
  /** Optional auth token. Sent as Bearer by default. */
  token?: string;
  /**
   * bearer: `Authorization: Bearer <token>` (custom auth on your own server)
   * api-key: `X-Api-Key: <token>` (LangSmith / LangGraph Platform)
   * agent-builder: `X-Api-Key` plus `X-Auth-Scheme: langsmith-api-key`
   */
  authScheme?: "bearer" | "api-key" | "agent-builder";
  /** Extra headers on every request. */
  headers?: Record<string, string>;
}

export interface Readable {
  description: string;
  value: unknown;
}

export type ConnectionStatus = "idle" | "checking" | "ok" | "error";
