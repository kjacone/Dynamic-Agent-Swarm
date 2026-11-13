"use client";

/**
 * Connect the kit to the NMB gateway (`/v1/session` + `/v1/chat`) instead of a
 * LangGraph server. The browser only ever holds a publishable key; the gateway
 * mints a short-lived session token and keeps sessions, guardrails, citations,
 * thread ownership and human handoff server-side.
 */
export interface GatewayConfig {
  /** e.g. https://agents.bank.co — no trailing slash */
  baseUrl: string;
  /** Publishable key (pk_…). Never pass a secret key to the browser. */
  publishableKey: string;
  /** Stable end-user id (your app's user id). */
  userId?: string;
  /** Only meaningful when a server-side secret key minted the session. */
  customerId?: string;
  /** Namespace for the persisted thread map. Defaults to the gateway host. */
  persistKey?: string;
  /** Injectable fetch (tests, non-browser runtimes). */
  fetch?: typeof fetch;
}

export interface GatewaySource {
  id?: number | string;
  title: string;
  page?: number;
  collection?: string;
}

export interface GatewayHandoff {
  id: string;
  thread_id: string;
  status: "requested" | "active" | "resolved";
  reason?: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
}

export interface GatewayStaffMessage {
  id: string;
  role: "staff" | "customer" | "system" | string;
  author?: string | null;
  text: string;
  created_at?: string | null;
}

export type GatewayEvent =
  | { type: "thread"; threadId: string }
  | { type: "citations"; sources: GatewaySource[] }
  | { type: "handoff"; handoff: GatewayHandoff; messageId?: string };

export interface GatewayEventBus {
  subscribe(fn: (event: GatewayEvent) => void): () => void;
  emit(event: GatewayEvent): void;
}

export function createGatewayEventBus(): GatewayEventBus {
  const listeners = new Set<(event: GatewayEvent) => void>();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    emit(event) {
      listeners.forEach((fn) => fn(event));
    },
  };
}

const trimBase = (url: string) => url.replace(/\/+$/, "");
const sessions = new Map<string, { token: string; exp: number }>();

/** Exchanges the publishable key for a short-lived session token; falls back to the key. */
export async function gatewayToken(cfg: GatewayConfig, force = false): Promise<string> {
  const url = trimBase(cfg.baseUrl);
  const key = `${url}|${cfg.publishableKey}|${cfg.userId ?? ""}|${cfg.customerId ?? ""}`;
  const hit = sessions.get(key);
  if (!force && hit && hit.exp > Date.now() + 30_000) return hit.token;

  const doFetch = cfg.fetch ?? fetch;
  try {
    const res = await doFetch(`${url}/v1/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.publishableKey}` },
      body: JSON.stringify({
        ...(cfg.userId ? { user_id: cfg.userId } : {}),
        ...(cfg.customerId ? { customer_id: cfg.customerId } : {}),
      }),
    });
    if (res.ok) {
      const data = await res.json() as { token?: string; expires_in?: number };
      if (data.token) {
        sessions.set(key, { token: data.token, exp: Date.now() + (data.expires_in ?? 900) * 1000 });
        return data.token;
      }
    }
  } catch { /* fall back to the publishable key */ }
  return cfg.publishableKey;
}

