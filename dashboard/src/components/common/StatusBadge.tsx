import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  red: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  blue: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",
  gray: "bg-muted text-muted-foreground border-border",
};

const MAP: Record<string, string> = {
  completed: "green", approved: "green", pass: "green", success: "green", ok: "green", allow: "green", installed: "green", available: "green",
  running: "blue", log: "blue", info: "blue",
  waiting_approval: "amber", pending: "amber", warn: "amber", redact: "amber", require_approval: "amber", escalated: "amber", roadmap: "amber",
  failed: "red", rejected: "red", denied: "red", fail: "red", error: "red", block: "red", expired: "red",
  cancelled: "gray",
};

export function StatusBadge({ value, label, tone }: { value: string; label?: string; tone?: keyof typeof TONES }) {
  const t = tone ?? MAP[value] ?? "gray";
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[t])}>
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{children}</span>;
}

/** Horizontal meter; turns red above `warnAt`. */
export function Meter({ pct, warnAt = 90 }: { pct: number; warnAt?: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", p >= warnAt ? "bg-red-500" : "bg-primary")} style={{ width: `${p}%` }} />
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
