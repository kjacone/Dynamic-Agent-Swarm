import { useEffect, useMemo, useState } from "react";
import { Bot, Cpu, Play, Workflow } from "lucide-react";
import { api, can, type Agent, type Me, type ModelCfg, type RunView, type WfInput, type WfSpec, type WfSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { ModelSelect } from "@/components/common/ModelSelect";
import { useToast } from "@/components/ui/toast";
import { agentIdsIn, agentPack, agentRole, flattenSteps } from "@/lib/workflows";
import { WorkflowGraph, type WorkflowStepStatus } from "@/components/workflows/WorkflowGraph";
import { fmtDate } from "@/lib/utils";

export function Workflows({ me, tenant }: { me: Me | null; tenant: string }) {
  const [defs, setDefs] = useState<WfSummary[]>([]);
  const [specs, setSpecs] = useState<Record<string, WfSpec>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelCfg[]>([]);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [viewing, setViewing] = useState<RunView | null>(null);
  const toast = useToast();
  const spec = active ? specs[active] ?? null : null;

  async function loadRuns() { try { setRuns(await api.listRuns()); } catch (e: any) { toast.push(e.message, "error"); } }

  async function loadDefinitions() {
    try {
      const [d, a, m] = await Promise.all([
        api.listWorkflows(), api.listAgents(tenant), api.listModels(tenant),
      ]);
      setDefs(d); setAgents(a); setModels(m);
      const full = await Promise.all(d.map((x) => api.getWorkflow(x.key).catch(() => null)));
      setSpecs(Object.fromEntries(full.filter((s): s is WfSpec => !!s).map((s) => [s.key, s])));
      setActive((cur) => cur ?? d[0]?.key ?? null);
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  useEffect(() => { loadDefinitions(); loadRuns(); }, [tenant]);
  useEffect(() => {
    if (!runs.some((r) => r.status === "running")) return;
    const id = setInterval(loadRuns, 3000); return () => clearInterval(id);
  }, [runs]);

  const mine = useMemo(() => runs.filter((r) => r.workflow === active), [runs, active]);
  const flat = useMemo(() => (spec ? flattenSteps(spec.steps) : []), [spec]);
  const roster = useMemo(
    () => (spec ? agents.filter((a) => agentIdsIn(spec.steps || []).includes(a.id)) : []),
    [spec, agents],
  );
  const agentCount = (d: WfSummary): number | null => {
    const s = specs[d.key];
    if (!s) return null;
    const ids = agentIdsIn(s.steps || []);
    return agents.filter((a) => ids.includes(a.id)).length;
  };

  async function setAgentModel(agent: Agent, model: string) {
    if (!model || model === agent.model) return;
    setAgents((list) => list.map((a) => (a.id === agent.id ? { ...a, model } : a)));
    try {
      await api.patchAgent(agent.id, { model });
      toast.push(`${agent.name} now runs ${model}`, "success");
    } catch (e: any) {
      setAgents((list) => list.map((a) => (a.id === agent.id ? { ...a, model: agent.model } : a)));
      toast.push(e.message, "error");
    }
  }

  return (
    <div>
      <PageHeader icon={Workflow} title="Workflows"
        description="Governed, durable processes that combine AI agents, system connectors and human approvals." />
      {defs.length === 0 ? (
        <EmptyState title="No workflows yet" body="Install an industry solution (Solutions tab) to get ready-made, configurable workflows." />
      ) : (
        <div className="grid gap-4 md:grid-cols-[260px,minmax(0,1fr)]">
          <Card><CardHeader><CardTitle className="text-sm">Definitions</CardTitle></CardHeader>
            <CardContent className="space-y-1 p-2">
              {defs.map((d) => (
                <button key={d.key} onClick={() => setActive(d.key)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${active === d.key ? "border-primary/40 bg-primary/5 font-medium shadow-sm" : "border-transparent hover:bg-muted/60"}`}>
                  <div className="truncate">{d.name || d.key}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>v{d.version} · {d.steps} steps</span>
                    {agentCount(d) != null && (
                      <span className="inline-flex items-center gap-0.5"><Bot className="h-3 w-3" />{agentCount(d)}</span>
                    )}
                  </div>
                </button>))}
            </CardContent></Card>

          <div className="min-w-0 space-y-4">
            {spec && (
              <Card>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div><CardTitle className="text-base">{spec.name || spec.key} <span className="text-xs font-normal text-muted-foreground">v{spec.version}</span></CardTitle>
                    {spec.description && <p className="mt-1 text-sm text-muted-foreground">{spec.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Chip>{flat.length} steps</Chip>
                      {flat.filter((s) => s.type === "approval").length > 0 && (
                        <Chip>{flat.filter((s) => s.type === "approval").length} approvals</Chip>
                      )}
                      {flat.filter((s) => s.type === "connector").length > 0 && (
                        <Chip>{flat.filter((s) => s.type === "connector").length} connectors</Chip>
                      )}
                      <Chip>{spec.steps.length} top-level · {roster.length} agents</Chip>
                    </div>
                  </div>
                  {can(me, "workflows:run") && <Button size="sm" onClick={() => setStarting(true)}><Play className="h-4 w-4" /> Start run</Button>}
                </CardHeader>
                <CardContent className="p-3">
                  <WorkflowGraph spec={spec} agents={agents} height={380} />
                </CardContent>
              </Card>
            )}

            {spec && (
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Cpu className="h-4 w-4" /> Agents in this workflow
                  </CardTitle>
                  <Chip>{roster.length}</Chip>
                </CardHeader>
                <CardContent className="space-y-2">
                  {roster.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No installed agents match this workflow's steps. Install the solution pack, or create the
                      agents from the Agents tab.
                    </p>
                  ) : (
                    roster.map((a) => {
                      const steps = flat.filter((s) => s.type === "agent" && s.agent === a.id);
                      return (
                        <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary">
                            <Bot className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium" title={a.name}>{agentRole(a.name)}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{agentPack(a.name)}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {steps.map((s) => (
                                <span key={s.id} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                  {s.name || s.id}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="w-full min-w-0 sm:w-64">
                            <ModelSelect value={a.model} models={models}
                              onChange={(m) => setAgentModel(a, m)} className="h-8 text-xs" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            )}

            <Card><CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Runs</CardTitle>
              <span className="text-xs text-muted-foreground">{mine.length} for this workflow</span>
            </CardHeader>
              <CardContent className="p-0">
                {mine.length === 0 ? <div className="p-4 text-sm text-muted-foreground">No runs yet.</div> : (
                  <Table><THead><TR><TH>Started</TH><TH>By</TH><TH>Status</TH><TH>Outcome</TH><TH>Updated</TH></TR></THead>
                    <TBody>{mine.map((r) => (
                      <TR key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setViewing(r)}>
                        <TD>{fmtDate(r.created_at)}</TD><TD>{r.initiator}</TD><TD><StatusBadge value={r.status} /></TD>
                        <TD>{r.outcome ?? "—"}</TD><TD>{fmtDate(r.updated_at)}</TD></TR>))}</TBody></Table>)}
              </CardContent></Card>
          </div>
        </div>
      )}
      {starting && spec && <StartDialog spec={spec} onClose={(r) => { setStarting(false); if (r) { loadRuns(); setViewing(r); } }} />}
      {viewing && <RunDialog run={viewing} agents={agents} canCancel={can(me, "workflows:write")} onClose={() => { setViewing(null); loadRuns(); }} />}
    </div>
  );
}

function coerce(raw: string, input: WfInput): unknown {
  if (raw === "") return undefined;
  if (input.type === "number") return Number(raw);
  if (input.type === "boolean") return raw === "true";
  if (input.type === "object" || input.type === "array") return JSON.parse(raw);
  try { return JSON.parse(raw); } catch { return raw; } // "any": numbers/JSON if it parses, else text
}

function StartDialog({ spec, onClose }: { spec: WfSpec; onClose: (r?: RunView) => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const toast = useToast();
  async function go() {
    try {
      const inputs: Record<string, unknown> = {};
      for (const [k, def] of Object.entries(spec.inputs)) {
        const v = coerce(vals[k] ?? "", def);
        if (v !== undefined) inputs[k] = v;
      }
      const run = await api.runWorkflow(spec.key, inputs, false);
      toast.push("Run started", "success"); onClose(run);
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  const missing = Object.entries(spec.inputs).some(([k, d]) => d.required && !(vals[k] ?? "").trim());
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start "{spec.name || spec.key}"</DialogTitle>
          <DialogDescription>Provide the inputs for this run. Required fields are marked with an asterisk.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto">
          {Object.entries(spec.inputs).map(([k, d]) => (
            <div key={k}>
              <Label>{k}{d.required && <span className="text-red-500"> *</span>} <span className="text-xs text-muted-foreground">({d.type})</span></Label>
              {d.type === "string" || d.type === "any" || d.type === "object" || d.type === "array"
                ? <Textarea rows={d.type === "string" || d.type === "any" ? 3 : 4} value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                  placeholder={d.type === "object" || d.type === "array" ? "JSON" : undefined} />
                : d.type === "boolean"
                  ? <select className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm" value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })}>
                    <option value="">—</option><option value="true">true</option><option value="false">false</option></select>
                  : <Input type="number" value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />}
              {d.description && <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>}
            </div>))}
          {Object.keys(spec.inputs).length === 0 && <p className="text-sm text-muted-foreground">This workflow takes no inputs.</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><AsyncButton onRun={go} disabled={missing}>Start</AsyncButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunDialog({ run: initial, agents, canCancel, onClose }: { run: RunView; agents: Agent[]; canCancel: boolean; onClose: () => void }) {
  const [run, setRun] = useState<RunView>(initial);
  const [spec, setSpec] = useState<WfSpec | null>(null);
  const toast = useToast();
  const refresh = () => api.getRun(initial.id).then(setRun).catch(() => { });
  useEffect(() => { refresh(); api.getWorkflow(initial.workflow, initial.version).then(setSpec).catch(() => { }); }, []);
  useEffect(() => { if (run.status !== "running") return; const id = setInterval(refresh, 2000); return () => clearInterval(id); }, [run.status]);
  const allSteps = spec ? flattenSteps(spec.steps) : [];
  const type = (id: string) => allSteps.find((s) => s.id === id)?.type ?? "";
  const statuses = useMemo(() => {
    const m: Record<string, WorkflowStepStatus> = {};
    for (const h of run.history) m[h.step] = h.status === "error" || m[h.step] === "error" ? "error" : "ok";
    if (run.current_step && ["running", "waiting_approval"].includes(run.status)) {
      m[run.current_step] = run.status === "waiting_approval" ? "waiting" : "active";
    }
    return m;
  }, [run.history, run.current_step, run.status]);
  const active = ["running", "waiting_approval"].includes(run.status);
  const currentStep = active && run.current_step ? allSteps.find((s) => s.id === run.current_step) : null;
  const trail = useMemo(() => {
    const ids = run.history.map((h) => h.step);
    if (active && run.current_step && ids[ids.length - 1] !== run.current_step) ids.push(run.current_step);
    return ids;
  }, [run.history, run.current_step, active]);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Run <span className="font-mono text-xs">{run.id.slice(0, 8)}</span> <StatusBadge value={run.status} /></DialogTitle>
          <DialogDescription>The highlighted route shows how this run moved through the workflow.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-auto text-sm">
          <div className="text-xs text-muted-foreground">Started by <b>{run.initiator}</b> · {fmtDate(run.created_at)}{run.outcome && <> · outcome <b>{run.outcome}</b></>}</div>
          {run.error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{run.error}</div>}
          {run.status === "waiting_approval" && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">Paused for a human decision — see the Approvals tab.</div>}
          {currentStep && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`h-2 w-2 shrink-0 animate-pulse rounded-full ${run.status === "waiting_approval" ? "bg-amber-500" : "bg-sky-500"}`} />
              <span className="text-muted-foreground">Current step</span>
              <b>{currentStep.name || currentStep.id}</b>
              {run.status === "waiting_approval" && <span className="text-amber-600 dark:text-amber-400">waiting for approval</span>}
            </div>
          )}
          {spec && <WorkflowGraph spec={spec} agents={agents} statuses={statuses} trail={trail} focusStep={run.current_step} height={300} minimap={false} />}
          {run.delegations && run.delegations.length > 0 && (
            <div className="rounded-md border p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Delegations ({run.delegations.length})
              </div>
              <ol className="space-y-1.5 text-sm">
                {run.delegations.map((d, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                    <div>
                      <span className="mr-2 text-xs text-muted-foreground">#{d.n}</span>
                      <b>{d.delegate}</b>
                      {d.task && <div className="text-xs text-muted-foreground">{d.task}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <ol className="relative space-y-3 border-l pl-5">
            {run.history.map((h, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ${h.status === "ok" ? "bg-emerald-500" : "bg-red-500"}`} />
                <div className="flex items-center gap-2"><b>{h.step}</b>{type(h.step) && <Chip>{type(h.step)}</Chip>}<span className="text-xs text-muted-foreground">{fmtDate(h.ts)}</span></div>
                {h.error && <div className="text-xs text-red-600">{h.error}</div>}
              </li>))}
            {run.status === "waiting_approval" && <li className="relative"><span className="absolute -left-[26px] top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" /><b>awaiting approval{currentStep ? ` at ${currentStep.name || currentStep.id}` : ""}</b></li>}
            {run.status === "running" && <li className="relative"><span className="absolute -left-[26px] top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" /><span className="text-muted-foreground">{currentStep ? `working on ${currentStep.name || currentStep.id}…` : "working…"}</span></li>}
          </ol>
          {run.context && <details><summary className="cursor-pointer text-xs text-muted-foreground">Data produced so far</summary><JsonView data={run.context} className="mt-2" /></details>}
        </div>
        <DialogFooter>
          {canCancel && active && <AsyncButton variant="outline" onRun={async () => { await api.cancelRun(run.id); toast.push("Run cancelled", "success"); refresh(); }}>Cancel run</AsyncButton>}
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
