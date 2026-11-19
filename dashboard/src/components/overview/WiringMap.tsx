import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, ArrowUpRight, Bot, FlaskConical, GitBranch, Wrench, Workflow,
} from "lucide-react";

import {
  api, type Agent, type ApiKey, type EvalDataset, type Guardrail, type LocaleProfileRow,
  type ModelCfg, type Rag, type SubAgent, type Tool, type WfSpec, type WfSummary,
} from "@/lib/api";
import type { TabId } from "@/components/layout/nav";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { agentRole, flattenSteps } from "@/lib/workflows";
import { cn } from "@/lib/utils";

const TONES: Record<string, string> = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

type WiringData = {
  agents: Agent[];
  tools: Tool[];
  rags: Rag[];
  subs: SubAgent[];
  models: ModelCfg[];
  workflows: WfSpec[];
  keys: ApiKey[];
  evals: EvalDataset[];
  locales: LocaleProfileRow[];
  guardrails: Guardrail[];
};

function Column({ icon: Icon, title, tone, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", TONES[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-medium">{title}</span>
      </div>
      <div className="mt-2 space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value, warn, onClick, title }: {
  label: string; value: number | string; warn?: string; onClick: () => void; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `Open ${label}`}
      className="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-background"
    >
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-foreground">
        {value}
        {warn && <span className="ml-1 font-normal text-amber-600 dark:text-amber-400">· {warn}</span>}
      </span>
    </button>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 border-t pt-1.5 text-[10px] leading-snug text-muted-foreground/80">{children}</p>;
}

