import { Badge } from "@/components/ui/badge";

export function StatusPill({
  ok,
  configured,
  label,
  detail,
}: {
  ok: boolean;
  configured?: boolean;
  label: string;
  detail?: string;
}) {
  const variant = ok ? "success" : !configured ? "outline" : "destructive";
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant={variant as any}>{ok ? "online" : configured ? "offline" : "not set"}</Badge>
      </div>
      <div className="text-xs text-muted-foreground">{detail || "—"}</div>
    </div>
  );
}