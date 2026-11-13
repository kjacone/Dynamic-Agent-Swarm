import { cn } from "@/lib/utils";

export function FilterTabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string; count?: number | null }>;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex flex-wrap items-center gap-1 rounded-xl border bg-muted/50 p-1", className)}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                  active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
