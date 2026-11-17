import { API_BASE } from "@/lib/api";

export type VoiceToolCall = { id: string; name: string; args: Record<string, unknown> };

export type VoiceInterrupt = {
  id: string | null;
  value?: {
    type?: string;
    tool_call?: VoiceToolCall;
    toolCall?: VoiceToolCall;
  };
};

export type VoiceStreamEvent =
  | { type: "thread"; threadId: string }
  | { type: "token"; text: string }
  | { type: "interrupt"; interrupts: VoiceInterrupt[] }
  | { type: "state"; values: unknown }
  | { type: "sources"; sources: unknown[] }
  | { type: "handoff"; handoff: unknown }
  | { type: "error"; error: string };

export class VoiceCallError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

type StreamBody = Record<string, unknown>;

export class VoiceCall {
  threadId: string | null = null;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = API_BASE,
    private readonly fetcher: typeof fetch = fetch.bind(globalThis),
  ) {}

  private async sessionToken(refresh = false): Promise<string> {
    if (!refresh && this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const res = await this.fetcher(`${this.baseUrl}/v1/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: "{}",
    });
    const body = await this.jsonOrText(res);
    if (!res.ok) {
      throw new VoiceCallError(sessionError(res.status, body), res.status);
    }
    const token = typeof body === "object" && body ? (body as { token?: unknown }).token : null;
    if (typeof token !== "string" || !token) throw new VoiceCallError("The gateway did not return a session token.");
    const ttl = typeof body === "object" && body ? Number((body as { expires_in?: unknown }).expires_in) : NaN;
    this.token = token;
    this.tokenExpiresAt = Date.now() + (Number.isFinite(ttl) ? Math.max(ttl - 30, 30) : 600) * 1000;
    return token;
  }

  async *say(message: string, context?: Record<string, unknown>): AsyncGenerator<VoiceStreamEvent> {
    yield* this.stream("/v1/chat", {
      message,
      thread_id: this.threadId ?? undefined,
      ...(context ? { context } : {}),
    });
  }

  async *resume(interruptId: string, callId: string, result: unknown): AsyncGenerator<VoiceStreamEvent> {
    yield* this.resumeMany([{ interruptId, callId, result }]);
  }

  async *resumeMany(
    entries: { interruptId: string; callId: string; result: unknown }[],
  ): AsyncGenerator<VoiceStreamEvent> {
    if (!this.threadId) throw new VoiceCallError("No active call thread to resume.");
    if (!entries.length) throw new VoiceCallError("No paused tool call to resume.");
    const resume: Record<string, Record<string, unknown>> = {};
    for (const entry of entries) resume[entry.interruptId] = { [entry.callId]: entry.result };
    yield* this.stream("/v1/chat/resume", { thread_id: this.threadId, resume });
  }

  private async *stream(path: string, body: StreamBody, retried = false): AsyncGenerator<VoiceStreamEvent> {
    const token = await this.sessionToken(retried);
    const res = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await this.jsonOrText(res);
      if (res.status === 401 && !retried) {
        yield* this.stream(path, body, true);
        return;
      }
      throw new VoiceCallError(chatError(res.status, detail), res.status);
    }
    if (!res.body) throw new VoiceCallError("The gateway returned an empty stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf("\n\n");
        while (split >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = parseSseBlock(block);
          if (event === "done") return;
          if (event) {
            if (event.type === "thread") this.threadId = event.threadId;
            yield event;
          }
          split = buffer.indexOf("\n\n");
        }
      }
      const tail = parseSseBlock(buffer);
      if (tail && tail !== "done") {
        if (tail.type === "thread") this.threadId = tail.threadId;
        yield tail;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async jsonOrText(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

function parseSseBlock(block: string): VoiceStreamEvent | "done" | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return null;
  if (data === "[DONE]") return "done";
  try {
    const parsed = JSON.parse(data) as { type?: unknown };
    if (typeof parsed.type !== "string") return null;
    return parsed as VoiceStreamEvent;
  } catch {
    return null;
  }
}

function describe(detail: unknown): string {
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (detail && typeof detail === "object" && "detail" in detail) {
    const value = (detail as { detail?: unknown }).detail;
    if (typeof value === "string") return value;
  }
  if (detail && typeof detail === "object" && "error" in detail) {
    const value = (detail as { error?: unknown }).error;
    if (typeof value === "string") return value;
  }
  return "";
}

function sessionError(status: number, detail: unknown): string {
  const message = describe(detail);
  if (status === 401 || status === 403) {
    return `The gateway rejected the call key (${status}). Sign in as a platform admin so the console can mint a demo key.${message ? ` ${message}` : ""}`;
  }
  return `The call session could not be created (${status}).${message ? ` ${message}` : ""}`;
}

function chatError(status: number, detail: unknown): string {
  const message = describe(detail);
  if (status === 404) return `The call agent is not loaded in the runtime (${status}).${message ? ` ${message}` : ""}`;
  if (status === 502 || status === 503) return `The agent runtime did not answer (${status}).${message ? ` ${message}` : ""}`;
  return `The agent run failed (${status}).${message ? ` ${message}` : ""}`;
}
