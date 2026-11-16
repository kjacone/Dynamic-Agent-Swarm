import { useState } from "react";
import { Check, Languages, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { LOCALES } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { DemoBadge, Mono, Panel, PanelHeader, SectionHeading, Stat } from "./ui";

const GLOSSARY: Record<string, [string, string][]> = {
  en: [
    ["refund", "refund"],
    ["duplicate charge", "duplicate charge"],
    ["working days", "working days"],
  ],
  sw: [
    ["refund", "kurejesha malipo"],
    ["duplicate charge", "malipo ya mara mbili"],
    ["working days", "siku za kazi"],
  ],
  fr: [
    ["refund", "remboursement"],
    ["duplicate charge", "débit en double"],
    ["working days", "jours ouvrés"],
  ],
};

export function LocaleSection() {
  const [active, setActive] = useState(LOCALES[1].id);
  const locale = LOCALES.find((item) => item.id === active) ?? LOCALES[0];
  const glossary = GLOSSARY[locale.id] ?? GLOSSARY.en;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Localisation"
          description="Locale packs set the language, formats, glossary and tone per market. The same agent answers in English, Kiswahili or French — with the same policy wording and the same audit trail."
        />
        <DemoBadge />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Locales live" value="3" hint="en · sw · fr" />
        <Stat label="Glossary terms" value="412" hint="reviewed by local editors" />
        <Stat label="Copy coverage" value="98%" hint="UI + agent replies" />
        <Stat label="Fallback" value="en" hint="on missing translation" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader
            title="Preview the same turn"
            meta={<Mono>thread:8c1f</Mono>}
            action={
              <div className="flex gap-1">
                {LOCALES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActive(item.id)}
                    className={`rounded-full px-2.5 py-1 text-[10.5px] transition-colors ${
                      active === item.id
                        ? "bg-[var(--site-accent)] font-semibold text-[var(--site-on-accent)]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            }
          />
          <div className="space-y-3 px-4 py-4">
            <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
              <Languages className="h-3.5 w-3.5" /> {locale.market}
            </p>
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-[var(--site-accent)] px-3.5 py-2 text-[12px] leading-relaxed text-[var(--site-on-accent)]">
              {locale.customer}
            </div>
            <div className="w-fit max-w-[95%] rounded-2xl rounded-tl-sm border border-border bg-[var(--site-bg)]/60 px-3.5 py-2 text-[12px] leading-relaxed">
              {locale.reply}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Date", locale.formatted.date],
                ["Amount", locale.formatted.amount],
                ["Phone", locale.formatted.phone],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border/80 px-2.5 py-2">
                  <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                  <p className="mt-0.5 font-mono text-[10.5px]">{value}</p>
                </div>
              ))}
            </div>
            <p className="flex items-start gap-2 rounded-lg border border-[var(--site-accent)]/20 bg-[var(--site-accent)]/5 px-3 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--site-accent)]" />
              {locale.note}
            </p>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Locale packs" meta={<Pill tone="green">sw-TZ live</Pill>} />
            <div className="divide-y divide-border/70">
              {[
                { code: "sw-TZ", name: "Kiswahili · Tanzania", version: "v4", reviewer: "Local editor · reviewed 12 Nov", status: "live" },
                { code: "en-TZ", name: "English · Tanzania", version: "v6", reviewer: "Base pack", status: "live" },
                { code: "fr-XX", name: "Français · regional", version: "v2", reviewer: "Imported from marketplace", status: "live" },
                { code: "lg-UG", name: "Luganda · Uganda", version: "v1", reviewer: "Pending review", status: "draft" },
              ].map((pack) => (
                <div key={pack.code} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--site-accent)]/8 font-mono text-[9px] font-semibold text-[var(--site-accent)]">
                    {pack.code.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-medium">{pack.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {pack.version} · {pack.reviewer}
                    </p>
                  </div>
                  <Pill tone={pack.status === "live" ? "green" : "amber"}>{pack.status}</Pill>
                </div>
              ))}
            </div>
            <p className="border-t border-border/70 px-4 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              Publishing a pack is an audited change. The console records the reviewer, diff and effective locale.
            </p>
          </Panel>

          <Panel>
            <PanelHeader title="Glossary" meta={<Mono>{locale.label}</Mono>} />
            <div className="px-4 py-3">
              <div className="divide-y divide-border/50">
                {glossary.map(([term, value]) => (
                  <div key={term} className="flex items-center justify-between py-2 text-[11.5px]">
                    <span className="text-muted-foreground">{term}</span>
                    <span className="font-medium">{value}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 flex items-start gap-2 text-[10.5px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Policy clauses are never machine-translated without review; a missing term falls back to the approved
                English wording.
              </p>
            </div>
          </Panel>

          <div className="rounded-xl border border-border/80 bg-[var(--site-bg)]/50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium">
              <MessageSquareText className="h-3.5 w-3.5 text-[var(--site-accent)]" /> Same answer on every channel
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
              Web, WhatsApp and SMS share the locale, glossary and guardrail verdicts. Switching channels never resets
              the conversation or the trace.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-[var(--site-accent)]/25 bg-[var(--site-accent)]/5 px-4 py-2.5 text-[10.5px] text-[var(--site-accent)]">
            <Check className="h-3.5 w-3.5" /> The full 412-term glossary lives in the console.
          </div>
        </div>
      </div>
    </div>
  );
}
