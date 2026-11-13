import { cn } from "@/lib/utils";

const TONES: Record<string, { box: string; dot: string }> = {
  green: { box: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25", dot: "bg-emerald-500" },
  amber: { box: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25", dot: "bg-amber-500" },
  red: { box: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/25", dot: "bg-red-500" },
  blue: { box: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25", dot: "bg-sky-500" },
  gray: { box: "bg-muted text-muted-foreground border-border", dot: "bg-slate-400" },
};

const MAP: Record<string, string> = {
  completed: "green", approved: "green", pass: "green", success: "green", ok: "green", allow: "green", installed: "green", available: "green", enabled: "green", active: "green",
  running: "blue", log: "blue", info: "blue", requested: "blue",
  waiting_approval: "amber", pending: "amber", warn: "amber", redact: "amber", require_approval: "amber", escalated: "amber", roadmap: "amber", queued: "amber", ingesting: "amber",
  failed: "red", rejected: "red", denied: "red", fail: "red", error: "red", block: "red", expired: "red",
  cancelled: "gray", disabled: "gray", resolved: "gray", archived: "gray",
};

export function StatusBadge({ value, label, tone }: { value: string; label?: string; tone?: keyof typeof TONES }) {
  const t = tone ?? MAP[value] ?? "gray";
  const { box, dot } = TONES[t];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", box)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground", className)}>
      {children}
    </span>
  );
}

/** Horizontal meter; turns red above `warnAt`. */
export function Meter({ pct, warnAt = 90, className }: { pct: number; warnAt?: number; className?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", p >= warnAt ? "bg-red-500" : "bg-primary")}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

/** "due in 3h", "overdue 2d" — for SLA display. */
export function dueLabel(due: string | null, active: boolean): { text: string; overdue: boolean } {
  if (!due) return { text: "no SLA", overdue: false };
  const ms = new Date(due).getTime() - Date.now();
  const abs = Math.abs(ms), h = abs / 3.6e6;
  const span = h >= 48 ? `${Math.round(h / 24)}d` : h >= 1 ? `${Math.round(h)}h` : `${Math.max(1, Math.round(abs / 6e4))}m`;
  if (!active) return { text: "", overdue: false };
  return ms < 0 ? { text: `overdue ${span}`, overdue: true } : { text: `due in ${span}`, overdue: false };
}
