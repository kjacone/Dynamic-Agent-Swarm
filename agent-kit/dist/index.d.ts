import * as react from 'react';
import { ReactNode, ChangeEvent, ClipboardEvent, ComponentType } from 'react';
import * as _langchain_langgraph_sdk from '@langchain/langgraph-sdk';
import { Client, Message, Checkpoint, Assistant, ToolMessage } from '@langchain/langgraph-sdk';
import { UIMessage, RemoveUIMessage } from '@langchain/langgraph-sdk/react-ui';
import { Options } from 'react-markdown';

/**
 * Connect the kit to the NMB gateway (`/v1/session` + `/v1/chat`) instead of a
 * LangGraph server. The browser only ever holds a publishable key; the gateway
 * mints a short-lived session token and keeps sessions, guardrails, citations,
 * thread ownership and human handoff server-side.
 */
interface GatewayConfig {
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
interface GatewaySource {
    id?: number | string;
    title: string;
    page?: number;
    collection?: string;
}
interface GatewayHandoff {
    id: string;
    thread_id: string;
    status: "requested" | "active" | "resolved";
    reason?: string | null;
    assigned_to?: string | null;
    created_at?: string | null;
    resolved_at?: string | null;
}
interface GatewayStaffMessage {
    id: string;
    role: "staff" | "customer" | "system" | string;
    author?: string | null;
    text: string;
    created_at?: string | null;
}
type GatewayEvent = {
    type: "thread";
    threadId: string;
} | {
    type: "citations";
    sources: GatewaySource[];
} | {
    type: "handoff";
    handoff: GatewayHandoff;
    messageId?: string;
};
interface GatewayEventBus {
    subscribe(fn: (event: GatewayEvent) => void): () => void;
    emit(event: GatewayEvent): void;
}
/** Exchanges the publishable key for a short-lived session token; falls back to the key. */
declare function gatewayToken(cfg: GatewayConfig, force?: boolean): Promise<string>;
declare function requestHandoff(cfg: GatewayConfig, threadId: string, reason?: string): Promise<{
    handoff: GatewayHandoff;
    created: boolean;
}>;
declare function handoffSnapshot(cfg: GatewayConfig, threadId: string): Promise<{
    handoff: GatewayHandoff | null;
    messages: GatewayStaffMessage[];
}>;
declare function sendFeedback(cfg: GatewayConfig, body: {
    thread_id: string;
    rating: "up" | "down";
    user_message?: string;
    reply?: string;
    comment?: string;
}): Promise<void>;
type Chunk = {
    id?: string;
    event: string;
    data: unknown;
};
type TransportPayload = {
    input: unknown;
    context?: unknown;
    command?: unknown;
    signal: AbortSignal;
    config?: {
        configurable?: Record<string, unknown>;
    };
};
/**
 * SDK custom transport: maps `/v1/chat` SSE onto the LangGraph event shape the
 * kit already understands (`messages` chunks + `custom` events).
 */
declare class GatewayTransport {
    private readonly cfg;
    private readonly emit;
    private boundThread;
    private serverThread;
    constructor(cfg: GatewayConfig, emit?: (event: GatewayEvent) => void);
    private get storeKey();
    private restore;
    private remember;
    stream(payload: TransportPayload): AsyncGenerator<Chunk>;
    private failure;
    private consume;
}

type ToastKind = "info" | "success" | "error";
type Notify = (t: {
    kind?: ToastKind;
    title: string;
    description?: string;
    duration?: number;
}) => void;

type ToolStatus = "running" | "done" | "error" | "pending";
interface ToolRenderProps<A = any, R = unknown> {
    name: string;
    args: A;
    status: ToolStatus;
    /** Parsed tool output once the tool has finished. */
    result?: R;
}
/**
 * A tool the UI knows about.
 * - with `handler`: runs in the browser when the graph interrupts with a
 *   headless tool call (frontend action).
 * - with `render`: draws a custom card for that tool call in the chat
 *   (works for server-side tools too).
 */
interface AgentToolDefinition<A = any, R = unknown> {
    name: string;
    handler?: (args: A) => R | Promise<R>;
    render?: (props: ToolRenderProps<A, R>) => ReactNode;
}
interface Connection {
    /** LangGraph API base URL, e.g. http://localhost:2024 */
    apiUrl: string;
    /** Assistant UUID or graph id (e.g. "agent"). */
    assistantId: string;
    /** Optional auth token. Sent as Bearer by default. */
    token?: string;
    /**
     * bearer: `Authorization: Bearer <token>` (custom auth on your own server)
     * api-key: `X-Api-Key: <token>` (LangSmith / LangGraph Platform)
     * agent-builder: `X-Api-Key` plus `X-Auth-Scheme: langsmith-api-key`
     */
    authScheme?: "bearer" | "api-key" | "agent-builder";
    /** Extra headers on every request. */
    headers?: Record<string, string>;
}
interface Readable {
    description: string;
    value: unknown;
}
type ConnectionStatus = "idle" | "checking" | "ok" | "error";

type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
/** CSS custom property overrides, e.g. { "--lgk-bg": "#fff" }. */
type ThemeVars = Record<`--${string}`, string>;
interface KitContextValue {
    connection: Connection;
    setConnection: (patch: Partial<Connection>) => void;
    isConfigured: boolean;
    status: ConnectionStatus;
    client: Client;
    auth: {
        apiKey?: string;
        headers: Record<string, string>;
    };
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
interface LangGraphKitProviderProps extends Partial<Connection> {
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
    themeVars?: {
        light?: ThemeVars;
        dark?: ThemeVars;
    };
}
declare function LangGraphKitProvider({ children, threadId: threadIdProp, onThreadIdChange, configurable, persistKey, branching, submitOptions, gateway, apiUrl, assistantId, token, authScheme, headers, theme: themeProp, defaultTheme, onThemeChange, themeVars, }: LangGraphKitProviderProps): react.JSX.Element;
declare function useKit(): KitContextValue;

/**
 * Human-in-the-loop request shape emitted by LangChain's HumanInTheLoopMiddleware.
 * The graph pauses with `interrupt(HitlRequest)`; resume with `{ decisions: Decision[] }`,
 * one decision per action request, in order.
 */
type DecisionType = "approve" | "edit" | "reject";
interface ActionRequest {
    name: string;
    args: Record<string, unknown>;
    description?: string;
}
interface ReviewConfig {
    action_name: string;
    allowed_decisions: DecisionType[];
    args_schema?: Record<string, unknown>;
}
interface HitlRequest {
    action_requests: ActionRequest[];
    review_configs: ReviewConfig[];
}
type Decision = {
    type: "approve";
} | {
    type: "reject";
    message?: string;
} | {
    type: "edit";
    edited_action: {
        name: string;
        args: Record<string, unknown>;
    };
};
/** Takes an interrupt's *value*. */
declare function isHitlRequest(value: unknown): value is HitlRequest;

/** Image / PDF blocks in LangChain's standard content-block shape (base64, no data: prefix). */
type ImageBlock = {
    type: "image";
    mimeType: string;
    data: string;
    metadata?: {
        name?: string;
    };
};
type FileBlock = {
    type: "file";
    mimeType: "application/pdf";
    data: string;
    metadata?: {
        filename?: string;
        name?: string;
    };
};
type MultimodalBlock = ImageBlock | FileBlock;

type AgentState = {
    messages: Message[];
    ui?: UIMessage[];
};
type Bag = {
    UpdateType: {
        messages?: Message[] | Message | string;
        ui?: (UIMessage | RemoveUIMessage)[] | UIMessage | RemoveUIMessage;
        context?: Record<string, unknown>;
    };
    CustomEventType: UIMessage | RemoveUIMessage;
};
type RawInterrupt = {
    id?: string;
    value?: unknown;
};
interface SendInput {
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
declare function useAgent(): {
    messages: Message[];
    isLoading: boolean;
    error: string | null;
    /** Pending human-in-the-loop interrupts (frontend-tool pauses are handled for you). */
    interrupts: RawInterrupt[];
    interrupt: RawInterrupt;
    /** Frontend tool calls the browser is about to run or is running. */
    pendingToolCallIds: string[];
    /** Raw thread state, e.g. for a "view state" panel. */
    values: AgentState | undefined;
    /** Generative UI messages emitted by the graph (`ui` channel). */
    ui: UIMessage[];
    threadId: string | null;
    send: (input: string | SendInput) => Promise<void>;
    stop: () => Promise<void>;
    regenerate: (parentCheckpoint: Checkpoint | null | undefined) => Promise<void>;
    editMessage: (message: Message, text: string) => Promise<void>;
    getBranch: (message: Message) => {
        branch: string | undefined;
        branchOptions: string[] | undefined;
        parentCheckpoint: Checkpoint | null | undefined;
    };
    setBranch: (branch: string) => void;
    resume: (value: unknown) => Promise<void>;
    continueRun: () => Promise<void>;
    submitDecisions: (decisions: Decision[], interruptId?: string) => Promise<void>;
    resolve: () => Promise<void>;
    newThread: () => void;
    selectThread: (id: string | null) => void;
    /** Gateway mode: citations for the current reply. */
    sources: GatewaySource[];
    /** Gateway mode: the open (or most recent) human handoff, if any. */
    handoff: GatewayHandoff | null;
    handoffMessages: GatewayStaffMessage[];
    /** Gateway mode: ask a human to join this conversation. */
    requestHuman: (reason?: string) => Promise<void>;
    /** Gateway mode: rate the last reply. */
    feedback: (rating: "up" | "down") => void;
    feedbackSent: "up" | "down" | null;
    /** Gateway mode: the server-side thread id (differs from the SDK client id). */
    serverThreadId: string | null;
    isGateway: boolean;
    /** Escape hatch to the raw SDK stream. */
    stream: _langchain_langgraph_sdk.BaseStream<AgentState, _langchain_langgraph_sdk.DefaultToolCall, Bag>;
};

type AgentApi = ReturnType<typeof useAgent>;
/**
 * The agent that the surrounding <Chat> is driving. Use it inside custom tool cards,
 * interrupt UIs and generative-UI components, e.g. to call `send()` from a button.
 */
declare function useAgentContext(): AgentApi;

/**
 * Register a tool the UI knows about.
 *  - `handler`  → frontend action, executed in the browser when the graph asks for it
 *  - `render`   → custom card for that tool call (frontend or server tool)
 * Keep the declaration stable; the latest `handler`/`render` closure is always used.
 */
declare function useAgentTool<A = any, R = unknown>(def: AgentToolDefinition<A, R>): void;
/**
 * Share app state with the agent. Sent on each run as
 * `config.configurable.readables = [{ description, value }, ...]`.
 */
declare function useAgentReadable(description: string, value: unknown): void;
declare function useAssistants(): {
    refresh: () => void;
    assistants: Assistant[];
    loading: boolean;
    error: string | null;
};
interface ThreadSummary {
    id: string;
    title: string;
    updatedAt: string;
}
declare function useThreads({ limit }?: {
    limit?: number;
}): {
    threads: ThreadSummary[];
    loading: boolean;
    remove: (id: string) => Promise<void>;
};

/** Attachments for the composer: picker, drag-and-drop anywhere on the page, and paste. */
declare function useFileUpload({ enabled, onError }?: {
    enabled?: boolean;
    onError?: (message: string) => void;
}): {
    blocks: MultimodalBlock[];
    dragOver: boolean;
    handleFileUpload: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
    handlePaste: (e: ClipboardEvent) => void;
    removeBlock: (index: number) => void;
    reset: () => void;
};

interface InterruptRenderProps {
    interrupt: {
        id?: string;
        value?: unknown;
    };
    value: unknown;
    resume: (value: unknown) => unknown;
}
/**
 * Picks the right UI for what the graph is waiting on:
 * your `render` (return null/undefined to fall through) → HITL review → generic answer box.
 */
declare function InterruptView({ interrupts, render }: {
    interrupts: {
        id?: string;
        value?: unknown;
    }[];
    render?: (p: InterruptRenderProps) => ReactNode;
}): react.JSX.Element | null;

interface MarkdownOptions {
    /** e.g. `[remarkMath]`, added after GitHub-flavoured markdown. */
    remarkPlugins?: Options["remarkPlugins"];
    /** e.g. `[rehypeKatex]` (also import katex's CSS). */
    rehypePlugins?: Options["rehypePlugins"];
    /** Override any element renderer, including `pre` to plug in a syntax highlighter. */
    components?: Options["components"];
}
declare const Markdown: react.NamedExoticComponent<MarkdownOptions & {
    children: string;
}>;

/** Components the graph's generative-UI (`ui`) messages are rendered with, keyed by name. */
type UiComponents = Record<string, ComponentType<any>>;
declare function AssistantMessage({ message, results, loading, hideToolCalls, branching, copy, uiComponents, markdown, sources, feedback, }: {
    message: Message;
    /** Tool results by `tool_call_id`. */
    results: Map<string, ToolMessage>;
    /** True while this is the message currently streaming. */
    loading: boolean;
    hideToolCalls?: boolean;
    branching?: boolean;
    copy?: boolean;
    uiComponents?: UiComponents;
    markdown?: MarkdownOptions;
    /** Gateway citations for this reply. */
    sources?: GatewaySource[];
    /** Gateway feedback controls for the last reply. */
    feedback?: {
        sent: "up" | "down" | null;
        onRate: (rating: "up" | "down") => void;
    };
}): react.JSX.Element | null;

interface ChatFeatures {
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
interface ChatProps {
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
declare function Chat(props: ChatProps): react.JSX.Element;

interface ChatPopupProps extends ChatProps {
    defaultOpen?: boolean;
    /** Label on the launcher button. */
    launcherLabel?: string;
}
/** Floating launcher + chat window, bottom-right. The chat stays mounted while closed. */
declare function ChatPopup({ defaultOpen, launcherLabel, title, features, ...chat }: ChatPopupProps): react.JSX.Element;

interface ChatSidebarProps extends ChatProps {
    children: ReactNode;
    defaultOpen?: boolean;
    /**
     * "panel": docked to the right edge, full height, your app shrinks to make room (default).
     * "popup": floating window that rises from the bottom-right corner.
     * Both go full screen on phones.
     */
    mode?: "panel" | "popup";
    /** Width in px. */
    width?: number;
    launcherLabel?: string;
}
declare function ChatSidebar({ children, defaultOpen, mode, width, launcherLabel, title, features, ...chat }: ChatSidebarProps): react.JSX.Element;

/**
 * Full-page workspace: connection settings and history on the left, chat on the right.
 * Shows the setup form until the provider has a server URL and an assistant.
 */
declare function Playground(props: Omit<ChatProps, "headerStart">): react.JSX.Element;

/** Full-size overlay with past chats and a "New chat" button. Used by ChatSidebar. */
declare function HistoryPanel({ onClose, title }: {
    onClose: () => void;
    title?: string;
}): react.JSX.Element;

/** First-run setup: where the server is, which agent to talk to, and how to authenticate. */
declare function ConnectionForm({ defaultApiUrl, defaultAssistantId, onConnected }: {
    defaultApiUrl?: string;
    defaultAssistantId?: string;
    onConnected?: () => void;
}): react.JSX.Element;

/** Past conversations for the current assistant. Click to open, ✕ to delete. */
declare function ThreadHistory({ onSelect }: {
    onSelect?: (id: string) => void;
}): react.JSX.Element;

interface ComposerProps {
    placeholder: string;
    busy: boolean;
    disabled: boolean;
    /** Allow attaching images and PDFs (picker, drag-and-drop, paste). */
    upload: boolean;
    toolToggle?: {
        checked: boolean;
        onChange: (v: boolean) => void;
    };
    onSend: (input: {
        text: string;
        blocks: MultimodalBlock[];
    }) => void;
    onStop: () => void;
    onError: (message: string) => void;
}
declare function Composer({ placeholder, busy, disabled, upload, toolToggle, onSend, onStop, onError }: ComposerProps): react.JSX.Element;

declare function HumanMessage({ message, branching, copy }: {
    message: Message;
    branching?: boolean;
    copy?: boolean;
}): react.JSX.Element;

type Content = Message["content"];
/** Messages whose id starts with this are stored in state but never shown. */
declare const DO_NOT_RENDER_ID_PREFIX = "do-not-render-";
declare function messageText(content: Content): string;
/** Reasoning/"thinking" blocks from Anthropic, OpenAI and compatible providers. */
declare function messageReasoning(content: Content): string;
interface ToolCallLike {
    id?: string;
    name: string;
    args: Record<string, unknown>;
}
/**
 * Tool calls of an AI message. While Anthropic streams, `tool_calls` can be empty and the
 * call only exists as a partial `tool_use` content block, so fall back to parsing that.
 */
declare function messageToolCalls(m: Message): ToolCallLike[];

/** A tool's output: card strips for lists, tables for objects, clipped text otherwise. */
declare function ToolOutput({ message }: {
    message: ToolMessage;
}): react.JSX.Element;
/**
 * One tool call with its input and (once it arrives) its result. A `render` registered
 * with `useAgentTool` replaces the default card.
 */
declare function ToolCallCard({ call, result, status }: {
    call: ToolCallLike;
    result?: ToolMessage;
    status: ToolStatus;
}): react.JSX.Element;

/**
 * Review UI for LangChain's HumanInTheLoopMiddleware: for every pending action the reviewer
 * approves, edits its arguments, or rejects with a reason. Resumes with `{ decisions }`.
 */
declare function HitlReview({ interrupts }: {
    interrupts: {
        id?: string;
        value?: unknown;
    }[];
}): react.JSX.Element;

/** Any `interrupt(value)`: shows the value and lets the user answer with text or JSON. */
declare function GenericInterrupt({ value }: {
    value: unknown;
}): react.JSX.Element;

/** Two-column view of an object's entries (or an array's items). */
declare function KeyValueTable({ data, maxRows }: {
    data: Record<string, unknown> | unknown[];
    maxRows?: number;
}): react.JSX.Element;
/** Long text, clipped until the reader asks for more. */
declare function ExpandableText({ text, maxLines, maxChars }: {
    text: string;
    maxLines?: number;
    maxChars?: number;
}): react.JSX.Element;

type Setter<T> = (value: T | ((value: T) => T)) => void;
type Slot<T> = [T, Setter<T>];
declare function useArtifact(): readonly [(props: {
    title?: ReactNode;
    children: ReactNode;
}) => react.JSX.Element, {
    readonly open: boolean;
    readonly setOpen: (value: boolean | ((v: boolean) => boolean)) => void;
    readonly context: Record<string, unknown>;
    readonly setContext: Setter<Record<string, unknown>>;
}];
/** `[isAnyOpen, close]` */
declare function useArtifactOpen(): readonly [boolean, () => void];
/** Context artifacts attached; sent along with the next message. */
declare function useArtifactContext(): Slot<Record<string, unknown>>;

/**
 * Providers reject a conversation where an AI tool call has no tool result. If the user
 * types while a call is unanswered (a pending approval, a stopped run), answer it with a
 * hidden placeholder so the next run is valid.
 */
declare function ensureToolCallsHaveResponses(messages: Message[]): Message[];

export { type ActionRequest, type AgentState, type AgentToolDefinition, AssistantMessage, Chat, type ChatFeatures, ChatPopup, type ChatPopupProps, type ChatProps, ChatSidebar, type ChatSidebarProps, Composer, type Connection, ConnectionForm, type ConnectionStatus, DO_NOT_RENDER_ID_PREFIX, type Decision, type DecisionType, ExpandableText, type GatewayConfig, type GatewayEvent, type GatewayHandoff, type GatewaySource, type GatewayStaffMessage, GatewayTransport, GenericInterrupt, HistoryPanel, type HitlRequest, HitlReview, HumanMessage, type InterruptRenderProps, InterruptView, KeyValueTable, type KitContextValue, LangGraphKitProvider, type LangGraphKitProviderProps, Markdown, type MarkdownOptions, type MultimodalBlock, Playground, type ReviewConfig, type SendInput, ThreadHistory, type ThreadSummary, ToolCallCard, ToolOutput, type ToolRenderProps, type ToolStatus, type UiComponents, ensureToolCallsHaveResponses, gatewayToken, handoffSnapshot, isHitlRequest, messageReasoning, messageText, messageToolCalls, requestHandoff, sendFeedback, useAgent, useAgentContext, useAgentReadable, useAgentTool, useArtifact, useArtifactContext, useArtifactOpen, useAssistants, useFileUpload, useKit, useThreads };
