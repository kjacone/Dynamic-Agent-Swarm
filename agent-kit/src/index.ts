// Provider + hooks
export { LangGraphKitProvider, useKit } from "./provider";
export type { LangGraphKitProviderProps, KitContextValue } from "./provider";
export { useAgent } from "./use-agent";
export type { AgentState, SendInput } from "./use-agent";
export { useAgentContext } from "./agent-context";
export { useAgentTool, useAgentReadable, useAssistants, useThreads } from "./hooks";
export type { ThreadSummary } from "./hooks";
export { useFileUpload } from "./use-file-upload";

// Surfaces
export { Chat } from "./components/Chat";
export type { ChatProps, ChatFeatures } from "./components/Chat";
export { ChatPopup } from "./components/ChatPopup";
export type { ChatPopupProps } from "./components/ChatPopup";
export { ChatSidebar } from "./components/ChatSidebar";
export type { ChatSidebarProps } from "./components/ChatSidebar";
export { Playground } from "./components/Playground";
export { HistoryPanel } from "./components/HistoryPanel";

// Building blocks for custom layouts
export { ConnectionForm } from "./components/ConnectionForm";
export { ThreadHistory } from "./components/ThreadHistory";
export { Composer } from "./components/Composer";
export { HumanMessage } from "./components/messages/HumanMessage";
export { AssistantMessage } from "./components/messages/AssistantMessage";
export type { UiComponents } from "./components/messages/AssistantMessage";
export { ToolCallCard, ToolOutput } from "./components/messages/ToolCalls";
export { InterruptView } from "./components/interrupts/InterruptView";
export type { InterruptRenderProps } from "./components/interrupts/InterruptView";
export { HitlReview } from "./components/interrupts/HitlReview";
export { GenericInterrupt } from "./components/interrupts/GenericInterrupt";
export { Markdown } from "./components/Markdown";
export type { MarkdownOptions } from "./components/Markdown";
export { KeyValueTable, ExpandableText } from "./components/ui/KeyValueTable";

// Artifacts (side panel)
export { useArtifact, useArtifactOpen, useArtifactContext } from "./artifact";

// Helpers and types
export { messageText, messageReasoning, messageToolCalls, DO_NOT_RENDER_ID_PREFIX } from "./content";
export { ensureToolCallsHaveResponses } from "./lib/ensure-tool-responses";
export { isHitlRequest } from "./lib/hitl";
export type { HitlRequest, ActionRequest, ReviewConfig, Decision, DecisionType } from "./lib/hitl";
export type { MultimodalBlock } from "./lib/multimodal";
export type { AgentToolDefinition, Connection, ConnectionStatus, ToolRenderProps, ToolStatus } from "./types";