export async function gatewayFetch(cfg: GatewayConfig, path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await gatewayToken(cfg, retried);
  const doFetch = cfg.fetch ?? fetch;
  const res = await doFetch(`${trimBase(cfg.baseUrl)}${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && !retried) {
    sessions.delete(`${trimBase(cfg.baseUrl)}|${cfg.publishableKey}|${cfg.userId ?? ""}|${cfg.customerId ?? ""}`);
    return gatewayFetch(cfg, path, init, true);
  }
  return res;
}

export async function requestHandoff(cfg: GatewayConfig, threadId: string, reason?: string): Promise<{ handoff: GatewayHandoff; created: boolean }> {
  const res = await gatewayFetch(cfg, "/v1/handoff", {
    method: "POST",
    body: JSON.stringify({ thread_id: threadId, ...(cfg.userId ? { user_id: cfg.userId } : {}), ...(reason ? { reason } : {}) }),
  });
  if (!res.ok) throw new Error(`handoff failed (${res.status})`);
  return res.json();
}

export async function handoffSnapshot(cfg: GatewayConfig, threadId: string): Promise<{ handoff: GatewayHandoff | null; messages: GatewayStaffMessage[] }> {
  const qs = cfg.userId ? `?user_id=${encodeURIComponent(cfg.userId)}` : "";
  const res = await gatewayFetch(cfg, `/v1/handoff/${encodeURIComponent(threadId)}${qs}`);
  if (!res.ok) throw new Error(`handoff status failed (${res.status})`);
  return res.json();
}

export async function sendFeedback(cfg: GatewayConfig, body: {
  thread_id: string;
  rating: "up" | "down";
  user_message?: string;
  reply?: string;
  comment?: string;
}): Promise<void> {
  const res = await gatewayFetch(cfg, "/v1/feedback", {
    method: "POST",
    body: JSON.stringify({ ...body, ...(cfg.userId ? { user_id: cfg.userId } : {}) }),
  });
  if (!res.ok) throw new Error(`feedback failed (${res.status})`);
}

// ── transport ────────────────────────────────────────────────────────
type Chunk = { id?: string; event: string; data: unknown };

type TransportPayload = {
  input: unknown;
  context?: unknown;
  command?: unknown;
  signal: AbortSignal;
  config?: { configurable?: Record<string, unknown> };
};

function lastUserText(input: unknown): string {
  const messages = (input as { messages?: unknown[] } | null | undefined)?.messages;
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { type?: string; role?: string; content?: unknown };
    if (m?.type !== "human" && m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content.trim();
    if (Array.isArray(m.content)) {
      return m.content
        .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
        .join("")
        .trim();
    }
  }
  return "";
}

async function* readSse(res: Response): AsyncGenerator<{ data: unknown }> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut = buf.indexOf("\n\n");
      while (cut >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data === "[DONE]") return;
        if (data) {
          try { yield { data: JSON.parse(data) }; } catch { /* keep streaming */ }
        }
        cut = buf.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * SDK custom transport: maps `/v1/chat` SSE onto the LangGraph event shape the
 * kit already understands (`messages` chunks + `custom` events).
 */
export class GatewayTransport {
  private readonly cfg: GatewayConfig;
  private readonly emit: (event: GatewayEvent) => void;
  private boundThread: string | null = null;
  private serverThread: string | null = null;

  constructor(cfg: GatewayConfig, emit: (event: GatewayEvent) => void = () => {}) {
    this.cfg = cfg;
    this.emit = emit;
  }

  private get storeKey(): string {
    const base = trimBase(this.cfg.baseUrl);
    return `nmb_gw_threads:${this.cfg.persistKey || base}:${this.cfg.publishableKey.slice(0, 10)}`;
  }

  private restore(clientThread: string): string | null {
    try {
      const raw = localStorage.getItem(this.storeKey);
      const map = raw ? JSON.parse(raw) as Record<string, string> : {};
      return map[clientThread] || null;
    } catch { return null; }
  }

  private remember(clientThread: string, serverThread: string): void {
    try {
      const raw = localStorage.getItem(this.storeKey);
      const map = raw ? JSON.parse(raw) as Record<string, string> : {};
      map[clientThread] = serverThread;
      const entries = Object.entries(map).slice(-20);
      localStorage.setItem(this.storeKey, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* storage unavailable */ }
  }

  async *stream(payload: TransportPayload): AsyncGenerator<Chunk> {
    if (payload.command) {
      throw new Error("This assistant runs on the NMB gateway; resuming graph commands is not supported yet.");
    }
    const text = lastUserText(payload.input);
    if (!text) throw new Error("The gateway transport needs a user message.");

    const clientThread = (payload.config?.configurable?.thread_id as string | undefined) ?? null;
    if (clientThread !== this.boundThread) {
      this.boundThread = clientThread;
      this.serverThread = clientThread ? this.restore(clientThread) : null;
    }

    const cfgurable = payload.config?.configurable as Record<string, unknown> | undefined;
    const context = payload.context ?? (cfgurable?.context as unknown) ?? undefined;
    const readables = cfgurable?.readables as unknown;

    const token = await gatewayToken(this.cfg);
    const res = await gatewayFetch(this.cfg, "/v1/chat", {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      signal: payload.signal,
      body: JSON.stringify({
        message: text,
        thread_id: this.serverThread,
        ...(this.cfg.userId ? { user_id: this.cfg.userId } : {}),
        ...(context !== undefined ? { context } : {}),
        ...(readables !== undefined ? { readables } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(res.status === 429
        ? "Too many messages. Please wait a moment."
        : `Gateway error (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    void token;

    const aiId = `ai_${crypto.randomUUID()}`;
    for await (const frame of readSse(res)) {
      const ev = frame.data as Record<string, unknown>;
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
              data: [{ id: aiId, type: "AIMessageChunk", content: delta }, { langgraph_node: "agent" }],
            };
          }
          break;
        }
        case "sources": {
          const sources = Array.isArray(ev.sources) ? ev.sources as GatewaySource[] : [];
          this.emit({ type: "citations", sources });
          yield { event: "custom", data: { type: "citations", sources } };
          break;
        }
        case "handoff": {
          if (!ev.handoff) break;
          const handoff = ev.handoff as GatewayHandoff;
          this.emit({ type: "handoff", handoff, messageId: ev.messageId as string | undefined });
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
}
