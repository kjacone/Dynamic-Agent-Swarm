"use client";
import { useEffect, useRef, useState } from "react";
import { useFileUpload } from "../use-file-upload";
import { ACCEPT_ATTR, type MultimodalBlock } from "../lib/multimodal";
import { ContentBlocksPreview } from "./MultimodalPreview";
import { PaperclipIcon, SpinnerIcon } from "./ui/icons";

export interface ComposerProps {
  placeholder: string;
  busy: boolean;
  disabled: boolean;
  /** Allow attaching images and PDFs (picker, drag-and-drop, paste). */
  upload: boolean;
  toolToggle?: { checked: boolean; onChange: (v: boolean) => void };
  onSend: (input: { text: string; blocks: MultimodalBlock[] }) => void;
  onStop: () => void;
  onError: (message: string) => void;
}

export function Composer({ placeholder, busy, disabled, upload, toolToggle, onSend, onStop, onError }: ComposerProps) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const files = useFileUpload({ enabled: upload && !disabled, onError });

  useEffect(() => {
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

  return (
    <div className="lgk-composer-wrap">
      <div className="lgk-composer" data-dragover={files.dragOver || undefined}>
        <ContentBlocksPreview blocks={files.blocks} onRemove={files.removeBlock} />
        <textarea
          ref={ref} rows={1} value={text} placeholder={placeholder} disabled={disabled} aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onPaste={upload ? files.handlePaste : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
        />
        <div className="lgk-composer-bar">
          {upload && (
            <label className="lgk-attach" title="Attach images or PDFs">
              <PaperclipIcon /> <span>Attach</span>
              <input type="file" multiple accept={ACCEPT_ATTR} onChange={files.handleFileUpload} disabled={disabled} hidden />
            </label>
          )}
          {toolToggle && (
            <label className="lgk-switch">
              <input type="checkbox" role="switch" checked={toolToggle.checked} onChange={(e) => toolToggle.onChange(e.target.checked)} />
              <span>Hide tool calls</span>
            </label>
          )}
          {busy ? (
            <button type="button" className="lgk-stop" onClick={onStop}><SpinnerIcon /> Stop</button>
          ) : (
            <button type="button" className="lgk-send" onClick={send} disabled={!canSend || disabled}>Send</button>
          )}
        </div>
        {files.dragOver && <div className="lgk-drop-hint">Drop images or PDFs to attach</div>}
      </div>
    </div>
  );
}
