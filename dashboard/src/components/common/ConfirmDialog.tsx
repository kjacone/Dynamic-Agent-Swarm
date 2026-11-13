import * as React from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Friendly replacement for window.confirm()/window.prompt().
 * Mount it conditionally (`{pending && <ConfirmDialog … />}`) so state resets.
 */
export function ConfirmDialog({
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  requireReason = false,
  reasonLabel = "Reason for override",
  reasonPlaceholder = "Why are you bypassing this guardrail?",
  onConfirm,
  onClose,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason?: string) => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const Icon = destructive ? AlertTriangle : Info;
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                destructive ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-primary/10 text-primary",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">{title}</DialogTitle>
              {description && <DialogDescription className="mt-1 leading-relaxed">{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>
        {children}
        {requireReason && (
          <div className="space-y-1.5">
            <Label>{reasonLabel}</Label>
            <Textarea
              rows={3}
              autoFocus
              value={reason}
              placeholder={reasonPlaceholder}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">The reason is written to the audit trail.</p>
          </div>
        )}
        {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{err}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={go}
            disabled={busy || (requireReason && !reason.trim())}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
