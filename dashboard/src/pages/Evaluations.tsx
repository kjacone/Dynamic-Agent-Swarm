import { useEffect, useState } from "react";
import { api, type Agent, type EvalCase, type EvalDataset, type EvalRun } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { useToast } from "@/components/ui/toast";
import { fmtDate, truncate } from "@/lib/utils";

export function Evaluations({ tenant }: { tenant: string }) {
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [active, setActive] = useState<EvalDataset | null>(null);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  async function refresh() {
    try {
      const ds = await api.listEvalDatasets(tenant);
      setDatasets(ds);
      if (active) setActive(ds.find((d) => d.id === active.id) || null);
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  return (
    <div>
      <PageHeader title="Evaluations" description="Datasets, cases, and runs against draft or published configs."
        actions={<Button onClick={() => setCreating(true)}>New dataset</Button>} />

      <div className="grid gap-4 md:grid-cols-[280px,1fr]">
        <Card>
          <CardHeader><CardTitle className="text-sm">Datasets</CardTitle></CardHeader>
          <CardContent className="space-y-1 p-2">
            {datasets.length === 0 && <div className="text-xs text-muted-foreground p-2">No datasets.</div>}
            {datasets.map((d) => (
              <button
                key={d.id}
                onClick={() => setActive(d)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${active?.id === d.id ? "bg-muted font-medium" : "hover:bg-muted/60"}`}
              >
                <div>{d.name}</div>
                <div className="text-xs text-muted-foreground">{d.cases} case(s)</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div>
          {!active ? (
            <EmptyState title="Select a dataset" body="Choose a dataset on the left to add cases and run evaluations." />
          ) : (
            <DatasetView dataset={active} onDelete={async () => {
              if (!confirm(`Delete ${active.name} and all its cases/runs?`)) return;
              await api.deleteEvalDataset(active.id);
              setActive(null); refresh();
            }} />
          )}
        </div>
      </div>

      {creating && <CreateDataset tenant={tenant} onClose={() => { setCreating(false); refresh(); }} />}
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
      toast.push("Created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New eval dataset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Agent</Label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
              <option value="">Select agent…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !agentId}>Create</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DatasetView({ dataset, onDelete }: { dataset: EvalDataset; onDelete: () => void }) {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<"draft" | "published">("published");
  const [viewing, setViewing] = useState<EvalRun | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const [c, r] = await Promise.all([api.listEvalCases(dataset.id), api.listEvalRuns(dataset.id)]);
      setCases(c); setRuns(r);
    } catch (e: any) { toast.push(e.message, "error"); }
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
      toast.push("Run started", "success");
      refresh();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{dataset.name}</CardTitle>
          <div className="flex items-center gap-2">
            <select value={target} onChange={(e) => setTarget(e.target.value as any)}
              className="rounded-md border bg-background px-2 py-1 text-sm">
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
            <Button size="sm" onClick={startRun} disabled={cases.length === 0}>Run</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>Delete</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Cases ({cases.length})</div>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add case</Button>
          </div>
          {cases.length === 0 ? (
            <div className="text-sm text-muted-foreground">No cases yet.</div>
          ) : (
            <div className="divide-y rounded-md border">
              {cases.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 p-2 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{truncate(c.input, 100)}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.expected_contains && <>expects contains: <code>{truncate(c.expected_contains, 40)}</code></>}
                      {c.criteria && <> · criteria: {truncate(c.criteria, 60)}</>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive"
                    onClick={async () => { await api.deleteEvalCase(c.id); refresh(); }}>Delete</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Runs ({runs.length})</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No runs yet.</div>
          ) : (
           <Table>
  <THead>
    <TR>
      <TH>Started</TH><TH>Target</TH><TH>Version</TH><TH>Status</TH>
      <TH>Pass rate</TH><TH>Orch</TH><TH>Avg</TH><TH></TH>
    </TR>
  </THead>
  <TBody>
    {runs.map((r) => {
      const s = r.summary ?? {};
      const orch = s.orchestration_rate;
      return (
        <TR key={r.id}>
          <TD className="text-xs">{fmtDate(r.created_at)}</TD>
          <TD><Badge variant="secondary">{r.target}</Badge></TD>
          <TD className="tabular-nums">{r.agent_version ?? "—"}</TD>
          <TD>
            <Badge variant={r.status === "done" ? "default" : "destructive"}>{r.status}</Badge>
          </TD>
          <TD className="tabular-nums">{s.pass_rate ?? "—"}</TD>
          <TD className="tabular-nums">
            {orch == null ? "—" : `${s.orchestration_passed}/${s.orchestration_checked}`}
          </TD>
          <TD className="tabular-nums">{s.avg ?? "—"}</TD>
          <TD><Button size="sm" variant="ghost" onClick={() => setViewing(r)}>View</Button></TD>
        </TR>
      );
    })}
  </TBody>
</Table>
          )}
        </CardContent>
      </Card>

      {adding && (
        <AddCase datasetId={dataset.id} onClose={() => { setAdding(false); refresh(); }} />
      )}
      {viewing && <RunView run={viewing} onClose={() => setViewing(null)} />}
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
        <DialogHeader><DialogTitle>Add case</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Input</Label><Textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} /></div>
          <div><Label>Expected contains (optional)</Label><Input value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
          <div><Label>Judge criteria (optional)</Label><Textarea rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)}
            placeholder="The answer is correct and cites a source." /></div>
          <div>
            <Label>Expected delegations (optional, comma-separated)</Label>
            <Input
              value={expectDelegations}
              onChange={(e) => setExpectDelegations(e.target.value)}
              placeholder="document-analyst, risk-analyst, case-writer"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              When set, the runner checks that each of these subagents was invoked for this case.
              Leave empty for non-supervisor datasets.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!input}>Add</AsyncButton>
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
        <DialogHeader><DialogTitle>Run {detail.id.slice(0, 8)}</DialogTitle></DialogHeader>
        
        <div className="grid grid-cols-5 gap-2 text-sm">
  <Box label="Status" value={detail.status} />
  <Box label="Cases" value={String(detail.summary?.cases ?? "—")} />
  <Box label="Pass rate" value={String(detail.summary?.pass_rate ?? "—")} />
  <Box label="Orch" value={
    detail.summary?.orchestration_rate == null
      ? "—"
      : `${detail.summary.orchestration_passed}/${detail.summary.orchestration_checked}`
  } />
  <Box label="Avg" value={String(detail.summary?.avg ?? "—")} />
</div>
{detail.summary?.langfuse && (
  <div className="text-xs text-muted-foreground">Langfuse: {detail.summary.langfuse}</div>
)}
<div className="max-h-96 space-y-2 overflow-auto">
  {detail.results?.map((r: any, i: number) => (
    <div key={i} className="rounded-md border p-3 text-sm">
      <div className="mb-1 text-xs text-muted-foreground">Case {i + 1}</div>
      <div className="font-medium">{r.input}</div>
      {r.reply && <div className="mt-1 whitespace-pre-wrap">{r.reply}</div>}
      {r.error && <div className="mt-1 text-xs text-destructive">{r.error}</div>}
      {r.delegations_expected && (
        <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs">
          <div>orchestration:{" "}
            {r.orchestration_passed
              ? <span className="font-medium text-emerald-600">passed</span>
              : <span className="font-medium text-red-600">failed</span>}
            {" — "}expected [{r.delegations_expected.join(", ") || "none"}],
            actual [{r.delegations_actual?.join(", ") || "none"}]
            {r.orchestration_missing?.length > 0 && (
              <> · missing: {r.orchestration_missing.join(", ")}</>
            )}
          </div>
        </div>
      )}
      <div className="mt-2 flex gap-3 text-xs">
        {r.score != null && <span>score: <strong>{r.score.toFixed(2)}</strong></span>}
        {r.judge_reason && <span className="text-muted-foreground">{r.judge_reason}</span>}
      </div>
    </div>
  ))}
</div>

        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );
}