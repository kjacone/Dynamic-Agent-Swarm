import type { Message } from "@langchain/langgraph-sdk";
import { parsePartialJson } from "./lib/partial-json";

type Content = Message["content"];
type Block = {
  type?: string; text?: string; thinking?: string; reasoning?: string;
  summary?: { text?: string }[]; id?: string; name?: string; input?: unknown;
};

/** Messages whose id starts with this are stored in state but never shown. */
export const DO_NOT_RENDER_ID_PREFIX = "do-not-render-";
export const isHiddenMessage = (m: Message) => !!m.id?.startsWith(DO_NOT_RENDER_ID_PREFIX);

export function messageText(content: Content): string {
  if (typeof content === "string") return content;
  return (content as Block[])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/** Reasoning/"thinking" blocks from Anthropic, OpenAI and compatible providers. */
export function messageReasoning(content: Content): string {
  if (typeof content === "string") return "";
  return (content as Block[])
    .map((b) => {
      if (b.type === "thinking") return b.thinking ?? "";
      if (b.type === "reasoning") return b.reasoning ?? b.summary?.map((s) => s.text ?? "").join("") ?? "";
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export interface ToolCallLike { id?: string; name: string; args: Record<string, unknown> }

/**
 * Tool calls of an AI message. While Anthropic streams, `tool_calls` can be empty and the
 * call only exists as a partial `tool_use` content block, so fall back to parsing that.
 */
export function messageToolCalls(m: Message): ToolCallLike[] {
  if (m.type !== "ai") return [];
  const base = (m.tool_calls ?? []) as ToolCallLike[];
  if (base.some((tc) => tc.args && Object.keys(tc.args).length)) return base;
  if (!Array.isArray(m.content)) return base;
  const streamed = (m.content as Block[])
    .filter((b) => b.type === "tool_use" && b.id)
    .map((b) => {
      const parsed = typeof b.input === "string" ? parsePartialJson(b.input) : b.input;
      const args = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      return { id: b.id, name: b.name ?? "", args };
    });
  return streamed.length ? streamed : base;
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
