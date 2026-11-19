import { Fragment, useEffect, useMemo, useState } from "react";
import { Bot, Download, Filter, GitBranch, RotateCcw, ScrollText, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  api, can, type Agent, type AuditEventRow, type Me, type RunView, type WfSpec, type WfSummary,
} from "@/lib/api";
import type { TabId } from "@/components/layout/nav";
import { agentRole, flattenSteps } from "@/lib/workflows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { ScopeBar } from "@/components/common/ScopeBar";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";

type Verify = { ok: boolean; checked: number; first_bad_seq: number | null; reason: string };

const EMPTY = { action: "", actor: "", resource_id: "" };

export function Audit({ me, tenant, onOpenTab, onOpenAgent }: {
  me: Me | null;
  tenant: string;
  onOpenTab?: (tab: TabId) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const [rows, setRows] = useState<AuditEventRow[] | null>(null);
  const [f, setF] = useState(EMPTY);
  const [agentF, setAgentF] = useState("");
  const [wfF, setWfF] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [defs, setDefs] = useState<WfSummary[]>([]);
  const [specs, setSpecs] = useState<WfSpec[]>([]);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [cp, setCp] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function load() {
    try { setRows((await api.queryAudit({ ...f, limit: 500 })).reverse()); } // newest first
    catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { load(); }, []);

  // Join audit events to the agents and workflows behind them: run ids → workflow,
  // workflow step → agent, and the agent/workflow ids already carried in details.
  useEffect(() => {
    (async () => {
      const [a, wf] = await Promise.all([
        api.listAgents(tenant).catch(() => [] as Agent[]),
        api.listWorkflows().catch(() => [] as WfSummary[]),
      ]);
      setAgents(a);
      setDefs(wf);
      const [full, rs] = await Promise.all([
        Promise.all(wf.map((d) => api.getWorkflow(d.key).catch(() => null))),
        api.listRuns().catch(() => [] as RunView[]),
      ]);
      setSpecs(full.filter((s): s is WfSpec => !!s));
      setRuns(rs);
    })();
  }, [tenant]);

  const runWorkflow = useMemo(() => new Map(runs.map((r) => [r.id, r.workflow])), [runs]);
  const stepAgents = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    for (const spec of specs) {
      const byStep = new Map<string, string>();
      for (const st of flattenSteps(spec.steps || [])) {
        if (st.type === "agent" && st.agent) byStep.set(st.id, st.agent);
      }
      m.set(spec.key, byStep);
    }
    return m;
  }, [specs]);
  const links = useMemo(() => {
    const m = new Map<string, { agents: string[]; workflow?: string }>();
    // Delegation events name the agent(s) behind a run; use them as a fallback when
    // a step id no longer exists in the workflow's current version.
    const runAgents = new Map<string, string[]>();
    for (const r of rows ?? []) {
      if (r.actor_type === "agent" && r.resource_type === "workflow_run" && r.resource_id) {
        const ids = runAgents.get(r.resource_id) ?? [];
        if (!ids.includes(r.actor)) ids.push(r.actor);
        runAgents.set(r.resource_id, ids);
      }
    }
    for (const r of rows ?? []) {
      const d = (r.details ?? {}) as Record<string, unknown>;
      const ids = new Set<string>();
      if (r.resource_type === "agent" && r.resource_id) ids.add(r.resource_id);
      if (r.actor_type === "agent" && r.actor) ids.add(r.actor);
      if (typeof d.agent_id === "string" && d.agent_id) ids.add(d.agent_id);
      let wf = typeof d.workflow === "string" ? d.workflow
        : typeof d.workflow_key === "string" ? d.workflow_key : undefined;
      if (!wf && r.resource_type === "workflow") wf = r.resource_id;
      if (!wf && r.resource_type === "workflow_run") wf = runWorkflow.get(r.resource_id);
      if (wf && r.resource_type === "workflow_run") {
        const a = typeof d.step === "string" ? stepAgents.get(wf)?.get(d.step) : undefined;
        if (a) ids.add(a);
        else for (const id of runAgents.get(r.resource_id) ?? []) ids.add(id);
      }
      m.set(r.id, { agents: [...ids], workflow: wf });
    }
    return m;
  }, [rows, runWorkflow, stepAgents]);

  const shown = useMemo(
    () => (rows ?? []).filter((r) => {
      const l = links.get(r.id);
      if (!l) return true;
      return (!agentF || l.agents.includes(agentF)) && (!wfF || l.workflow === wfF);
    }),
    [rows, links, agentF, wfF],
  );

  const agentLabel = (id: string) => {
    const a = agents.find((x) => x.id === id);
    return a ? agentRole(a.name) : id.slice(0, 8);
  };
  const wfLabel = (key: string) => defs.find((d) => d.key === key)?.name || key;
  const scoped = !!(agentF || wfF);
  const filtered = !!(f.action || f.actor || f.resource_id || scoped);

  return (
    <div>
      <PageHeader
        icon={ScrollText}
        title="Audit trail"
        description="Append-only, hash-chained record of who did what. Any edit or deletion breaks the chain and is detected."
        actions={<>
          <AsyncButton variant="outline" onRun={async () => setVerify(await api.verifyAudit())}><ShieldCheck className="h-4 w-4" /> Verify integrity</AsyncButton>
          <AsyncButton variant="outline" onRun={async () => setCp(await api.auditCheckpoint())}>Signed checkpoint</AsyncButton>
          {can(me, "audit:export") && (
            <AsyncButton variant="outline" onRun={() => api.exportAudit().catch((e) => toast.push(e.message, "error"))}>
              <Download className="h-4 w-4" /> Export JSONL
            </AsyncButton>
          )}
        </>}
      />

      <ScopeBar
        tenant={tenant}
        onOpenTab={onOpenTab}
        title="Every event names its agent and workflow"
        note="Rows resolve to the agent that acted and the workflow run behind them. Filter by either below, or click a chip to open the agent's wiring."
      />

      {verify && (
        <div className={cn(
          "mb-4 flex items-start gap-3 rounded-xl border p-3.5 text-sm",
          verify.ok ? "border-emerald-500/35 bg-emerald-500/10" : "border-red-500/35 bg-red-500/10",
        )}>
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", verify.ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-600 dark:text-red-400")}>
            {verify.ok ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          </span>
          {verify.ok
            ? <span><b>Chain intact.</b> {verify.checked.toLocaleString()} events verified from the first record to the latest.</span>
            : <span><b>Tampering detected</b> at event #{verify.first_bad_seq}: {verify.reason}. Treat as a security incident and preserve the database.</span>}
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
            <div className="grid gap-2 md:grid-cols-[1fr,1fr,1fr,auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Action, e.g. approval.*" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
              </div>
              <Input placeholder="Actor (user or system)" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
              <Input placeholder="Resource id (run, approval, agent…)" value={f.resource_id} onChange={(e) => setF({ ...f, resource_id: e.target.value })} />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1 md:flex-none"><Filter className="h-4 w-4" /> Filter</Button>
                {filtered && (
                  <Button type="button" variant="ghost" title="Clear filters" onClick={() => { setF(EMPTY); setAgentF(""); setWfF(""); setTimeout(load, 0); }}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <GitBranch className="h-3 w-3" /> Agent / workflow
              </span>
              <select
                aria-label="Agent"
                value={agentF}
                onChange={(e) => setAgentF(e.target.value)}
                className="h-8 max-w-52 rounded-lg border bg-background px-2 text-xs"
              >
                <option value="">All agents</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{agentRole(a.name)}</option>)}
              </select>
              <select
                aria-label="Workflow"
                value={wfF}
                onChange={(e) => setWfF(e.target.value)}
                className="h-8 max-w-52 rounded-lg border bg-background px-2 text-xs"
              >
                <option value="">All workflows</option>
                {defs.map((d) => <option key={d.key} value={d.key}>{d.name || d.key}</option>)}
              </select>
              {scoped && (
                <button type="button" onClick={() => { setAgentF(""); setWfF(""); }}
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  Clear
                </button>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                Resolved from the newest {rows?.length ?? 0} events.
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {rows === null ? (
        <Card><CardContent className="space-y-2 py-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/60" />)}
        </CardContent></Card>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={rows.length === 0 ? "No events match" : "No events for this agent or workflow"}
          body={rows.length === 0
            ? "Adjust the filters, or run an action elsewhere in the console to generate audit events."
            : "Widen the agent or workflow filter — relationship filters look at the newest batch of events."}
        />
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
            <CardTitle className="text-sm">Events</CardTitle>
            <span className="text-xs text-muted-foreground">
              {scoped ? `${shown.length.toLocaleString()} of ${rows.length.toLocaleString()}` : rows.length.toLocaleString()} newest first · click a row for details
            </span>
          </CardHeader>
          <CardContent className="p-0"><Table>
            <THead><TR><TH className="w-16">#</TH><TH>Time</TH><TH>Actor</TH><TH>Action</TH><TH>Resource</TH><TH>Outcome</TH></TR></THead>
            <TBody>{shown.map((r) => {
              const l = links.get(r.id);
              return (<Fragment key={r.id}>
                <TR className={cn("cursor-pointer", open === r.id && "bg-muted/40")} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <TD className="font-mono text-xs text-muted-foreground">{r.seq}</TD><TD className="whitespace-nowrap text-xs">{fmtDate(r.ts)}</TD>
                  <TD>{r.actor}{r.actor_type !== "user" && <span className="ml-1 text-xs text-muted-foreground">({r.actor_type})</span>}</TD>
                  <TD className="font-mono text-xs">{r.action}</TD>
                  <TD className="max-w-[230px] text-xs">
                    <div className="truncate">{r.resource_type && `${r.resource_type}:`}{r.resource_id.slice(0, 12)}</div>
                    {l && (l.workflow || l.agents.length > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.workflow && (
                          <button
                            type="button"
                            title="Open Workflows"
                            onClick={(e) => { e.stopPropagation(); onOpenTab?.("workflows"); }}
                            className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <GitBranch className="h-2.5 w-2.5" /> {wfLabel(l.workflow)}
                          </button>
                        )}
                        {l.agents.slice(0, 3).map((id) => (
                          <button
                            key={id}
                            type="button"
                            title="Open this agent's wiring"
                            onClick={(e) => { e.stopPropagation(); onOpenAgent?.(id); }}
                            className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Bot className="h-2.5 w-2.5" /> {agentLabel(id)}
                          </button>
                        ))}
                      </div>
                    )}
                  </TD>
                  <TD><StatusBadge value={r.outcome} /></TD></TR>
                {open === r.id && (<TR><TD colSpan={6} className="bg-muted/25 p-4">
                  <JsonView data={r.details} />
                  <div className="mt-2 grid gap-1 font-mono text-[10px] text-muted-foreground">
                    <div className="truncate">prev: {r.prev_hash}</div><div className="truncate">hash: {r.hash}</div></div></TD></TR>)}
              </Fragment>);
            })}</TBody></Table></CardContent></Card>
      )}

      {cp && (
        <Dialog open onOpenChange={(v) => !v && setCp(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Signed audit checkpoint</DialogTitle>
              <DialogDescription>Store this outside the platform (object-lock storage, SIEM, regulator). If events are later truncated, the head will no longer match.</DialogDescription>
            </DialogHeader>
            <JsonView data={cp} />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(JSON.stringify(cp, null, 2));
                  setCopied(true);
                  toast.push("Checkpoint copied to clipboard", "success");
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={() => setCp(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>)}
    </div>
  );
}
