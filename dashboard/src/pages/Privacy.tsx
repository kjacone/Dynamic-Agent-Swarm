import { useEffect, useMemo, useState } from "react";
import { Download, Lock, ShieldCheck, ShieldOff } from "lucide-react";
import {
  api, can, type EraseResult, type LegalHold, type Me, type PrivacyRequestItem,
  type RetentionPolicy, type RetentionSettings,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TabId } from "@/components/layout/nav";
import { PageHeader } from "@/components/common/PageHeader";
import { ScopeBar } from "@/components/common/ScopeBar";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { FilterTabs } from "@/components/common/FilterTabs";
import { JsonView } from "@/components/common/JsonView";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";

const KEYS = ["threads_days", "citations_days", "feedback_days", "handoff_days", "langfuse_days"] as const;
const FIELDS: Array<{ key: (typeof KEYS)[number]; label: string; hint: string }> = [
  { key: "threads_days", label: "Conversations", hint: "Transcript, checkpoints and derived rows. Existing active handoffs are skipped." },
  { key: "citations_days", label: "Citations", hint: "Default 7 days unless overridden here; leave blank to disable." },
  { key: "feedback_days", label: "Feedback", hint: "Comments and message excerpts." },
  { key: "handoff_days", label: "Resolved handoffs", hint: "Staff transcripts older than this." },
  { key: "langfuse_days", label: "Langfuse traces", hint: "Only traces tagged for this tenant." },
];

export function Privacy({ me, tenant, onOpenTab }: {
  me: Me | null;
  tenant: string;
  onOpenTab?: (tab: TabId) => void;
}) {
  const writable = can(me, "privacy:write");
  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Privacy"
        description="Retention windows, legal holds and data-subject access/erasure across the runtime, registry, vector stores and Langfuse." />
      <ScopeBar
        tenant={tenant}
        onOpenTab={onOpenTab}
        title="Covers every conversation these agents run"
        note="Retention windows, holds and erasure reach the threads, checkpoints and traces produced by these agents, whether a person called the agent directly or a workflow step did."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <RetentionCard writable={writable} />
        <HoldsCard writable={writable} />
        <ErasureCard writable={writable} />
        <RequestsCard writable={writable} />
      </div>
    </div>
  );
}

