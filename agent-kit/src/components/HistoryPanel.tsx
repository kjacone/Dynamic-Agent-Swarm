"use client";
import { useKit } from "../provider";
import { ThreadHistory } from "./ThreadHistory";
import { ChevronLeftIcon, PlusIcon } from "./ui/icons";
import { IconButton } from "./ui/IconButton";

/** Full-size overlay with past chats and a "New chat" button. Used by ChatSidebar. */
export function HistoryPanel({ onClose, title = "Chats" }: { onClose: () => void; title?: string }) {
  const { setThreadId } = useKit();
  return (
    <div className="lgk-dock-history" role="region" aria-label="Chat history">
      <header className="lgk-chat-head">
        <div className="lgk-chat-head-start">
          <IconButton label="Back to chat" onClick={onClose}><ChevronLeftIcon /></IconButton>
          <h2>{title}</h2>
        </div>
        <div className="lgk-chat-head-actions">
          <button type="button" className="lgk-primary lgk-sm" onClick={() => { setThreadId(null); onClose(); }}>
            <PlusIcon /> New chat
          </button>
        </div>
      </header>
      <div className="lgk-dock-history-body">
        <ThreadHistory onSelect={onClose} />
      </div>
    </div>
  );
}