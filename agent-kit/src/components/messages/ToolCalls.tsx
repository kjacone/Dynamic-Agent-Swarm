"use client";
import type { ToolMessage } from "@langchain/langgraph-sdk";
import { messageText, type ToolCallLike } from "../../content";
import { useKit } from "../../provider";
import type { ToolStatus } from "../../types";
import { ExpandableText, KeyValueTable } from "../ui/KeyValueTable";
import { GenUi, uiSpecs } from "./GenUi";
import { listItems, ResultCards } from "./ResultCards";

const LABEL: Record<ToolStatus, string> = { running: "Running", done: "Done", error: "Failed", pending: "Not run" };

function parse(content: string): unknown {
  try { return JSON.parse(content); } catch { return content; }
}

/** A tool's output: a UI spec when it carries one, else cards, tables or clipped text. */
export function ToolOutput({ message }: { message: ToolMessage }) {
  const parsed = parse(messageText(message.content));
  const specs = uiSpecs(parsed);
  if (specs?.length) return <GenUi specs={specs} />;
  if (listItems(parsed)?.length) return <ResultCards value={parsed} />;
  if (parsed && typeof parsed === "object") {
    return <KeyValueTable data={parsed as Record<string, unknown> | unknown[]} maxRows={Array.isArray(parsed) ? 5 : undefined} />;
  }
  return <ExpandableText text={String(parsed)} />;
}

/**
 * One tool call with its input and (once it arrives) its result. A `render` registered
 * with `useAgentTool` replaces the default card.
 */
export function ToolCallCard({ call, result, status }: { call: ToolCallLike; result?: ToolMessage; status: ToolStatus }) {
  const { tools } = useKit();
  const custom = tools[call.name]?.render;
  if (custom) {
    return <div className="lgk-tool-custom">{custom({ name: call.name, args: call.args, status, result: result ? parse(messageText(result.content)) : undefined })}</div>;
  }
  const hasArgs = Object.keys(call.args ?? {}).length > 0;
  const resultItems = result ? listItems(parse(messageText(result.content))) : null;
  return (
    <details className="lgk-tool" data-status={status} open={status === "running" || status === "error" || !!resultItems?.length || undefined}>
      <summary>
        <span className="lgk-dot" aria-hidden />
        <code>{call.name}</code>
        <span className="lgk-tool-status">{LABEL[status]}</span>
      </summary>
      <div className="lgk-tool-body">
        <h4>Input</h4>
        {hasArgs ? <KeyValueTable data={call.args} /> : <code className="lgk-inline-code">{"{}"}</code>}
        {result && (<><h4>Output</h4><ToolOutput message={result} /></>)}
      </div>
    </details>
  );
}

/** A tool result with no matching call in the thread. */
export function OrphanToolResult({ message }: { message: ToolMessage }) {
  return (
    <details className="lgk-tool" data-status="done">
      <summary><span className="lgk-dot" aria-hidden /><code>{message.name ?? "tool result"}</code><span className="lgk-tool-status">Result</span></summary>
      <div className="lgk-tool-body"><ToolOutput message={message} /></div>
    </details>
  );
}
