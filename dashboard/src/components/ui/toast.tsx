import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; kind: "info" | "success" | "error" };
type Ctx = { push: (message: string, kind?: Toast["kind"]) => void };

const ToastCtx = React.createContext<Ctx | null>(null);

const TONES: Record<Toast["kind"], { box: string; icon: typeof Info }> = {
  success: {
    box: "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
    icon: CheckCircle2,
  },
  error: {
    box: "border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-200",
    icon: AlertTriangle,
  },
  info: {
    box: "border-border bg-card text-foreground",
    icon: Info,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const dismiss = React.useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  const push = React.useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, kind }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => {
          const { box, icon: Icon } = TONES[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3 text-sm shadow-lg backdrop-blur",
                box,
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.kind === "success" && "text-emerald-600 dark:text-emerald-400", t.kind === "error" && "text-red-600 dark:text-red-400")} />
              <div className="min-w-0 flex-1 leading-snug">{t.message}</div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 cursor-pointer rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
