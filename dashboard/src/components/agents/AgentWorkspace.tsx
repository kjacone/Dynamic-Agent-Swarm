import {
  ArrowUpRight, Bot, Boxes, Cpu, FileText, FlaskConical, GitBranch, KeyRound, Languages, Layers, Pencil, Play, Wrench,
} from "lucide-react";

import type { Agent, ApiKey, EvalDataset, LocaleProfileRow, ModelCfg, Rag, SubAgent, Tool } from "@/lib/api";
import type { TabId } from "@/components/layout/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type AgentWorkflowUse = { key: string; name: string; steps: string[] };

const TONES: Record<string, string> = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function ConnectCard({
  icon: Icon, title, tone, meta, action, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone: keyof typeof TONES;
  meta?: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", TONES[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-xs font-medium">{title}</span>
        {meta != null && <Badge variant="secondary" className="ml-auto shrink-0 text-[10px] tabular-nums">{meta}</Badge>}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground",
              meta == null && "ml-auto",
            )}
          >
            {action.label} <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="mt-2 min-w-0 text-[11px] leading-snug text-muted-foreground">{children}</div>
    </div>
  );
}

function ItemRow({ name, detail, warn }: { name: string; detail?: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-md bg-background/60 px-1.5 py-0.5">
      <span className={cn("truncate", warn && "text-amber-600 dark:text-amber-400")}>{name}</span>
      {detail && <span className="shrink-0 tabular-nums text-muted-foreground">{detail}</span>}
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-md border border-dashed px-2 py-1.5 text-muted-foreground">{children}</p>
);

export function AgentWorkspace({
  agent, models, tools, rags, subs, workflows, keys, evals, locales,
  onClose, onEdit, onTest, onOpenTab,
}: {
  agent: Agent;
  models: ModelCfg[];
  tools: Tool[];
  rags: Rag[];
  subs: SubAgent[];
  workflows: AgentWorkflowUse[];
  keys: ApiKey[];
  evals: EvalDataset[];
  locales: LocaleProfileRow[];
  onClose: () => void;
  onEdit: () => void;
  onTest?: () => void;
  onOpenTab?: (tab: TabId) => void;
}) {
  const model = models.find((m) => m.name === agent.model);
  const modelProvider = model?.provider ?? (agent.model.includes(":") ? agent.model.split(":")[0] : undefined);
  const agentTools = agent.tool_ids.map((id) => tools.find((t) => t.id === id)).filter((t): t is Tool => !!t);
  const collections = agent.rag_collection_ids.map((id) => rags.find((r) => r.id === id)).filter((r): r is Rag => !!r);
  const delegates = agent.subagent_ids.map((id) => subs.find((s) => s.id === id)).filter((s): s is SubAgent => !!s);
  const agentKeys = keys.filter((k) => k.agent_id === agent.id);
  const agentEvals = evals.filter((e) => e.agent_id === agent.id);
  const agentLocales = locales.filter((l) => (l.attached_to ?? []).includes(agent.id));
  const promptTokens = Math.ceil((agent.system_prompt?.length ?? 0) / 4);

  const open = (tab: TabId) => {
    onClose();
    onOpenTab?.(tab);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
              <Bot className="h-4 w-4" />
            </span>
            <span className="truncate">{agent.name}</span>
            <Badge variant="outline" className="font-mono text-[10px]">{agent.tenant_id}</Badge>
          </DialogTitle>
          <DialogDescription>
            Everything in this panel is wired into this agent. A request enters from a workflow or an API key,
            runs through the model with these tools and collections, and is measured by these evals.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-3 overflow-auto pr-1">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ConnectCard icon={Cpu} tone="amber" title="Model"
              meta={modelProvider}
              action={{ label: "Models", onClick: () => open("models") }}>
              {model ? (
                <div className="space-y-0.5">
                  <div className="truncate font-mono text-[11px] text-foreground">{model.provider} · {model.model_name}</div>
                  {model.base_url && <div className="truncate">endpoint {model.base_url}</div>}
                  {model.api_key_env && <div>key from {model.api_key_env}</div>}
                </div>
              ) : (
                <div className="truncate font-mono text-foreground">{agent.model || "No model selected"}</div>
              )}
            </ConnectCard>

            <ConnectCard icon={FileText} tone="slate" title="System prompt"
              meta={agent.system_prompt ? `~${promptTokens} tok` : undefined}
              action={{ label: "Edit", onClick: () => { onClose(); onEdit(); } }}>
              {agent.system_prompt
                ? <p className="line-clamp-4 whitespace-pre-wrap text-foreground/80">{agent.system_prompt}</p>
                : <Empty>No system prompt — the model runs with its default behaviour.</Empty>}
            </ConnectCard>

            <ConnectCard icon={Wrench} tone="sky" title="Tools" meta={String(agentTools.length)}
              action={{ label: "Tools", onClick: () => open("tools") }}>
              {agentTools.length ? (
                <div className="space-y-0.5">
                  {agentTools.slice(0, 4).map((t) => <ItemRow key={t.id} name={t.name} detail={t.type} />)}
                  {agentTools.length > 4 && <div className="px-1.5 text-[10px]">+{agentTools.length - 4} more</div>}
                </div>
              ) : <Empty>No tools — the agent answers from the prompt and knowledge only.</Empty>}
            </ConnectCard>

            <ConnectCard icon={Layers} tone="emerald" title="Knowledge" meta={String(collections.length)}
              action={{ label: "Knowledge", onClick: () => open("knowledge") }}>
              {collections.length ? (
                <div className="space-y-0.5">
                  {collections.slice(0, 4).map((r) => <ItemRow key={r.id} name={r.name} detail={r.status} />)}
                  {collections.length > 4 && <div className="px-1.5 text-[10px]">+{collections.length - 4} more</div>}
                </div>
              ) : <Empty>Answers are not grounded in a collection — enable one for factual replies.</Empty>}
            </ConnectCard>

            <ConnectCard icon={Boxes} tone="violet" title="Subagents" meta={String(delegates.length)}
              action={{ label: "Subagents", onClick: () => open("subagents") }}>
              {delegates.length ? (
                <div className="space-y-0.5">
                  {delegates.slice(0, 4).map((s) => <ItemRow key={s.id} name={s.name} detail={s.mode} />)}
                  {delegates.length > 4 && <div className="px-1.5 text-[10px]">+{delegates.length - 4} more</div>}
                </div>
              ) : <Empty>No delegation — this agent handles every step itself.</Empty>}
            </ConnectCard>

            <ConnectCard icon={GitBranch} tone="violet" title="Used by workflows" meta={String(workflows.length)}
              action={{ label: "Workflows", onClick: () => open("workflows") }}>
              {workflows.length ? (
                <div className="space-y-0.5">
                  {workflows.map((w) => <ItemRow key={w.key} name={w.name} detail={w.steps.join(", ")} />)}
                </div>
              ) : (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-amber-700 dark:text-amber-400">
                  Not referenced by a workflow step — reachable only through an API key, a direct call or the test bench.
                </p>
              )}
            </ConnectCard>

            <ConnectCard icon={KeyRound} tone="rose" title="Public channels" meta={String(agentKeys.length)}
              action={{ label: "Settings", onClick: () => open("settings") }}>
              {agentKeys.length ? (
                <div className="space-y-0.5">
                  {agentKeys.map((k) => (
                    <ItemRow key={k.id} name={k.name} detail={k.revoked ? "revoked" : `${k.prefix}…`} warn={k.revoked} />
                  ))}
                </div>
              ) : <Empty>No API key — no website or partner can call this agent yet.</Empty>}
            </ConnectCard>

            <ConnectCard icon={FlaskConical} tone="amber" title="Evaluations" meta={String(agentEvals.length)}
              action={{ label: "Evaluations", onClick: () => open("evals") }}>
              {agentEvals.length ? (
                <div className="space-y-0.5">
                  {agentEvals.map((e) => <ItemRow key={e.id} name={e.name} detail={`${e.cases} cases`} />)}
                </div>
              ) : <Empty>No eval dataset — publish gates cannot score this agent.</Empty>}
            </ConnectCard>

            <ConnectCard icon={Languages} tone="sky" title="Locale profiles" meta={String(agentLocales.length)}
              action={{ label: "Locale", onClick: () => open("locale") }}>
              {agentLocales.length ? (
                <div className="space-y-0.5">
                  {agentLocales.map((l) => <ItemRow key={l.id} name={l.name} detail={l.locale_code} />)}
                </div>
              ) : <Empty>Uses the default language and formatting.</Empty>}
            </ConnectCard>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); onEdit(); }}>
            <Pencil className="h-3.5 w-3.5" /> Edit agent
          </Button>
          {onTest && (
            <Button variant="outline" onClick={() => { onClose(); onTest(); }}>
              <Play className="h-3.5 w-3.5" /> Test on bench
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
