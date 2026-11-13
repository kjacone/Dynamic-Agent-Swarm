import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FlaskConical, Play, Plus, Trash2, XCircle } from "lucide-react";
import { api, type Agent, type EvalCase, type EvalDataset, type EvalRun } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { FilterTabs } from "@/components/common/FilterTabs";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate, truncate } from "@/lib/utils";

export function Evaluations({ tenant }: { tenant: string }) {
  const [datasets, setDatasets] = useState<EvalDataset[] | null>(null);
  const [active, setActive] = useState<EvalDataset | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EvalDataset | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const ds = await api.listEvalDatasets(tenant);
      setDatasets(ds);
      if (active) setActive(ds.find((d) => d.id === active.id) || null);
    } catch (e: any) { toast.push(e.message, "error"); setDatasets([]); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  const totalCases = useMemo(() => (datasets ?? []).reduce((n, d) => n + d.cases, 0), [datasets]);

  return (
    <div>
      <PageHeader icon={FlaskConical} title="Evaluations"
        description="Datasets, cases, and runs against draft or published configs."
        actions={<Button onClick={() => setCreating(true)}>New dataset</Button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard icon={FlaskConical} label="Datasets" value={datasets?.length ?? "—"} tone="violet" />
        <StatCard icon={CheckCircle2} label="Cases" value={datasets ? totalCases : "—"} tone="emerald" hint="Across all datasets" />
        <StatCard icon={Play} label="Selected" value={active?.name ?? "None"} tone="sky" hint={active ? `${active.cases} case(s)` : "Pick a dataset to run"} />
      </div>

      <div className="grid gap-4 md:grid-cols-[280px,minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Datasets</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-2">
            {datasets === null && <LoadingBlock rows={3} />}
            {datasets?.length === 0 && <div className="p-2 text-xs text-muted-foreground">No datasets yet.</div>}
            {datasets?.map((d) => (
              <button key={d.id} onClick={() => setActive(d)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  active?.id === d.id ? "border-primary/40 bg-primary/5 font-medium shadow-sm" : "border-transparent hover:bg-muted/60",
                )}>
                <div className="truncate">{d.name}</div>
                <div className="text-xs text-muted-foreground">{d.cases} case(s)</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div>
          {!active ? (
            <EmptyState icon={FlaskConical} title="Select a dataset"
              body="Choose a dataset on the left to add cases and run evaluations." />
          ) : (
            <DatasetView key={active.id} dataset={active} onDelete={() => setDeleting(active)} />
          )}
        </div>
      </div>

      {creating && <CreateDataset tenant={tenant} onClose={() => { setCreating(false); refresh(); }} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description="The dataset and every case and run inside it will be removed. Past results cannot be recovered."
          confirmLabel="Delete dataset" destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteEvalDataset(deleting.id);
            toast.push("Dataset deleted", "success");
            setActive(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateDataset({ tenant, onClose }: { tenant: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const toast = useToast();

  useEffect(() => { api.listAgents(tenant).then(setAgents); }, [tenant]);

  async function save() {
    try {
      await api.createEvalDataset({ name, agent_id: agentId, tenant_id: tenant });
      toast.push("Dataset created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New eval dataset</DialogTitle>
          <DialogDescription>Group test cases that exercise a single agent.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. refunds-golden-set" /></div>
          <div className="space-y-1.5">
            <Label>Agent</Label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
              <option value="">Select agent…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !agentId}>Create dataset</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DatasetView({ dataset, onDelete }: { dataset: EvalDataset; onDelete: () => void }) {
  const [cases, setCases] = useState<EvalCase[] | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<"draft" | "published">("published");
  const [viewing, setViewing] = useState<EvalRun | null>(null);
  const [deletingCase, setDeletingCase] = useState<EvalCase | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const [c, r] = await Promise.all([api.listEvalCases(dataset.id), api.listEvalRuns(dataset.id)]);
      setCases(c); setRuns(r);
    } catch (e: any) { toast.push(e.message, "error"); setCases([]); }
  }
  useEffect(() => { refresh(); }, [dataset.id]);

  // Poll any running eval.
  useEffect(() => {
    if (!runs.some((r) => r.status === "running")) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [runs]);

  async function startRun() {
    try {
      await api.runEval(dataset.id, target);
      toast.push("Evaluation started", "success");
      refresh();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">{dataset.name}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {cases?.length ?? dataset.cases} case(s) · runs are graded per case and, for supervisors, on delegation choice.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FilterTabs value={target} onChange={setTarget}
              options={[{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }]} />
            <Button size="sm" onClick={startRun} disabled={!cases?.length}><Play className="h-3.5 w-3.5" /> Run</Button>
            <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" title="Delete dataset" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Cases</div>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add case</Button>
          </div>
          {cases === null ? <LoadingBlock rows={3} />
            : cases.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No cases yet. Add one to start evaluating.</div>
            : <div className="space-y-2">{cases.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-3 rounded-xl border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{truncate(c.input, 100)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {c.expected_contains && <>expects contains: <code className="rounded bg-muted px-1">{truncate(c.expected_contains, 40)}</code> </>}
                    {c.criteria && <> · criteria: {truncate(c.criteria, 60)}</>}
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setDeletingCase(c)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Runs</CardTitle>
          <span className="text-xs text-muted-foreground">{runs.length} recorded</span>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-muted-foreground">No runs yet — hit Run to evaluate this dataset.</div>
          ) : (
            <Table>
              <THead><TR><TH>Started</TH><TH>Target</TH><TH>Version</TH><TH>Status</TH><TH className="text-right">Pass rate</TH><TH className="text-right">Orch</TH><TH className="text-right">Avg</TH><TH></TH></TR></THead>
              <TBody>
                {runs.map((r) => {
                  const s = r.summary ?? {};
                  const orch = s.orchestration_rate;
                  return (
                    <TR key={r.id} className="group">
                      <TD className="whitespace-nowrap text-xs">{fmtDate(r.created_at)}</TD>
                      <TD><span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">{r.target}</span></TD>
                      <TD className="tabular-nums">{r.agent_version ?? "—"}</TD>
                      <TD><StatusBadge value={r.status === "done" ? "completed" : r.status} /></TD>
                      <TD className="text-right tabular-nums">{s.pass_rate ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{orch == null ? "—" : `${s.orchestration_passed}/${s.orchestration_checked}`}</TD>
                      <TD className="text-right tabular-nums">{s.avg ?? "—"}</TD>
                      <TD><div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setViewing(r)}>View</Button></div></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {adding && <AddCase datasetId={dataset.id} onClose={() => { setAdding(false); refresh(); }} />}
      {viewing && <RunView run={viewing} onClose={() => setViewing(null)} />}
      {deletingCase && (
        <ConfirmDialog
          title="Delete this case?"
          description="The case will no longer be included in future runs. Past run results are kept."
          confirmLabel="Delete case" destructive
          onClose={() => setDeletingCase(null)}
          onConfirm={async () => { await api.deleteEvalCase(deletingCase.id); refresh(); }}
        />
      )}
    </div>
  );
}

function AddCase({ datasetId, onClose }: { datasetId: string; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState("");
  const [criteria, setCriteria] = useState("");
  const [expectDelegations, setExpectDelegations] = useState("");
  const toast = useToast();

  async function save() {
    try {
      const delegations = expectDelegations.trim()
        ? expectDelegations.split(",").map((s) => s.trim()).filter(Boolean)
        : null;
      await api.addEvalCase(datasetId, {
        input,
        expected_contains: expected || null,
        criteria: criteria || null,
        expect_delegations: delegations,
      });
      toast.push("Case added", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add case</DialogTitle>
          <DialogDescription>Deterministic checks (expected text) run first; the judge criteria is used by the LLM grader.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Input</Label><Textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder="What the customer says" /></div>
          <div className="space-y-1.5"><Label>Expected contains (optional)</Label>
            <Input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="A phrase the reply must contain" /></div>
          <div className="space-y-1.5"><Label>Judge criteria (optional)</Label>
            <Textarea rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="The answer is correct and cites a source." /></div>
          <div className="space-y-1.5">
            <Label>Expected delegations (optional, comma-separated)</Label>
            <Input value={expectDelegations} onChange={(e) => setExpectDelegations(e.target.value)}
              placeholder="document-analyst, risk-analyst, case-writer" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              When set, the runner checks that each of these subagents was invoked for this case.
              Leave empty for non-supervisor datasets.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!input}>Add case</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunView({ run, onClose }: { run: EvalRun; onClose: () => void }) {
  const [detail, setDetail] = useState<EvalRun>(run);

  useEffect(() => {
    if (run.status !== "running") return;
    const id = setInterval(async () => {
      try {
        const rows = await api.listEvalRuns(run.dataset_id);
        const found = rows.find((r) => r.id === run.id);
        if (found) setDetail(found);
      } catch { /* ignore */ }
    }, 2500);
    return () => clearInterval(id);
  }, [run]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Run <span className="font-mono text-xs">{detail.id.slice(0, 8)}</span> <StatusBadge value={detail.status === "done" ? "completed" : detail.status} /></DialogTitle>
          <DialogDescription>Per-case results and the orchestration check for supervisor agents.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Box label="Cases" value={String(detail.summary?.cases ?? "—")} />
          <Box label="Pass rate" value={String(detail.summary?.pass_rate ?? "—")} tone="emerald" />
          <Box label="Orch" value={detail.summary?.orchestration_rate == null ? "—" : `${detail.summary.orchestration_passed}/${detail.summary.orchestration_checked}`} />
          <Box label="Avg" value={String(detail.summary?.avg ?? "—")} />
          <Box label="Target" value={detail.target} />
        </div>
        {detail.summary?.langfuse && <div className="text-xs text-muted-foreground">Langfuse: {detail.summary.langfuse}</div>}
        <div className="max-h-96 space-y-2 overflow-auto pr-1">
          {detail.results?.map((r: any, i: number) => (
            <div key={i} className="rounded-xl border p-3 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Case {i + 1}</span>
                {r.score != null && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">score {r.score.toFixed(2)}</span>}
              </div>
              <div className="font-medium">{r.input}</div>
              {r.reply && <div className="mt-1 whitespace-pre-wrap leading-relaxed text-muted-foreground">{r.reply}</div>}
              {r.error && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{r.error}</div>}
              {r.delegations_expected && (
                <div className="mt-2 rounded-lg bg-muted/40 p-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    {r.orchestration_passed
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                    <span className={r.orchestration_passed ? "font-medium text-emerald-600 dark:text-emerald-400" : "font-medium text-red-600 dark:text-red-400"}>
                      orchestration {r.orchestration_passed ? "passed" : "failed"}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    expected [{r.delegations_expected.join(", ") || "none"}], actual [{r.delegations_actual?.join(", ") || "none"}]
                    {r.orchestration_missing?.length > 0 && <> · missing: {r.orchestration_missing.join(", ")}</>}
                  </div>
                </div>
              )}
              {r.judge_reason && <div className="mt-1.5 text-xs text-muted-foreground">{r.judge_reason}</div>}
            </div>
          ))}
        </div>

        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Box({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className={cn("rounded-xl border p-2.5", tone === "emerald" && "border-emerald-500/30 bg-emerald-500/5")}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
