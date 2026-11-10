import { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { api, can, type ApprovalItem, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { Chip, StatusBadge, dueLabel } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/utils";

const FILTERS = ["pending", "approved", "rejected", "expired"] as const;

/** Why the current user cannot decide this request (mirrors server rules; the server is the authority). */
function blocker(a: ApprovalItem, me: Me | null): string | null {
  if (!me || !can(me, "approvals:decide")) return "Your role cannot decide approvals.";
  if (me.auth === "admin_token") return "Shared admin credentials cannot approve. Sign in with a named account.";
  if (a.status !== "pending") return null;
  if (me.sub === a.requester) return "Maker-checker: you requested this, so someone else must decide.";
  if (!a.allowed_roles.some((r) => me.roles.includes(r))) return `Requires role: ${a.allowed_roles.join(" or ")}.`;
  if (a.decisions.some((d) => d.by === me.sub)) return "You have already decided on this request.";
  return null;
}

export function Approvals({ me, onChanged }: { me: Me | null; onChanged?: () => void }) {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("pending");
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [acting, setActing] = useState<{ a: ApprovalItem; decision: "approve" | "reject" } | null>(null);
  const toast = useToast();

  async function load() {
    try { setItems(await api.listApprovals(status)); } catch (e: any) { toast.push(e.message, "error"); setItems([]); }
  }
  useEffect(() => { setItems(null); load(); }, [status]);
  useEffect(() => { const id = setInterval(load, 10000); return () => clearInterval(id); }, [status]);

  return (
    <div>
      <PageHeader title="Approvals" description="Human decisions requested by workflows and policy. Every decision is written to the audit trail."
        actions={can(me, "workflows:write") ? (
          <AsyncButton variant="outline" onRun={async () => {
            const r = await api.sweepApprovals();
            toast.push(`SLA sweep: ${r.escalated} escalated, ${r.expired} expired`, "success"); load(); onChanged?.();
          }}>Run SLA sweep</AsyncButton>) : undefined} />

      {me?.auth === "admin_token" && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
          <span>You are signed in with the shared admin token. You can view approvals but not decide them — segregation of duties requires a named approver account (SSO or tenant JWT).</span>
        </div>
      )}

      <div className="mb-4 flex gap-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setStatus(f)}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${status === f ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>{f}</button>
        ))}
      </div>

      {items === null ? <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div>
        : items.length === 0 ? <EmptyState title={`No ${status} approvals`} body={status === "pending" ? "You're all caught up." : undefined} />
        : <div className="space-y-3">{items.map((a) => <ApprovalCard key={a.id} a={a} me={me} onAct={(decision) => setActing({ a, decision })} />)}</div>}

      {acting && <DecideDialog {...acting} onClose={(changed) => { setActing(null); if (changed) { load(); onChanged?.(); } }} />}
    </div>
  );
}

function ApprovalCard({ a, me, onAct }: { a: ApprovalItem; me: Me | null; onAct: (d: "approve" | "reject") => void }) {
  const why = blocker(a, me);
  const due = dueLabel(a.due_at, a.status === "pending");
  const approvals = a.decisions.filter((d) => d.decision === "approve").length;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{a.title || a.step_id}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Requested by <b>{a.requester || "system"}</b> · {fmtDate(a.created_at)}
              {due.text && <> · <span className={due.overdue ? "font-medium text-red-600" : ""}>{due.text}</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {a.escalated && <StatusBadge value="escalated" />}
            <StatusBadge value={a.status} />
          </div>
        </div>

        {a.summary && <p className="text-sm">{a.summary}</p>}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Needs</span>
          <span className="font-medium">{approvals} of {a.required_approvals} approval{a.required_approvals > 1 ? "s" : ""}</span>
          <span className="flex gap-1">{Array.from({ length: a.required_approvals }, (_, i) => (
            <span key={i} className={`h-2 w-6 rounded-full ${i < approvals ? "bg-emerald-500" : "bg-muted"}`} />))}</span>
          <span className="text-muted-foreground">· roles:</span>{a.allowed_roles.map((r) => <Chip key={r}>{r}</Chip>)}
        </div>

        {a.decisions.length > 0 && (
          <ul className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
            {a.decisions.map((d, i) => (
              <li key={i}><StatusBadge value={d.decision === "approve" ? "approved" : "rejected"} /> <b>{d.by}</b> · {fmtDate(d.ts)}
                {d.comment && <span className="text-muted-foreground"> — “{d.comment}”</span>}</li>))}
          </ul>
        )}

        {Object.keys(a.context || {}).length > 0 && (
          <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Case data the agent produced</summary>
            <JsonView data={a.context} className="mt-2" /></details>
        )}

        {a.status === "pending" && (
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" disabled={!!why} onClick={() => onAct("approve")}><Check className="h-4 w-4" /> Approve</Button>
            <Button size="sm" variant="outline" disabled={!!why} onClick={() => onAct("reject")}><X className="h-4 w-4" /> Reject</Button>
            {why && <span className="text-xs text-muted-foreground">{why}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DecideDialog({ a, decision, onClose }: { a: ApprovalItem; decision: "approve" | "reject"; onClose: (changed: boolean) => void }) {
  const [comment, setComment] = useState("");
  const toast = useToast();
  const needReason = decision === "reject";
  async function submit() {
    try {
      const r = await api.decideApproval(a.id, decision, comment.trim());
      toast.push(r.status === "pending" ? "Recorded — waiting for further approvers" : `Request ${r.status}`, "success");
      onClose(true);
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose(false)}>
      <DialogContent>
        <DialogHeader><DialogTitle>{decision === "approve" ? "Approve" : "Reject"}: {a.title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>{needReason ? "Reason (required)" : "Comment (optional)"}</Label>
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder={needReason ? "Why is this being rejected?" : "Evidence reviewed, conditions, etc."} />
          <p className="text-xs text-muted-foreground">Your name, decision and comment become part of the tamper-evident audit trail.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <AsyncButton variant={needReason ? "destructive" : "default"} onRun={submit} disabled={needReason && !comment.trim()}>
            {decision === "approve" ? "Confirm approval" : "Confirm rejection"}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
