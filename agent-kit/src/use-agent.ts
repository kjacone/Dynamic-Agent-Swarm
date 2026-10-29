"use client";
import type { Checkpoint, Message } from "@langchain/langgraph-sdk";
import { parseHeadlessToolInterruptPayload, useStream } from "@langchain/langgraph-sdk/react";
import {
  isRemoveUIMessage, isUIMessage, uiMessageReducer,
  type RemoveUIMessage, type UIMessage,
} from "@langchain/langgraph-sdk/react-ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { newId } from "./content";
import { ensureToolCallsHaveResponses } from "./lib/ensure-tool-responses";
import type { Decision } from "./lib/hitl";
import type { MultimodalBlock } from "./lib/multimodal";
import { useKit } from "./provider";

export type AgentState = { messages: Message[]; ui?: UIMessage[] };
type Bag = {
  UpdateType: {
    messages?: Message[] | Message | string;
    ui?: (UIMessage | RemoveUIMessage)[] | UIMessage | RemoveUIMessage;
    context?: Record<string, unknown>;
  };
  CustomEventType: UIMessage | RemoveUIMessage;
};
const useTypedStream = useStream<AgentState, Bag>;

type RawInterrupt = { id?: string; value?: unknown };

export interface SendInput {
  text?: string;
  /** Images / PDFs from `useFileUpload`. */
  blocks?: MultimodalBlock[];
  /** Extra state sent as `context` (e.g. from an artifact). */
  context?: Record<string, unknown>;
}

/**
 * The one hook that talks to the agent. Wraps the SDK's `useStream` and adds:
 *  - send with attachments and context
 *  - edit / regenerate / branch switching (time-travel), when the provider has `branching`
 *  - human-in-the-loop helpers: `submitDecisions`, `resolve`, `resume`
 *  - frontend tools (`useAgentTool` with a `handler`): when the graph pauses with a
 *    `{type: "tool", tool_call}` interrupt, the handler runs in the browser and the
 *    run resumes with its result
 *  - readables (`useAgentReadable`), sent as `config.configurable.readables` on every
 *    run, including the resume after a frontend tool
 *  - generative UI messages (`ui` state)
 *
 * Use it once per tree: every call opens its own stream. Below a <Chat>, read it with
 * `useAgentContext()` instead.
 */
