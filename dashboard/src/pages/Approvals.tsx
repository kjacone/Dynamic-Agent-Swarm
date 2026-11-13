import { useEffect, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, Clock, FlaskConical, GitBranch, Inbox, ShieldCheck, TimerOff, X, XCircle,
} from "lucide-react";
import { api, can, EvalDataset, type ApprovalItem, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { Chip, StatusBadge, dueLabel } from "@/components/common/StatusBadge";
import { FilterTabs } from "@/components/common/FilterTabs";
import { StatCard } from "@/components/common/StatCard";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";

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
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [acting, setActing] = useState<{ a: ApprovalItem; decision: "approve" | "reject" } | null>(null);
  const toast = useToast();

  async function load() {
    try { setItems(await api.listApprovals(status)); } catch (e: any) { toast.push(e.message, "error"); setItems([]); }
  }
  async function loadCounts() {
    try {
      const lists = await Promise.all(FILTERS.map((f) => api.listApprovals(f)));
      setCounts(Object.fromEntries(FILTERS.map((f, i) => [f, lists[i].length])));
    } catch { /* counts are decorative; the list itself surfaces errors */ }
  }
  useEffect(() => { setItems(null); load(); }, [status]);
  useEffect(() => { const id = setInterval(load, 10000); return () => clearInterval(id); }, [status]);
  useEffect(() => { loadCounts(); const id = setInterval(loadCounts, 15000); return () => clearInterval(id); }, []);

  const pendingItems = status === "pending" ? items ?? [] : [];
  const overdue = pendingItems.filter((a) => dueLabel(a.due_at, true).overdue).length;
  const escalated = pendingItems.filter((a) => a.escalated).length;

  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Approvals" description="Human decisions requested by workflows and policy. Every decision is written to the audit trail."
        actions={can(me, "workflows:write") ? (
          <AsyncButton variant="outline" onRun={async () => {
            const r = await api.sweepApprovals();
            toast.push(`SLA sweep: ${r.escalated} escalated, ${r.expired} expired`, "success"); load(); loadCounts(); onChanged?.();
          }}><TimerOff className="h-4 w-4" /> Run SLA sweep</AsyncButton>) : undefined} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Clock} tone="amber" label="Awaiting decision" value={counts.pending ?? "—"} hint={status === "pending" && overdue ? `${overdue} past SLA` : "Maker-checker queue"} />
        <StatCard icon={CheckCircle2} tone="emerald" label="Approved" value={counts.approved ?? "—"} />
        <StatCard icon={XCircle} tone="red" label="Rejected" value={counts.rejected ?? "—"} />
        <StatCard icon={TimerOff} tone="slate" label="Expired" value={counts.expired ?? "—"} hint={escalated ? `${escalated} escalated` : undefined} />
      </div>

      {me?.auth === "admin_token" && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>You are signed in with the shared admin token. You can view approvals but not decide them — segregation of duties requires a named approver account (SSO or tenant JWT).</span>
        </div>
      )}

      <FilterTabs
        className="mb-4"
        value={status}
        onChange={setStatus}
        options={FILTERS.map((f) => ({ id: f, label: f, count: counts[f] }))}
      />

      {items === null ? <LoadingBlock rows={3} />
        : items.length === 0 ? (
          <EmptyState
            icon={status === "pending" ? CheckCircle2 : Inbox}
            title={`No ${status} approvals`}
            body={status === "pending" ? "You're all caught up — new requests will appear here automatically." : "Nothing has been decided in this state yet."}
          />
        )
        : <div className="space-y-3">{items.map((a) => <ApprovalCard key={a.id} a={a} me={me} onAct={(decision) => setActing({ a, decision })} />)}</div>}

      {acting && <DecideDialog {...acting} onClose={(changed) => { setActing(null); if (changed) { load(); loadCounts(); onChanged?.(); } }} />}
    </div>
  );
}

