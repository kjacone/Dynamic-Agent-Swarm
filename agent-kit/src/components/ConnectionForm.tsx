"use client";
import { useState, type FormEvent } from "react";
import { useKit } from "../provider";
import type { Connection } from "../types";

/** First-run setup: where the server is, which agent to talk to, and how to authenticate. */
export function ConnectionForm({ defaultApiUrl = "http://localhost:2024", defaultAssistantId = "agent", onConnected }: {
  defaultApiUrl?: string; defaultAssistantId?: string; onConnected?: () => void;
}) {
  const { connection, setConnection } = useKit();
  const [apiUrl, setApiUrl] = useState(connection.apiUrl || defaultApiUrl);
  const [assistantId, setAssistantId] = useState(connection.assistantId || defaultAssistantId);
  const [token, setToken] = useState(connection.token ?? "");
  const [scheme, setScheme] = useState<NonNullable<Connection["authScheme"]>>(connection.authScheme ?? "bearer");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setConnection({ apiUrl: apiUrl.trim(), assistantId: assistantId.trim(), token: token.trim() || undefined, authScheme: scheme });
    onConnected?.();
  };

  return (
    <div className="lgk lgk-setup">
      <form onSubmit={submit}>
        <h1>Connect to your agent</h1>
        <p className="lgk-muted-block">Point this at a LangGraph server. Local (<code>langgraph dev</code>) or deployed both work.</p>

        <label>
          <span>Server URL</span>
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} required spellCheck={false} placeholder="http://localhost:2024" />
        </label>

        <label>
          <span>Assistant or graph ID</span>
          <input value={assistantId} onChange={(e) => setAssistantId(e.target.value)} required spellCheck={false} placeholder="agent" />
          <small>The graph name from <code>langgraph.json</code>, or an assistant UUID.</small>
        </label>

        <label>
          <span>Access token <em>(optional)</em></span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="Not needed for a local server" />
          <small>Stored in this browser only, and only sent to this server.</small>
        </label>

        <label>
          <span>How to send the token</span>
          <select value={scheme} onChange={(e) => setScheme(e.target.value as NonNullable<Connection["authScheme"]>)}>
            <option value="bearer">Authorization: Bearer (custom auth)</option>
            <option value="api-key">X-Api-Key (LangSmith / LangGraph Platform)</option>
            <option value="agent-builder">LangSmith Agent Builder</option>
          </select>
        </label>

        <button type="submit" className="lgk-primary">Connect</button>
      </form>
    </div>
  );
}
