import { useState } from "react";
import { ArrowUpRight, Boxes, Check, GitBranch, Users } from "lucide-react";
import { PACKS, type DemoPack } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { navigate } from "@/lib/nav";
import { DemoBadge, Mono, Panel, SectionHeading } from "./ui";

export function MarketplaceSection() {
  const [industry, setIndustry] = useState("All");
  const [selected, setSelected] = useState<DemoPack | null>(null);
  const industries = ["All", ...Array.from(new Set(PACKS.map((pack) => pack.industry)))];
  const visible = industry === "All" ? PACKS : PACKS.filter((pack) => pack.industry === industry);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Solutions marketplace"
          description="Industry packs bundle agents, workflows and policy presets. Installing a pack in a real tenant is audited and reversible."
        />
        <DemoBadge />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {industries.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setIndustry(value)}
            className={`rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
              industry === value
                ? "border-[var(--site-accent)]/45 bg-[var(--site-accent)]/8 font-medium text-[var(--site-accent)]"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((pack) => (
          <Panel key={pack.id} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--site-accent)]/8 text-[var(--site-accent)]">
                <Boxes className="h-4 w-4" strokeWidth={1.7} />
              </span>
              {pack.installed ? <Pill tone="green"><Check className="h-3 w-3" /> installed</Pill> : <Pill tone="neutral">{pack.industry}</Pill>}
            </div>
            <p className="mt-3 text-[13px] font-semibold leading-snug">{pack.name}</p>
            <p className="mt-1 line-clamp-3 flex-1 text-[11px] leading-relaxed text-muted-foreground">{pack.summary}</p>
            <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {pack.agents} agents</span>
              <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" /> {pack.workflows} workflow{pack.workflows === 1 ? "" : "s"}</span>
              <Mono>v{pack.version}</Mono>
            </div>
            <button
              type="button"
              onClick={() => setSelected(pack)}
              className="mt-3 inline-flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:border-[var(--site-accent)]/40"
            >
              View pack <ArrowUpRight className="h-3 w-3" />
            </button>
          </Panel>
        ))}
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--site-deep)]/45 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pack-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Pill tone="neutral">{selected.industry}</Pill>
                  <Mono>v{selected.version}</Mono>
                  {selected.installed ? <Pill tone="green">installed</Pill> : null}
                </div>
                <h2 id="pack-title" className="mt-2 text-[17px] font-semibold">{selected.name}</h2>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{selected.summary}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground">
                Close
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-muted-foreground">Included agents</p>
                <p className="mt-0.5 font-medium">{selected.agents} specialist agents</p>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-muted-foreground">Workflow graphs</p>
                <p className="mt-0.5 font-medium">{selected.workflows || "None"}</p>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              {selected.installed
                ? "This pack is installed in the sandbox tenant, which is why its agents and approval rules appear across the tour."
                : "Not installed in the tour workspace. Pack installation is scoped in a paid consultation and runs against your tenant, with rollback."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  navigate("/book/");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--site-accent)] px-3.5 py-2 text-[11.5px] font-semibold text-[var(--site-on-accent)]"
              >
                Scope this pack in a paid session <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border border-border px-3.5 py-2 text-[11.5px] font-medium"
              >
                Back to packs
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
