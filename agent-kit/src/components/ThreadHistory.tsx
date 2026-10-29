"use client";
import { useThreads } from "../hooks";
import { useKit } from "../provider";
import { TrashIcon } from "./ui/icons";
import { IconButton } from "./ui/IconButton";

export function formatRelative(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const f = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit, number][] = [
    [60, "second", 1], [3600, "minute", 60], [86400, "hour", 3600], [604800, "day", 86400],
  ];
  for (const [limit, unit, div] of steps) {
    if (Math.abs(seconds) < limit) return f.format(Math.round(seconds / div), unit);
  }
  return new Date(iso).toLocaleDateString();
}

/** Past conversations for the current assistant. Click to open, ✕ to delete. */
export function ThreadHistory({ onSelect }: { onSelect?: (id: string) => void }) {
  const { threads, loading, remove } = useThreads();
  const { threadId, setThreadId, isConfigured, notify } = useKit();

  if (!isConfigured) return <p className="lgk-muted">Connect to a server to see your chats.</p>;
  if (loading) {
    return (
      <div className="lgk-threads" aria-busy="true" aria-label="Loading chats">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="lgk-skeleton" />)}
      </div>
    );
  }
  if (!threads.length) return <p className="lgk-muted">No chats yet. Send a message to start one.</p>;

  return (
    <nav className="lgk-threads" aria-label="Chat history">
      {threads.map((t) => (
        <div key={t.id} className="lgk-thread-row" data-active={t.id === threadId}>
          <button
            type="button" aria-current={t.id === threadId ? "page" : undefined}
            onClick={() => { if (t.id !== threadId) setThreadId(t.id); onSelect?.(t.id); }}
          >
            <span className="lgk-thread-title">{t.title}</span>
            <span className="lgk-muted">{formatRelative(t.updatedAt)}</span>
          </button>
          <IconButton
            label={`Delete "${t.title}"`}
            onClick={() => { remove(t.id).catch(() => notify({ kind: "error", title: "Couldn't delete that chat" })); }}
          >
            <TrashIcon />
          </IconButton>
        </div>
      ))}
    </nav>
  );
}
