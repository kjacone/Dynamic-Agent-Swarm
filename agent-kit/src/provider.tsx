"use client";
import { Client } from "@langchain/langgraph-sdk";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { ArtifactProvider } from "./artifact";
import { getStoredToken, setStoredToken } from "./lib/storage";
import { ToastViewport, useToastState, type Notify } from "./toast";
import type { AgentToolDefinition, Connection, ConnectionStatus, Readable } from "./types";

export interface KitContextValue {
  connection: Connection;
  setConnection: (patch: Partial<Connection>) => void;
  /** True once both an API URL and an assistant id are known. */
  isConfigured: boolean;
  /** Result of a `GET /info` probe against the server. */
  status: ConnectionStatus;
  client: Client;
  /** Resolved request auth, shared by the client and the stream hook. */
  auth: { apiKey?: string; headers: Record<string, string> };
  threadId: string | null;
  setThreadId: (id: string | null) => void;
  configurable?: Record<string, unknown>;
  /** Keep per-message state history so messages can be edited, regenerated and branched. */
  branching: boolean;
  /** Extra options merged into every `submit` (e.g. `{ streamSubgraphs: true }`). */
  submitOptions?: Record<string, unknown>;
  tools: Record<string, AgentToolDefinition>;
  registerTool: (def: AgentToolDefinition) => () => void;
  readables: Record<string, Readable>;
  setReadable: (id: string, r: Readable | null) => void;
  /** Bumps whenever a thread was created or finished a run. */
  threadsRevision: number;
  bumpThreads: () => void;
  notify: Notify;
}

const Ctx = createContext<KitContextValue | null>(null);

export interface LangGraphKitProviderProps extends Partial<Connection> {
  children: ReactNode;
  /** Controlled thread id. Omit for uncontrolled. */
  threadId?: string | null;
  onThreadIdChange?: (id: string | null) => void;
  /** Extra `config.configurable` values sent with every run. */
  configurable?: Record<string, unknown>;
  /** Enables edit / regenerate / branch switching. Default true. */
  branching?: boolean;
  submitOptions?: Record<string, unknown>;
  /**
   * localStorage namespace. Remembers endpoint, assistant and scheme; the token is
   * stored separately and only ever returned to the origin it was saved for.
   */
  persistKey?: string;
}

