import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  Fingerprint,
  GitBranch,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AUDIT_EVENTS, FEATURES, GUARDRAILS, LICENCE, REGISTRY } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import type { DemoTab } from "./DemoConsole";
import { DemoBadge, Mono, Panel, PanelHeader, SectionHeading, Stat } from "./ui";

const POSTURE = [
  { icon: ShieldCheck, label: "Guardrails armed", value: `${GUARDRAILS.filter((g) => g.enabled).length} directives`, note: "Prompt-injection shield" },
  { icon: BadgeCheck, label: "Approval gate", value: "High-risk steps", note: "Human decision required" },
  { icon: Fingerprint, label: "Audit chain", value: "Verified", note: "No broken hashes" },
  { icon: GitBranch, label: "Workflow version", value: "v3 live", note: "Shadow replay available" },
];

export function OverviewSection({ onNavigate }: { onNavigate: (tab: DemoTab) => void }) {
  const pending = 3;
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Workspace overview"
          description="A sandbox workspace for a multi-market retailer: licence, agents, workflows and approvals in one place."
        />
        <DemoBadge />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <div className="deep-panel relative overflow-hidden rounded-xl p-5 text-[#efe9d8] sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[var(--site-gold)]/10 blur-2xl" />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#a6b5aa]">Active licence</p>
              <p className="font-display mt-1 text-[26px] leading-tight">{LICENCE.customer}</p>
              <p className="mt-1 text-[12px] text-[#c5d0c6]">
                {LICENCE.edition} · {LICENCE.deployment} deployment
              </p>
            </div>
            <span className="rounded-full border border-[var(--site-gold)]/45 bg-[var(--site-gold)]/15 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#e8d5a2]">
              {LICENCE.state}
            </span>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#a6b5aa]">Features</p>
              <p className="mt-1 text-[22px] font-semibold">
                {LICENCE.activeFeatures.length}
                <span className="text-[12px] font-normal text-[#a6b5aa]"> / {FEATURES.length}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#a6b5aa]">Seats</p>
              <p className="mt-1 text-[22px] font-semibold">
                {LICENCE.seatsUsed}
                <span className="text-[12px] font-normal text-[#a6b5aa]"> / {LICENCE.seats}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#a6b5aa]">Renews</p>
              <p className="mt-1 text-[15px] font-semibold leading-8">30 Jun 2027</p>
            </div>
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/12">
            <div className="h-full rounded-full bg-[var(--site-gold)]" style={{ width: `${(LICENCE.seatsUsed / LICENCE.seats) * 100}%` }} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#a6b5aa]">{LICENCE.note}</p>
          <button
            type="button"
            onClick={() => onNavigate("licence")}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1.5 text-[11px] font-medium text-[#efe9d8] transition-colors hover:border-[var(--site-gold)]/60"
          >
            Manage licence <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <Panel>
          <PanelHeader title="Runtime posture" meta={null} />
          <div className="divide-y divide-border/70">
            {POSTURE.map(({ icon: Icon, label, value, note }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--site-accent)]/8 text-[var(--site-accent)]">
                  <Icon className="h-4 w-4" strokeWidth={1.7} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium">{label}</p>
                  <p className="text-[10.5px] text-muted-foreground">{note}</p>
                </div>
                <span className="text-[11px] font-medium text-[var(--site-accent)]">{value}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Agents" value={REGISTRY.agents} hint="2 paused" />
        <Stat label="Specialists" value={REGISTRY.specialists} hint="across 3 packs" />
        <Stat label="Tools" value={REGISTRY.tools} hint="17 bound" />
        <Stat label="Packs" value={REGISTRY.packs} hint="2 installed" />
        <Stat label="Models" value={REGISTRY.models} hint="routed per agent" />
        <Stat label="Approvals" value={pending} hint="need a decision" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <Panel>
          <PanelHeader
            title="Waiting on a human"
            meta={<Pill tone="amber">{pending} open</Pill>}
            action={
              <button
                type="button"
                onClick={() => onNavigate("approvals")}
                className="text-[11px] font-medium text-[var(--site-accent)] hover:underline"
              >
                Open queue
              </button>
            }
          />
          <div className="divide-y divide-border/70">
            {[
              { title: "Manual onboarding review — business account", meta: "APR-2041 · onboarding · due in 3h", tone: "high" },
              { title: "Refund above limit — TZS 1,250,000", meta: "APR-2040 · escalated · overdue 2h", tone: "late" },
              { title: "Payout to new vendor — connector offline", meta: "APR-2039 · finance · due today", tone: "std" },
            ].map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => onNavigate("approvals")}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--site-bg)]/60"
              >
                <div>
                  <p className="text-[12.5px] font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[10.5px] text-muted-foreground">{item.meta}</p>
                </div>
                {item.tone === "high" ? (
                  <Pill tone="red">high risk</Pill>
                ) : item.tone === "late" ? (
                  <Pill tone="amber">overdue</Pill>
                ) : (
                  <Pill tone="neutral">review</Pill>
                )}
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Latest audit events"
            action={<Mono>chain verified</Mono>}
          />
          <div className="px-4 py-2">
            {AUDIT_EVENTS.slice(0, 5).map((event) => (
              <div key={event.seq} className="flex items-start gap-2.5 border-b border-border/50 py-2 last:border-0">
                <ScrollText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px]">
                    <span className="font-medium">{event.action}</span>
                    <span className="text-muted-foreground"> · {event.resource}</span>
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {event.actor} · {event.time} · #{event.seq}
                  </p>
                </div>
                {event.outcome === "denied" ? <Pill tone="red">denied</Pill> : null}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onNavigate("audit")}
            className="flex w-full items-center justify-between border-t border-border/70 px-4 py-2.5 text-left text-[11px] font-medium text-[var(--site-accent)]"
          >
            View the full trail <ArrowRight className="h-3 w-3" />
          </button>
        </Panel>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border/80 bg-[var(--site-bg)]/60 px-4 py-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> 27 of 40 seats assigned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" /> Demo session resets when you leave
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> 5 tenant directives applied to every agent
        </span>
      </div>
    </div>
  );
}
