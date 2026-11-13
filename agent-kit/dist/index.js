"use client";

// src/provider.tsx
import { Client } from "@langchain/langgraph-sdk";
import {
  createContext as createContext2,
  useCallback as useCallback3,
  useContext as useContext2,
  useEffect as useEffect2,
  useMemo,
  useRef as useRef3,
  useState as useState3
} from "react";

// src/artifact.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var SlotCtx = createContext(null);
function useSlots() {
  const v = useContext(SlotCtx);
  if (!v) throw new Error("langgraph-kit: artifacts need <LangGraphKitProvider>");
  return v;
}
function ArtifactProvider({ children }) {
  const open = useState(null);
  const mounted = useState(null);
  const title = useState(null);
  const content = useState(null);
  const context = useState({});
  return /* @__PURE__ */ jsx(SlotCtx.Provider, { value: { open, mounted, title, content, context }, children });
}
function ArtifactSlot({ id, title, children }) {
  const s = useSlots();
  const [mountedId, setMounted] = s.mounted;
  const [contentEl] = s.content;
  const [titleEl] = s.title;
  const empty = children == null && title == null;
  useEffect(() => {
    if (empty) setMounted((cur) => cur === id ? null : cur);
  }, [empty, id, setMounted]);
  if (mountedId !== id) return null;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    titleEl ? createPortal(/* @__PURE__ */ jsx(Fragment, { children: title }), titleEl) : null,
    contentEl ? createPortal(/* @__PURE__ */ jsx(Fragment, { children }), contentEl) : null
  ] });
}
function ArtifactContent(props) {
  const s = useSlots();
  const [mounted] = s.mounted;
  const [, setEl] = s.content;
  const ref = useRef(null);
  useLayoutEffect(() => setEl(mounted ? ref.current : null), [mounted, setEl]);
  if (!mounted) return null;
  return /* @__PURE__ */ jsx("div", { ...props, ref });
}
function ArtifactTitle(props) {
  const s = useSlots();
  const [, setEl] = s.title;
  const ref = useRef(null);
  useLayoutEffect(() => setEl(ref.current), [setEl]);
  return /* @__PURE__ */ jsx("div", { ...props, ref });
}
function useArtifact() {
  const id = useId();
  const s = useSlots();
  const [openId, setOpenId] = s.open;
  const [context, setContext] = s.context;
  const [, setMounted] = s.mounted;
  const open = openId === id;
  const setOpen = useCallback((value) => {
    if (typeof value === "boolean") setOpenId(value ? id : null);
    else setOpenId((cur) => cur === id ? null : id);
    setMounted(id);
  }, [id, setOpenId, setMounted]);
  const Artifact = useCallback(
    (props) => /* @__PURE__ */ jsx(ArtifactSlot, { id, title: props.title, children: props.children }),
    [id]
  );
  return [Artifact, { open, setOpen, context, setContext }];
}
function useArtifactOpen() {
  const [openId, setOpenId] = useSlots().open;
  const close2 = useCallback(() => setOpenId(null), [setOpenId]);
  return [openId !== null, close2];
}
function useArtifactContext() {
  return useSlots().context;
}

