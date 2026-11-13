import { useEffect, useMemo, useState } from "react";
import {
  Bot, Boxes, Cpu, GitBranch, History, Layers, Pencil, Play, Plus, Trash2, UserX, Wrench,
} from "lucide-react";

import { api, type Agent, type ModelCfg, type Rag, type SubAgent, type Tool, type WfSpec } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatCard } from "@/components/common/StatCard";
import { JsonView } from "@/components/common/JsonView";
import { ModelSelect } from "@/components/common/ModelSelect";
import { useToast } from "@/components/ui/toast";
import { agentRole, flattenSteps } from "@/lib/workflows";
import { cn, truncate } from "@/lib/utils";

type WorkflowUsage = { key: string; name: string; steps: string[] };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export function Agents({ tenant }: { tenant: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [rags, setRags] = useState<Rag[]>([]);
  const [subs, setSubs] = useState<SubAgent[]>([]);
  const [models, setModels] = useState<ModelCfg[]>([]);
  const [specs, setSpecs] = useState<WfSpec[]>([]);
  const [selected, setSelected] = useState("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<Agent | null>(null);
  const [versionsFor, setVersionsFor] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const [a, t, r, s, m] = await Promise.all([
        api.listAgents(tenant), api.listTools(tenant), api.listRag(tenant),
        api.listSubagents(tenant), api.listModels(tenant),
      ]);
      setAgents(a); setTools(t); setRags(r); setSubs(s); setModels(m);
    } catch (e: any) {
      toast.push(e.message, "error");
    }
    try {
      const defs = await api.listWorkflows();
      const full = await Promise.all(defs.map((d) => api.getWorkflow(d.key).catch(() => null)));
      setSpecs(full.filter((x): x is WfSpec => !!x));
    } catch {
      // Workflows module unavailable (licence or edition) — the page still works without grouping.
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [tenant]);

  const usage = useMemo(() => {
    const map = new Map<string, WorkflowUsage[]>();
    for (const spec of specs) {
      for (const step of flattenSteps(spec.steps || [])) {
        if (step.type !== "agent" || !step.agent) continue;
        const list = map.get(step.agent) ?? [];
        const label = step.name || step.id;
        const entry = list.find((u) => u.key === spec.key);
        if (entry) entry.steps.push(label);
        else list.push({ key: spec.key, name: spec.name || spec.key, steps: [label] });
        map.set(step.agent, list);
      }
    }
    return map;
  }, [specs]);

  const unassigned = useMemo(() => agents.filter((a) => !usage.has(a.id)).length, [agents, usage]);
  const byWorkflow = useMemo(
    () => specs.map((s) => ({ spec: s, count: agents.filter((a) => usage.get(a.id)?.some((u) => u.key === s.key)).length })),
    [specs, agents, usage],
  );

  const visible = useMemo(() => {
    if (selected === "all") return agents;
    if (selected === "none") return agents.filter((a) => !usage.has(a.id));
    return agents.filter((a) => usage.get(a.id)?.some((u) => u.key === selected));
  }, [agents, selected, usage]);

  const activeSpec = specs.find((s) => s.key === selected);
  const title = selected === "all" ? "All agents" : selected === "none" ? "Unassigned agents"
    : activeSpec?.name || activeSpec?.key || selected;
  const subtitle = selected === "all"
    ? "Every top-level graph, grouped by the workflow that calls it."
    : selected === "none"
      ? "These agents exist but no workflow step references them."
      : activeSpec?.description || `${activeSpec?.steps.length ?? 0} steps · click an agent to edit its config.`;

  async function changeModel(agent: Agent, model: string) {
    if (!model || model === agent.model) return;
    const previous = agent.model;
    setAgents((list) => list.map((a) => (a.id === agent.id ? { ...a, model } : a)));
    try {
      const saved = await api.patchAgent(agent.id, { model });
      setAgents((list) => list.map((a) => (a.id === agent.id ? saved : a)));
      toast.push(`${agent.name} now runs ${model}`, "success");
    } catch (e: any) {
      setAgents((list) => list.map((a) => (a.id === agent.id ? { ...a, model: previous } : a)));
      toast.push(e.message, "error");
    }
  }

  async function remove(agent: Agent) {
    try {
      await api.deleteAgent(agent.id);
      toast.push("Deleted", "success");
      refresh();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <div>
      <PageHeader
        icon={Bot}
        title="Agents"
        description="The top-level graph each chat session runs against."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New agent</Button>}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Bot} label="Agents" value={agents.length} tone="sky" />
        <StatCard icon={GitBranch} label="Workflows" value={specs.length} tone="violet" />
        <StatCard icon={Cpu} label="Models in play" value={new Set(agents.map((a) => a.model)).size} tone="emerald" />
        <StatCard icon={UserX} label="Unassigned" value={unassigned} tone="amber"
          hint={unassigned ? "Not referenced by any workflow step" : "Every agent has a workflow"} />
      </div>

      {loading && agents.length === 0 ? (
        <LoadingBlock rows={4} />
      ) : agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          body="Create one and configure its tools, RAG collections, and subagents."
          action={<Button onClick={() => setCreating(true)}>Create agent</Button>}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[280px,minmax(0,1fr)]">
          <Card className="min-w-0 lg:sticky lg:top-4">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Workflows
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-2">
              <RailItem active={selected === "all"} onClick={() => setSelected("all")}
                name="All agents" meta={`${agents.length} agents`} count={agents.length} />
              {unassigned > 0 && (
                <RailItem active={selected === "none"} onClick={() => setSelected("none")}
                  name="Unassigned" meta="No workflow references" count={unassigned} />
              )}
              <div className="my-2 border-t" />
              {byWorkflow.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No workflows installed. Install a solution pack to see agents grouped by workflow.
                </p>
              )}
              {byWorkflow.map(({ spec, count }) => (
                <RailItem key={spec.key} active={selected === spec.key} onClick={() => setSelected(spec.key)}
                  name={spec.name || spec.key} meta={`v${spec.version} · ${spec.steps.length} steps`} count={count} />
              ))}
            </CardContent>
          </Card>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
              </div>
              <Badge variant="secondary" className="tabular-nums">{visible.length} agents</Badge>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                title={selected === "none" ? "Every agent is wired into a workflow" : "No agents in this workflow"}
                body="Pick another workflow on the left, or create a new agent."
                action={<Button onClick={() => setCreating(true)}>New agent</Button>}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {visible.map((a) => (
                  <AgentCard
                    key={a.id}
                    agent={a}
                    models={models}
                    trails={usage.get(a.id) ?? []}
                    onModel={(m) => changeModel(a, m)}
                    onEdit={() => setEditing(a)}
                    onTest={() => setTesting(a)}
                    onVersions={() => setVersionsFor(a)}
                    onDelete={() => setDeleting(a)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AgentForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); refresh(); }}
        tenant={tenant}
        tools={tools} rags={rags} subs={subs} models={models}
      />
      {editing && (
        <AgentForm
          open
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
          tenant={tenant}
          tools={tools} rags={rags} subs={subs} models={models}
        />
      )}
      {testing && <TestChat agent={testing} tenant={tenant} onClose={() => setTesting(null)} />}
      {versionsFor && <VersionsDialog agent={versionsFor} tenant={tenant} onClose={() => setVersionsFor(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description="Chat sessions routed to this agent will fail until another agent is selected. Workflow steps referencing it will report an error. This cannot be undone."
          confirmLabel="Delete agent" destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove(deleting);
          }}
        />
      )}
    </div>
  );
}

