"use client";
import type { Message } from "@langchain/langgraph-sdk";
import { useState, type ComponentProps } from "react";
import { useAgentContext } from "../../agent-context";
import { messageText } from "../../content";
import { isMultimodalBlock } from "../../lib/multimodal";
import { MultimodalPreview } from "../MultimodalPreview";
import { PencilIcon, SendIcon, XIcon } from "../ui/icons";
import { IconButton } from "../ui/IconButton";
import { BranchSwitcher, CopyButton } from "./MessageControls";

export function HumanMessage({ message, branching = true, copy = true }: { message: Message; branching?: boolean; copy?: boolean }) {
  const agent = useAgentContext();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const text = messageText(message.content);
  const blocks = (Array.isArray(message.content) ? message.content.filter(isMultimodalBlock) : []) as unknown as Array<
    ComponentProps<typeof MultimodalPreview>["block"]
  >;
  const { branch, branchOptions } = branching ? agent.getBranch(message) : {};
  const busy = agent.isLoading;

  const submit = () => {
    const next = draft.trim();
    if (!next) return;
    setEditing(false);
    void agent.editMessage(message, next);
  };

  return (
    <div className="lgk-msg lgk-human" data-editing={editing || undefined}>
      {editing ? (
        <textarea
          autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit message"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); }
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <>
          {blocks.length > 0 && (
            <div className="lgk-attachments" data-align="end">
              {blocks.map((b, i) => <MultimodalPreview key={i} block={b} />)}
            </div>
          )}
          {text && <p>{text}</p>}
        </>
      )}
      <div className="lgk-actions">
        <BranchSwitcher branch={branch} branchOptions={branchOptions} onSelect={agent.setBranch} disabled={busy} />
        {editing ? (
          <>
            <IconButton label="Cancel edit" onClick={() => setEditing(false)}><XIcon /></IconButton>
            <IconButton label="Send edit (Ctrl+Enter)" disabled={busy || !draft.trim()} onClick={submit}><SendIcon /></IconButton>
          </>
        ) : (
          <>
            {copy && <CopyButton text={text} disabled={busy} />}
            {branching && text && <IconButton label="Edit" disabled={busy} onClick={() => { setDraft(text); setEditing(true); }}><PencilIcon /></IconButton>}
          </>
        )}
      </div>
    </div>
  );
}
