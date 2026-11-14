"use client";
import type { Message, ToolMessage } from "@langchain/langgraph-sdk";
import { useEffect, useState, type ReactNode } from "react";
import { AgentContext, useAgentContext } from "../agent-context";
import { ArtifactContent, ArtifactTitle, useArtifactContext, useArtifactOpen } from "../artifact";
import { isHiddenMessage, messageText, messageToolCalls } from "../content";
import { useKit } from "../provider";
import { useStickToBottom } from "../use-stick-to-bottom";
import { useAgent } from "../use-agent";
import { Composer } from "./Composer";
import { HistoryPanel } from "./HistoryPanel";
import { InterruptView, type InterruptRenderProps } from "./interrupts/InterruptView";
import type { MarkdownOptions } from "./Markdown";
import { AssistantMessage, type UiComponents } from "./messages/AssistantMessage";
import { HumanMessage } from "./messages/HumanMessage";
import { OrphanToolResult } from "./messages/ToolCalls";
import { ArrowDownIcon, HistoryIcon, NewChatIcon, XIcon } from "./ui/icons";
import { IconButton } from "./ui/IconButton";

export interface ChatFeatures {
  /** Attach images and PDFs (button, drag-and-drop, paste). */
  upload?: boolean;
  /** Edit your messages, regenerate answers and switch between versions. Needs provider `branching`. */
  branching?: boolean;
  copy?: boolean;
  /** "Hide background tasks" switch in the composer (the tool-call cards). */
  toolToggle?: boolean;
  /** Side panel for artifacts opened from tool cards or generative UI. */
  artifacts?: boolean;
  /** Show the server host and a connection dot in the header. */
  connectionBadge?: boolean;
  /** Header button for past conversations (and a new chat). */
  history?: boolean;
}

export interface ChatProps {
  title?: string;
  placeholder?: string;
  /** Clickable starter prompts shown on an empty thread. */
  suggestions?: string[];
  emptyState?: ReactNode;
  /** Custom UI for `interrupt()` pauses. Return null to fall back to the built-in review UI. */
  renderInterrupt?: (p: InterruptRenderProps) => ReactNode;
  /** Left of the title (e.g. a menu button). */
  headerStart?: ReactNode;
  /** Right of the header (e.g. a close button). */
  headerActions?: ReactNode;
  features?: ChatFeatures;
  /** Local React components for the graph's generative-UI messages, keyed by name. */
  uiComponents?: UiComponents;
  markdown?: MarkdownOptions;
  className?: string;
}

/** Drop-in chat. Owns one agent stream and shares it with everything inside via `useAgentContext()`. */
export function Chat(props: ChatProps) {
  const agent = useAgent();
  return (
    <AgentContext.Provider value={agent}>
      <ChatView {...props} />
    </AgentContext.Provider>
  );
}

function hostOf(url: string) { try { return new URL(url).host; } catch { return url; } }