// src/gateway.ts
function createGatewayEventBus() {
  const listeners = /* @__PURE__ */ new Set();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit(event) {
      listeners.forEach((fn) => fn(event));
    }
  };
}
var trimBase = (url) => url.replace(/\/+$/, "");
var sessions = /* @__PURE__ */ new Map();
async function gatewayToken(cfg, force = false) {
  const url = trimBase(cfg.baseUrl);
  const key = `${url}|${cfg.publishableKey}|${cfg.userId ?? ""}|${cfg.customerId ?? ""}`;
  const hit = sessions.get(key);
  if (!force && hit && hit.exp > Date.now() + 3e4) return hit.token;
  const doFetch = cfg.fetch ?? fetch;
  try {
    const res = await doFetch(`${url}/v1/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.publishableKey}` },
      body: JSON.stringify({
        ...cfg.userId ? { user_id: cfg.userId } : {},
        ...cfg.customerId ? { customer_id: cfg.customerId } : {}
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        sessions.set(key, { token: data.token, exp: Date.now() + (data.expires_in ?? 900) * 1e3 });
        return data.token;
      }
    }
  } catch {
  }
  return cfg.publishableKey;
}
async function gatewayFetch(cfg, path, init = {}, retried = false) {
  const token = await gatewayToken(cfg, retried);
  const doFetch = cfg.fetch ?? fetch;
  const res = await doFetch(`${trimBase(cfg.baseUrl)}${path}`, {
    ...init,
    headers: { ...init.body ? { "Content-Type": "application/json" } : {}, ...init.headers, Authorization: `Bearer ${token}` }
  });
  if (res.status === 401 && !retried) {
    sessions.delete(`${trimBase(cfg.baseUrl)}|${cfg.publishableKey}|${cfg.userId ?? ""}|${cfg.customerId ?? ""}`);
    return gatewayFetch(cfg, path, init, true);
  }
  return res;
}
async function requestHandoff(cfg, threadId, reason) {
  const res = await gatewayFetch(cfg, "/v1/handoff", {
    method: "POST",
    body: JSON.stringify({ thread_id: threadId, ...cfg.userId ? { user_id: cfg.userId } : {}, ...reason ? { reason } : {} })
  });
  if (!res.ok) throw new Error(`handoff failed (${res.status})`);
  return res.json();
}
async function handoffSnapshot(cfg, threadId) {
  const qs = cfg.userId ? `?user_id=${encodeURIComponent(cfg.userId)}` : "";
  const res = await gatewayFetch(cfg, `/v1/handoff/${encodeURIComponent(threadId)}${qs}`);
  if (!res.ok) throw new Error(`handoff status failed (${res.status})`);
  return res.json();
}
async function sendFeedback(cfg, body) {
  const res = await gatewayFetch(cfg, "/v1/feedback", {
    method: "POST",
    body: JSON.stringify({ ...body, ...cfg.userId ? { user_id: cfg.userId } : {} })
  });
  if (!res.ok) throw new Error(`feedback failed (${res.status})`);
}
function lastUserText(input) {
  const messages = input?.messages;
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.type !== "human" && m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content.trim();
    if (Array.isArray(m.content)) {
      return m.content.map((part) => part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "").join("").trim();
    }
  }
  return "";
}
async function* readSse(res) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut = buf.indexOf("\n\n");
      while (cut >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
        if (data === "[DONE]") return;
        if (data) {
          try {
            yield { data: JSON.parse(data) };
          } catch {
          }
        }
        cut = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
var GatewayTransport = class {
  constructor(cfg, emit = () => {
  }) {
    this.boundThread = null;
    this.serverThread = null;
    this.cfg = cfg;
    this.emit = emit;
  }
  get storeKey() {
    const base2 = trimBase(this.cfg.baseUrl);
    return `nmb_gw_threads:${this.cfg.persistKey || base2}:${this.cfg.publishableKey.slice(0, 10)}`;
  }
  restore(clientThread) {
    try {
      const raw = localStorage.getItem(this.storeKey);
      const map = raw ? JSON.parse(raw) : {};
      return map[clientThread] || null;
    } catch {
      return null;
    }
  }
  remember(clientThread, serverThread) {
    try {
      const raw = localStorage.getItem(this.storeKey);
      const map = raw ? JSON.parse(raw) : {};
      map[clientThread] = serverThread;
      const entries = Object.entries(map).slice(-20);
      localStorage.setItem(this.storeKey, JSON.stringify(Object.fromEntries(entries)));
    } catch {
    }
  }
  async *stream(payload) {
    if (payload.command) {
      throw new Error("This assistant runs on the NMB gateway; resuming graph commands is not supported yet.");
    }
    const text = lastUserText(payload.input);
    if (!text) throw new Error("The gateway transport needs a user message.");
    const clientThread = payload.config?.configurable?.thread_id ?? null;
    if (clientThread !== this.boundThread) {
      this.boundThread = clientThread;
      this.serverThread = clientThread ? this.restore(clientThread) : null;
    }
    const cfgurable = payload.config?.configurable;
    const context = payload.context ?? cfgurable?.context ?? void 0;
    const readables = cfgurable?.readables;
    const token = await gatewayToken(this.cfg);
    const res = await gatewayFetch(this.cfg, "/v1/chat", {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      signal: payload.signal,
      body: JSON.stringify({
        message: text,
        thread_id: this.serverThread,
        ...this.cfg.userId ? { user_id: this.cfg.userId } : {},
        ...context !== void 0 ? { context } : {},
        ...readables !== void 0 ? { readables } : {}
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(res.status === 429 ? "Too many messages. Please wait a moment." : `Gateway error (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    void token;
    const aiId = `ai_${crypto.randomUUID()}`;
    for await (const frame of readSse(res)) {
      const ev = frame.data;
      switch (ev.type) {
        case "thread": {
          const threadId = String(ev.threadId || "");
          if (!threadId) break;
          this.serverThread = threadId;
          if (this.boundThread) this.remember(this.boundThread, threadId);
          this.emit({ type: "thread", threadId });
          yield { event: "metadata", data: { thread_id: threadId } };
          break;
        }
        case "token": {
          const delta = String(ev.text || "");
          if (delta) {
            yield {
              event: "messages",
              data: [{ id: aiId, type: "AIMessageChunk", content: delta }, { langgraph_node: "agent" }]
            };
          }
          break;
        }
        case "sources": {
          const sources = Array.isArray(ev.sources) ? ev.sources : [];
          this.emit({ type: "citations", sources });
          yield { event: "custom", data: { type: "citations", sources } };
          break;
        }
        case "handoff": {
          if (!ev.handoff) break;
          const handoff = ev.handoff;
          this.emit({ type: "handoff", handoff, messageId: ev.messageId });
          yield { event: "custom", data: { type: "handoff", handoff, messageId: ev.messageId } };
          break;
        }
        case "error":
          throw new Error(String(ev.error || "Something went wrong."));
        default:
          break;
      }
    }
  }
};

// src/lib/storage.ts
var origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};
function getStoredToken(ns, apiUrl) {
  try {
    const raw = localStorage.getItem(`${ns}:token`);
    if (!raw) return void 0;
    const { origin: o, token } = JSON.parse(raw);
    return o && o === origin(apiUrl) ? token : void 0;
  } catch {
    return void 0;
  }
}
function setStoredToken(ns, apiUrl, token) {
  try {
    const o = origin(apiUrl);
    if (!token || !o) localStorage.removeItem(`${ns}:token`);
    else localStorage.setItem(`${ns}:token`, JSON.stringify({ origin: o, token }));
  } catch {
  }
}

// src/toast.tsx
import { useCallback as useCallback2, useRef as useRef2, useState as useState2 } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function useToastState() {
  const [items, setItems] = useState2([]);
  const seq = useRef2(0);
  const dismiss = useCallback2((id) => setItems((p) => p.filter((t) => t.id !== id)), []);
  const notify = useCallback2(({ kind = "info", title, description, duration = 6e3 }) => {
    const id = ++seq.current;
    setItems((p) => [...p.slice(-2), { id, kind, title, description }]);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);
  return { items, notify, dismiss };
}
function ToastViewport({ items, dismiss }) {
  if (!items.length) return null;
  return /* @__PURE__ */ jsx2("div", { className: "lgk lgk-toasts", role: "region", "aria-label": "Notifications", "aria-live": "polite", children: items.map((t) => /* @__PURE__ */ jsxs2("div", { className: "lgk-toast", "data-kind": t.kind, children: [
    /* @__PURE__ */ jsxs2("div", { children: [
      /* @__PURE__ */ jsx2("strong", { children: t.title }),
      t.description && /* @__PURE__ */ jsx2("p", { children: t.description })
    ] }),
    /* @__PURE__ */ jsx2("button", { type: "button", className: "lgk-icon-btn", "aria-label": "Dismiss", onClick: () => dismiss(t.id), children: "\u2715" })
  ] }, t.id)) });
}

// src/provider.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var LangGraphKitContext = createContext2(null);
var isMode = (v) => v === "light" || v === "dark" || v === "system";
function useSystemDark() {
  const [dark, setDark] = useState3(false);
  useEffect2(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark;
}
function LangGraphKitProvider({
  children,
  threadId: threadIdProp,
  onThreadIdChange,
  configurable,
  persistKey,
  branching = true,
  submitOptions,
  gateway,
  apiUrl = gateway?.baseUrl ?? "",
  assistantId = "",
  token,
  authScheme = "bearer",
  headers,
  theme: themeProp,
  defaultTheme = "system",
  onThemeChange,
  themeVars
}) {
  const [conn, setConn] = useState3({ apiUrl, assistantId, token, authScheme, headers });
  const connRef = useRef3(conn);
  connRef.current = conn;
  const toasts = useToastState();
  const notifyRef = useRef3(toasts.notify);
  notifyRef.current = toasts.notify;
  const [themeState, setThemeState] = useState3(defaultTheme);
  const theme = themeProp ?? themeState;
  const systemDark = useSystemDark();
  const resolvedTheme = theme === "system" ? systemDark ? "dark" : "light" : theme;
  const setTheme = useCallback3((mode) => {
    setThemeState(mode);
    onThemeChange?.(mode);
  }, [onThemeChange]);
  useEffect2(() => {
    if (!persistKey || themeProp !== void 0) return;
    try {
      const saved = localStorage.getItem(`${persistKey}:theme`);
      if (isMode(saved)) setThemeState(saved);
    } catch {
    }
  }, [persistKey, themeProp]);
  useEffect2(() => {
    if (!persistKey) return;
    try {
      localStorage.setItem(`${persistKey}:theme`, theme);
    } catch {
    }
  }, [persistKey, theme]);
  useEffect2(() => {
    const el = document.documentElement;
    el.dataset.lgkTheme = resolvedTheme;
    return () => {
      delete el.dataset.lgkTheme;
    };
  }, [resolvedTheme]);
  const themeStyle = useMemo(
    () => ({ display: "contents", colorScheme: resolvedTheme, ...themeVars?.[resolvedTheme] ?? {} }),
    [resolvedTheme, themeVars]
  );
  const [internalThread, setInternalThread] = useState3(threadIdProp ?? null);
  const threadId = threadIdProp !== void 0 ? threadIdProp : internalThread;
  const setThreadId = useCallback3((id) => {
    setInternalThread(id);
    onThreadIdChange?.(id);
  }, [onThreadIdChange]);
  const setConnection = useCallback3((patch) => {
    const prev = connRef.current;
    const moved = patch.apiUrl !== void 0 && patch.apiUrl !== prev.apiUrl || patch.assistantId !== void 0 && patch.assistantId !== prev.assistantId;
    setConn({ ...prev, ...patch });
    if (moved) setThreadId(null);
  }, [setThreadId]);
  const [hydrated, setHydrated] = useState3(!persistKey);
  useEffect2(() => {
    if (!persistKey) return;
    try {
      const raw = localStorage.getItem(persistKey);
      const saved = raw ? JSON.parse(raw) : {};
      setConn((p) => {
        const next = { ...p, ...saved };
        return { ...next, token: p.token ?? getStoredToken(persistKey, next.apiUrl) };
      });
    } catch {
    }
    setHydrated(true);
  }, [persistKey]);
  useEffect2(() => {
    if (!persistKey || !hydrated) return;
    try {
      const { apiUrl: apiUrl2, assistantId: assistantId2, authScheme: authScheme2 } = conn;
      localStorage.setItem(persistKey, JSON.stringify({ apiUrl: apiUrl2, assistantId: assistantId2, authScheme: authScheme2 }));
      setStoredToken(persistKey, apiUrl2, conn.token);
    } catch {
    }
  }, [conn, hydrated, persistKey]);
  const auth = useMemo(() => {
    const out = { ...conn.headers };
    let apiKey;
    if (conn.token) {
      if (conn.authScheme === "bearer" || !conn.authScheme) out.Authorization = `Bearer ${conn.token}`;
      else apiKey = conn.token;
    }
    if (conn.authScheme === "agent-builder") out["X-Auth-Scheme"] = "langsmith-api-key";
    return { apiKey, headers: out };
  }, [conn.token, conn.authScheme, conn.headers]);
  const isConfigured = gateway ? !!gateway.baseUrl && !!gateway.publishableKey : !!conn.apiUrl && !!conn.assistantId;
  const client = useMemo(
    () => new Client({ apiUrl: conn.apiUrl || void 0, apiKey: auth.apiKey, defaultHeaders: auth.headers }),
    [conn.apiUrl, auth]
  );
  const gatewayEvents = useMemo(() => createGatewayEventBus(), []);
  const gatewayBaseUrl = gateway?.baseUrl;
  const gatewayKey = gateway?.publishableKey;
  const gatewayUser = gateway?.userId;
  const gatewayCustomer = gateway?.customerId;
  const gatewayPersist = gateway?.persistKey;
  const gatewayFetchImpl = gateway?.fetch;
  const gatewayTransport = useMemo(
    () => gatewayBaseUrl && gatewayKey ? new GatewayTransport({
      baseUrl: gatewayBaseUrl,
      publishableKey: gatewayKey,
      userId: gatewayUser,
      customerId: gatewayCustomer,
      persistKey: gatewayPersist,
      fetch: gatewayFetchImpl
    }, gatewayEvents.emit) : null,
    [gatewayBaseUrl, gatewayKey, gatewayUser, gatewayCustomer, gatewayPersist, gatewayFetchImpl, gatewayEvents]
  );
  const [status, setStatus] = useState3("idle");
  useEffect2(() => {
    if (!isConfigured) {
      setStatus("idle");
      return;
    }
    let off = false;
    setStatus("checking");
    const fail = () => {
      if (off) return;
      setStatus("error");
      notifyRef.current({
        kind: "error",
        title: gatewayBaseUrl ? "Can't reach the agent gateway" : "Can't reach the LangGraph server",
        description: gatewayBaseUrl ? `Check that ${gatewayBaseUrl} is up and CORS allows this origin.` : `Check that it is running at ${conn.apiUrl}, your token is right, and CORS allows this origin.`,
        duration: 1e4
      });
    };
    if (gatewayBaseUrl) {
      fetch(`${gatewayBaseUrl.replace(/\/$/, "")}/health`).then((r) => r.ok ? !off && setStatus("ok") : fail()).catch(fail);
    } else {
      const h = new Headers(auth.headers);
      if (auth.apiKey) h.set("X-Api-Key", auth.apiKey);
      fetch(`${conn.apiUrl.replace(/\/$/, "")}/info`, { headers: h }).then((r) => r.ok ? !off && setStatus("ok") : fail()).catch(fail);
    }
    return () => {
      off = true;
    };
  }, [isConfigured, conn.apiUrl, auth, gatewayBaseUrl]);
  const [tools, setTools] = useState3({});
  const registerTool = useCallback3((def) => {
    setTools((p) => ({ ...p, [def.name]: def }));
    return () => setTools((p) => {
      const { [def.name]: _gone, ...rest } = p;
      return rest;
    });
  }, []);
  const [readables, setReadables] = useState3({});
  const setReadable = useCallback3((id, r) => {
    setReadables((p) => {
      if (r) return { ...p, [id]: r };
      const { [id]: _gone, ...rest } = p;
      return rest;
    });
  }, []);
  const [threadsRevision, setRev] = useState3(0);
  const bumpThreads = useCallback3(() => setRev((n) => n + 1), []);
  const value = useMemo(() => ({
    connection: conn,
    setConnection,
    isConfigured,
    status,
    client,
    auth,
    gateway,
    gatewayTransport,
    gatewayEvents,
    threadId,
    setThreadId,
    configurable,
    branching,
    submitOptions,
    tools,
    registerTool,
    readables,
    setReadable,
    threadsRevision,
    bumpThreads,
    notify: toasts.notify,
    theme,
    resolvedTheme,
    setTheme
  }), [
    conn,
    setConnection,
    isConfigured,
    status,
    client,
    auth,
    gateway,
    gatewayTransport,
    gatewayEvents,
    threadId,
    setThreadId,
    configurable,
    branching,
    submitOptions,
    tools,
    registerTool,
    readables,
    setReadable,
    threadsRevision,
    bumpThreads,
    toasts.notify,
    theme,
    resolvedTheme,
    setTheme
  ]);
  return /* @__PURE__ */ jsx3(LangGraphKitContext.Provider, { value, children: /* @__PURE__ */ jsxs3("div", { className: "lgk-theme-root", "data-theme": resolvedTheme, style: themeStyle, children: [
    /* @__PURE__ */ jsx3(ArtifactProvider, { children }),
    /* @__PURE__ */ jsx3(ToastViewport, { items: toasts.items, dismiss: toasts.dismiss })
  ] }) });
}
function useKit() {
  const context = useContext2(LangGraphKitContext);
  if (!context) {
    throw new Error("langgraph-kit: wrap your app in <LangGraphKitProvider>");
  }
  return context;
}

// src/use-agent.ts
import { parseHeadlessToolInterruptPayload, useStream } from "@langchain/langgraph-sdk/react";
import {
  isRemoveUIMessage,
  isUIMessage,
  uiMessageReducer
} from "@langchain/langgraph-sdk/react-ui";
import { useCallback as useCallback4, useEffect as useEffect3, useMemo as useMemo2, useRef as useRef4, useState as useState4 } from "react";

// src/lib/partial-json.ts
function parsePartialJson(input) {
  try {
    return JSON.parse(input);
  } catch {
  }
  let s = input.trim();
  for (let attempt = 0; attempt < 8 && s; attempt++) {
    try {
      return JSON.parse(close(s));
    } catch {
    }
    const cut = Math.max(s.lastIndexOf(","), s.lastIndexOf("{"), s.lastIndexOf("["));
    if (cut <= 0) break;
    s = s.slice(0, s[cut] === "," ? cut : cut + 1);
  }
  return void 0;
}
function close(s) {
  const stack = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.trimEnd();
  if (out.endsWith(",")) out = out.slice(0, -1);
  else if (out.endsWith(":")) out += "null";
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return out;
}

// src/content.ts
var DO_NOT_RENDER_ID_PREFIX = "do-not-render-";
var isHiddenMessage = (m) => !!m.id?.startsWith(DO_NOT_RENDER_ID_PREFIX);
function messageText(content) {
  if (typeof content === "string") return content;
  return content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
}
function messageReasoning(content) {
  if (typeof content === "string") return "";
  return content.map((b) => {
    if (b.type === "thinking") return b.thinking ?? "";
    if (b.type === "reasoning") return b.reasoning ?? b.summary?.map((s) => s.text ?? "").join("") ?? "";
    return "";
  }).filter(Boolean).join("\n\n");
}
function messageToolCalls(m) {
  if (m.type !== "ai") return [];
  const base2 = m.tool_calls ?? [];
  if (base2.some((tc) => tc.args && Object.keys(tc.args).length)) return base2;
  if (!Array.isArray(m.content)) return base2;
  const streamed = m.content.filter((b) => b.type === "tool_use" && b.id).map((b) => {
    const parsed = typeof b.input === "string" ? parsePartialJson(b.input) : b.input;
    const args = parsed && typeof parsed === "object" ? parsed : {};
    return { id: b.id, name: b.name ?? "", args };
  });
  return streamed.length ? streamed : base2;
}
function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// src/lib/ensure-tool-responses.ts
function ensureToolCallsHaveResponses(messages) {
  const answered = new Set(
    messages.filter((m) => m.type === "tool").map((m) => m.tool_call_id)
  );
  const out = [];
  for (const m of messages) {
    if (m.type !== "ai") continue;
    for (const tc of m.tool_calls ?? []) {
      if (!tc.id || answered.has(tc.id)) continue;
      out.push({
        type: "tool",
        tool_call_id: tc.id,
        id: `${DO_NOT_RENDER_ID_PREFIX}${newId()}`,
        name: tc.name,
        content: "Successfully handled tool call."
      });
    }
  }
  return out;
}

// src/use-agent.ts
var useTypedStream = useStream;
function useAgent() {
  const kit = useKit();
  const { connection, auth, threadId, setThreadId, bumpThreads, branching } = kit;
  const gateway = kit.gateway;
  const gatewayTransport = kit.gatewayTransport;
  const [sources, setSources] = useState4([]);
  const [handoff, setHandoff] = useState4(null);
  const [handoffMessages, setHandoffMessages] = useState4([]);
  const [serverThreadId, setServerThreadId] = useState4(null);
  const [feedbackSent, setFeedbackSent] = useState4(null);
  const stream = useTypedStream(gateway && gatewayTransport ? {
    transport: gatewayTransport,
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      bumpThreads();
    },
    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => ({ ...prev, ui: uiMessageReducer(prev.ui ?? [], event) }));
      }
    },
    onFinish: () => bumpThreads()
  } : {
    apiUrl: connection.apiUrl || void 0,
    apiKey: auth.apiKey,
    defaultHeaders: auth.headers,
    assistantId: connection.assistantId,
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      bumpThreads();
    },
    // Needed for edit / regenerate / branch switcher.
    fetchStateHistory: branching,
    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => ({ ...prev, ui: uiMessageReducer(prev.ui ?? [], event) }));
      }
    },
    onFinish: () => bumpThreads()
  });
  useEffect3(() => {
    if (!gateway) return;
    return kit.gatewayEvents.subscribe((event) => {
      if (event.type === "thread") setServerThreadId(event.threadId);
      else if (event.type === "citations") setSources(event.sources);
      else if (event.type === "handoff") setHandoff(event.handoff.status === "resolved" ? null : event.handoff);
    });
  }, [gateway, kit.gatewayEvents]);
  useEffect3(() => {
    if (threadId) return;
    setSources([]);
    setHandoff(null);
    setHandoffMessages([]);
    setFeedbackSent(null);
    setServerThreadId(null);
  }, [threadId]);
  const handoffId = handoff?.id;
  const handoffStatus = handoff?.status;
  useEffect3(() => {
    if (!gateway || !serverThreadId || !handoffId || handoffStatus === "resolved") return;
    let stopped = false;
    const tick = async () => {
      try {
        const data = await handoffSnapshot(gateway, serverThreadId);
        if (stopped) return;
        setHandoff(data.handoff && data.handoff.status !== "resolved" ? data.handoff : null);
        setHandoffMessages(data.messages ?? []);
      } catch {
      }
    };
    void tick();
    const timer = setInterval(tick, 5e3);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [gateway, serverThreadId, handoffId, handoffStatus]);
  const latest = useRef4({ kit, stream });
  latest.current = { kit, stream };
  const runConfig = useCallback4(() => {
    const { readables, configurable } = latest.current.kit;
    const list = Object.values(readables);
    return { configurable: { ...configurable, ...list.length ? { readables: list } : {} } };
  }, []);
  const opts = useCallback4(
    (extra = {}) => ({
      config: runConfig(),
      ...latest.current.kit.submitOptions,
      ...extra
    }),
    [runConfig]
  );
  const send = useCallback4(async (input) => {
    const { text = "", blocks = [], context } = typeof input === "string" ? { text: input } : input;
    const trimmed = text.trim();
    if (!trimmed && !blocks.length) return;
    const { stream: s } = latest.current;
    setSources([]);
    setFeedbackSent(null);
    const human = {
      id: newId(),
      type: "human",
      content: blocks.length ? [...trimmed ? [{ type: "text", text: trimmed }] : [], ...blocks] : trimmed
    };
    const placeholders = ensureToolCallsHaveResponses(s.messages);
    const ctx = context && Object.keys(context).length ? context : void 0;
    await s.submit(
      { messages: [...placeholders, human], ...ctx ? { context: ctx } : {} },
      opts({
        optimisticValues: (prev) => ({
          ...prev,
          messages: [...prev.messages ?? [], ...placeholders, human]
        })
      })
    );
  }, [opts]);
  const getBranch = useCallback4((message) => {
    const meta = latest.current.stream.getMessagesMetadata(message);
    return {
      branch: meta?.branch,
      branchOptions: meta?.branchOptions,
      parentCheckpoint: meta?.firstSeenState?.parent_checkpoint
    };
  }, []);
  const regenerate = useCallback4(
    (parentCheckpoint) => latest.current.stream.submit(void 0, opts({ checkpoint: parentCheckpoint })),
    [opts]
  );
  const editMessage = useCallback4(async (message, text) => {
    const { stream: s } = latest.current;
    const meta = s.getMessagesMetadata(message);
    const newMessage = { type: "human", content: text };
    await s.submit(
      { messages: [newMessage] },
      opts({
        checkpoint: meta?.firstSeenState?.parent_checkpoint,
        optimisticValues: (prev) => {
          const values2 = meta?.firstSeenState?.values;
          if (!values2) return prev;
          return { ...values2, messages: [...values2.messages ?? [], newMessage] };
        }
      })
    );
  }, [opts]);
  const resume = useCallback4(
    (value) => latest.current.stream.submit(null, opts({ command: { resume: value } })),
    [opts]
  );
  const submitDecisions = useCallback4(
    (decisions, interruptId) => resume(interruptId ? { [interruptId]: { decisions } } : { decisions }),
    [resume]
  );
  const continueRun = useCallback4(
    () => latest.current.stream.submit(null, opts()),
    [opts]
  );
  const resolve = useCallback4(
    () => latest.current.stream.submit(null, opts({ command: { goto: "__end__" } })),
    [opts]
  );
  const requestHuman = useCallback4(async (reason) => {
    const gw = latest.current.kit.gateway;
    if (!gw || !serverThreadId) {
      latest.current.kit.notify({
        kind: "info",
        title: "Start the conversation first",
        description: "Send a message, then ask for a colleague."
      });
      return;
    }
    try {
      const data = await requestHandoff(gw, serverThreadId, reason);
      setHandoff(data.handoff);
    } catch (e) {
      latest.current.kit.notify({
        kind: "error",
        title: "Can't reach a colleague",
        description: e instanceof Error ? e.message : String(e)
      });
    }
  }, [serverThreadId]);
  const feedback = useCallback4((rating) => {
    const gw = latest.current.kit.gateway;
    if (!gw || !serverThreadId || feedbackSent) return;
    const messages = latest.current.stream.messages ?? [];
    const human = [...messages].reverse().find((m) => m.type === "human");
    const ai = [...messages].reverse().find((m) => m.type === "ai");
    void sendFeedback(gw, {
      thread_id: serverThreadId,
      rating,
      ...human ? { user_message: messageText(human.content) } : {},
      ...ai ? { reply: messageText(ai.content) } : {}
    }).then(() => setFeedbackSent(rating)).catch(() => {
    });
  }, [serverThreadId, feedbackSent]);
  const raw = stream.values?.__interrupt__ ?? [];
  const pendingTools = useMemo2(() => (Array.isArray(raw) ? raw : []).flatMap((i) => {
    const p = parseHeadlessToolInterruptPayload(i.value);
    return p ? [{ interruptId: i.id, call: p.toolCall }] : [];
  }), [raw]);
  const pendingKey = pendingTools.map((p) => p.interruptId ?? p.call.id ?? p.call.name).join("|");
  const interrupts = stream.interrupts ?? [];
  const handled = useRef4(/* @__PURE__ */ new Set());
  useEffect3(() => {
    handled.current.clear();
  }, [threadId]);
  useEffect3(() => {
    if (stream.isLoading || !pendingTools.length) return;
    const keyOf = (p) => p.interruptId ?? p.call.id ?? p.call.name;
    const fresh = pendingTools.filter((p) => !handled.current.has(keyOf(p)));
    if (!fresh.length) return;
    fresh.forEach((p) => handled.current.add(keyOf(p)));
    void (async () => {
      const done = await Promise.all(fresh.map(async (p) => {
        const def = latest.current.kit.tools[p.call.name];
        let value;
        if (!def?.handler) value = { error: `No frontend handler registered for "${p.call.name}"` };
        else {
          try {
            value = await def.handler(p.call.args);
          } catch (e) {
            value = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        return { ...p, value };
      }));
      const byId = done.every((d) => d.interruptId);
      const resumeValue = byId ? Object.fromEntries(done.map((d) => [d.interruptId, d.call.id ? { [d.call.id]: d.value } : d.value])) : done.length === 1 && !done[0].call.id ? done[0].value : Object.fromEntries(done.map((d) => [d.call.id ?? d.call.name, d.value]));
      await latest.current.stream.submit(null, opts({ command: { resume: resumeValue } }));
    })().catch(() => {
    });
  }, [stream.isLoading, pendingKey]);
  const values = stream.values;
  return {
    messages: stream.messages,
    isLoading: stream.isLoading,
    error: stream.error ? stream.error instanceof Error ? stream.error.message : String(stream.error) : null,
    /** Pending human-in-the-loop interrupts (frontend-tool pauses are handled for you). */
    interrupts,
    interrupt: interrupts[0],
    /** Frontend tool calls the browser is about to run or is running. */
    pendingToolCallIds: pendingTools.map((p) => p.call.id).filter(Boolean),
    /** Raw thread state, e.g. for a "view state" panel. */
    values,
    /** Generative UI messages emitted by the graph (`ui` channel). */
    ui: values?.ui ?? [],
    threadId,
    send,
    stop: stream.stop,
    regenerate,
    editMessage,
    getBranch,
    setBranch: (branch) => stream.setBranch(branch),
    resume,
    continueRun,
    submitDecisions,
    resolve,
    newThread: () => setThreadId(null),
    selectThread: (id) => setThreadId(id),
    /** Gateway mode: citations for the current reply. */
    sources,
    /** Gateway mode: the open (or most recent) human handoff, if any. */
    handoff,
    handoffMessages,
    /** Gateway mode: ask a human to join this conversation. */
    requestHuman,
    /** Gateway mode: rate the last reply. */
    feedback,
    feedbackSent,
    /** Gateway mode: the server-side thread id (differs from the SDK client id). */
    serverThreadId,
    isGateway: !!gateway,
    /** Escape hatch to the raw SDK stream. */
    stream
  };
}

// src/agent-context.tsx
import { createContext as createContext3, useContext as useContext3 } from "react";
var AgentContext = createContext3(null);
function useAgentContext() {
  const v = useContext3(AgentContext);
  if (!v) throw new Error("langgraph-kit: useAgentContext must be used inside <Chat> (or Playground / ChatPopup / ChatSidebar)");
  return v;
}

// src/hooks.ts
import { useCallback as useCallback5, useEffect as useEffect4, useId as useId2, useRef as useRef5, useState as useState5 } from "react";
function useAgentTool(def) {
  const { registerTool } = useKit();
  const ref = useRef5(def);
  ref.current = def;
  const hasHandler = !!def.handler;
  const hasRender = !!def.render;
  useEffect4(() => registerTool({
    name: def.name,
    handler: hasHandler ? (a) => ref.current.handler(a) : void 0,
    render: hasRender ? (p) => ref.current.render(p) : void 0
  }), [def.name, hasHandler, hasRender, registerTool]);
}
function useAgentReadable(description, value) {
  const { setReadable } = useKit();
  const id = useId2();
  const serialized = JSON.stringify(value);
  useEffect4(() => {
    setReadable(id, { description, value: JSON.parse(serialized ?? "null") });
    return () => setReadable(id, null);
  }, [id, description, serialized, setReadable]);
}
function useAssistants() {
  const { client, connection, isConfigured } = useKit();
  const [state, setState] = useState5(
    { assistants: [], loading: isConfigured, error: null }
  );
  const [tick, setTick] = useState5(0);
  useEffect4(() => {
    if (!isConfigured) {
      setState({ assistants: [], loading: false, error: null });
      return;
    }
    let off = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    client.assistants.search({ limit: 100 }).then((assistants) => !off && setState({ assistants, loading: false, error: null })).catch((e) => !off && setState({ assistants: [], loading: false, error: e?.message ?? String(e) }));
    return () => {
      off = true;
    };
  }, [client, connection.apiUrl, isConfigured, tick]);
  return { ...state, refresh: useCallback5(() => setTick((n) => n + 1), []) };
}
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var threadMetadata = (assistantId) => UUID.test(assistantId) ? { assistant_id: assistantId } : { graph_id: assistantId };
function useThreads({ limit = 100 } = {}) {
  const { client, connection, isConfigured, threadsRevision, bumpThreads, threadId, setThreadId } = useKit();
  const [threads, setThreads] = useState5([]);
  const [loading, setLoading] = useState5(isConfigured);
  useEffect4(() => {
    if (!isConfigured) {
      setThreads([]);
      setLoading(false);
      return;
    }
    let off = false;
    client.threads.search({
      limit,
      sortBy: "updated_at",
      sortOrder: "desc",
      metadata: threadMetadata(connection.assistantId)
    }).then((rows) => {
      if (off) return;
      setThreads(rows.map((t) => {
        const msgs = t.values?.messages ?? [];
        const first = msgs.find((m) => m.type === "human");
        let title = first ? messageText(first.content).trim().slice(0, 80) : "";
        if (!title && first && Array.isArray(first.content) && first.content.length) title = "Attachment";
        return { id: t.thread_id, title: title || "Untitled chat", updatedAt: t.updated_at };
      }));
      setLoading(false);
    }).catch(() => !off && setLoading(false));
    return () => {
      off = true;
    };
  }, [client, connection.assistantId, isConfigured, threadsRevision, limit]);
  const remove = useCallback5(async (id) => {
    await client.threads.delete(id);
    if (id === threadId) setThreadId(null);
    bumpThreads();
  }, [client, threadId, setThreadId, bumpThreads]);
  return { threads, loading, remove };
}

// src/use-file-upload.ts
import { useCallback as useCallback6, useEffect as useEffect5, useRef as useRef6, useState as useState6 } from "react";

// src/lib/multimodal.ts
var IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
var SUPPORTED_FILE_TYPES = [...IMAGE_TYPES, "application/pdf"];
var ACCEPT_ATTR = SUPPORTED_FILE_TYPES.join(",");
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
async function fileToContentBlock(file) {
  if (!SUPPORTED_FILE_TYPES.includes(file.type)) throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  const data = await fileToBase64(file);
  if (IMAGE_TYPES.includes(file.type)) return { type: "image", mimeType: file.type, data, metadata: { name: file.name } };
  return { type: "file", mimeType: "application/pdf", data, metadata: { filename: file.name } };
}
function isMultimodalBlock(block) {
  if (typeof block !== "object" || block === null) return false;
  const b = block;
  if (typeof b.mimeType !== "string") return false;
  if (b.type === "image") return b.mimeType.startsWith("image/");
  if (b.type === "file") return b.mimeType.startsWith("image/") || b.mimeType === "application/pdf";
  return false;
}
var blockDataUrl = (b) => `data:${b.mimeType};base64,${b.data}`;
var blockName = (b) => String(b.metadata?.filename ?? b.metadata?.name ?? (b.type === "image" ? "image" : "PDF file"));

// src/use-file-upload.ts
var isDuplicate = (f, blocks) => blocks.some((b) => {
  const meta = b.metadata ?? {};
  return b.mimeType === f.type && (meta.filename ?? meta.name) === f.name;
});
function useFileUpload({ enabled = true, onError } = {}) {
  const [blocks, setBlocks] = useState6([]);
  const blocksRef = useRef6(blocks);
  blocksRef.current = blocks;
  const [dragOver, setDragOver] = useState6(false);
  const depth = useRef6(0);
  const onErrorRef = useRef6(onError);
  onErrorRef.current = onError;
  const addFiles = useCallback6(async (files) => {
    const valid = files.filter((f) => SUPPORTED_FILE_TYPES.includes(f.type));
    if (valid.length < files.length) onErrorRef.current?.("Only JPEG, PNG, GIF, WEBP images and PDFs can be attached.");
    const fresh = valid.filter((f) => !isDuplicate(f, blocksRef.current));
    if (fresh.length < valid.length) onErrorRef.current?.("That file is already attached.");
    if (!fresh.length) return;
    try {
      const next = await Promise.all(fresh.map(fileToContentBlock));
      setBlocks((p) => [...p, ...next]);
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "Could not read the file.");
    }
  }, []);
  const handleFileUpload = useCallback6(async (e) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await addFiles(files);
  }, [addFiles]);
  const handlePaste = useCallback6((e) => {
    if (!enabled) return;
    const files = Array.from(e.clipboardData.items).filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f) => !!f);
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  }, [enabled, addFiles]);
  useEffect5(() => {
    if (!enabled) return;
    const hasFiles = (e) => !!e.dataTransfer?.types?.includes("Files");
    const enter = (e) => {
      if (hasFiles(e)) {
        depth.current += 1;
        setDragOver(true);
      }
    };
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragOver(false);
    };
    const over = (e) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragOver(false);
      void addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [enabled, addFiles]);
  return {
    blocks,
    dragOver,
    handleFileUpload,
    handlePaste,
    removeBlock: (index) => setBlocks((p) => p.filter((_, i) => i !== index)),
    reset: () => setBlocks([])
  };
}

// src/components/Chat.tsx
import { useEffect as useEffect8, useState as useState15 } from "react";

// src/use-stick-to-bottom.ts
import { useCallback as useCallback7, useEffect as useEffect6, useRef as useRef7, useState as useState7 } from "react";
function useStickToBottom() {
  const scrollRef = useRef7(null);
  const contentRef = useRef7(null);
  const pinned = useRef7(true);
  const [isAtBottom, setAtBottom] = useState7(true);
  const scrollToBottom = useCallback7((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useEffect6(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      pinned.current = atBottom;
      setAtBottom(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (pinned.current) el.scrollTop = el.scrollHeight;
      });
      ro.observe(content);
    }
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, []);
  return { scrollRef, contentRef, isAtBottom, scrollToBottom };
}

// src/components/Composer.tsx
import { useEffect as useEffect7, useRef as useRef8, useState as useState8 } from "react";

// src/components/ui/icons.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function Icon({ children, ...p }) {
  return /* @__PURE__ */ jsx4(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: "1em",
      height: "1em",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
      focusable: "false",
      ...p,
      children
    }
  );
}
var CopyIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }),
  /* @__PURE__ */ jsx4("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" })
] });
var CheckIcon = (p) => /* @__PURE__ */ jsx4(Icon, { ...p, children: /* @__PURE__ */ jsx4("path", { d: "M20 6 9 17l-5-5" }) });
var RefreshIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }),
  /* @__PURE__ */ jsx4("path", { d: "M21 3v5h-5" }),
  /* @__PURE__ */ jsx4("path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }),
  /* @__PURE__ */ jsx4("path", { d: "M8 16H3v5" })
] });
var PencilIcon = (p) => /* @__PURE__ */ jsx4(Icon, { ...p, children: /* @__PURE__ */ jsx4("path", { d: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" }) });
var SendIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "m22 2-7 20-4-9-9-4Z" }),
  /* @__PURE__ */ jsx4("path", { d: "M22 2 11 13" })
] });
var XIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "M18 6 6 18" }),
  /* @__PURE__ */ jsx4("path", { d: "m6 6 12 12" })
] });
var ChevronLeftIcon = (p) => /* @__PURE__ */ jsx4(Icon, { ...p, children: /* @__PURE__ */ jsx4("path", { d: "m15 18-6-6 6-6" }) });
var ChevronRightIcon = (p) => /* @__PURE__ */ jsx4(Icon, { ...p, children: /* @__PURE__ */ jsx4("path", { d: "m9 18 6-6-6-6" }) });
var ChevronDownIcon = (p) => /* @__PURE__ */ jsx4(Icon, { ...p, children: /* @__PURE__ */ jsx4("path", { d: "m6 9 6 6 6-6" }) });
var ChevronUpIcon = (p) => /* @__PURE__ */ jsx4(Icon, { ...p, children: /* @__PURE__ */ jsx4("path", { d: "m18 15-6-6-6 6" }) });
var PlusIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "M5 12h14" }),
  /* @__PURE__ */ jsx4("path", { d: "M12 5v14" })
] });
var PaperclipIcon = (p) => /* @__PURE__ */ jsx4(Icon, { ...p, children: /* @__PURE__ */ jsx4("path", { d: "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" }) });
var FileIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }),
  /* @__PURE__ */ jsx4("path", { d: "M14 2v4a2 2 0 0 0 2 2h4" })
] });
var ArrowDownIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "M12 5v14" }),
  /* @__PURE__ */ jsx4("path", { d: "m19 12-7 7-7-7" })
] });
var PanelLeftIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }),
  /* @__PURE__ */ jsx4("path", { d: "M9 3v18" })
] });
var NewChatIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" }),
  /* @__PURE__ */ jsx4("path", { d: "M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" })
] });
var TrashIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "M3 6h18" }),
  /* @__PURE__ */ jsx4("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }),
  /* @__PURE__ */ jsx4("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" })
] });
var SpinnerIcon = (p) => /* @__PURE__ */ jsx4(Icon, { ...p, className: `lgk-spin ${p.className ?? ""}`, children: /* @__PURE__ */ jsx4("path", { d: "M21 12a9 9 0 1 1-6.22-8.56" }) });
var HistoryIcon = (p) => /* @__PURE__ */ jsxs4(Icon, { ...p, children: [
  /* @__PURE__ */ jsx4("path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }),
  /* @__PURE__ */ jsx4("path", { d: "M3 3v5h5" }),
  /* @__PURE__ */ jsx4("path", { d: "M12 7v5l4 2" })
] });

// src/components/MultimodalPreview.tsx
import { Fragment as Fragment2, jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function MultimodalPreview({ block, onRemove, size = "md" }) {
  const name = blockName(block);
  return /* @__PURE__ */ jsxs5("div", { className: "lgk-attachment", "data-size": size, "data-kind": block.type === "image" ? "image" : "file", children: [
    block.type === "image" || block.mimeType.startsWith("image/") ? /* @__PURE__ */ jsx5("img", { src: blockDataUrl(block), alt: name }) : /* @__PURE__ */ jsxs5(Fragment2, { children: [
      /* @__PURE__ */ jsx5(FileIcon, {}),
      /* @__PURE__ */ jsx5("span", { children: name })
    ] }),
    onRemove && /* @__PURE__ */ jsx5("button", { type: "button", className: "lgk-attachment-remove", onClick: onRemove, "aria-label": `Remove ${name}`, title: "Remove", children: /* @__PURE__ */ jsx5(XIcon, {}) })
  ] });
}
function ContentBlocksPreview({ blocks, onRemove }) {
  if (!blocks.length) return null;
  return /* @__PURE__ */ jsx5("div", { className: "lgk-attachments", children: blocks.map((b, i) => /* @__PURE__ */ jsx5(MultimodalPreview, { block: b, size: "md", onRemove: onRemove ? () => onRemove(i) : void 0 }, `${blockName(b)}-${i}`)) });
}

// src/components/Composer.tsx
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
function Composer({ placeholder, busy, disabled, upload, toolToggle, onSend, onStop, onError }) {
  const [text, setText] = useState8("");
  const ref = useRef8(null);
  const files = useFileUpload({ enabled: upload && !disabled, onError });
  useEffect7(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);
  const canSend = !!text.trim() || files.blocks.length > 0;
  const send = () => {
    if (!canSend || busy || disabled) return;
    onSend({ text, blocks: files.blocks });
    setText("");
    files.reset();
  };
  return /* @__PURE__ */ jsx6("div", { className: "lgk-composer-wrap", children: /* @__PURE__ */ jsxs6("div", { className: "lgk-composer", "data-dragover": files.dragOver || void 0, children: [
    /* @__PURE__ */ jsx6(ContentBlocksPreview, { blocks: files.blocks, onRemove: files.removeBlock }),
    /* @__PURE__ */ jsx6(
      "textarea",
      {
        ref,
        rows: 1,
        value: text,
        placeholder,
        disabled,
        "aria-label": "Message",
        onChange: (e) => setText(e.target.value),
        onPaste: upload ? files.handlePaste : void 0,
        onKeyDown: (e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }
      }
    ),
    /* @__PURE__ */ jsxs6("div", { className: "lgk-composer-bar", children: [
      upload && /* @__PURE__ */ jsxs6("label", { className: "lgk-attach", title: "Attach images or PDFs", children: [
        /* @__PURE__ */ jsx6(PaperclipIcon, {}),
        " ",
        /* @__PURE__ */ jsx6("span", { children: "Attach" }),
        /* @__PURE__ */ jsx6("input", { type: "file", multiple: true, accept: ACCEPT_ATTR, onChange: files.handleFileUpload, disabled, hidden: true })
      ] }),
      toolToggle && /* @__PURE__ */ jsxs6("label", { className: "lgk-switch", children: [
        /* @__PURE__ */ jsx6("input", { type: "checkbox", role: "switch", checked: toolToggle.checked, onChange: (e) => toolToggle.onChange(e.target.checked) }),
        /* @__PURE__ */ jsx6("span", { children: "Hide tool calls" })
      ] }),
      busy ? /* @__PURE__ */ jsxs6("button", { type: "button", className: "lgk-stop", onClick: onStop, children: [
        /* @__PURE__ */ jsx6(SpinnerIcon, {}),
        " Stop"
      ] }) : /* @__PURE__ */ jsx6("button", { type: "button", className: "lgk-send", onClick: send, disabled: !canSend || disabled, children: "Send" })
    ] }),
    files.dragOver && /* @__PURE__ */ jsx6("div", { className: "lgk-drop-hint", children: "Drop images or PDFs to attach" })
  ] }) });
}

// src/lib/hitl.ts
function isHitlRequest(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  if (!Array.isArray(v.action_requests) || !v.action_requests.length) return false;
  if (!Array.isArray(v.review_configs) || !v.review_configs.length) return false;
  return v.action_requests.every((a) => a && typeof a.name === "string" && a.args !== null && typeof a.args === "object") && v.review_configs.every((c) => c && typeof c.action_name === "string" && Array.isArray(c.allowed_decisions));
}
var allowedFor = (req, action) => req.review_configs.find((c) => c.action_name === action.name)?.allowed_decisions ?? ["approve", "reject"];
var show = (v) => typeof v === "string" ? v : JSON.stringify(v, null, 2);
function initialDraft(action, allowed) {
  return {
    type: allowed.length === 1 ? allowed[0] : void 0,
    args: Object.fromEntries(Object.entries(action.args).map(([k, v]) => [k, show(v)])),
    message: ""
  };
}
function buildDecision(action, allowed, draft) {
  if (!draft.type) return { error: `Choose a decision for "${action.name}".` };
  if (draft.type === "approve") return { decision: { type: "approve" } };
  if (draft.type === "reject") {
    const message = draft.message.trim();
    return message ? { decision: { type: "reject", message } } : { error: `Add a reason for rejecting "${action.name}".` };
  }
  const args = {};
  let changed = false;
  for (const [key, original] of Object.entries(action.args)) {
    const raw = draft.args[key] ?? "";
    if (raw !== show(original)) changed = true;
    if (typeof original === "string") {
      args[key] = raw;
      continue;
    }
    try {
      args[key] = JSON.parse(raw);
    } catch {
      return { error: `"${key}" in "${action.name}" must be valid JSON.` };
    }
  }
  if (!changed && allowed.includes("approve")) return { decision: { type: "approve" } };
  return { decision: { type: "edit", edited_action: { name: action.name, args } } };
}

// src/components/interrupts/GenericInterrupt.tsx
import { useState as useState10 } from "react";

// src/components/ui/KeyValueTable.tsx
import { useState as useState9 } from "react";
import { Fragment as Fragment3, jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
var isComplex = (v) => Array.isArray(v) || typeof v === "object" && v !== null;
var isUrl = (v) => typeof v === "string" && /^https?:\/\//.test(v);
function Value({ value }) {
  if (isComplex(value)) return /* @__PURE__ */ jsx7("code", { className: "lgk-inline-code", children: JSON.stringify(value, null, 2) });
  if (isUrl(value)) return /* @__PURE__ */ jsx7("a", { href: value, target: "_blank", rel: "noopener noreferrer", children: value });
  return /* @__PURE__ */ jsx7(Fragment3, { children: String(value) });
}
function KeyValueTable({ data, maxRows }) {
  const [all, setAll] = useState9(false);
  const entries = Array.isArray(data) ? data.map((v, i) => [i, v]) : Object.entries(data);
  const limited = maxRows && !all ? entries.slice(0, maxRows) : entries;
  return /* @__PURE__ */ jsxs7(Fragment3, { children: [
    /* @__PURE__ */ jsx7("table", { className: "lgk-kv", children: /* @__PURE__ */ jsx7("tbody", { children: limited.map(([k, v]) => /* @__PURE__ */ jsxs7("tr", { children: [
      /* @__PURE__ */ jsx7("th", { scope: "row", children: k }),
      /* @__PURE__ */ jsx7("td", { children: /* @__PURE__ */ jsx7(Value, { value: v }) })
    ] }, k)) }) }),
    maxRows && entries.length > maxRows && /* @__PURE__ */ jsxs7("button", { type: "button", className: "lgk-more", onClick: () => setAll((a) => !a), children: [
      all ? /* @__PURE__ */ jsx7(ChevronUpIcon, {}) : /* @__PURE__ */ jsx7(ChevronDownIcon, {}),
      " ",
      all ? "Show less" : `Show ${entries.length - maxRows} more`
    ] })
  ] });
}
function ExpandableText({ text, maxLines = 4, maxChars = 500 }) {
  const [open, setOpen] = useState9(false);
  const lines = text.split("\n");
  const long = lines.length > maxLines || text.length > maxChars;
  const shown = !long || open ? text : text.length > maxChars ? `${text.slice(0, maxChars)}\u2026` : `${lines.slice(0, maxLines).join("\n")}
\u2026`;
  return /* @__PURE__ */ jsxs7(Fragment3, { children: [
    /* @__PURE__ */ jsx7("pre", { className: "lgk-pre", children: shown }),
    long && /* @__PURE__ */ jsxs7("button", { type: "button", className: "lgk-more", onClick: () => setOpen((o) => !o), children: [
      open ? /* @__PURE__ */ jsx7(ChevronUpIcon, {}) : /* @__PURE__ */ jsx7(ChevronDownIcon, {}),
      " ",
      open ? "Show less" : "Show more"
    ] })
  ] });
}

// src/components/interrupts/GenericInterrupt.tsx
import { Fragment as Fragment4, jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
function GenericInterrupt({ value }) {
  const agent = useAgentContext();
  const [text, setText] = useState10("");
  const breakpoint = value === void 0;
  const answer = () => {
    let v = text;
    try {
      v = JSON.parse(text);
    } catch {
    }
    void agent.resume(v);
  };
  return /* @__PURE__ */ jsxs8(Fragment4, { children: [
    /* @__PURE__ */ jsx8("strong", { children: breakpoint ? "The run is paused at a breakpoint" : "The agent is waiting for you" }),
    !breakpoint && (value && typeof value === "object" ? /* @__PURE__ */ jsx8(KeyValueTable, { data: value, maxRows: Array.isArray(value) ? 5 : void 0 }) : /* @__PURE__ */ jsx8(ExpandableText, { text: String(value) })),
    breakpoint ? /* @__PURE__ */ jsx8("div", { className: "lgk-interrupt-row", children: /* @__PURE__ */ jsx8("button", { type: "button", className: "lgk-primary", onClick: () => void agent.continueRun(), children: "Continue" }) }) : /* @__PURE__ */ jsxs8("div", { className: "lgk-interrupt-row", children: [
      /* @__PURE__ */ jsx8(
        "input",
        {
          value: text,
          onChange: (e) => setText(e.target.value),
          "aria-label": "Your answer",
          placeholder: "Your answer (text or JSON)",
          onKeyDown: (e) => e.key === "Enter" && text && answer()
        }
      ),
      /* @__PURE__ */ jsx8("button", { type: "button", className: "lgk-primary", onClick: answer, disabled: !text, children: "Continue" })
    ] })
  ] });
}

// src/components/interrupts/HitlReview.tsx
import { useState as useState11 } from "react";
import { jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
var pretty = (name) => {
  const s = name.replace(/[_-]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
var LABEL = { approve: "Approve", edit: "Edit", reject: "Reject" };
function ActionReview({ action, allowed, draft, onChange }) {
  return /* @__PURE__ */ jsxs9("fieldset", { className: "lgk-hitl-action", children: [
    /* @__PURE__ */ jsx9("legend", { children: pretty(action.name) }),
    action.description && /* @__PURE__ */ jsx9("p", { className: "lgk-muted-block", children: action.description }),
    draft.type === "edit" ? /* @__PURE__ */ jsx9("div", { className: "lgk-hitl-edit", children: Object.keys(action.args).map((key) => /* @__PURE__ */ jsxs9("label", { children: [
      /* @__PURE__ */ jsx9("span", { children: key }),
      /* @__PURE__ */ jsx9(
        "textarea",
        {
          rows: Math.min(8, Math.max(1, draft.args[key]?.split("\n").length ?? 1)),
          value: draft.args[key] ?? "",
          onChange: (e) => onChange({ ...draft, args: { ...draft.args, [key]: e.target.value } })
        }
      )
    ] }, key)) }) : /* @__PURE__ */ jsx9(KeyValueTable, { data: action.args }),
    draft.type === "reject" && /* @__PURE__ */ jsxs9("label", { className: "lgk-hitl-reason", children: [
      /* @__PURE__ */ jsx9("span", { children: "Reason" }),
      /* @__PURE__ */ jsx9("textarea", { rows: 2, placeholder: "Tell the agent why", value: draft.message, onChange: (e) => onChange({ ...draft, message: e.target.value }) })
    ] }),
    /* @__PURE__ */ jsx9("div", { className: "lgk-hitl-choices", role: "radiogroup", "aria-label": `Decision for ${action.name}`, children: allowed.map((t) => /* @__PURE__ */ jsx9(
      "button",
      {
        type: "button",
        role: "radio",
        "aria-checked": draft.type === t,
        "data-selected": draft.type === t,
        "data-kind": t,
        onClick: () => onChange({ ...draft, type: t }),
        children: LABEL[t]
      },
      t
    )) })
  ] });
}
function HitlReview({ interrupts }) {
  const agent = useAgentContext();
  const { notify } = useKit();
  const [active, setActive] = useState11(0);
  const [drafts, setDrafts] = useState11({});
  const current = interrupts[Math.min(active, interrupts.length - 1)];
  const request = current.value;
  const key = current.id ?? String(active);
  const list = drafts[key] ?? request.action_requests.map((a) => initialDraft(a, allowedFor(request, a)));
  const idForResume = interrupts.length > 1 ? current.id : void 0;
  const send = (decisions) => {
    agent.submitDecisions(decisions, idForResume).then(
      () => void 0,
      (e) => notify({ kind: "error", title: "Couldn't send your decision", description: e instanceof Error ? e.message : void 0 })
    );
  };
  const submit = () => {
    const decisions = [];
    for (let i = 0; i < request.action_requests.length; i++) {
      const a = request.action_requests[i];
      const { decision, error } = buildDecision(a, allowedFor(request, a), list[i]);
      if (!decision) {
        notify({ kind: "error", title: "Can't submit yet", description: error });
        return;
      }
      decisions.push(decision);
    }
    send(decisions);
  };
  const allApprovable = request.action_requests.every((a) => allowedFor(request, a).includes("approve"));
  const complete = list.every((d) => d.type);
  return /* @__PURE__ */ jsxs9("div", { className: "lgk-hitl", children: [
    /* @__PURE__ */ jsx9("strong", { children: "Review needed" }),
    interrupts.length > 1 && /* @__PURE__ */ jsx9("div", { className: "lgk-hitl-tabs", role: "tablist", children: interrupts.map((it, i) => /* @__PURE__ */ jsx9("button", { type: "button", role: "tab", "aria-selected": i === active, onClick: () => setActive(i), children: pretty(it.value.action_requests[0]?.name ?? `Request ${i + 1}`) }, it.id ?? i)) }),
    request.action_requests.map((a, i) => /* @__PURE__ */ jsx9(
      ActionReview,
      {
        action: a,
        allowed: allowedFor(request, a),
        draft: list[i],
        onChange: (d) => setDrafts((p) => ({ ...p, [key]: list.map((x, j) => j === i ? d : x) }))
      },
      `${key}-${i}`
    )),
    /* @__PURE__ */ jsxs9("div", { className: "lgk-hitl-footer", children: [
      /* @__PURE__ */ jsx9("button", { type: "button", className: "lgk-ghost", onClick: () => void agent.resolve(), title: "End the run without answering", children: "Mark as resolved" }),
      request.action_requests.length > 1 && allApprovable && /* @__PURE__ */ jsx9("button", { type: "button", className: "lgk-ghost", onClick: () => send(request.action_requests.map(() => ({ type: "approve" }))), children: "Approve all" }),
      /* @__PURE__ */ jsx9("button", { type: "button", className: "lgk-primary", disabled: !complete, onClick: submit, children: "Submit" })
    ] }),
    /* @__PURE__ */ jsxs9("details", { className: "lgk-hitl-state", children: [
      /* @__PURE__ */ jsx9("summary", { children: "View thread state" }),
      /* @__PURE__ */ jsx9("pre", { className: "lgk-pre", children: JSON.stringify(agent.values ?? {}, null, 2) })
    ] })
  ] });
}

// src/components/interrupts/InterruptView.tsx
import { jsx as jsx10 } from "react/jsx-runtime";
function InterruptView({ interrupts, render }) {
  const agent = useAgentContext();
  if (!interrupts.length) return null;
  const custom = render?.({ interrupt: interrupts[0], value: interrupts[0].value, resume: agent.resume });
  if (custom != null && custom !== false) return /* @__PURE__ */ jsx10("div", { className: "lgk-interrupt", children: custom });
  const hitl = interrupts.filter((i) => isHitlRequest(i.value));
  return /* @__PURE__ */ jsx10("div", { className: "lgk-interrupt", children: hitl.length ? /* @__PURE__ */ jsx10(HitlReview, { interrupts: hitl }) : /* @__PURE__ */ jsx10(GenericInterrupt, { value: interrupts[0].value }) });
}

// src/components/messages/AssistantMessage.tsx
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";

// src/components/Markdown.tsx
import { Children, memo, isValidElement, useState as useState12 } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// src/components/ui/IconButton.tsx
import { jsx as jsx11 } from "react/jsx-runtime";
function IconButton({ label, children, className = "", ...rest }) {
  return /* @__PURE__ */ jsx11("button", { type: "button", className: `lgk-icon-btn ${className}`, title: label, "aria-label": label, ...rest, children });
}

// src/components/Markdown.tsx
import { jsx as jsx12, jsxs as jsxs10 } from "react/jsx-runtime";
function CodeBlock({ children }) {
  const [copied, setCopied] = useState12(false);
  const child = Children.toArray(children)[0];
  let language = "";
  let code = "";
  if (isValidElement(child)) {
    const el = child;
    language = /language-([\w-]+)/.exec(el.props.className ?? "")?.[1] ?? "";
    code = String(el.props.children ?? "").replace(/\n$/, "");
  }
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    });
  };
  return /* @__PURE__ */ jsxs10("div", { className: "lgk-codeblock", children: [
    /* @__PURE__ */ jsxs10("div", { className: "lgk-codeblock-head", children: [
      /* @__PURE__ */ jsx12("span", { children: language || "text" }),
      /* @__PURE__ */ jsx12(IconButton, { label: copied ? "Copied" : "Copy code", onClick: copy, children: copied ? /* @__PURE__ */ jsx12(CheckIcon, {}) : /* @__PURE__ */ jsx12(CopyIcon, {}) })
    ] }),
    /* @__PURE__ */ jsx12("pre", { children })
  ] });
}
var base = {
  pre: ({ children }) => /* @__PURE__ */ jsx12(CodeBlock, { children }),
  a: ({ node: _n, ...props }) => /* @__PURE__ */ jsx12("a", { ...props, target: "_blank", rel: "noopener noreferrer" }),
  table: ({ node: _n, ...props }) => /* @__PURE__ */ jsx12("div", { className: "lgk-table-wrap", children: /* @__PURE__ */ jsx12("table", { ...props }) })
};
var Markdown = memo(function Markdown2({ children, remarkPlugins = [], rehypePlugins, components }) {
  return /* @__PURE__ */ jsx12("div", { className: "lgk-md", children: /* @__PURE__ */ jsx12(
    ReactMarkdown,
    {
      remarkPlugins: [remarkGfm, ...remarkPlugins ?? []],
      rehypePlugins,
      components: { ...base, ...components },
      children
    }
  ) });
});

// src/components/messages/MessageControls.tsx
import { useState as useState13 } from "react";
import { jsx as jsx13, jsxs as jsxs11 } from "react/jsx-runtime";
function BranchSwitcher({ branch, branchOptions, onSelect, disabled }) {
  if (!branch || !branchOptions || branchOptions.length < 2) return null;
  const i = branchOptions.indexOf(branch);
  return /* @__PURE__ */ jsxs11("div", { className: "lgk-branch", role: "group", "aria-label": "Message versions", children: [
    /* @__PURE__ */ jsx13(IconButton, { label: "Previous version", disabled: disabled || i <= 0, onClick: () => onSelect(branchOptions[i - 1]), children: /* @__PURE__ */ jsx13(ChevronLeftIcon, {}) }),
    /* @__PURE__ */ jsxs11("span", { children: [
      i + 1,
      " / ",
      branchOptions.length
    ] }),
    /* @__PURE__ */ jsx13(IconButton, { label: "Next version", disabled: disabled || i >= branchOptions.length - 1, onClick: () => onSelect(branchOptions[i + 1]), children: /* @__PURE__ */ jsx13(ChevronRightIcon, {}) })
  ] });
}
function CopyButton({ text, disabled }) {
  const [copied, setCopied] = useState13(false);
  return /* @__PURE__ */ jsx13(
    IconButton,
    {
      label: copied ? "Copied" : "Copy",
      disabled: disabled || !text,
      onClick: () => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2e3);
        });
      },
      children: copied ? /* @__PURE__ */ jsx13(CheckIcon, {}) : /* @__PURE__ */ jsx13(CopyIcon, {})
    }
  );
}

// src/components/messages/ToolCalls.tsx
import { Fragment as Fragment5, jsx as jsx14, jsxs as jsxs12 } from "react/jsx-runtime";
var LABEL2 = { running: "Running", done: "Done", error: "Failed", pending: "Not run" };
function parse(content) {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}
function ToolOutput({ message }) {
  const parsed = parse(messageText(message.content));
  if (parsed && typeof parsed === "object") {
    return /* @__PURE__ */ jsx14(KeyValueTable, { data: parsed, maxRows: Array.isArray(parsed) ? 5 : void 0 });
  }
  return /* @__PURE__ */ jsx14(ExpandableText, { text: String(parsed) });
}
function ToolCallCard({ call, result, status }) {
  const { tools } = useKit();
  const custom = tools[call.name]?.render;
  if (custom) {
    return /* @__PURE__ */ jsx14("div", { className: "lgk-tool-custom", children: custom({ name: call.name, args: call.args, status, result: result ? parse(messageText(result.content)) : void 0 }) });
  }
  const hasArgs = Object.keys(call.args ?? {}).length > 0;
  return /* @__PURE__ */ jsxs12("details", { className: "lgk-tool", "data-status": status, open: status === "running" || status === "error" ? true : void 0, children: [
    /* @__PURE__ */ jsxs12("summary", { children: [
      /* @__PURE__ */ jsx14("span", { className: "lgk-dot", "aria-hidden": true }),
      /* @__PURE__ */ jsx14("code", { children: call.name }),
      /* @__PURE__ */ jsx14("span", { className: "lgk-tool-status", children: LABEL2[status] })
    ] }),
    /* @__PURE__ */ jsxs12("div", { className: "lgk-tool-body", children: [
      /* @__PURE__ */ jsx14("h4", { children: "Input" }),
      hasArgs ? /* @__PURE__ */ jsx14(KeyValueTable, { data: call.args }) : /* @__PURE__ */ jsx14("code", { className: "lgk-inline-code", children: "{}" }),
      result && /* @__PURE__ */ jsxs12(Fragment5, { children: [
        /* @__PURE__ */ jsx14("h4", { children: "Output" }),
        /* @__PURE__ */ jsx14(ToolOutput, { message: result })
      ] })
    ] })
  ] });
}
function OrphanToolResult({ message }) {
  return /* @__PURE__ */ jsxs12("details", { className: "lgk-tool", "data-status": "done", children: [
    /* @__PURE__ */ jsxs12("summary", { children: [
      /* @__PURE__ */ jsx14("span", { className: "lgk-dot", "aria-hidden": true }),
      /* @__PURE__ */ jsx14("code", { children: message.name ?? "tool result" }),
      /* @__PURE__ */ jsx14("span", { className: "lgk-tool-status", children: "Result" })
    ] }),
    /* @__PURE__ */ jsx14("div", { className: "lgk-tool-body", children: /* @__PURE__ */ jsx14(ToolOutput, { message }) })
  ] });
}

// src/components/messages/AssistantMessage.tsx
import { Fragment as Fragment6, jsx as jsx15, jsxs as jsxs13 } from "react/jsx-runtime";
function GenerativeUi({ message, components }) {
  const agent = useAgentContext();
  const artifact = useArtifact();
  const items = agent.ui.filter((u) => u.metadata?.message_id === message.id);
  if (!items.length) return null;
  return /* @__PURE__ */ jsx15(Fragment6, { children: items.map((u) => /* @__PURE__ */ jsx15(
    LoadExternalComponent,
    {
      stream: agent.stream,
      message: u,
      meta: { ui: u, artifact },
      components
    },
    u.id
  )) });
}
function AssistantMessage({
  message,
  results,
  loading,
  hideToolCalls,
  branching = true,
  copy = true,
  uiComponents,
  markdown,
  sources,
  feedback
}) {
  const agent = useAgentContext();
  const text = messageText(message.content);
  const reasoning = messageReasoning(message.content);
  const calls = messageToolCalls(message);
  const hasUi = agent.ui.some((u) => u.metadata?.message_id === message.id);
  if (!text && !reasoning && !calls.length && !hasUi) return null;
  const { branch, branchOptions, parentCheckpoint } = branching ? agent.getBranch(message) : {};
  const busy = agent.isLoading;
  return /* @__PURE__ */ jsxs13("div", { className: "lgk-msg lgk-ai", children: [
    reasoning && /* @__PURE__ */ jsxs13("details", { className: "lgk-reasoning", children: [
      /* @__PURE__ */ jsx15("summary", { children: "Reasoning" }),
      /* @__PURE__ */ jsx15("p", { children: reasoning })
    ] }),
    text && /* @__PURE__ */ jsx15(Markdown, { ...markdown, children: text }),
    sources && sources.length > 0 && /* @__PURE__ */ jsxs13("div", { className: "lgk-sources", "aria-label": "Sources", children: [
      /* @__PURE__ */ jsx15("span", { className: "lgk-sources-label", children: "Sources" }),
      sources.map((s, i) => /* @__PURE__ */ jsxs13("span", { className: "lgk-source", children: [
        /* @__PURE__ */ jsx15("b", { children: s.id ?? i + 1 }),
        " ",
        s.title,
        s.page ? ` \xB7 p. ${s.page}` : ""
      ] }, `${s.id ?? i}`))
    ] }),
    !hideToolCalls && calls.map((c, i) => {
      const res = c.id ? results.get(c.id) : void 0;
      const status = res ? res.status === "error" ? "error" : "done" : loading || c.id && agent.pendingToolCallIds.includes(c.id) ? "running" : "pending";
      return /* @__PURE__ */ jsx15(ToolCallCard, { call: c, result: res, status }, c.id ?? i);
    }),
    /* @__PURE__ */ jsx15(GenerativeUi, { message, components: uiComponents }),
    text && !loading && /* @__PURE__ */ jsxs13("div", { className: "lgk-actions", children: [
      /* @__PURE__ */ jsx15(BranchSwitcher, { branch, branchOptions, onSelect: agent.setBranch, disabled: busy }),
      copy && /* @__PURE__ */ jsx15(CopyButton, { text, disabled: busy }),
      branching && parentCheckpoint && /* @__PURE__ */ jsx15(IconButton, { label: "Regenerate", disabled: busy, onClick: () => void agent.regenerate(parentCheckpoint), children: /* @__PURE__ */ jsx15(RefreshIcon, {}) }),
      feedback && /* @__PURE__ */ jsx15("span", { className: "lgk-feedback", "aria-label": "Rate this answer", children: feedback.sent ? /* @__PURE__ */ jsx15("span", { className: "lgk-feedback-thanks", children: "Thanks for the feedback" }) : ["up", "down"].map((rating) => /* @__PURE__ */ jsx15(
        "button",
        {
          type: "button",
          className: "lgk-icon-btn",
          "aria-label": rating === "up" ? "Good answer" : "Bad answer",
          disabled: busy,
          onClick: () => feedback.onRate(rating),
          children: rating === "up" ? "\u{1F44D}" : "\u{1F44E}"
        },
        rating
      )) })
    ] })
  ] });
}

// src/components/messages/HumanMessage.tsx
import { useState as useState14 } from "react";
import { Fragment as Fragment7, jsx as jsx16, jsxs as jsxs14 } from "react/jsx-runtime";
function HumanMessage({ message, branching = true, copy = true }) {
  const agent = useAgentContext();
  const [editing, setEditing] = useState14(false);
  const [draft, setDraft] = useState14("");
  const text = messageText(message.content);
  const blocks = Array.isArray(message.content) ? message.content.filter(isMultimodalBlock) : [];
  const { branch, branchOptions } = branching ? agent.getBranch(message) : {};
  const busy = agent.isLoading;
  const submit = () => {
    const next = draft.trim();
    if (!next) return;
    setEditing(false);
    void agent.editMessage(message, next);
  };
  return /* @__PURE__ */ jsxs14("div", { className: "lgk-msg lgk-human", "data-editing": editing || void 0, children: [
    editing ? /* @__PURE__ */ jsx16(
      "textarea",
      {
        autoFocus: true,
        value: draft,
        onChange: (e) => setDraft(e.target.value),
        "aria-label": "Edit message",
        onKeyDown: (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setEditing(false);
        }
      }
    ) : /* @__PURE__ */ jsxs14(Fragment7, { children: [
      blocks.length > 0 && /* @__PURE__ */ jsx16("div", { className: "lgk-attachments", "data-align": "end", children: blocks.map((b, i) => /* @__PURE__ */ jsx16(MultimodalPreview, { block: b }, i)) }),
      text && /* @__PURE__ */ jsx16("p", { children: text })
    ] }),
    /* @__PURE__ */ jsxs14("div", { className: "lgk-actions", children: [
      /* @__PURE__ */ jsx16(BranchSwitcher, { branch, branchOptions, onSelect: agent.setBranch, disabled: busy }),
      editing ? /* @__PURE__ */ jsxs14(Fragment7, { children: [
        /* @__PURE__ */ jsx16(IconButton, { label: "Cancel edit", onClick: () => setEditing(false), children: /* @__PURE__ */ jsx16(XIcon, {}) }),
        /* @__PURE__ */ jsx16(IconButton, { label: "Send edit (Ctrl+Enter)", disabled: busy || !draft.trim(), onClick: submit, children: /* @__PURE__ */ jsx16(SendIcon, {}) })
      ] }) : /* @__PURE__ */ jsxs14(Fragment7, { children: [
        copy && /* @__PURE__ */ jsx16(CopyButton, { text, disabled: busy }),
        branching && text && /* @__PURE__ */ jsx16(IconButton, { label: "Edit", disabled: busy, onClick: () => {
          setDraft(text);
          setEditing(true);
        }, children: /* @__PURE__ */ jsx16(PencilIcon, {}) })
      ] })
    ] })
  ] });
}

// src/components/Chat.tsx
import { jsx as jsx17, jsxs as jsxs15 } from "react/jsx-runtime";
function Chat(props) {
  const agent = useAgent();
  return /* @__PURE__ */ jsx17(AgentContext.Provider, { value: agent, children: /* @__PURE__ */ jsx17(ChatView, { ...props }) });
}
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function ChatView({
  title,
  placeholder = "Message the agent\u2026",
  suggestions,
  emptyState,
  renderInterrupt,
  headerStart,
  headerActions,
  features,
  uiComponents,
  markdown,
  className
}) {
  const agent = useAgentContext();
  const kit = useKit();
  const f = { upload: true, branching: true, copy: true, toolToggle: true, artifacts: true, connectionBadge: true, ...features };
  const branching = f.branching && kit.branching;
  const [hideToolCalls, setHideToolCalls] = useState15(false);
  const [artifactOpen, closeArtifact] = useArtifactOpen();
  const [artifactContext, setArtifactContext] = useArtifactContext();
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();
  useEffect8(() => {
    closeArtifact();
    setArtifactContext({});
  }, [agent.threadId, closeArtifact, setArtifactContext]);
  const visible = agent.messages.filter((m) => !isHiddenMessage(m));
  const results = /* @__PURE__ */ new Map();
  const knownCalls = /* @__PURE__ */ new Set();
  for (const m of visible) {
    if (m.type === "tool") results.set(m.tool_call_id, m);
    for (const c of messageToolCalls(m)) if (c.id) knownCalls.add(c.id);
  }
  const lastAi = [...visible].reverse().find((m) => m.type === "ai");
  const last = visible[visible.length - 1];
  const waiting = agent.isLoading && (!last || last.type === "human" || last.type === "ai" && !messageText(last.content) && !messageToolCalls(last).length);
  const empty = visible.length === 0 && !agent.interrupts.length;
  const started = !!agent.threadId || visible.length > 0;
  const showArtifact = f.artifacts && artifactOpen;
  const renderMessage = (m, i) => {
    const key = m.id ?? `${m.type}-${i}`;
    if (m.type === "human") return /* @__PURE__ */ jsx17(HumanMessage, { message: m, branching, copy: f.copy }, key);
    if (m.type === "ai") {
      const isLast = m === lastAi && !agent.isLoading;
      return /* @__PURE__ */ jsx17(
        AssistantMessage,
        {
          message: m,
          results,
          loading: agent.isLoading && i === visible.length - 1,
          hideToolCalls,
          branching,
          copy: f.copy,
          uiComponents,
          markdown,
          sources: agent.isGateway && m === lastAi ? agent.sources : void 0,
          feedback: agent.isGateway && isLast ? { sent: agent.feedbackSent, onRate: agent.feedback } : void 0
        },
        key
      );
    }
    if (m.type === "tool" && !hideToolCalls && !knownCalls.has(m.tool_call_id)) {
      return /* @__PURE__ */ jsx17(OrphanToolResult, { message: m }, key);
    }
    return null;
  };
  return /* @__PURE__ */ jsxs15("section", { className: `lgk lgk-chat ${className ?? ""}`, "aria-label": title ?? "Chat", "data-artifact": showArtifact || void 0, children: [
    /* @__PURE__ */ jsxs15("header", { className: "lgk-chat-head", children: [
      /* @__PURE__ */ jsxs15("div", { className: "lgk-chat-head-start", children: [
        headerStart,
        title && /* @__PURE__ */ jsx17("h2", { children: title }),
        f.connectionBadge && kit.isConfigured && /* @__PURE__ */ jsx17("span", { className: "lgk-host", "data-status": kit.status, title: `${kit.status === "error" ? "Can't reach" : "Connected to"} ${kit.connection.apiUrl}`, children: hostOf(kit.connection.apiUrl) })
      ] }),
      /* @__PURE__ */ jsxs15("div", { className: "lgk-chat-head-actions", children: [
        kit.gateway && !agent.handoff && /* @__PURE__ */ jsx17("button", { type: "button", className: "lgk-hb-btn", onClick: () => void agent.requestHuman(), children: "Talk to a human" }),
        started && /* @__PURE__ */ jsx17(IconButton, { label: "New chat", onClick: agent.newThread, children: /* @__PURE__ */ jsx17(NewChatIcon, {}) }),
        headerActions
      ] })
    ] }),
    /* @__PURE__ */ jsxs15("div", { className: "lgk-chat-body", children: [
      /* @__PURE__ */ jsxs15("div", { className: "lgk-chat-main", children: [
        /* @__PURE__ */ jsx17("div", { className: "lgk-scroll", ref: scrollRef, children: /* @__PURE__ */ jsxs15("div", { className: "lgk-thread", ref: contentRef, role: "log", "aria-live": "polite", children: [
          empty && /* @__PURE__ */ jsxs15("div", { className: "lgk-empty", children: [
            !kit.isConfigured ? /* @__PURE__ */ jsx17("p", { children: "Add a server URL and assistant to the provider to start chatting." }) : emptyState ?? /* @__PURE__ */ jsx17("p", { children: "Ask anything to start a conversation." }),
            kit.isConfigured && suggestions && suggestions.length > 0 && /* @__PURE__ */ jsx17("div", { className: "lgk-suggest", children: suggestions.map((s) => /* @__PURE__ */ jsx17("button", { type: "button", onClick: () => void agent.send(s), children: s }, s)) })
          ] }),
          visible.map(renderMessage),
          waiting && /* @__PURE__ */ jsxs15("div", { className: "lgk-typing", role: "status", "aria-label": "Agent is working", children: [
            /* @__PURE__ */ jsx17("i", {}),
            /* @__PURE__ */ jsx17("i", {}),
            /* @__PURE__ */ jsx17("i", {})
          ] }),
          agent.handoff && /* @__PURE__ */ jsxs15("div", { className: "lgk-handoff", "data-status": agent.handoff.status, role: "status", children: [
            /* @__PURE__ */ jsxs15("div", { className: "lgk-handoff-head", children: [
              /* @__PURE__ */ jsx17("strong", { children: agent.handoff.status === "active" ? "A colleague has joined" : "Waiting for a colleague" }),
              /* @__PURE__ */ jsx17("span", { children: agent.handoff.status === "active" ? "You're chatting with our team. Replies appear here." : "Our team has been notified. You can keep typing here." })
            ] }),
            agent.handoffMessages.filter((m) => m.role === "staff").map((m) => /* @__PURE__ */ jsxs15("div", { className: "lgk-handoff-msg", children: [
              /* @__PURE__ */ jsx17("b", { children: m.author || "Team" }),
              " ",
              m.text
            ] }, m.id))
          ] }),
          /* @__PURE__ */ jsx17(InterruptView, { interrupts: agent.interrupts, render: renderInterrupt }),
          agent.error && /* @__PURE__ */ jsx17("div", { className: "lgk-error", role: "alert", children: agent.error })
        ] }) }),
        !isAtBottom && /* @__PURE__ */ jsxs15("button", { type: "button", className: "lgk-scroll-btn", onClick: () => scrollToBottom(), children: [
          /* @__PURE__ */ jsx17(ArrowDownIcon, {}),
          " Scroll to bottom"
        ] }),
        /* @__PURE__ */ jsx17(
          Composer,
          {
            placeholder,
            busy: agent.isLoading,
            disabled: !kit.isConfigured || agent.interrupts.length > 0,
            upload: f.upload,
            toolToggle: f.toolToggle ? { checked: hideToolCalls, onChange: setHideToolCalls } : void 0,
            onSend: ({ text, blocks }) => void agent.send({ text, blocks, context: artifactContext }),
            onStop: () => void agent.stop(),
            onError: (description) => kit.notify({ kind: "error", title: "Can't attach that", description })
          }
        )
      ] }),
      showArtifact && /* @__PURE__ */ jsxs15("aside", { className: "lgk-artifact", "aria-label": "Artifact", children: [
        /* @__PURE__ */ jsxs15("div", { className: "lgk-artifact-head", children: [
          /* @__PURE__ */ jsx17(ArtifactTitle, { className: "lgk-artifact-title" }),
          /* @__PURE__ */ jsx17(IconButton, { label: "Close panel", onClick: closeArtifact, children: /* @__PURE__ */ jsx17(XIcon, {}) })
        ] }),
        /* @__PURE__ */ jsx17(ArtifactContent, { className: "lgk-artifact-body" })
      ] })
    ] })
  ] });
}

// src/components/ChatPopup.tsx
import { useState as useState16 } from "react";
import { jsx as jsx18, jsxs as jsxs16 } from "react/jsx-runtime";
function ChatPopup({ defaultOpen = false, launcherLabel = "Ask the agent", title = "Assistant", features, ...chat }) {
  const [open, setOpen] = useState16(defaultOpen);
  return /* @__PURE__ */ jsxs16("div", { className: "lgk lgk-popup-root", children: [
    /* @__PURE__ */ jsx18("div", { className: "lgk-popup", role: "dialog", "aria-label": title, hidden: !open, children: /* @__PURE__ */ jsx18(
      Chat,
      {
        ...chat,
        title,
        features: { connectionBadge: false, toolToggle: false, artifacts: false, ...features },
        headerActions: /* @__PURE__ */ jsx18(IconButton, { label: "Close", onClick: () => setOpen(false), children: /* @__PURE__ */ jsx18(XIcon, {}) })
      }
    ) }),
    !open && /* @__PURE__ */ jsx18("button", { type: "button", className: "lgk-fab", onClick: () => setOpen(true), children: launcherLabel })
  ] });
}

// src/components/ChatSidebar.tsx
import { useState as useState17 } from "react";

// src/components/ThreadHistory.tsx
import { jsx as jsx19, jsxs as jsxs17 } from "react/jsx-runtime";
function formatRelative(iso) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1e3;
  const f = new Intl.RelativeTimeFormat(void 0, { numeric: "auto" });
  const steps = [
    [60, "second", 1],
    [3600, "minute", 60],
    [86400, "hour", 3600],
    [604800, "day", 86400]
  ];
  for (const [limit, unit, div] of steps) {
    if (Math.abs(seconds) < limit) return f.format(Math.round(seconds / div), unit);
  }
  return new Date(iso).toLocaleDateString();
}
function ThreadHistory({ onSelect }) {
  const { threads, loading, remove } = useThreads();
  const { threadId, setThreadId, isConfigured, notify } = useKit();
  if (!isConfigured) return /* @__PURE__ */ jsx19("p", { className: "lgk-muted", children: "Connect to a server to see your chats." });
  if (loading) {
    return /* @__PURE__ */ jsx19("div", { className: "lgk-threads", "aria-busy": "true", "aria-label": "Loading chats", children: Array.from({ length: 8 }, (_, i) => /* @__PURE__ */ jsx19("div", { className: "lgk-skeleton" }, i)) });
  }
  if (!threads.length) return /* @__PURE__ */ jsx19("p", { className: "lgk-muted", children: "No chats yet. Send a message to start one." });
  return /* @__PURE__ */ jsx19("nav", { className: "lgk-threads", "aria-label": "Chat history", children: threads.map((t) => /* @__PURE__ */ jsxs17("div", { className: "lgk-thread-row", "data-active": t.id === threadId, children: [
    /* @__PURE__ */ jsxs17(
      "button",
      {
        type: "button",
        "aria-current": t.id === threadId ? "page" : void 0,
        onClick: () => {
          if (t.id !== threadId) setThreadId(t.id);
          onSelect?.(t.id);
        },
        children: [
          /* @__PURE__ */ jsx19("span", { className: "lgk-thread-title", children: t.title }),
          /* @__PURE__ */ jsx19("span", { className: "lgk-muted", children: formatRelative(t.updatedAt) })
        ]
      }
    ),
    /* @__PURE__ */ jsx19(
      IconButton,
      {
        label: `Delete "${t.title}"`,
        onClick: () => {
          remove(t.id).catch(() => notify({ kind: "error", title: "Couldn't delete that chat" }));
        },
        children: /* @__PURE__ */ jsx19(TrashIcon, {})
      }
    )
  ] }, t.id)) });
}

// src/components/HistoryPanel.tsx
import { jsx as jsx20, jsxs as jsxs18 } from "react/jsx-runtime";
function HistoryPanel({ onClose, title = "Chats" }) {
  const { setThreadId } = useKit();
  return /* @__PURE__ */ jsxs18("div", { className: "lgk-dock-history", role: "region", "aria-label": "Chat history", children: [
    /* @__PURE__ */ jsxs18("header", { className: "lgk-chat-head", children: [
      /* @__PURE__ */ jsxs18("div", { className: "lgk-chat-head-start", children: [
        /* @__PURE__ */ jsx20(IconButton, { label: "Back to chat", onClick: onClose, children: /* @__PURE__ */ jsx20(ChevronLeftIcon, {}) }),
        /* @__PURE__ */ jsx20("h2", { children: title })
      ] }),
      /* @__PURE__ */ jsx20("div", { className: "lgk-chat-head-actions", children: /* @__PURE__ */ jsxs18("button", { type: "button", className: "lgk-primary lgk-sm", onClick: () => {
        setThreadId(null);
        onClose();
      }, children: [
        /* @__PURE__ */ jsx20(PlusIcon, {}),
        " New chat"
      ] }) })
    ] }),
    /* @__PURE__ */ jsx20("div", { className: "lgk-dock-history-body", children: /* @__PURE__ */ jsx20(ThreadHistory, { onSelect: onClose }) })
  ] });
}

// src/components/ChatSidebar.tsx
import { Fragment as Fragment8, jsx as jsx21, jsxs as jsxs19 } from "react/jsx-runtime";
function ChatSidebar({
  children,
  defaultOpen = true,
  mode = "panel",
  width = 420,
  launcherLabel = "Ask the agent",
  title = "Assistant",
  features,
  ...chat
}) {
  const [open, setOpen] = useState17(defaultOpen);
  const [view, setView] = useState17("chat");
  const style = { "--lgk-dock-w": `${width}px` };
  return /* @__PURE__ */ jsxs19("div", { className: "lgk lgk-dock", "data-mode": mode, "data-open": open, style, children: [
    /* @__PURE__ */ jsx21("div", { className: "lgk-dock-main", children }),
    /* @__PURE__ */ jsxs19("aside", { className: "lgk-dock-side", hidden: !open, "aria-label": title, children: [
      /* @__PURE__ */ jsx21(
        Chat,
        {
          ...chat,
          title,
          features: { connectionBadge: false, artifacts: false, ...features },
          headerActions: /* @__PURE__ */ jsxs19(Fragment8, { children: [
            /* @__PURE__ */ jsx21(IconButton, { label: "Chat history", onClick: () => setView("history"), children: /* @__PURE__ */ jsx21(HistoryIcon, {}) }),
            /* @__PURE__ */ jsx21(IconButton, { label: "Close", onClick: () => {
              setOpen(false);
              setView("chat");
            }, children: /* @__PURE__ */ jsx21(XIcon, {}) })
          ] })
        }
      ),
      view === "history" && /* @__PURE__ */ jsx21(HistoryPanel, { onClose: () => setView("chat") })
    ] }),
    !open && /* @__PURE__ */ jsx21("button", { type: "button", className: "lgk-fab", onClick: () => setOpen(true), children: launcherLabel })
  ] });
}

// src/components/Playground.tsx
import { useEffect as useEffect9, useState as useState19 } from "react";

// src/components/ConnectionForm.tsx
import { useState as useState18 } from "react";
import { jsx as jsx22, jsxs as jsxs20 } from "react/jsx-runtime";
function ConnectionForm({ defaultApiUrl = "http://localhost:2024", defaultAssistantId = "agent", onConnected }) {
  const { connection, setConnection } = useKit();
  const [apiUrl, setApiUrl] = useState18(connection.apiUrl || defaultApiUrl);
  const [assistantId, setAssistantId] = useState18(connection.assistantId || defaultAssistantId);
  const [token, setToken] = useState18(connection.token ?? "");
  const [scheme, setScheme] = useState18(connection.authScheme ?? "bearer");
  const submit = (e) => {
    e.preventDefault();
    setConnection({ apiUrl: apiUrl.trim(), assistantId: assistantId.trim(), token: token.trim() || void 0, authScheme: scheme });
    onConnected?.();
  };
  return /* @__PURE__ */ jsx22("div", { className: "lgk lgk-setup", children: /* @__PURE__ */ jsxs20("form", { onSubmit: submit, children: [
    /* @__PURE__ */ jsx22("h1", { children: "Connect to your agent" }),
    /* @__PURE__ */ jsxs20("p", { className: "lgk-muted-block", children: [
      "Point this at a LangGraph server. Local (",
      /* @__PURE__ */ jsx22("code", { children: "langgraph dev" }),
      ") or deployed both work."
    ] }),
    /* @__PURE__ */ jsxs20("label", { children: [
      /* @__PURE__ */ jsx22("span", { children: "Server URL" }),
      /* @__PURE__ */ jsx22("input", { value: apiUrl, onChange: (e) => setApiUrl(e.target.value), required: true, spellCheck: false, placeholder: "http://localhost:2024" })
    ] }),
    /* @__PURE__ */ jsxs20("label", { children: [
      /* @__PURE__ */ jsx22("span", { children: "Assistant or graph ID" }),
      /* @__PURE__ */ jsx22("input", { value: assistantId, onChange: (e) => setAssistantId(e.target.value), required: true, spellCheck: false, placeholder: "agent" }),
      /* @__PURE__ */ jsxs20("small", { children: [
        "The graph name from ",
        /* @__PURE__ */ jsx22("code", { children: "langgraph.json" }),
        ", or an assistant UUID."
      ] })
    ] }),
    /* @__PURE__ */ jsxs20("label", { children: [
      /* @__PURE__ */ jsxs20("span", { children: [
        "Access token ",
        /* @__PURE__ */ jsx22("em", { children: "(optional)" })
      ] }),
      /* @__PURE__ */ jsx22("input", { type: "password", value: token, onChange: (e) => setToken(e.target.value), autoComplete: "off", placeholder: "Not needed for a local server" }),
      /* @__PURE__ */ jsx22("small", { children: "Stored in this browser only, and only sent to this server." })
    ] }),
    /* @__PURE__ */ jsxs20("label", { children: [
      /* @__PURE__ */ jsx22("span", { children: "How to send the token" }),
      /* @__PURE__ */ jsxs20("select", { value: scheme, onChange: (e) => setScheme(e.target.value), children: [
        /* @__PURE__ */ jsx22("option", { value: "bearer", children: "Authorization: Bearer (custom auth)" }),
        /* @__PURE__ */ jsx22("option", { value: "api-key", children: "X-Api-Key (LangSmith / LangGraph Platform)" }),
        /* @__PURE__ */ jsx22("option", { value: "agent-builder", children: "LangSmith Agent Builder" })
      ] })
    ] }),
    /* @__PURE__ */ jsx22("button", { type: "submit", className: "lgk-primary", children: "Connect" })
  ] }) });
}

// src/components/Playground.tsx
import { Fragment as Fragment9, jsx as jsx23, jsxs as jsxs21 } from "react/jsx-runtime";
function CommitInput({ value, onCommit, ...rest }) {
  const [draft, setDraft] = useState19(value);
  useEffect9(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft.trim());
  return /* @__PURE__ */ jsx23(
    "input",
    {
      ...rest,
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur()
    }
  );
}
function Playground(props) {
  const { connection, setConnection, setThreadId, isConfigured, status } = useKit();
  const { assistants, error, refresh } = useAssistants();
  const [navOpen, setNavOpen] = useState19(false);
  if (!isConfigured) return /* @__PURE__ */ jsx23(ConnectionForm, {});
  const current = assistants.find((a) => a.assistant_id === connection.assistantId || a.graph_id === connection.assistantId);
  const known = assistants.some((a) => a.assistant_id === connection.assistantId);
  return /* @__PURE__ */ jsxs21("div", { className: "lgk lgk-pg", "data-nav": navOpen, children: [
    /* @__PURE__ */ jsxs21("aside", { className: "lgk-pg-side", children: [
      /* @__PURE__ */ jsx23("div", { className: "lgk-pg-brand", children: "LangGraph" }),
      /* @__PURE__ */ jsxs21("label", { className: "lgk-field", children: [
        /* @__PURE__ */ jsx23("span", { children: "Endpoint" }),
        /* @__PURE__ */ jsx23(CommitInput, { value: connection.apiUrl, onCommit: (v) => setConnection({ apiUrl: v }), spellCheck: false })
      ] }),
      /* @__PURE__ */ jsxs21("div", { className: "lgk-field", children: [
        /* @__PURE__ */ jsx23("span", { children: "Access token" }),
        /* @__PURE__ */ jsxs21("div", { className: "lgk-field-row", children: [
          /* @__PURE__ */ jsx23(
            CommitInput,
            {
              type: "password",
              value: connection.token ?? "",
              placeholder: "Optional",
              autoComplete: "off",
              onCommit: (v) => setConnection({ token: v || void 0 }),
              "aria-label": "Access token"
            }
          ),
          /* @__PURE__ */ jsxs21(
            "select",
            {
              value: connection.authScheme ?? "bearer",
              "aria-label": "How to send the token",
              onChange: (e) => setConnection({ authScheme: e.target.value }),
              children: [
                /* @__PURE__ */ jsx23("option", { value: "bearer", children: "Bearer" }),
                /* @__PURE__ */ jsx23("option", { value: "api-key", children: "X-Api-Key" }),
                /* @__PURE__ */ jsx23("option", { value: "agent-builder", children: "Agent Builder" })
              ]
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxs21("label", { className: "lgk-field", children: [
        /* @__PURE__ */ jsx23("span", { children: "Agent" }),
        /* @__PURE__ */ jsxs21("select", { value: connection.assistantId, onChange: (e) => setConnection({ assistantId: e.target.value }), children: [
          !known && /* @__PURE__ */ jsx23("option", { value: connection.assistantId, children: connection.assistantId }),
          assistants.map((a) => /* @__PURE__ */ jsx23("option", { value: a.assistant_id, children: a.name || a.graph_id }, a.assistant_id))
        ] })
      ] }),
      /* @__PURE__ */ jsx23("p", { className: "lgk-status", "data-state": status === "error" || error ? "error" : status, children: status === "error" || error ? /* @__PURE__ */ jsxs21(Fragment9, { children: [
        "Can't reach ",
        connection.apiUrl,
        ". ",
        /* @__PURE__ */ jsx23("button", { type: "button", onClick: refresh, children: "Retry" })
      ] }) : status === "checking" ? "Connecting\u2026" : `Connected \xB7 ${assistants.length} agent${assistants.length === 1 ? "" : "s"}` }),
      /* @__PURE__ */ jsx23("button", { type: "button", className: "lgk-primary", onClick: () => {
        setThreadId(null);
        setNavOpen(false);
      }, children: "New chat" }),
      /* @__PURE__ */ jsx23(ThreadHistory, { onSelect: () => setNavOpen(false) })
    ] }),
    /* @__PURE__ */ jsx23("main", { className: "lgk-pg-main", children: /* @__PURE__ */ jsx23(
      Chat,
      {
        ...props,
        headerStart: /* @__PURE__ */ jsx23(IconButton, { label: "Chats", className: "lgk-burger", onClick: () => setNavOpen((o) => !o), children: /* @__PURE__ */ jsx23(PanelLeftIcon, {}) }),
        title: props.title ?? current?.name ?? current?.graph_id ?? "Chat"
      }
    ) })
  ] });
}
export {
  AssistantMessage,
  Chat,
  ChatPopup,
  ChatSidebar,
  Composer,
  ConnectionForm,
  DO_NOT_RENDER_ID_PREFIX,
  ExpandableText,
  GatewayTransport,
  GenericInterrupt,
  HistoryPanel,
  HitlReview,
  HumanMessage,
  InterruptView,
  KeyValueTable,
  LangGraphKitProvider,
  Markdown,
  Playground,
  ThreadHistory,
  ToolCallCard,
  ToolOutput,
  ensureToolCallsHaveResponses,
  gatewayToken,
  handoffSnapshot,
  isHitlRequest,
  messageReasoning,
  messageText,
  messageToolCalls,
  requestHandoff,
  sendFeedback,
  useAgent,
  useAgentContext,
  useAgentReadable,
  useAgentTool,
  useArtifact,
  useArtifactContext,
  useArtifactOpen,
  useAssistants,
  useFileUpload,
  useKit,
  useThreads
};
