"use client";
import { Client } from "@langchain/langgraph-sdk";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";
import { ArtifactProvider } from "./artifact";
import {
  createGatewayEventBus, GatewayTransport,
  type GatewayConfig, type GatewayEventBus,
} from "./gateway";
import { getStoredToken, setStoredToken } from "./lib/storage";
import { ToastViewport, useToastState, type Notify } from "./toast";
import type { AgentToolDefinition, Connection, ConnectionStatus, Readable } from "./types";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
/** CSS custom property overrides, e.g. { "--lgk-bg": "#fff" }. */
export type ThemeVars = Record<`--${string}`, string>;

export interface KitContextValue {
  connection: Connection;
  setConnection: (patch: Partial<Connection>) => void;
  isConfigured: boolean;
  status: ConnectionStatus;
  client: Client;
  auth: { apiKey?: string; headers: Record<string, string> };
  /** Set when the kit talks to the NMB gateway instead of a LangGraph server. */
  gateway?: GatewayConfig;
  gatewayTransport: GatewayTransport | null;
  gatewayEvents: GatewayEventBus;
  threadId: string | null;
  setThreadId: (id: string | null) => void;
  configurable?: Record<string, unknown>;
  branching: boolean;
  submitOptions?: Record<string, unknown>;
  tools: Record<string, AgentToolDefinition>;
  registerTool: (def: AgentToolDefinition) => () => void;
  readables: Record<string, Readable>;
  setReadable: (id: string, r: Readable | null) => void;
  threadsRevision: number;
  bumpThreads: () => void;
  notify: Notify;
  /** The selected mode: "light", "dark" or "system". */
  theme: ThemeMode;
  /** What is actually applied right now (system is resolved to light or dark). */
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
}

const LangGraphKitContext = createContext<KitContextValue | null>(null);

export interface LangGraphKitProviderProps extends Partial<Connection> {
  children: ReactNode;
  /**
   * Talk to the NMB gateway (`/v1/session` + `/v1/chat`) instead of a LangGraph
   * server. Enables citations, human handoff and feedback in the chat surfaces.
   */
  gateway?: GatewayConfig;
  threadId?: string | null;
  onThreadIdChange?: (id: string | null) => void;
  configurable?: Record<string, unknown>;
  branching?: boolean;
  submitOptions?: Record<string, unknown>;
  persistKey?: string;
  /** Controlled theme mode. Omit for uncontrolled. */
  theme?: ThemeMode;
  /** Starting mode when uncontrolled and nothing is saved. Default "system". */
  defaultTheme?: ThemeMode;
  onThemeChange?: (mode: ThemeMode) => void;
  /** Per-theme CSS variable overrides. */
  themeVars?: { light?: ThemeVars; dark?: ThemeVars };
}

const isMode = (v: unknown): v is ThemeMode => v === "light" || v === "dark" || v === "system";

/** Tracks the OS color scheme. Starts as light so server and first client render match. */
function useSystemDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark;
}