function ChatView({
  title, placeholder = "Message the agent…", suggestions, emptyState, renderInterrupt,
  headerStart, headerActions, features, uiComponents, markdown, className,
}: ChatProps) {
  const agent = useAgentContext();
  const kit = useKit();
  const f = { upload: true, branching: true, copy: true, toolToggle: true, artifacts: true, connectionBadge: true, history: true, ...features };
  const branching = f.branching && kit.branching;

  const [hideToolCalls, setHideToolCalls] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [artifactOpen, closeArtifact] = useArtifactOpen();
  const [artifactContext, setArtifactContext] = useArtifactContext();
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();

  // A different thread means a different artifact.
  useEffect(() => { closeArtifact(); setArtifactContext({}); }, [agent.threadId, closeArtifact, setArtifactContext]);
  useEffect(() => { setHistoryOpen(false); }, [agent.threadId]);

  const visible = agent.messages.filter((m) => !isHiddenMessage(m));
  const results = new Map<string, ToolMessage>();
  const knownCalls = new Set<string>();
  for (const m of visible) {
    if (m.type === "tool") results.set((m as ToolMessage).tool_call_id, m as ToolMessage);
    for (const c of messageToolCalls(m)) if (c.id) knownCalls.add(c.id);
  }

  const lastAi = [...visible].reverse().find((m) => m.type === "ai");
  const last = visible[visible.length - 1];
  const waiting = agent.isLoading && (!last || last.type === "human" ||
    (last.type === "ai" && !messageText(last.content) && !messageToolCalls(last).length));
  const empty = visible.length === 0 && !agent.interrupts.length;
  const started = !!agent.threadId || visible.length > 0;
  const showArtifact = f.artifacts && artifactOpen;

  const renderMessage = (m: Message, i: number) => {
    const key = m.id ?? `${m.type}-${i}`;
    if (m.type === "human") return <HumanMessage key={key} message={m} branching={branching} copy={f.copy} />;
    if (m.type === "ai") {
      const isLast = m === lastAi && !agent.isLoading;
      return (
        <AssistantMessage
          key={key} message={m} results={results} loading={agent.isLoading && i === visible.length - 1}
          hideToolCalls={hideToolCalls} branching={branching} copy={f.copy} uiComponents={uiComponents} markdown={markdown}
          sources={agent.isGateway && m === lastAi ? agent.sources : undefined}
          feedback={agent.isGateway && isLast ? { sent: agent.feedbackSent, onRate: agent.feedback } : undefined}
        />
      );
    }
    if (m.type === "tool" && !hideToolCalls && !knownCalls.has((m as ToolMessage).tool_call_id)) {
      return <OrphanToolResult key={key} message={m as ToolMessage} />;
    }
    return null;
  };

  return (
    <section className={`lgk lgk-chat ${className ?? ""}`} aria-label={title ?? "Chat"} data-artifact={showArtifact || undefined}>
      <header className="lgk-chat-head">
        <div className="lgk-chat-head-start">
          {headerStart}
          {title && <h2>{title}</h2>}
          {f.connectionBadge && kit.isConfigured && (
            <span className="lgk-host" data-status={kit.status} title={`${kit.status === "error" ? "Can't reach" : "Connected to"} ${kit.connection.apiUrl}`}>
              {hostOf(kit.connection.apiUrl)}
            </span>
          )}
        </div>
        <div className="lgk-chat-head-actions">
          {kit.gateway && !agent.handoff && (
            <button type="button" className="lgk-hb-btn" onClick={() => void agent.requestHuman()}>
              Talk to a human
            </button>
          )}
          {f.history && started && (
            <IconButton label="Chat history" onClick={() => setHistoryOpen(true)}><HistoryIcon /></IconButton>
          )}
          {started && <IconButton label="New chat" onClick={agent.newThread}><NewChatIcon /></IconButton>}
          {headerActions}
        </div>
      </header>

      <div className="lgk-chat-body">
        <div className="lgk-chat-main">
          <div className="lgk-scroll" ref={scrollRef}>
            <div className="lgk-thread" ref={contentRef} role="log" aria-live="polite">
              {empty && (
                <div className="lgk-empty">
                  {!kit.isConfigured
                    ? <p>Add a server URL and assistant to the provider to start chatting.</p>
                    : emptyState ?? <p>Ask anything to start a conversation.</p>}
                  {kit.isConfigured && suggestions && suggestions.length > 0 && (
                    <div className="lgk-suggest">
                      {suggestions.map((s) => <button key={s} type="button" onClick={() => void agent.send(s)}>{s}</button>)}
                    </div>
                  )}
                </div>
              )}

              {visible.map(renderMessage)}

              {waiting && <div className="lgk-typing" role="status" aria-label="Agent is working"><i /><i /><i /></div>}
              {agent.handoff && (
                <div className="lgk-handoff" data-status={agent.handoff.status} role="status">
                  <div className="lgk-handoff-head">
                    <strong>
                      {agent.handoff.status === "active" ? "A colleague has joined" : "Waiting for a colleague"}
                    </strong>
                    <span>
                      {agent.handoff.status === "active"
                        ? "You're chatting with our team. Replies appear here."
                        : "Our team has been notified. You can keep typing here."}
                    </span>
                  </div>
                  {agent.handoffMessages.filter((m) => m.role === "staff").map((m) => (
                    <div className="lgk-handoff-msg" key={m.id}>
                      <b>{m.author || "Team"}</b> {m.text}
                    </div>
                  ))}
                </div>
              )}
              <InterruptView interrupts={agent.interrupts} render={renderInterrupt} />
              {agent.error && <div className="lgk-error" role="alert">{agent.error}</div>}
            </div>
          </div>

          {!isAtBottom && (
            <button type="button" className="lgk-scroll-btn" onClick={() => scrollToBottom()}>
              <ArrowDownIcon /> Scroll to bottom
            </button>
          )}

          <Composer
            placeholder={placeholder}
            busy={agent.isLoading}
            disabled={!kit.isConfigured || agent.interrupts.length > 0}
            upload={f.upload}
            toolToggle={f.toolToggle ? { checked: hideToolCalls, onChange: setHideToolCalls } : undefined}
            onSend={({ text, blocks }) => void agent.send({ text, blocks, context: artifactContext })}
            onStop={() => void agent.stop()}
            onError={(description) => kit.notify({ kind: "error", title: "Can't attach that", description })}
          />
          {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
        </div>

        {showArtifact && (
          <aside className="lgk-artifact" aria-label="Artifact">
            <div className="lgk-artifact-head">
              <ArtifactTitle className="lgk-artifact-title" />
              <IconButton label="Close panel" onClick={closeArtifact}><XIcon /></IconButton>
            </div>
            <ArtifactContent className="lgk-artifact-body" />
          </aside>
        )}
      </div>
    </section>
  );
}
