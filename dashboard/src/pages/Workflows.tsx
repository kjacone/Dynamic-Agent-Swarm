import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { api, can, type Me, type RunView, type WfInput, type WfSpec, type WfSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/utils";

const STEP_TONE: Record<string, string> = {
  agent: "bg-violet-500", approval: "bg-amber-500", connector: "bg-sky-500",
  tool: "bg-sky-500", condition: "bg-slate-400", parallel: "bg-indigo-500", set: "bg-slate-400", end: "bg-emerald-500"
};

function describe(s: WfSpec["steps"][number]): string {
  switch (s.type) {
    case "approval": return `${s.required_approvals ?? 1} approver(s) · ${(s.roles || []).join(", ")}${s.due_hours ? ` · ${s.due_hours}h SLA` : ""}`;
    case "connector": return `${s.connector}.${s.operation}`;
    case "tool": return String(s.tool);
    case "condition": return `if ${s.if}`;
    case "end": return String(s.outcome ?? "");
    case "parallel": return `${(s.branches as unknown[] | undefined)?.length ?? 0} branches`;
    default: return s.type === "agent" ? "AI agent" : "";
  }
}

export function Workflows({ me }: { me: Me | null }) {
  const [defs, setDefs] = useState<WfSummary[]>([]);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [spec, setSpec] = useState<WfSpec | null>(null);
  const [starting, setStarting] = useState(false);
  const [viewing, setViewing] = useState<RunView | null>(null);
  const toast = useToast();

  async function loadRuns() { try { setRuns(await api.listRuns()); } catch (e: any) { toast.push(e.message, "error"); } }
  useEffect(() => {
    api.listWorkflows().then((d) => { setDefs(d); setActive((a) => a ?? d[0]?.key ?? null); }).catch((e) => toast.push(e.message, "error"));
    loadRuns();
  }, []);
  useEffect(() => { setSpec(null); if (active) api.getWorkflow(active).then(setSpec).catch(() => { }); }, [active]);
  useEffect(() => {
    if (!runs.some((r) => r.status === "running")) return;
    const id = setInterval(loadRuns, 3000); return () => clearInterval(id);
  }, [runs]);

  const mine = useMemo(() => runs.filter((r) => r.workflow === active), [runs, active]);

  return (
    <div>
      <PageHeader title="Workflows" description="Governed, durable processes that combine AI agents, system connectors and human approvals." />
      {defs.length === 0 ? (
        <EmptyState title="No workflows yet" body="Install an industry solution (Solutions tab) to get ready-made, configurable workflows." />
      ) : (
        <div className="grid gap-4 md:grid-cols-[260px,1fr]">
          <Card><CardHeader><CardTitle className="text-sm">Definitions</CardTitle></CardHeader>
            <CardContent className="space-y-1 p-2">
              {defs.map((d) => (
                <button key={d.key} onClick={() => setActive(d.key)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${active === d.key ? "bg-muted font-medium" : "hover:bg-muted/60"}`}>
                  <div>{d.name || d.key}</div>
                  <div className="text-xs text-muted-foreground">v{d.version} · {d.steps} steps</div>
                </button>))}
            </CardContent></Card>

          <div className="space-y-4">
            {spec && (
              <Card>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div><CardTitle className="text-base">{spec.name || spec.key} <span className="text-xs font-normal text-muted-foreground">v{spec.version}</span></CardTitle>
                    {spec.description && <p className="mt-1 text-sm text-muted-foreground">{spec.description}</p>}</div>
                  {can(me, "workflows:run") && <Button size="sm" onClick={() => setStarting(true)}><Play className="h-4 w-4" /> Start run</Button>}
                </CardHeader>
                <CardContent><ol className="space-y-1.5">
                  {spec.steps.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-3 text-sm">
                      <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}</span>
                      <span className={`h-2.5 w-2.5 rounded-full ${STEP_TONE[s.type] ?? "bg-slate-400"}`} />
                      <span className="w-40 truncate font-medium">{s.name || s.id}</span>
                      <Chip>{s.type}</Chip>
                      <span className="truncate text-xs text-muted-foreground">{describe(s)}</span>
                    </li>))}
                </ol></CardContent>
              </Card>
            )}

            <Card><CardHeader><CardTitle className="text-sm">Runs</CardTitle></CardHeader>
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
      {viewing && <RunDialog run={viewing} canCancel={can(me, "workflows:write")} onClose={() => { setViewing(null); loadRuns(); }} />}
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
        <DialogHeader><DialogTitle>Start “{spec.name || spec.key}”</DialogTitle></DialogHeader>
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

function RunDialog({ run: initial, canCancel, onClose }: { run: RunView; canCancel: boolean; onClose: () => void }) {
  const [run, setRun] = useState<RunView>(initial);
  const [spec, setSpec] = useState<WfSpec | null>(null);
  const toast = useToast();
  const refresh = () => api.getRun(initial.id).then(setRun).catch(() => { });
  useEffect(() => { refresh(); api.getWorkflow(initial.workflow, initial.version).then(setSpec).catch(() => { }); }, []);
  useEffect(() => { if (run.status !== "running") return; const id = setInterval(refresh, 2000); return () => clearInterval(id); }, [run.status]);
  const type = (id: string) => spec?.steps.find((s) => s.id === id)?.type ?? "";
  const active = ["running", "waiting_approval"].includes(run.status);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2">Run <span className="font-mono text-xs">{run.id.slice(0, 8)}</span> <StatusBadge value={run.status} /></DialogTitle></DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-auto text-sm">
          <div className="text-xs text-muted-foreground">Started by <b>{run.initiator}</b> · {fmtDate(run.created_at)}{run.outcome && <> · outcome <b>{run.outcome}</b></>}</div>
          {run.error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{run.error}</div>}
          {run.status === "waiting_approval" && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">Paused for a human decision — see the Approvals tab.</div>}
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
            {run.status === "waiting_approval" && <li className="relative"><span className="absolute -left-[26px] top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" /><b>awaiting approval</b></li>}
            {run.status === "running" && <li className="relative"><span className="absolute -left-[26px] top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" /><span className="text-muted-foreground">working…</span></li>}
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
