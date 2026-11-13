import { Inbox, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function AsyncState<T>({
  loading,
  error,
  data,
  children,
  empty,
}: {
  loading: boolean;
  error: Error | null;
  data: T | undefined | null;
  children: (d: T) => React.ReactNode;
  empty?: React.ReactNode;
}) {
  if (loading) return <LoadingBlock />;
  if (error)
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error.message}
      </div>
    );
  if (data === undefined || data === null) return <>{empty ?? null}</>;
  return <>{children(data)}</>;
}

export function LoadingBlock({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={"space-y-3 " + (className || "")} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-6 py-12 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm">
        <Icon className="h-5 w-5" />
      </span>
      <div className="text-sm font-medium">{title}</div>
      {body && <div className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{body}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