function ApprovalCard({ a, me, onAct }: { a: ApprovalItem; me: Me | null; onAct: (d: "approve" | "reject") => void }) {
  const why = blocker(a, me);
  const due = dueLabel(a.due_at, a.status === "pending");
  const approvals = a.decisions.filter((d) => d.decision === "approve").length;
  const [asEval, setAsEval] = useState(false);
  const decided = a.status === "approved" || a.status === "rejected";
    const [asRule, setAsRule] = useState(false);
  const accent = a.status === "approved" ? "border-l-emerald-500"
    : a.status === "rejected" ? "border-l-red-500"
      : a.escalated || due.overdue ? "border-l-amber-500"
        : "border-l-sky-500";

  return (
    <Card className={cn("overflow-hidden border-l-4 transition-shadow hover:shadow-md", accent)}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">{a.title || a.step_id}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
              <span>Requested by <b>{a.requester || "system"}</b> · {fmtDate(a.created_at)}</span>
              {due.text && (
                <span className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px]",
                  due.overdue ? "border-red-500/30 bg-red-500/10 font-medium text-red-600 dark:text-red-400" : "bg-muted/70",
                )}>{due.text}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" disabled={!!why} onClick={() => onAct("approve")}><Check className="h-3.5 w-3.5" /> Approve</Button>
            <Button size="sm" variant="outline" className="text-red-600 hover:text-red-600 dark:text-red-400" disabled={!!why} onClick={() => onAct("reject")}>
              <X className="h-3.5 w-3.5" /> Reject
            </Button>
            {why && <span className="text-xs text-muted-foreground">{why}</span>}
          </div>
        )}

        {decided && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <Button size="sm" variant="outline" onClick={() => setAsEval(true)}>
              <FlaskConical className="h-3.5 w-3.5" /> Add to eval set
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAsRule(true)}>
              <GitBranch className="h-3.5 w-3.5" /> Turn into rule
            </Button>
            <span className="text-xs text-muted-foreground">
              Capture this decision as a reusable test case, or a workflow rule.
            </span>
          </div>
        )}
      </CardContent>
      {asEval && <AddEvalDialog approval={a} onClose={() => setAsEval(false)} />}
      {asRule && <TurnIntoRuleDialog approval={a} onClose={() => setAsRule(false)} />}
    </Card>
  );
}

