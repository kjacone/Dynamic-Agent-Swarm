"use client";
import type { Message, ToolMessage } from "@langchain/langgraph-sdk";
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";
import type { ComponentType } from "react";
import { useAgentContext } from "../../agent-context";
import { useArtifact } from "../../artifact";
import { messageReasoning, messageText, messageToolCalls } from "../../content";
import type { GatewaySource } from "../../gateway";
import type { ToolStatus } from "../../types";
import { Markdown, type MarkdownOptions } from "../Markdown";
import { RefreshIcon } from "../ui/icons";
import { IconButton } from "../ui/IconButton";
import { BranchSwitcher, CopyButton } from "./MessageControls";
import { ToolCallCard } from "./ToolCalls";

/** Components the graph's generative-UI (`ui`) messages are rendered with, keyed by name. */
export type UiComponents = Record<string, ComponentType<any>>;

function GenerativeUi({ message, components }: { message: Message; components?: UiComponents }) {
  const agent = useAgentContext();
  const artifact = useArtifact();
  const items = agent.ui.filter((u) => u.metadata?.message_id === message.id);
  if (!items.length) return null;
  return (
    <>
      {items.map((u) => (
        <LoadExternalComponent
          key={u.id}
          stream={agent.stream as never}
          message={u}
          meta={{ ui: u, artifact }}
          components={components as never}
        />
      ))}
    </>
  );
}

export function AssistantMessage({
  message, results, loading, hideToolCalls, branching = true, copy = true, uiComponents, markdown,
  sources, feedback,
}: {
  message: Message;
  /** Tool results by `tool_call_id`. */
  results: Map<string, ToolMessage>;
  /** True while this is the message currently streaming. */
  loading: boolean;
  hideToolCalls?: boolean;
  branching?: boolean;
  copy?: boolean;
  uiComponents?: UiComponents;
  markdown?: MarkdownOptions;
  /** Gateway citations for this reply. */
  sources?: GatewaySource[];
  /** Gateway feedback controls for the last reply. */
  feedback?: { sent: "up" | "down" | null; onRate: (rating: "up" | "down") => void };
}) {
  const agent = useAgentContext();
  const text = messageText(message.content);
  const reasoning = messageReasoning(message.content);
  const calls = messageToolCalls(message);
  const hasUi = agent.ui.some((u) => u.metadata?.message_id === message.id);
  if (!text && !reasoning && !calls.length && !hasUi) return null;

  const { branch, branchOptions, parentCheckpoint } = branching ? agent.getBranch(message) : {};
  const busy = agent.isLoading;

  return (
    <div className="lgk-msg lgk-ai">
      {reasoning && (
        <details className="lgk-reasoning">
          <summary>Reasoning</summary>
          <p>{reasoning}</p>
        </details>
      )}
      {text && <Markdown {...markdown}>{text}</Markdown>}
      {sources && sources.length > 0 && (
        <div className="lgk-sources" aria-label="Sources">
          <span className="lgk-sources-label">Sources</span>
          {sources.map((s, i) => (
            <span className="lgk-source" key={`${s.id ?? i}`}>
              <b>{s.id ?? i + 1}</b> {s.title}{s.page ? ` · p. ${s.page}` : ""}
            </span>
          ))}
        </div>
      )}
      {!hideToolCalls && calls.map((c, i) => {
        const res = c.id ? results.get(c.id) : undefined;
        const status: ToolStatus = res
          ? (res.status === "error" ? "error" : "done")
          : loading || (c.id && agent.pendingToolCallIds.includes(c.id)) ? "running" : "pending";
        return <ToolCallCard key={c.id ?? i} call={c} result={res} status={status} />;
      })}
      <GenerativeUi message={message} components={uiComponents} />
      {text && !loading && (
        <div className="lgk-actions">
          <BranchSwitcher branch={branch} branchOptions={branchOptions} onSelect={agent.setBranch} disabled={busy} />
          {copy && <CopyButton text={text} disabled={busy} />}
          {branching && parentCheckpoint && (
            <IconButton label="Regenerate" disabled={busy} onClick={() => void agent.regenerate(parentCheckpoint)}><RefreshIcon /></IconButton>
          )}
          {feedback && (
            <span className="lgk-feedback" aria-label="Rate this answer">
              {feedback.sent
                ? <span className="lgk-feedback-thanks">Thanks for the feedback</span>
                : (["up", "down"] as const).map((rating) => (
                    <button
                      key={rating} type="button" className="lgk-icon-btn"
                      aria-label={rating === "up" ? "Good answer" : "Bad answer"}
                      disabled={busy} onClick={() => feedback.onRate(rating)}
                    >
                      {rating === "up" ? "👍" : "👎"}
                    </button>
                  ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