export function LangGraphKitProvider({
  children, threadId: threadIdProp, onThreadIdChange, configurable, persistKey,
  branching = true, submitOptions,
  apiUrl = "", assistantId = "", token, authScheme = "bearer", headers,
}: LangGraphKitProviderProps) {
  const [conn, setConn] = useState<Connection>({ apiUrl, assistantId, token, authScheme, headers });
  const connRef = useRef(conn);
  connRef.current = conn;
  const toasts = useToastState();
  const notifyRef = useRef(toasts.notify);
  notifyRef.current = toasts.notify;

  const [internalThread, setInternalThread] = useState<string | null>(threadIdProp ?? null);
  const threadId = threadIdProp !== undefined ? threadIdProp : internalThread;
  const setThreadId = useCallback((id: string | null) => {
    setInternalThread(id);
    onThreadIdChange?.(id);
  }, [onThreadIdChange]);

  const setConnection = useCallback((patch: Partial<Connection>) => {
    const prev = connRef.current;
    const moved =
      (patch.apiUrl !== undefined && patch.apiUrl !== prev.apiUrl) ||
      (patch.assistantId !== undefined && patch.assistantId !== prev.assistantId);
    setConn({ ...prev, ...patch });
    if (moved) setThreadId(null); // threads belong to one server + assistant
  }, [setThreadId]);

  // Optional persistence (client-only, so it hydrates after mount).
  const [hydrated, setHydrated] = useState(!persistKey);
  useEffect(() => {
    if (!persistKey) return;
    try {
      const raw = localStorage.getItem(persistKey);
      const saved = raw ? (JSON.parse(raw) as Partial<Connection>) : {};
      setConn((p) => {
        const next = { ...p, ...saved };
        return { ...next, token: p.token ?? getStoredToken(persistKey, next.apiUrl) };
      });
    } catch { /* storage unavailable */ }
    setHydrated(true);
  }, [persistKey]);
  useEffect(() => {
    if (!persistKey || !hydrated) return;
    try {
      const { apiUrl, assistantId, authScheme } = conn;
      localStorage.setItem(persistKey, JSON.stringify({ apiUrl, assistantId, authScheme }));
      setStoredToken(persistKey, apiUrl, conn.token);
    } catch { /* storage unavailable */ }
  }, [conn, hydrated, persistKey]);

  const auth = useMemo(() => {
    const out: Record<string, string> = { ...conn.headers };
    let apiKey: string | undefined;
    if (conn.token) {
      if (conn.authScheme === "bearer" || !conn.authScheme) out.Authorization = `Bearer ${conn.token}`;
      else apiKey = conn.token;
    }
    if (conn.authScheme === "agent-builder") out["X-Auth-Scheme"] = "langsmith-api-key";
    return { apiKey, headers: out };
  }, [conn.token, conn.authScheme, conn.headers]);

  const isConfigured = !!conn.apiUrl && !!conn.assistantId;

  const client = useMemo(
    () => new Client({ apiUrl: conn.apiUrl || undefined, apiKey: auth.apiKey, defaultHeaders: auth.headers }),
    [conn.apiUrl, auth],
  );

  // Health probe, like agent-chat-ui: tell the user early if the server is unreachable.
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  useEffect(() => {
    if (!isConfigured) { setStatus("idle"); return; }
    let off = false;
    setStatus("checking");
    const h = new Headers(auth.headers);
    if (auth.apiKey) h.set("X-Api-Key", auth.apiKey);
    const fail = () => {
      if (off) return;
      setStatus("error");
      notifyRef.current({
        kind: "error",
        title: "Can't reach the LangGraph server",
        description: `Check that it is running at ${conn.apiUrl}, your token is right, and CORS allows this origin.`,
        duration: 10000,
      });
    };
    fetch(`${conn.apiUrl.replace(/\/$/, "")}/info`, { headers: h })
      .then((r) => (r.ok ? !off && setStatus("ok") : fail()))
      .catch(fail);
    return () => { off = true; };
  }, [isConfigured, conn.apiUrl, auth]);

  const [tools, setTools] = useState<Record<string, AgentToolDefinition>>({});
  const registerTool = useCallback((def: AgentToolDefinition) => {
    setTools((p) => ({ ...p, [def.name]: def }));
    return () => setTools((p) => { const { [def.name]: _gone, ...rest } = p; return rest; });
  }, []);

  const [readables, setReadables] = useState<Record<string, Readable>>({});
  const setReadable = useCallback((id: string, r: Readable | null) => {
    setReadables((p) => {
      if (r) return { ...p, [id]: r };
      const { [id]: _gone, ...rest } = p;
      return rest;
    });
  }, []);

  const [threadsRevision, setRev] = useState(0);
  const bumpThreads = useCallback(() => setRev((n) => n + 1), []);

  const value = useMemo<KitContextValue>(() => ({
    connection: conn, setConnection, isConfigured, status, client, auth, threadId, setThreadId,
    configurable, branching, submitOptions, tools, registerTool, readables, setReadable,
    threadsRevision, bumpThreads, notify: toasts.notify,
  }), [conn, setConnection, isConfigured, status, client, auth, threadId, setThreadId, configurable,
       branching, submitOptions, tools, registerTool, readables, setReadable, threadsRevision,
       bumpThreads, toasts.notify]);

  return (
    <Ctx.Provider value={value}>
      <ArtifactProvider>{children}</ArtifactProvider>
      <ToastViewport items={toasts.items} dismiss={toasts.dismiss} />
    </Ctx.Provider>
  );
}

export function useKit(): KitContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("langgraph-kit: wrap your app in <LangGraphKitProvider>");
  return v;
}
