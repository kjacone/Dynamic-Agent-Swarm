import type { Message, ToolMessage } from "@langchain/langgraph-sdk";
import { DO_NOT_RENDER_ID_PREFIX, newId } from "../content";

export { DO_NOT_RENDER_ID_PREFIX };

/**
 * Providers reject a conversation where an AI tool call has no tool result. If the user
 * types while a call is unanswered (a pending approval, a stopped run), answer it with a
 * hidden placeholder so the next run is valid.
 */
export function ensureToolCallsHaveResponses(messages: Message[]): Message[] {
  const answered = new Set(
    messages.filter((m) => m.type === "tool").map((m) => (m as ToolMessage).tool_call_id),
  );
  const out: ToolMessage[] = [];
  for (const m of messages) {
    if (m.type !== "ai") continue;
    for (const tc of m.tool_calls ?? []) {
      if (!tc.id || answered.has(tc.id)) continue;
      out.push({
        type: "tool",
        tool_call_id: tc.id,
        id: `${DO_NOT_RENDER_ID_PREFIX}${newId()}`,
        name: tc.name,
        content: "Successfully handled tool call.",
      });
    }
  }
  return out;
}
