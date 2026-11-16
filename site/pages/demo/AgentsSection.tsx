import { Bot, Cpu, PauseCircle, PlayCircle } from "lucide-react";
import { AGENTS, REGISTRY } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { DemoBadge, Mono, Panel, SectionHeading, Stat } from "./ui";

export function AgentsSection() {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Agents"
          description="Each tenant agent owns a model route, a tool set and a roster of specialists. The supervisor delegates; the specialists act."
        />
        <DemoBadge />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Agents" value={REGISTRY.agents} hint="2 paused" />
        <Stat label="Specialists" value={REGISTRY.specialists} hint="delegated" />
        <Stat label="Bound tools" value={REGISTRY.tools} hint="scoped per agent" />
        <Stat label="Model routes" value={REGISTRY.models} hint="swap per agent" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {AGENTS.map((agent) => (
          <Panel key={agent.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--site-accent)]/8 text-[var(--site-accent)]">
                  <Bot className="h-4 w-4" strokeWidth={1.7} />
                </span>
                <div>
                  <p className="text-[13px] font-semibold leading-tight">{agent.name}</p>
                  <p className="text-[10.5px] text-muted-foreground">{agent.pack}</p>
                </div>
              </div>
              {agent.status === "active" ? (
                <Pill tone="green"><PlayCircle className="h-3 w-3" /> active</Pill>
              ) : (
                <Pill tone="neutral"><PauseCircle className="h-3 w-3" /> paused</Pill>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[10.5px]">
              <div>
                <p className="text-muted-foreground">Tools</p>
                <p className="mt-0.5 font-medium">{agent.tools} bound</p>
              </div>
              <div>
                <p className="text-muted-foreground">Specialists</p>
                <p className="mt-0.5 font-medium">{agent.specialists}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Last run</p>
                <p className="mt-0.5 font-medium">{agent.lastRun}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-[var(--site-bg)]/70 px-2.5 py-1.5">
              <Cpu className="h-3 w-3 text-muted-foreground" />
              <Mono>{agent.model}</Mono>
            </div>
          </Panel>
        ))}
      </div>

      <p className="mt-4 rounded-xl border border-border/80 bg-[var(--site-bg)]/50 px-4 py-3 text-[10.5px] leading-relaxed text-muted-foreground">
        Model providers are routed per agent. The sandbox uses a sample model for the marketplace concierge and hosted
        open models elsewhere — no provider keys are exposed to the browser.
      </p>
    </div>
  );
}
