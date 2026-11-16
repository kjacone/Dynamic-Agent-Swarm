import { useState } from "react";
import { ArrowRight, BadgeCheck, Clock3, GitBranch, PlayCircle, Wrench } from "lucide-react";
import { WORKFLOW } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { DemoBadge, Mono, Panel, PanelHeader, SectionHeading } from "./ui";

const STATUS_LABEL: Record<string, { label: string; tone: "green" | "amber" | "neutral" }> = {
  waiting_approval: { label: "waiting approval", tone: "amber" },
  completed: { label: "completed", tone: "green" },
};

export function WorkflowsSection() {
  const [selectedId, setSelectedId] = useState(WORKFLOW.runs[0].id);
  const selected = WORKFLOW.runs.find((run) => run.id === selectedId) ?? WORKFLOW.runs[0];
  const allDone = selected.status === "completed";
  const waiting = !allDone;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Workflows"
          description="Regulated journeys run as versioned graphs. Each step records its actor, timing and output so you can replay a decision later."
        />
        <DemoBadge />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill tone="green">
          <GitBranch className="h-3 w-3" /> {WORKFLOW.name} · v{WORKFLOW.version} live
        </Pill>
        <Pill tone="neutral">6 steps</Pill>
        <Pill tone="neutral">2 completed runs today</Pill>
        <span className="ml-auto text-[10.5px] text-muted-foreground">Shadow replay keeps the same inputs against a new version.</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Recent runs" meta={<Mono>kyc_onboarding</Mono>} />
          <div className="divide-y divide-border/70">
            {WORKFLOW.runs.map((run) => {
              const meta = STATUS_LABEL[run.status] ?? { label: run.status, tone: "neutral" as const };
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  className={`flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors ${
                    run.id === selected.id ? "bg-[var(--site-accent)]/6" : "hover:bg-[var(--site-bg)]/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Mono>{run.id}</Mono>
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                  </div>
                  <p className="text-[12.5px] font-medium">{run.customer}</p>
                  <div className="flex flex-wrap items-center gap-x-3 text-[10.5px] text-muted-foreground">
                    <span>started {run.started}</span>
                    <span>{run.duration}</span>
                    <span className={run.risk >= 70 ? "text-red-700" : ""}>risk {run.risk}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title={`${selected.id} · pipeline`}
              meta={<Pill tone={waiting ? "amber" : "green"}>{waiting ? "paused for a human" : "closed"}</Pill>}
            />
            <ol className="px-4 py-4">
              {WORKFLOW.steps.map((step, index) => {
                const state = allDone ? "done" : step.state;
                return (
                  <li key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < WORKFLOW.steps.length - 1 ? (
                      <span
                        className={`absolute left-[11px] top-6 h-[calc(100%-12px)] w-px ${
                          state === "done" ? "bg-[var(--site-accent)]/30" : "bg-border"
                        }`}
                      />
                    ) : null}
                    <span
                      className={`relative z-10 mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border text-[9px] ${
                        state === "done"
                          ? "border-[var(--site-accent)] bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                          : state === "waiting"
                            ? "border-[var(--site-gold)] bg-[var(--site-gold)]/15 text-[#7a5b1c]"
                            : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {state === "done" ? <BadgeCheck className="h-3 w-3" /> : state === "waiting" ? <Clock3 className="h-3 w-3" /> : index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <p className="text-[12.5px] font-medium">{step.label}</p>
                        <span className="font-mono text-[10px] text-muted-foreground">{step.timing}</span>
                      </div>
                      <p className="text-[10.5px] text-muted-foreground">
                        {step.actor} · {step.kind}
                      </p>
                      {state === "waiting" ? (
                        <p className="mt-1 rounded-md border border-[var(--site-gold)]/35 bg-[var(--site-gold)]/8 px-2 py-1.5 text-[10.5px] leading-relaxed text-[#7a5b1c]">
                          Paused on approval APR-2041. The run resumes automatically once an operations reviewer decides.
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="p-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-[var(--site-accent)]" />
                <p className="text-[12px] font-semibold">Tools this run used</p>
              </div>
              <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                <li className="flex justify-between"><span>document.extract</span><span className="text-[var(--site-accent)]">ok</span></li>
                <li className="flex justify-between"><span>crm.read_customer</span><span className="text-[var(--site-accent)]">ok</span></li>
                <li className="flex justify-between"><span>erp.read_order</span><span className="text-[var(--site-accent)]">ok</span></li>
              </ul>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-[var(--site-accent)]" />
                <p className="text-[12px] font-semibold">Replay</p>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Re-run v{WORKFLOW.version} against v{WORKFLOW.version - 1} inputs without writing to the ERP.
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--site-accent)]">
                Shadow replay available <ArrowRight className="h-3 w-3" />
              </span>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