function AddEvalDialog({ approval: a, onClose }: { approval: ApprovalItem; onClose: () => void }) {
  const [datasets, setDatasets] = useState<EvalDataset[] | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [input, setInput] = useState("");
  const [criteria, setCriteria] = useState("");
  const [expect, setExpect] = useState("");
  const toast = useToast();

  useEffect(() => {
    api.listEvalDatasets().then(setDatasets).catch((e: any) => toast.push(e.message, "error"));
    // Reasonable defaults derived from the approval's case data.
    const ctx = a.context || {};
    const inputDefault = Object.keys(ctx).length ? JSON.stringify(ctx, null, 2) : "";
    setInput(inputDefault);
    setCriteria(
      `A human ${a.status === "approved" ? "approved" : "rejected"} this case. The agent must produce an answer consistent with that decision.`
    );
  }, []);

  async function save() {
    try {
      if (!datasetId) { toast.push("Choose a dataset", "error"); return; }
      const delegations = expect.trim()
        ? expect.split(",").map((s) => s.trim()).filter(Boolean)
        : null;
      const r = await api.approvalToEvalCase(a.id, {
        dataset_id: datasetId,
        input: input.trim() || null,
        criteria: criteria.trim() || null,
        expect_delegations: delegations,
      });
      toast.push(`Added case to dataset (${r.decision})`, "success");
      onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add “{a.title || a.step_id}” to an eval set</DialogTitle>
          <DialogDescription>Turn this human decision into a regression case the LLM judge can score future runs against.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Dataset</Label>
            <select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="">Select dataset…</option>
              {(datasets ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.cases} cases)</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Input</Label>
            <Textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)} />
          </div>
          <div>
            <Label>Criteria</Label>
            <Textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
          </div>
          <div>
            <Label>Expected delegations (optional)</Label>
            <Input value={expect} onChange={(e) => setExpect(e.target.value)} placeholder="document-analyst, risk-analyst" />
          </div>
          <p className="text-xs text-muted-foreground">
            The reviewer's decision ({a.status}) and comment are captured in the criteria so the LLM judge knows what "correct" means.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!datasetId}>Add case</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <DialogHeader>
          <DialogTitle>{decision === "approve" ? "Approve" : "Reject"}: {a.title || a.step_id}</DialogTitle>
          <DialogDescription>
            {a.summary || `${a.requester || "system"} requested a decision on step “${a.step_id}”.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{needReason ? "Reason (required)" : "Comment (optional)"}</Label>
          <Textarea rows={3} autoFocus value={comment} onChange={(e) => setComment(e.target.value)}
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


function TurnIntoRuleDialog({ approval: a, onClose }: { approval: ApprovalItem; onClose: () => void }) {
  const [workflowKey, setWorkflowKey] = useState<string | null>(null);
  const [steps, setSteps] = useState<Array<{ id: string; type: string; name?: string }>>([]);
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const [action, setAction] = useState<"route_to" | "block">("route_to");
  const [target, setTarget] = useState("");
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const run = await api.getRun(a.run_id);
        setWorkflowKey(run.workflow);
        const spec = await api.getWorkflow(run.workflow, run.version);
        setSteps(spec.steps.map((s) => ({ id: s.id, type: s.type, name: s.name })));
        setName(`${a.status === "approved" ? "Approve" : "Escalate"} when ...`);
      } catch (e: any) { toast.push(e.message, "error"); }
    })();
  }, [a.run_id]);

  const TEMPLATES: Array<[string, string]> = [
    ["High score", "risk.score > 70"],
    ["Low confidence", "risk.confidence < 0.7"],
    ["High-risk country", 'country in ["IR", "KP"]'],
    ["Sanctions hit", "sanctions.hit == true"],
  ];

  async function save() {
    try {
      if (!workflowKey) return;
      await api.createWorkflowRule(workflowKey, {
        name: name || when,
        when_expr: when,
        action,
        target_step: action === "route_to" ? target : null,
        created_from_approval_id: a.id,
      });
      toast.push("Rule created", "success");
      onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Turn “{a.title || a.step_id}” into a workflow rule
          </DialogTitle>
          <DialogDescription>Future runs will be routed or blocked automatically when the expression matches.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!workflowKey && <div className="text-sm text-muted-foreground">Loading workflow…</div>}
          {workflowKey && (
            <>
              <div className="rounded-md bg-muted/40 p-2 text-xs">
                <b>Case data:</b>
                <JsonView data={a.context} className="mt-1" />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>When</Label>
                <Textarea rows={2} value={when} onChange={(e) => setWhen(e.target.value)}
                  placeholder='risk.score > 70 and risk.confidence < 0.7' />
                <div className="mt-2 flex flex-wrap gap-1">
                  {TEMPLATES.map(([label, expr]) => (
                    <button key={label} onClick={() => setWhen(expr)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Action</Label>
                <select value={action} onChange={(e) => setAction(e.target.value as any)}
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
                  <option value="route_to">route_to — skip to a step</option>
                  <option value="block">block — fail the run</option>
                </select>
              </div>
              {action === "route_to" && (
                <div>
                  <Label>Target step</Label>
                  <select value={target} onChange={(e) => setTarget(e.target.value)}
                    className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
                    <option value="">Select step…</option>
                    {steps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id} ({s.type}{s.name ? ` · ${s.name}` : ""})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                The rule is attributed to approval <code>{a.id.slice(0, 8)}</code> in the audit trail.
                It will fire on future runs of <code>{workflowKey}</code> whenever its expression matches.
              </p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save}
            disabled={!when || (action === "route_to" && !target) || !workflowKey}>
            Create rule
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}