"use client";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Chat, type ChatProps } from "./Chat";
import { HistoryPanel } from "./HistoryPanel";
import { HistoryIcon, XIcon } from "./ui/icons";
import { IconButton } from "./ui/IconButton";

export interface ChatSidebarProps extends ChatProps {
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

export function ChatSidebar({
  children, defaultOpen = true, mode = "panel", width = 420,
  launcherLabel = "Ask the agent", title = "Assistant", features, ...chat
}: ChatSidebarProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<"chat" | "history">("chat");
  const style = { "--lgk-dock-w": `${width}px` } as CSSProperties;

  return (
    <div className="lgk lgk-dock" data-mode={mode} data-open={open} style={style}>
      <div className="lgk-dock-main">{children}</div>

      {/* Stays mounted while closed so the conversation and stream survive. */}
      <aside className="lgk-dock-side" hidden={!open} aria-label={title}>
        <Chat
          {...chat}
          title={title}
          features={{ connectionBadge: false, artifacts: false, ...features }}
          headerActions={
            <>
              <IconButton label="Chat history" onClick={() => setView("history")}><HistoryIcon /></IconButton>
              <IconButton label="Close" onClick={() => { setOpen(false); setView("chat"); }}><XIcon /></IconButton>
            </>
          }
        />
        {view === "history" && <HistoryPanel onClose={() => setView("chat")} />}
      </aside>

      {!open && (
        <button type="button" className="lgk-fab" onClick={() => setOpen(true)}>{launcherLabel}</button>
      )}
    </div>
  );
}