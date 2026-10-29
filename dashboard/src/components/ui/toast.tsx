import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; kind: "info" | "success" | "error" };
type Ctx = { push: (message: string, kind?: Toast["kind"]) => void };

const ToastCtx = React.createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto min-w-[260px] rounded-md border px-3 py-2 text-sm shadow-lg",
              t.kind === "error" && "border-red-300 bg-red-50 text-red-900",
              t.kind === "success" && "border-emerald-300 bg-emerald-50 text-emerald-900",
              t.kind === "info" && "border-slate-300 bg-white text-slate-900",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}