export function LangGraphKitProvider({
  children, threadId: threadIdProp, onThreadIdChange, configurable, persistKey,
  branching = true, submitOptions, gateway,
  apiUrl = gateway?.baseUrl ?? "", assistantId = "", token, authScheme = "bearer", headers,
  theme: themeProp, defaultTheme = "system", onThemeChange, themeVars,
}: LangGraphKitProviderProps) {
  const [conn, setConn] = useState<Connection>({ apiUrl, assistantId, token, authScheme, headers });
  const connRef = useRef(conn);
  connRef.current = conn;
  const toasts = useToastState();
  const notifyRef = useRef(toasts.notify);
  notifyRef.current = toasts.notify;

  // ---- Theme ----
  const [themeState, setThemeState] = useState<ThemeMode>(defaultTheme);
  const theme = themeProp ?? themeState;
  const systemDark = useSystemDark();
  const resolvedTheme: ResolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    onThemeChange?.(mode);
  }, [onThemeChange]);

  // Restore the saved mode after mount (uncontrolled only).
  useEffect(() => {
    if (!persistKey || themeProp !== undefined) return;
    try {
      const saved = localStorage.getItem(`${persistKey}:theme`);
      if (isMode(saved)) setThemeState(saved);
    } catch { /* storage unavailable */ }
  }, [persistKey, themeProp]);
  useEffect(() => {
    if (!persistKey) return;
    try { localStorage.setItem(`${persistKey}:theme`, theme); } catch { /* storage unavailable */ }
  }, [persistKey, theme]);

  // Mirror onto <html> so portaled UI (popups, toasts) is themed too.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.lgkTheme = resolvedTheme;
    return () => { delete el.dataset.lgkTheme; };
  }, [resolvedTheme]);

  const themeStyle = useMemo(
    () => ({ display: "contents", colorScheme: resolvedTheme, ...(themeVars?.[resolvedTheme] ?? {}) }) as CSSProperties,
    [resolvedTheme, themeVars],
  );

  // ---- Threads ----
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
    if (moved) setThreadId(null);
  }, [setThreadId]);

  // ---- Connection persistence ----
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

  const isConfigured = gateway
    ? !!gateway.baseUrl && !!gateway.publishableKey
    : !!conn.apiUrl && !!conn.assistantId;

  const client = useMemo(
    () => new Client({ apiUrl: conn.apiUrl || undefined, apiKey: auth.apiKey, defaultHeaders: auth.headers }),
    [conn.apiUrl, auth],
  );

  const gatewayEvents = useMemo(() => createGatewayEventBus(), []);
  const gatewayBaseUrl = gateway?.baseUrl;
  const gatewayKey = gateway?.publishableKey;
  const gatewayUser = gateway?.userId;
  const gatewayCustomer = gateway?.customerId;
  const gatewayAgent = gateway?.agentId;
  const gatewayPersist = gateway?.persistKey;
  const gatewayHostConfig = gateway?.hostConfig;
  const gatewayFetchImpl = gateway?.fetch;
  const gatewayTransport = useMemo(
    () => (gatewayBaseUrl && gatewayKey
      ? new GatewayTransport({
          baseUrl: gatewayBaseUrl,
          publishableKey: gatewayKey,
          userId: gatewayUser,
          customerId: gatewayCustomer,
          agentId: gatewayAgent,
          persistKey: gatewayPersist,
          hostConfig: gatewayHostConfig,
          fetch: gatewayFetchImpl,
        }, gatewayEvents.emit)
      : null),
    [gatewayBaseUrl, gatewayKey, gatewayUser, gatewayCustomer, gatewayAgent, gatewayPersist, gatewayHostConfig, gatewayFetchImpl, gatewayEvents],
  );

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  useEffect(() => {
    if (!isConfigured) { setStatus("idle"); return; }
    let off = false;
    setStatus("checking");
    const fail = () => {
      if (off) return;
      setStatus("error");
      notifyRef.current({
        kind: "error",
        title: gatewayBaseUrl ? "Can't reach the agent gateway" : "Can't reach the LangGraph server",
        description: gatewayBaseUrl
          ? `Check that ${gatewayBaseUrl} is up and CORS allows this origin.`
          : `Check that it is running at ${conn.apiUrl}, your token is right, and CORS allows this origin.`,
        duration: 10000,
      });
    };
    if (gatewayBaseUrl) {
      fetch(`${gatewayBaseUrl.replace(/\/$/, "")}/health`)
        .then((r) => (r.ok ? !off && setStatus("ok") : fail()))
        .catch(fail);
    } else {
      const h = new Headers(auth.headers);
      if (auth.apiKey) h.set("X-Api-Key", auth.apiKey);
      fetch(`${conn.apiUrl.replace(/\/$/, "")}/info`, { headers: h })
        .then((r) => (r.ok ? !off && setStatus("ok") : fail()))
        .catch(fail);
    }
    return () => { off = true; };
  }, [isConfigured, conn.apiUrl, auth, gatewayBaseUrl]);

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
    connection: conn, setConnection, isConfigured, status, client, auth, gateway, gatewayTransport, gatewayEvents,
    threadId, setThreadId,
    configurable, branching, submitOptions, tools, registerTool, readables, setReadable,
    threadsRevision, bumpThreads, notify: toasts.notify,
    theme, resolvedTheme, setTheme,
  }), [conn, setConnection, isConfigured, status, client, auth, gateway, gatewayTransport, gatewayEvents,
       threadId, setThreadId, configurable, branching, submitOptions, tools, registerTool, readables,
       setReadable, threadsRevision, bumpThreads, toasts.notify, theme, resolvedTheme, setTheme]);

  return (
    <LangGraphKitContext.Provider value={value}>
      <div className="lgk-theme-root" data-theme={resolvedTheme} style={themeStyle}>
        <ArtifactProvider>{children}</ArtifactProvider>
        <ToastViewport items={toasts.items} dismiss={toasts.dismiss} />
      </div>
    </LangGraphKitContext.Provider>
  );
}

export function useKit(): KitContextValue {
  const context = useContext(LangGraphKitContext);
  if (!context) {
    throw new Error("langgraph-kit: wrap your app in <LangGraphKitProvider>");
  }
  return context;
}