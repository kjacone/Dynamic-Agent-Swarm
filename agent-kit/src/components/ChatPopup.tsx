"use client";
import { useState } from "react";
import { Chat, type ChatProps } from "./Chat";
import { XIcon } from "./ui/icons";
import { IconButton } from "./ui/IconButton";

export interface ChatPopupProps extends ChatProps {
  defaultOpen?: boolean;
  /** Label on the launcher button. */
  launcherLabel?: string;
}

/** Floating launcher + chat window, bottom-right. The chat stays mounted while closed. */
export function ChatPopup({ defaultOpen = false, launcherLabel = "Ask the agent", title = "Assistant", features, ...chat }: ChatPopupProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="lgk lgk-popup-root">
      <div className="lgk-popup" role="dialog" aria-label={title} hidden={!open}>
        <Chat
          {...chat} title={title}
          // Compact by default: a small window has no room for the extras.
          features={{ connectionBadge: false, toolToggle: false, artifacts: false, ...features }}
          headerActions={<IconButton label="Close" onClick={() => setOpen(false)}><XIcon /></IconButton>}
        />
      </div>
      {!open && <button type="button" className="lgk-fab" onClick={() => setOpen(true)}>{launcherLabel}</button>}
    </div>
  );
}