function RailItem({ active, name, meta, count, onClick }: {
  active: boolean; name: string; meta: string; count: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
        active ? "border-primary/40 bg-primary/5 shadow-sm" : "border-transparent hover:bg-muted/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className={cn(
          "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}>{count}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{meta}</div>
    </button>
  );
}

function AgentCard({
  agent, models, trails, onModel, onEdit, onTest, onVersions, onDelete,
}: {
  agent: Agent;
  models: ModelCfg[];
  trails: WorkflowUsage[];
  onModel: (m: string) => void;
  onEdit: () => void;
  onTest: () => void;
  onVersions: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex min-w-0 flex-col transition-shadow hover:shadow-md">
      <CardHeader className="flex-row items-start gap-3 space-y-0 p-4 pb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-sm font-semibold text-primary">
          {initials(agentRole(agent.name)) || <Bot className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-sm" title={agent.name}>{agentRole(agent.name)}</CardTitle>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{agent.id}</div>
        </div>
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{agent.tenant_id}</Badge>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <Cpu className="h-3 w-3" /> Model
          </div>
          <ModelSelect value={agent.model} models={models} onChange={onModel} className="h-8 text-xs" />
        </div>
        <p className="line-clamp-2 min-h-[32px] text-xs text-muted-foreground">
          {agent.system_prompt ? truncate(agent.system_prompt, 160) : "No system prompt — the model runs with defaults."}
        </p>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <Pill icon={Wrench} label="tools" n={agent.tool_ids.length} />
          <Pill icon={Layers} label="RAG" n={agent.rag_collection_ids.length} />
          <Pill icon={Boxes} label="subagents" n={agent.subagent_ids.length} />
        </div>
        <div className="flex flex-wrap gap-1">
          {trails.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">Not used by a workflow yet</span>
          ) : (
            trails.map((t) => (
              <span key={t.key} title={t.steps.join(", ")}
                className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-700 dark:text-violet-300">
                {t.name}
              </span>
            ))
          )}
        </div>
        <div className="mt-auto flex items-center gap-0.5 border-t pt-2">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onTest}>
            <Play className="h-3.5 w-3.5" /> Test
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onVersions}>
            <History className="h-3.5 w-3.5" /> Versions
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Pill({ icon: Icon, label, n }: { icon: React.ComponentType<{ className?: string }>; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
      <Icon className="h-3 w-3" /> {n} {label}
    </span>
  );
}

