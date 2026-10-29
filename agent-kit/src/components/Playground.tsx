"use client";
import { useEffect, useState } from "react";
import { useAssistants } from "../hooks";
import { useKit } from "../provider";
import type { Connection } from "../types";
import { Chat, type ChatProps } from "./Chat";
import { ConnectionForm } from "./ConnectionForm";
import { ThreadHistory } from "./ThreadHistory";
import { PanelLeftIcon } from "./ui/icons";
import { IconButton } from "./ui/IconButton";

/** Commits on Enter or blur so typing a URL doesn't reconnect on every keystroke. */
function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft.trim());
  return (
    <input
      {...rest} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/**
 * Full-page workspace: connection settings and history on the left, chat on the right.
 * Shows the setup form until the provider has a server URL and an assistant.
 */
export function Playground(props: Omit<ChatProps, "headerStart">) {
  const { connection, setConnection, setThreadId, isConfigured, status } = useKit();
  const { assistants, error, refresh } = useAssistants();
  const [navOpen, setNavOpen] = useState(false);

  if (!isConfigured) return <ConnectionForm />;

  const current = assistants.find((a) => a.assistant_id === connection.assistantId || a.graph_id === connection.assistantId);
  const known = assistants.some((a) => a.assistant_id === connection.assistantId);

  return (
    <div className="lgk lgk-pg" data-nav={navOpen}>
      <aside className="lgk-pg-side">
        <div className="lgk-pg-brand">LangGraph</div>

        <label className="lgk-field">
          <span>Endpoint</span>
          <CommitInput value={connection.apiUrl} onCommit={(v) => setConnection({ apiUrl: v })} spellCheck={false} />
        </label>

        <div className="lgk-field">
          <span>Access token</span>
          <div className="lgk-field-row">
            <CommitInput
              type="password" value={connection.token ?? ""} placeholder="Optional" autoComplete="off"
              onCommit={(v) => setConnection({ token: v || undefined })} aria-label="Access token"
            />
            <select
              value={connection.authScheme ?? "bearer"} aria-label="How to send the token"
              onChange={(e) => setConnection({ authScheme: e.target.value as NonNullable<Connection["authScheme"]> })}
            >
              <option value="bearer">Bearer</option>
              <option value="api-key">X-Api-Key</option>
              <option value="agent-builder">Agent Builder</option>
            </select>
          </div>
        </div>

        <label className="lgk-field">
          <span>Agent</span>
          <select value={connection.assistantId} onChange={(e) => setConnection({ assistantId: e.target.value })}>
            {!known && <option value={connection.assistantId}>{connection.assistantId}</option>}
            {assistants.map((a) => <option key={a.assistant_id} value={a.assistant_id}>{a.name || a.graph_id}</option>)}
          </select>
        </label>

        <p className="lgk-status" data-state={status === "error" || error ? "error" : status}>
          {status === "error" || error
            ? <>Can't reach {connection.apiUrl}. <button type="button" onClick={refresh}>Retry</button></>
            : status === "checking" ? "Connecting…" : `Connected · ${assistants.length} agent${assistants.length === 1 ? "" : "s"}`}
        </p>

        <button type="button" className="lgk-primary" onClick={() => { setThreadId(null); setNavOpen(false); }}>New chat</button>
        <ThreadHistory onSelect={() => setNavOpen(false)} />
      </aside>

      <main className="lgk-pg-main">
        <Chat
          {...props}
          headerStart={<IconButton label="Chats" className="lgk-burger" onClick={() => setNavOpen((o) => !o)}><PanelLeftIcon /></IconButton>}
          title={props.title ?? current?.name ?? current?.graph_id ?? "Chat"}
        />
      </main>
    </div>
  );
}
