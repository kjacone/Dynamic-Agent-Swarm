import { Button } from "@/components/ui/button";

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
  if (loading) return <div className="animate-pulse p-6 text-sm text-muted-foreground">Loading…</div>;
  if (error)
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error.message}
      </div>
    );
  if (data === undefined || data === null) return <>{empty ?? null}</>;
  return <>{children(data)}</>;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      {body && <div className="mt-1 text-xs text-muted-foreground">{body}</div>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}