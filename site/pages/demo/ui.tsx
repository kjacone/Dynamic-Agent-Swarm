import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function DemoBadge({ label = "Free" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--site-accent)]/25 bg-[var(--site-accent)]/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--site-accent)]">
      <Sparkles className="h-3 w-3" />
      {label}
    </span>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border/80 bg-card ${className}`}>{children}</section>;
}

export function PanelHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {meta}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/80 bg-card px-4 py-3.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[20px] font-semibold tracking-[-0.02em]">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[10.5px] text-muted-foreground">{children}</span>;
}