function AgentForm({
  open, onClose, onSaved, tenant, tools, rags, subs, models, initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  tenant: string;
  tools: Tool[]; rags: Rag[]; subs: SubAgent[]; models: ModelCfg[];
  initial?: Agent;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [model, setModel] = useState(initial?.model || "ollama:llama3.1:8b");
  const [prompt, setPrompt] = useState(initial?.system_prompt || "");
  const [toolIds, setToolIds] = useState<string[]>(initial?.tool_ids || []);
  const [ragIds, setRagIds] = useState<string[]>(initial?.rag_collection_ids || []);
  const [subIds, setSubIds] = useState<string[]>(initial?.subagent_ids || []);
  const toast = useToast();

  async function save() {
    try {
      const body = {
        name, model, system_prompt: prompt, tenant_id: tenant,
        tool_ids: toolIds, rag_collection_ids: ragIds, subagent_ids: subIds,
      };
      if (initial) await api.patchAgent(initial.id, body);
      else await api.createAgent(body);
      toast.push("Saved", "success");
      onSaved();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit agent" : "New agent"}</DialogTitle>
          <DialogDescription>
            Changes are saved as a draft. Publish a version from the agent card to route live traffic to it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="refunds-supervisor" /></div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <ModelSelect value={model} onChange={setModel} models={models} />
            </div>
          </div>
          <div className="space-y-1.5"><Label>System prompt</Label>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="Or a Langfuse ref: langfuse:my-prompt:production" />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MultiSelect label="Tools" items={tools.map((t) => ({ id: t.id, label: t.name }))}
              selected={toolIds} onChange={setToolIds} />
            <MultiSelect label="RAG" items={rags.map((r) => ({ id: r.id, label: `${r.name} (${r.status})` }))}
              selected={ragIds} onChange={setRagIds} />
            <MultiSelect label="Subagents" items={subs.map((s) => ({ id: s.id, label: `${s.name} · ${s.mode}` }))}
              selected={subIds} onChange={setSubIds} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name}>Save</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MultiSelect({ label, items, selected, onChange }: {
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 max-h-40 space-y-1 overflow-auto rounded-md border p-2">
        {items.length === 0 && <div className="text-xs text-muted-foreground">None available</div>}
        {items.map((it) => (
          <label key={it.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(it.id)} onCheckedChange={() => toggle(it.id)} />
            <span className="truncate">{it.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TestChat({ agent, tenant, onClose }: { agent: Agent; tenant: string; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [useDraft, setUseDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try {
      const out = await api.testAgent({
        agent_id: agent.id, message, tenant_id: tenant, use_draft: useDraft,
      });
      setResult(out);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Test · {agent.name}</DialogTitle>
          <DialogDescription>Send a message with the draft config before publishing. Runs are traced and billed like live traffic.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Message</Label>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && message && !busy) run(); }}
              placeholder="How do I dispute a card charge?" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={useDraft} onCheckedChange={(v) => setUseDraft(!!v)} /> Use draft config
          </label>
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          {result ? <JsonView data={result} /> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <AsyncButton onRun={run} disabled={!message || busy}>Run</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionsDialog({ agent, tenant, onClose }: { agent: Agent; tenant: string; onClose: () => void }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState<{ title: string; lines: string[]; hint?: string } | null>(null);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listVersions(agent.id)); } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, []);

  async function publish() {
    try {
      await api.publishAgent(agent.id, note);
      setNote("");
      refresh();
      toast.push("Published", "success");
    } catch (e: any) {
      const body = e.body as
        | { error?: string;
            detail?: {
              failed?: Array<{ id: string; notes: string[] }>;
              failures?: Array<{ dimension: string; pass_rate: number | null; threshold: number }>;
              reason?: string; message?: string;
              pass_rate?: number | null; threshold?: number | null;
            };
            hint?: string }
        | undefined;

      if (body?.error === "conformance_failed") {
        setOverride({
          title: "Conformance gate blocked this publish",
          lines: (body.detail?.failed ?? []).map((f) => `${f.id}: ${f.notes.join("; ")}`),
          hint: body.hint,
        });
        return;
      }

      if (body?.error === "eval_failed") {
        const d = body.detail;
        setOverride({
          title: "Eval gate blocked this publish",
          lines: d?.reason === "no_eval_run"
            ? [d.message ?? "no draft eval run"]
            : (d?.failures ?? []).map((f) => `${f.dimension}: pass ${f.pass_rate ?? "—"} < ${f.threshold}`),
          hint: body.hint,
        });
        return;
      }

      toast.push(e.message, "error");
    }
  }
  async function overridePublish(reason?: string) {
    await api.publishAgent(agent.id, note, reason);
    setNote(""); refresh();
    toast.push("Published with gate override (audited)", "success");
  }
  async function rollback(v: number) {
    try { await api.rollback(agent.id, v); refresh(); toast.push(`v${v} live`, "success"); }
    catch (e: any) { toast.push(e.message, "error"); throw e; }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Versions · {agent.name}</DialogTitle>
          <DialogDescription>Publishing swaps live traffic to the draft config. Rollback restores an earlier published version.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Publish note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <AsyncButton onRun={publish}>Publish current</AsyncButton>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <THead><TR><TH>v</TH><TH>Note</TH><TH>Status</TH><TH></TH></TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={String(r.id)}>
                    <TD className="tabular-nums">{String(r.version)}</TD>
                    <TD className="text-xs">{String(r.note || "—")}</TD>
                    <TD>{r.published
                      ? <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 shadow-none hover:bg-emerald-500/15 dark:text-emerald-400">live</Badge>
                      : <Badge variant="outline">archived</Badge>}</TD>
                    <TD>
                      {!r.published && (
                        <Button size="sm" variant="outline" onClick={() => setRollingBack(Number(r.version))}>Rollback</Button>
                      )}
                    </TD>
                  </TR>
                ))}
                {rows.length === 0 && <TR><TD colSpan={4} className="py-8 text-center text-xs text-muted-foreground">No versions yet. Publish to create v1.</TD></TR>}
              </TBody>
            </Table>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
        {override && (
          <ConfirmDialog
            title={override.title}
            description="This guardrail exists for a reason. Publishing anyway is recorded against your account."
            confirmLabel="Publish anyway" destructive requireReason
            reasonPlaceholder="Why is this bypass acceptable for this release?"
            onClose={() => setOverride(null)}
            onConfirm={overridePublish}
          >
            <div className="space-y-2">
              <ul className="max-h-40 space-y-1 overflow-auto rounded-lg border bg-muted/30 p-2.5 text-xs">
                {override.lines.map((l, i) => <li key={i} className="flex gap-1.5"><span className="text-red-500">•</span><span>{l}</span></li>)}
                {override.lines.length === 0 && <li className="text-muted-foreground">(no details)</li>}
              </ul>
              {override.hint && <p className="text-xs text-muted-foreground">{override.hint}</p>}
            </div>
          </ConfirmDialog>
        )}
        {rollingBack != null && (
          <ConfirmDialog
            title={`Roll back to v${rollingBack}?`}
            description="Live traffic immediately moves to this version's config. The current version stays archived and can be restored the same way."
            confirmLabel="Roll back"
            onClose={() => setRollingBack(null)}
            onConfirm={() => rollback(rollingBack)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
