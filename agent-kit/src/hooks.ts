"use client";
import type { Assistant, Message } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { messageText } from "./content";
import { useKit } from "./provider";
import type { AgentToolDefinition } from "./types";

/**
 * Register a tool the UI knows about.
 *  - `handler`  → frontend action, executed in the browser when the graph asks for it
 *  - `render`   → custom card for that tool call (frontend or server tool)
 * Keep the declaration stable; the latest `handler`/`render` closure is always used.
 */
export function useAgentTool<A = any, R = unknown>(def: AgentToolDefinition<A, R>) {
  const { registerTool } = useKit();
  const ref = useRef(def);
  ref.current = def;
  const hasHandler = !!def.handler;
  const hasRender = !!def.render;
  useEffect(() => registerTool({
    name: def.name,
    handler: hasHandler ? (a: any) => ref.current.handler!(a) : undefined,
    render: hasRender ? (p: any) => ref.current.render!(p) : undefined,
  }), [def.name, hasHandler, hasRender, registerTool]);
}

/**
 * Share app state with the agent. Sent on each run as
 * `config.configurable.readables = [{ description, value }, ...]`.
 */
export function useAgentReadable(description: string, value: unknown) {
  const { setReadable } = useKit();
  const id = useId();
  const serialized = JSON.stringify(value);
  useEffect(() => {
    setReadable(id, { description, value: JSON.parse(serialized ?? "null") });
    return () => setReadable(id, null);
  }, [id, description, serialized, setReadable]);
}

export function useAssistants() {
  const { client, connection, isConfigured } = useKit();
  const [state, setState] = useState<{ assistants: Assistant[]; loading: boolean; error: string | null }>(
    { assistants: [], loading: isConfigured, error: null },
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isConfigured) { setState({ assistants: [], loading: false, error: null }); return; }
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    client.assistants.search({ limit: 100 })
      .then((assistants) => !off && setState({ assistants, loading: false, error: null }))
      .catch((e) => !off && setState({ assistants: [], loading: false, error: e?.message ?? String(e) }));
    return () => { off = true; };
  }, [client, connection.apiUrl, isConfigured, tick]);
  return { ...state, refresh: useCallback(() => setTick((n) => n + 1), []) };
}

export interface ThreadSummary { id: string; title: string; updatedAt: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Threads carry the graph id or assistant id as metadata, depending on how they were started. */
const threadMetadata = (assistantId: string) => (UUID.test(assistantId) ? { assistant_id: assistantId } : { graph_id: assistantId });

export function useThreads({ limit = 100 }: { limit?: number } = {}) {
  const { client, connection, isConfigured, threadsRevision, bumpThreads, threadId, setThreadId } = useKit();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(isConfigured);
  useEffect(() => {
    if (!isConfigured) { setThreads([]); setLoading(false); return; }
    let off = false;
    client.threads.search({
      limit, sortBy: "updated_at", sortOrder: "desc",
      metadata: threadMetadata(connection.assistantId),
    }).then((rows) => {
      if (off) return;
      setThreads(rows.map((t) => {
        const msgs = ((t.values as { messages?: Message[] } | null)?.messages ?? []);
        const first = msgs.find((m) => m.type === "human");
        let title = first ? messageText(first.content).trim().slice(0, 80) : "";
        if (!title && first && Array.isArray(first.content) && first.content.length) title = "Attachment";
        return { id: t.thread_id, title: title || "Untitled chat", updatedAt: t.updated_at };
      }));
      setLoading(false);
    }).catch(() => !off && setLoading(false));
    return () => { off = true; };
  }, [client, connection.assistantId, isConfigured, threadsRevision, limit]);

  const remove = useCallback(async (id: string) => {
    await client.threads.delete(id);
    if (id === threadId) setThreadId(null);
    bumpThreads();
  }, [client, threadId, setThreadId, bumpThreads]);

  return { threads, loading, remove };
}
