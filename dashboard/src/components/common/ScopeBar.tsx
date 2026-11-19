import { useEffect, useState } from "react";
import { Bot, GitBranch, Network, Workflow } from "lucide-react";

import { api, type Agent, type WfSummary } from "@/lib/api";
import type { TabId } from "@/components/layout/nav";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function ChipLink({ icon: Icon, onClick, children, title }: {
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
        onClick ? "cursor-pointer hover:border-primary/40 hover:bg-primary/5" : "cursor-default text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" /> {children}
    </button>
  );
}

/** Compact strip showing which agents and workflows a control applies to, with drill-down links. */
export function ScopeBar({ tenant, title, note, onOpenTab }: {
  tenant: string;
  title: string;
  note: string;
  onOpenTab?: (tab: TabId) => void;
}) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [workflows, setWorkflows] = useState<WfSummary[] | null>(null);

  useEffect(() => {
    let live = true;
    Promise.allSettled([api.listAgents(tenant), api.listWorkflows()]).then(([a, w]) => {
      if (!live) return;
      setAgents(a.status === "fulfilled" ? a.value : []);
      setWorkflows(w.status === "fulfilled" ? w.value : []);
    });
    return () => { live = false; };
  }, [tenant]);

  const shown = (workflows ?? []).slice(0, 3);

  return (
    <Card className="mb-4">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Network className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">{note}</div>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:pl-12">
          <ChipLink icon={Bot} onClick={() => onOpenTab?.("agents")} title="Open Agents">
            {agents ? agents.length : "…"} agents
          </ChipLink>
          {shown.map((w) => (
            <ChipLink key={w.key} icon={GitBranch} onClick={() => onOpenTab?.("workflows")} title="Open Workflows">
              {w.name || w.key}
            </ChipLink>
          ))}
          {workflows && workflows.length > shown.length && (
            <ChipLink icon={GitBranch} onClick={() => onOpenTab?.("workflows")} title="Open Workflows">
              +{workflows.length - shown.length} more
            </ChipLink>
          )}
          {workflows && workflows.length === 0 && <ChipLink icon={GitBranch}>no workflows</ChipLink>}
          <ChipLink icon={Workflow} onClick={() => onOpenTab?.("overview")} title="Open the wiring map">
            Wiring map
          </ChipLink>
        </div>
      </CardContent>
    </Card>
  );
}
