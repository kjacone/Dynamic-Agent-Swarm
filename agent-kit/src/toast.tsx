"use client";
import { useCallback, useRef, useState } from "react";

export type ToastKind = "info" | "success" | "error";
export interface ToastItem { id: number; kind: ToastKind; title: string; description?: string }
export type Notify = (t: { kind?: ToastKind; title: string; description?: string; duration?: number }) => void;

export function useToastState() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((p) => p.filter((t) => t.id !== id)), []);
  const notify = useCallback<Notify>(({ kind = "info", title, description, duration = 6000 }) => {
    const id = ++seq.current;
    setItems((p) => [...p.slice(-2), { id, kind, title, description }]);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);
  return { items, notify, dismiss };
}

export function ToastViewport({ items, dismiss }: { items: ToastItem[]; dismiss: (id: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="lgk lgk-toasts" role="region" aria-label="Notifications" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="lgk-toast" data-kind={t.kind}>
          <div>
            <strong>{t.title}</strong>
            {t.description && <p>{t.description}</p>}
          </div>
          <button type="button" className="lgk-icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
