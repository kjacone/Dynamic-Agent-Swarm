import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONES = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
} as const;

export type StatTone = keyof typeof TONES;

export function StatCard({
  icon: Icon,
  label,
  value,
  tone = "sky",
  hint,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone?: StatTone;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("p-4 transition-shadow hover:shadow-md", className)}>
      <div className="flex items-center gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold leading-none tabular-nums">{value}</div>
          <div className="mt-1 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
      </div>
      {hint && <div className="mt-2.5 line-clamp-2 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}