function RetentionCard({ writable }: { writable: boolean }) {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const toast = useToast();

  async function load() {
    try {
      const p = await api.getRetention();
      setPolicy(p);
      setDraft(Object.fromEntries(KEYS.map((k) => [k, p.settings[k] == null ? "" : String(p.settings[k])])));
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    const settings: Partial<RetentionSettings> = {};
    for (const k of KEYS) {
      const raw = (draft[k] ?? "").trim();
      if (!raw) { settings[k] = null; continue; }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) { toast.push(`${k}: enter a whole number of days, or leave blank`, "error"); return; }
      settings[k] = n;
    }
    try {
      const p = await api.putRetention(settings);
      setPolicy(p);
      toast.push("Retention saved", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Lock className="h-4 w-4 text-primary" /> Retention</CardTitle></CardHeader>
      <CardContent className="space-y-2.5">
        {!policy ? <LoadingBlock rows={4} /> : (
          <>
            {FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-[1fr_104px] items-start gap-3 rounded-lg p-1.5 hover:bg-muted/40">
                <div>
                  <div className="text-sm font-medium">{f.label} <span className="font-normal text-muted-foreground">(days)</span></div>
                  <div className="text-xs leading-relaxed text-muted-foreground">{f.hint}</div>
                </div>
                <Input inputMode="numeric" placeholder="keep" value={draft[f.key] ?? ""}
                  disabled={!writable}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <div className="text-xs leading-relaxed text-muted-foreground">
                A blank field keeps data forever (citations fall back to the default window).
                {policy.updated_at && <> Last saved {fmtDate(policy.updated_at)}{policy.updated_by ? ` by ${policy.updated_by}` : ""}.</>}
              </div>
              {writable && <AsyncButton size="sm" onRun={save}>Save</AsyncButton>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HoldsCard({ writable }: { writable: boolean }) {
  const [holds, setHolds] = useState<LegalHold[] | null>(null);
  const [scope, setScope] = useState<LegalHold["scope"]>("tenant");
  const [scopeId, setScopeId] = useState("");
  const [reason, setReason] = useState("");
  const [releasing, setReleasing] = useState<LegalHold | null>(null);
  const toast = useToast();

  async function load() {
    try { setHolds((await api.listHolds()).holds); }
    catch (e: any) { toast.push(e.message, "error"); setHolds([]); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    try {
      await api.createHold(scope, scope === "tenant" ? "" : scopeId.trim(), reason.trim());
      setReason(""); setScopeId("");
      toast.push("Legal hold created", "success");
      load();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldOff className="h-4 w-4 text-primary" /> Legal holds</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          A hold blocks erasure and retention deletion for the whole tenant, a customer, a user or a single thread.
          Release it before handling an erasure request.
        </p>
        {writable && (
          <div className="space-y-2 rounded-xl border bg-muted/25 p-3">
            <FilterTabs value={scope} onChange={(v) => { setScope(v); setScopeId(""); }}
              options={[{ id: "tenant", label: "Tenant" }, { id: "customer", label: "Customer" }, { id: "user", label: "User" }, { id: "thread", label: "Thread" }]} />
            <Input placeholder={scope === "tenant" ? "Applies to the whole tenant" : `${scope} id`}
              value={scopeId} disabled={scope === "tenant"}
              onChange={(e) => setScopeId(e.target.value)} />
            <Textarea rows={2} placeholder="Reason (e.g. litigation hold 2026-114)"
              value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end">
              <AsyncButton size="sm" onRun={create} disabled={!reason.trim() || (scope !== "tenant" && !scopeId.trim())}>
                Place hold
              </AsyncButton>
            </div>
          </div>
        )}
        {holds === null ? <LoadingBlock rows={2} />
          : holds.length === 0 ? <EmptyState title="No active holds" body="Erasure and retention deletion are unblocked." />
          : <div className="space-y-2">{holds.map((h) => (
            <div key={h.id} className="flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors hover:border-border">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <StatusBadge value={h.scope} tone="amber" />
                  {h.scope !== "tenant" && <span className="truncate font-mono text-xs">{h.scope_id}</span>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{h.reason} · {fmtDate(h.created_at)} · {h.created_by}</div>
              </div>
              {writable && <Button size="sm" variant="outline" onClick={() => setReleasing(h)}>Release</Button>}
            </div>
          ))}</div>}
      </CardContent>
      {releasing && (
        <ConfirmDialog
          title="Release this legal hold?"
          description={`Retention deletion and erasure will be able to remove data for ${releasing.scope === "tenant" ? "the whole tenant" : `${releasing.scope} ${releasing.scope_id}`} again.`}
          confirmLabel="Release hold"
          onClose={() => setReleasing(null)}
          onConfirm={async () => {
            await api.releaseHold(releasing.id);
            toast.push("Legal hold released", "success");
            load();
          }}
        />
      )}
    </Card>
  );
}

function ErasureCard({ writable }: { writable: boolean }) {
  const [kind, setKind] = useState<"customer" | "user" | "threads">("customer");
  const [customerId, setCustomerId] = useState("");
  const [userId, setUserId] = useState("");
  const [threads, setThreads] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<EraseResult | null>(null);
  const toast = useToast();

  async function run() {
    const body: { customer_id?: string; user_id?: string; thread_ids?: string[]; reason?: string } = { reason };
    if (kind === "customer") body.customer_id = customerId.trim();
    if (kind === "user") body.user_id = userId.trim();
    if (kind === "threads") body.thread_ids = threads.split(/[\s,]+/).filter(Boolean);
    if (!body.customer_id && !body.user_id && !(body.thread_ids?.length)) {
      toast.push("Identify the data subject first", "error"); return;
    }
    try {
      const r = await api.eraseSubject(body);
      setResult(r);
      setConfirm(false);
      toast.push(r.status === "completed" ? "Erasure completed" : "Erasure partially completed", r.status === "completed" ? "success" : "error");
    } catch (e: any) {
      const detail = e?.body?.detail;
      if (detail && typeof detail === "object") setResult(detail as EraseResult);
      toast.push(e.message, "error");
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Data-subject erasure</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Deletes LangGraph threads, registry rows, subject-tagged vector documents and Langfuse traces.
          Blocked while any active legal hold intersects the subject. Every run is recorded and audited.
        </p>
        <FilterTabs value={kind} onChange={(k) => setKind(k)}
          options={[{ id: "customer", label: "Customer" }, { id: "user", label: "User" }, { id: "threads", label: "Threads" }]} />
        {kind === "customer" && <Input placeholder="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />}
        {kind === "user" && <Input placeholder="user_id" value={userId} onChange={(e) => setUserId(e.target.value)} />}
        {kind === "threads" && <Textarea rows={2} placeholder="thread ids, one per line" value={threads} onChange={(e) => setThreads(e.target.value)} />}
        <Input placeholder="Reason / ticket reference" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className={cn(
          "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-xs leading-relaxed transition-colors",
          confirm ? "border-red-500/40 bg-red-500/5" : "text-muted-foreground",
        )}>
          <Checkbox className="mt-0.5" checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} />
          I understand this is destructive and cannot be undone.
        </label>
        {writable && (
          <div className="flex justify-end">
            <AsyncButton variant="destructive" onRun={run} disabled={!confirm}>Erase subject data</AsyncButton>
          </div>
        )}
        {result && <JsonView data={result} />}
      </CardContent>
    </Card>
  );
}

function RequestsCard({ writable }: { writable: boolean }) {
  const [rows, setRows] = useState<PrivacyRequestItem[] | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [userId, setUserId] = useState("");
  const [transcript, setTranscript] = useState(false);
  const toast = useToast();

  async function load() {
    try { setRows((await api.listPrivacyRequests()).requests); }
    catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { load(); }, []);

  const subject = useMemo(() => customerId.trim() || userId.trim(), [customerId, userId]);

  async function exportSubject() {
    if (!subject) { toast.push("Enter a customer or user id", "error"); return; }
    try {
      const data = await api.exportSubject(customerId.trim(), userId.trim(), transcript);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `subject-${subject}.json`; a.click();
      URL.revokeObjectURL(url);
      toast.push("Subject access export downloaded", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Subject access & history</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
          <Input placeholder="user_id" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-xs text-muted-foreground">
          <Checkbox className="mt-0.5" checked={transcript} onCheckedChange={(v) => setTranscript(v === true)} />
          Include LangGraph transcripts (requires the runtime to be reachable)
        </label>
        <AsyncButton variant="outline" onRun={exportSubject} disabled={!subject}>
          <Download className="h-4 w-4" /> Export JSON
        </AsyncButton>

        <div className="pt-2">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent erasure requests</div>
          {rows === null ? <LoadingBlock rows={2} />
            : rows.length === 0 ? <EmptyState title="No erasure requests" body={writable ? "Runs started here appear with their per-store outcome." : undefined} />
            : <div className="max-h-72 space-y-2 overflow-auto">{rows.map((r) => (
              <div key={r.id} className="rounded-xl border p-3 text-xs transition-colors hover:border-border">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium"><StatusBadge value={r.status} /> {r.subject_type} <span className="truncate font-mono">{r.subject_id}</span></span>
                  <span className="shrink-0 text-muted-foreground">{fmtDate(r.created_at)}</span>
                </div>
                {r.reason && <div className="mt-1 text-muted-foreground">{r.reason}</div>}
                <div className="mt-1 text-muted-foreground">
                  {(r.thread_ids || []).length} thread(s) · requested by {r.requested_by} · <span className="font-mono">{r.id.slice(0, 8)}</span>
                </div>
              </div>
            ))}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