export function WiringMap({ tenant, onOpenTab, onOpenAgent }: {
  tenant: string;
  onOpenTab?: (tab: TabId) => void;
  onOpenAgent?: (agentId: string) => void;
}) {
  const [data, setData] = useState<WiringData | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [agents, tools, rags, subs, models, keys, evals, locales, guardrails, defs] = await Promise.all([
        api.listAgents(tenant).catch(() => [] as Agent[]),
        api.listTools(tenant).catch(() => [] as Tool[]),
        api.listRag(tenant).catch(() => [] as Rag[]),
        api.listSubagents(tenant).catch(() => [] as SubAgent[]),
        api.listModels(tenant).catch(() => [] as ModelCfg[]),
        api.listKeys(tenant).catch(() => [] as ApiKey[]),
        api.listEvalDatasets(tenant).catch(() => [] as EvalDataset[]),
        api.listLocaleProfiles(tenant).catch(() => [] as LocaleProfileRow[]),
        api.guardrails().catch(() => [] as Guardrail[]),
        api.listWorkflows().catch(() => [] as WfSummary[]),
      ]);
      const specs = (await Promise.all(defs.map((d) => api.getWorkflow(d.key).catch(() => null))))
        .filter((x): x is WfSpec => !!x);
      if (live) setData({ agents, tools, rags, subs, models, workflows: specs, keys, evals, locales, guardrails });
    })();
    return () => { live = false; };
  }, [tenant]);

  const view = useMemo(() => {
    if (!data) return null;
    const wfUse = new Map<string, Array<{ key: string; name: string; steps: string[] }>>();
    for (const spec of data.workflows) {
      for (const step of flattenSteps(spec.steps || [])) {
        if (step.type !== "agent" || !step.agent) continue;
        const list = wfUse.get(step.agent) ?? [];
        const label = step.name || step.id;
        const entry = list.find((u) => u.key === spec.key);
        if (entry) entry.steps.push(label);
        else list.push({ key: spec.key, name: spec.name || spec.key, steps: [label] });
        wfUse.set(step.agent, list);
      }
    }
    const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
    const modelUse = new Map<string, number>();
    const toolUse = new Map<string, number>();
    const ragUse = new Map<string, number>();
    const subUse = new Map<string, number>();
    const keyUse = new Map<string, number>();
    for (const a of data.agents) {
      bump(modelUse, a.model);
      a.tool_ids.forEach((id) => bump(toolUse, id));
      a.rag_collection_ids.forEach((id) => bump(ragUse, id));
      a.subagent_ids.forEach((id) => bump(subUse, id));
    }
    const activeKeys = data.keys.filter((k) => !k.revoked);
    activeKeys.forEach((k) => bump(keyUse, k.agent_id));
    return {
      wfUse,
      activeKeys,
      unassigned: data.agents.filter((a) => !wfUse.has(a.id)).length,
      unusedModels: data.models.filter((m) => !modelUse.has(m.name)).length,
      unusedTools: data.tools.filter((t) => !toolUse.has(t.id)).length,
      unusedRags: data.rags.filter((r) => !ragUse.has(r.id)).length,
      unusedSubs: data.subs.filter((s) => !subUse.has(s.id)).length,
      evalAgents: new Set(data.evals.map((e) => e.agent_id)).size,
      localeAgents: new Set(data.locales.flatMap((l) => l.attached_to ?? [])).size,
      keyedAgents: keyUse.size,
      guardrailsOn: data.guardrails.filter((g) => g.enabled).length,
    };
  }, [data]);

  const go = (tab: TabId) => onOpenTab?.(tab);

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Workflow className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">How it fits together</h2>
        <span className="text-xs text-muted-foreground">
          Workflows and keys drive agents; agents draw on models, tools and knowledge. Click any row to manage it.
        </span>
      </div>
      <Card>
        <CardContent className="p-3">
          {!data || !view ? (
            <Skeleton className="h-[230px] rounded-lg" />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] xl:items-stretch">
                <Column icon={GitBranch} title="Triggers" tone="violet">
                  <Row label="Workflows" value={data.workflows.length} onClick={() => go("workflows")}
                    title="Workflows that run agents step by step" />
                  <Row label="API keys" value={view.activeKeys.length} onClick={() => go("settings")}
                    title="Keys that expose an agent to a website or partner" />
                  <Note>Workflows automate; keys expose a single agent.</Note>
                </Column>
                <Arrow />
                <Column icon={Bot} title="Agents" tone="sky">
                  <Row label="Agents" value={data.agents.length} onClick={() => go("agents")} />
                  <Row label="Not in a workflow" value={view.unassigned}
                    warn={view.unassigned ? "orphan" : undefined} onClick={() => go("agents")}
                    title="Agents no workflow step references" />
                  <Row label="Reachable by key" value={view.keyedAgents} onClick={() => go("settings")} />
                  <Note>The hub — everything else plugs into an agent.</Note>
                </Column>
                <Arrow />
                <Column icon={Wrench} title="Capabilities" tone="emerald">
                  <Row label="Models" value={data.models.length}
                    warn={view.unusedModels ? `${view.unusedModels} unused` : undefined} onClick={() => go("models")} />
                  <Row label="Tools" value={data.tools.length}
                    warn={view.unusedTools ? `${view.unusedTools} unused` : undefined} onClick={() => go("tools")} />
                  <Row label="Knowledge" value={data.rags.length}
                    warn={view.unusedRags ? `${view.unusedRags} unused` : undefined} onClick={() => go("knowledge")} />
                  <Row label="Subagents" value={data.subs.length}
                    warn={view.unusedSubs ? `${view.unusedSubs} unused` : undefined} onClick={() => go("subagents")} />
                  <Note>Amber counts are not attached to any agent.</Note>
                </Column>
                <Arrow />
                <Column icon={FlaskConical} title="Assurance" tone="amber">
                  <Row label="Eval datasets" value={data.evals.length} onClick={() => go("evals")} />
                  <Row label="Agents with evals" value={view.evalAgents} onClick={() => go("evals")} />
                  <Row label="Locale profiles" value={data.locales.length} onClick={() => go("locale")} />
                  <Row label="Guardrails on" value={view.guardrailsOn} onClick={() => go("guardrails")} />
                  <Note>Applied when publishing and at inference.</Note>
                </Column>
              </div>

              <div className="mt-3 overflow-x-auto rounded-xl border">
                <Table>
                  <THead>
                    <TR>
                      <TH>Agent</TH>
                      <TH>Model</TH>
                      <TH className="text-right">Tools</TH>
                      <TH className="text-right">Knowledge</TH>
                      <TH className="text-right">Subagents</TH>
                      <TH>Workflow</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.agents.slice(0, 6).map((a) => {
                      const wf = view.wfUse.get(a.id);
                      return (
                        <TR key={a.id} className="cursor-pointer" onClick={() => onOpenAgent ? onOpenAgent(a.id) : go("agents")}
                          title="Open this agent's wiring">
                          <TD className="text-xs font-medium">{agentRole(a.name)}</TD>
                          <TD className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{a.model}</TD>
                          <TD className="text-right tabular-nums">{a.tool_ids.length}</TD>
                          <TD className="text-right tabular-nums">{a.rag_collection_ids.length}</TD>
                          <TD className="text-right tabular-nums">{a.subagent_ids.length}</TD>
                          <TD className="text-xs">
                            {wf
                              ? wf.map((w) => w.name).join(", ")
                              : <span className="text-amber-600 dark:text-amber-400">not in a workflow</span>}
                          </TD>
                        </TR>
                      );
                    })}
                    {data.agents.length === 0 && (
                      <TR><TD colSpan={6} className="py-6 text-center text-xs text-muted-foreground">No agents yet — create one in Agents.</TD></TR>
                    )}
                  </TBody>
                </Table>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {data.agents.length > 6 ? `+${data.agents.length - 6} more agents. ` : ""}
                  Open an agent's <span className="font-medium text-foreground">Wiring</span> panel for the full picture.
                </span>
                <button
                  type="button"
                  onClick={() => go("agents")}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  Open Agents <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Arrow() {
  return (
    <div className="hidden shrink-0 items-center justify-center xl:flex" aria-hidden>
      <ArrowRight className="h-4 w-4 text-muted-foreground/40" />
    </div>
  );
}