export function useAgent() {
  const kit = useKit();
  const { connection, auth, threadId, setThreadId, bumpThreads, branching } = kit;

  const stream = useTypedStream({
    apiUrl: connection.apiUrl || undefined,
    apiKey: auth.apiKey,
    defaultHeaders: auth.headers,
    assistantId: connection.assistantId,
    threadId,
    onThreadId: (id) => { setThreadId(id); bumpThreads(); },
    // Needed for edit / regenerate / branch switcher.
    fetchStateHistory: branching,
    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => ({ ...prev, ui: uiMessageReducer(prev.ui ?? [], event) }));
      }
    },
    onFinish: () => bumpThreads(),
  });

  // Always read the latest state at call time (effects and callbacks outlive renders).
  const latest = useRef({ kit, stream });
  latest.current = { kit, stream };

  const runConfig = useCallback(() => {
    const { readables, configurable } = latest.current.kit;
    const list = Object.values(readables);
    return { configurable: { ...configurable, ...(list.length ? { readables: list } : {}) } };
  }, []);

  // Submit options are assembled from config + provider options + per-call extras.
  // Typed loosely on purpose: the SDK's SubmitOptions is generic over the state bag.
  const opts = useCallback(
    (extra: Record<string, unknown> = {}): any => ({
      config: runConfig(),
      ...latest.current.kit.submitOptions,
      ...extra,
    }),
    [runConfig],
  );

  const send = useCallback(async (input: string | SendInput) => {
    const { text = "", blocks = [], context } = typeof input === "string" ? { text: input } : input;
    const trimmed = text.trim();
    if (!trimmed && !blocks.length) return;
    const { stream: s } = latest.current;

    const human: Message = {
      id: newId(),
      type: "human",
      content: blocks.length
        ? ([...(trimmed ? [{ type: "text", text: trimmed }] : []), ...blocks] as Message["content"])
        : trimmed,
    };
    const placeholders = ensureToolCallsHaveResponses(s.messages as Message[]);
    const ctx = context && Object.keys(context).length ? context : undefined;

    await s.submit(
      { messages: [...placeholders, human], ...(ctx ? { context: ctx } : {}) },
      opts({
        optimisticValues: (prev: AgentState) => ({
          ...prev,
          messages: [...(prev.messages ?? []), ...placeholders, human],
        }),
      }),
    );
  }, [opts]);

  /** Branching info for a message: which branch it is on and which exist. */
  const getBranch = useCallback((message: Message) => {
    const meta = latest.current.stream.getMessagesMetadata(message);
    return {
      branch: meta?.branch,
      branchOptions: meta?.branchOptions,
      parentCheckpoint: meta?.firstSeenState?.parent_checkpoint as Checkpoint | null | undefined,
    };
  }, []);

  /** Re-run from before an AI message to get a new answer (creates a branch). */
  const regenerate = useCallback(
    (parentCheckpoint: Checkpoint | null | undefined) =>
      latest.current.stream.submit(undefined, opts({ checkpoint: parentCheckpoint })),
    [opts],
  );

  /** Replace a human message and continue from there (creates a branch). */
  const editMessage = useCallback(async (message: Message, text: string) => {
    const { stream: s } = latest.current;
    const meta = s.getMessagesMetadata(message);
    const newMessage: Message = { type: "human", content: text };
    await s.submit(
      { messages: [newMessage] },
      opts({
        checkpoint: meta?.firstSeenState?.parent_checkpoint,
        optimisticValues: (prev: AgentState) => {
          const values = meta?.firstSeenState?.values as AgentState | undefined;
          if (!values) return prev;
          return { ...values, messages: [...(values.messages ?? []), newMessage] };
        },
      }),
    );
  }, [opts]);

  /** Answer a user-facing `interrupt()` with any value. */
  const resume = useCallback(
    (value: unknown) => latest.current.stream.submit(null, opts({ command: { resume: value } })),
    [opts],
  );

  /** Answer a human-in-the-loop review. Pass `interruptId` when several are pending. */
  const submitDecisions = useCallback(
    (decisions: Decision[], interruptId?: string) =>
      resume(interruptId ? { [interruptId]: { decisions } } : { decisions }),
    [resume],
  );

  /** Continue past a static breakpoint (an interrupt with no value). */
  const continueRun = useCallback(
    () => latest.current.stream.submit(null, opts()),
    [opts],
  );

  /** End the run without answering the interrupt ("mark as resolved"). */
  const resolve = useCallback(
    () => latest.current.stream.submit(null, opts({ command: { goto: "__end__" } })),
    [opts],
  );

  // ---- frontend tools -------------------------------------------------------
  // `stream.interrupts` only holds user-facing interrupts; frontend-tool requests
  // stay in the raw state values.
  const raw = ((stream.values as Record<string, unknown> | undefined)?.__interrupt__ ?? []) as RawInterrupt[];
  const pendingTools = useMemo(() => (Array.isArray(raw) ? raw : []).flatMap((i) => {
    const p = parseHeadlessToolInterruptPayload(i.value);
    return p ? [{ interruptId: i.id, call: p.toolCall }] : [];
  }), [raw]);
  const pendingKey = pendingTools.map((p) => p.interruptId ?? p.call.id ?? p.call.name).join("|");
  const interrupts = (stream.interrupts ?? []) as RawInterrupt[];

  const handled = useRef(new Set<string>());
  useEffect(() => { handled.current.clear(); }, [threadId]);

  useEffect(() => {
    // Wait until the stream is idle: resuming while the previous stream is still
    // open queues the resume behind it and it never starts.
    if (stream.isLoading || !pendingTools.length) return;
    const keyOf = (p: (typeof pendingTools)[number]) => p.interruptId ?? p.call.id ?? p.call.name;
    const fresh = pendingTools.filter((p) => !handled.current.has(keyOf(p)));
    if (!fresh.length) return;
    fresh.forEach((p) => handled.current.add(keyOf(p)));

    void (async () => {
      const done = await Promise.all(fresh.map(async (p) => {
        const def = latest.current.kit.tools[p.call.name];
        let value: unknown;
        if (!def?.handler) value = { error: `No frontend handler registered for "${p.call.name}"` };
        else {
          try { value = await def.handler(p.call.args); }
          catch (e) { value = { error: e instanceof Error ? e.message : String(e) }; }
        }
        return { ...p, value };
      }));

      const byId = done.every((d) => d.interruptId);
      const resumeValue = byId
        ? Object.fromEntries(done.map((d) => [d.interruptId!, d.call.id ? { [d.call.id]: d.value } : d.value]))
        : done.length === 1 && !done[0].call.id
          ? done[0].value
          : Object.fromEntries(done.map((d) => [d.call.id ?? d.call.name, d.value]));

      await latest.current.stream.submit(null, opts({ command: { resume: resumeValue } }));
    })().catch(() => { /* surfaced through stream.error */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.isLoading, pendingKey]);

  const values = stream.values as AgentState | undefined;

  return {
    messages: stream.messages as Message[],
    isLoading: stream.isLoading,
    error: stream.error ? (stream.error instanceof Error ? stream.error.message : String(stream.error)) : null,
    /** Pending human-in-the-loop interrupts (frontend-tool pauses are handled for you). */
    interrupts,
    interrupt: interrupts[0],
    /** Frontend tool calls the browser is about to run or is running. */
    pendingToolCallIds: pendingTools.map((p) => p.call.id).filter(Boolean) as string[],
    /** Raw thread state, e.g. for a "view state" panel. */
    values,
    /** Generative UI messages emitted by the graph (`ui` channel). */
    ui: (values?.ui ?? []) as UIMessage[],
    threadId,
    send,
    stop: stream.stop,
    regenerate,
    editMessage,
    getBranch,
    setBranch: (branch: string) => stream.setBranch(branch),
    resume,
    continueRun,
    submitDecisions,
    resolve,
    newThread: () => setThreadId(null),
    selectThread: (id: string | null) => setThreadId(id),
    /** Escape hatch to the raw SDK stream. */
    stream,
  };
}
