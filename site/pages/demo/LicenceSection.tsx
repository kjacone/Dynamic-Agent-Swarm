import { useState } from "react";
import { ArrowUpRight, BadgeCheck, Banknote, Check, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import { FEATURES, LICENCE } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { DemoBadge, Mono, Panel, PanelHeader, SectionHeading } from "./ui";

type UpgradeRequest = (typeof LICENCE.upgradeRequests)[number];

export function LicenceSection() {
  const [requests, setRequests] = useState<UpgradeRequest[]>(LICENCE.upgradeRequests);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(LICENCE.upgradeRequests[0].features);
  const [message, setMessage] = useState(LICENCE.upgradeRequests[0].message);
  const [submitted, setSubmitted] = useState(false);

  const candidates = FEATURES.filter((feature) => !feature.always && !LICENCE.activeFeatures.includes(feature.id));

  function submit() {
    if (picked.length === 0) return;
    setRequests((current) => [
      {
        id: `UP-${1043 + current.length}`,
        from: LICENCE.edition,
        to: "Enterprise",
        features: picked,
        status: "requested",
        requestedBy: "you (demo session)",
        createdAt: "just now",
        message: message.trim() || "Upgrade requested from the product tour.",
      },
      ...current,
    ]);
    setOpen(false);
    setSubmitted(true);
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Licence & entitlements"
          description="What this tenant has paid for, which features are switched on, and the upgrade path. Display-only in the sandbox."
        />
        <DemoBadge />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <Panel className="overflow-hidden">
          <div className="deep-panel p-5 text-[#efe9d8]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#a6b5aa]">Current plan</p>
                <p className="font-display mt-1 text-[28px] leading-tight">{LICENCE.edition}</p>
                <p className="mt-1 text-[12px] text-[#c5d0c6]">
                  {LICENCE.customer} · {LICENCE.seats} seats · dedicated
                </p>
              </div>
              <Pill tone="gold">display-only</Pill>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 text-[11px]">
              <div>
                <p className="text-[#a6b5aa]">Seats assigned</p>
                <p className="mt-1 text-[15px] font-semibold">{LICENCE.seatsUsed} / {LICENCE.seats}</p>
              </div>
              <div>
                <p className="text-[#a6b5aa]">Renews</p>
                <p className="mt-1 text-[15px] font-semibold">30 Jun 2027</p>
              </div>
              <div>
                <p className="text-[#a6b5aa]">Enforcement</p>
                <p className="mt-1 text-[15px] font-semibold capitalize">{LICENCE.state}</p>
              </div>
              <div>
                <p className="text-[#a6b5aa]">Last change</p>
                <p className="mt-1 text-[12px] font-medium">{LICENCE.updatedAt}</p>
              </div>
            </div>
            <p className="mt-4 border-t border-white/10 pt-3 text-[10.5px] leading-relaxed text-[#a6b5aa]">{LICENCE.note}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--site-accent)] px-3.5 py-2 text-[11.5px] font-semibold text-[var(--site-on-accent)]"
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> Request upgrade
            </button>
            <span className="text-[10.5px] text-muted-foreground">
              Requests are reviewed by the account team. No entitlement changes in the demo.
            </span>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Feature entitlements" meta={<Mono>{LICENCE.activeFeatures.length} active</Mono>} />
          <div className="divide-y divide-border/60">
            {FEATURES.map((feature) => {
              const active = feature.always || LICENCE.activeFeatures.includes(feature.id);
              return (
                <div key={feature.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                      active ? "bg-[var(--site-accent)] text-[var(--site-on-accent)]" : "border border-border text-transparent"
                    }`}
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] font-medium ${active ? "" : "text-muted-foreground"}`}>{feature.label}</p>
                    <p className="text-[10.5px] leading-snug text-muted-foreground">{feature.detail}</p>
                  </div>
                  {feature.always ? (
                    <Pill tone="neutral">always</Pill>
                  ) : active ? (
                    <Pill tone="green">active</Pill>
                  ) : (
                    <Pill tone="neutral">locked</Pill>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader title="Upgrade requests" meta={<Mono>{requests.length} total</Mono>} />
          <div className="divide-y divide-border/70">
            {requests.map((request) => (
              <div key={request.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Mono>{request.id}</Mono>
                  <Pill tone="amber">{request.status}</Pill>
                </div>
                <p className="mt-1 text-[12.5px] font-medium">
                  {request.from} <span className="text-muted-foreground">→</span> {request.to}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{request.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {request.features.map((feature) => (
                    <span key={feature} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {feature}
                    </span>
                  ))}
                  <span className="ml-auto text-[10px] text-muted-foreground">{request.createdAt}</span>
                </div>
              </div>
            ))}
          </div>
          {submitted ? (
            <p className="flex items-start gap-1.5 border-t border-border/70 px-4 py-2.5 text-[10.5px] leading-relaxed text-[var(--site-accent)]">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Request captured in this browser tab. In a tenant it would notify the account team and appear in the audit trail.
            </p>
          ) : null}
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--site-accent)]" />
              <p className="text-[12px] font-semibold">Enforcement in the pilot</p>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              The plan above is display and request only. A signed Ed25519 licence still governs feature enforcement at
              runtime whenever enforcement is switched on — this sandbox has it off.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--site-bg)]/70 px-2.5 py-2 text-[10.5px] text-muted-foreground">
              <LockKeyhole className="h-3.5 w-3.5" /> Audit trail is always included, even on the smallest edition.
            </div>
          </Panel>
          <Panel className="p-4">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-[var(--site-accent)]" />
              <p className="text-[12px] font-semibold">Need Enterprise features?</p>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Workflows, connectors and compliance evidence are Enterprise entitlements in this demo. Request them above,
              or book a paid working session to scope the rollout.
            </p>
          </Panel>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--site-deep)]/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="upgrade-title" className="text-[16px] font-semibold">Request Enterprise upgrade</h2>
                <p className="mt-1 text-[11.5px] text-muted-foreground">Demo only — no contract or entitlement changes.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground">
                Close
              </button>
            </div>
            <fieldset className="mt-4">
              <legend className="text-[11px] font-medium">Features to enable</legend>
              <div className="mt-2 space-y-1.5">
                {candidates.map((feature) => {
                  const checked = picked.includes(feature.id);
                  return (
                    <label key={feature.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-2.5 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setPicked((current) =>
                            current.includes(feature.id) ? current.filter((id) => id !== feature.id) : [...current, feature.id],
                          )
                        }
                        className="mt-0.5 accent-[var(--site-accent)]"
                      />
                      <span>
                        <span className="block text-[12px] font-medium">{feature.label}</span>
                        <span className="block text-[10px] leading-snug text-muted-foreground">{feature.detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label htmlFor="upgrade-message" className="mt-3 block text-[11px] font-medium">
              Note for the account team
            </label>
            <textarea
              id="upgrade-message"
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="mt-1 w-full resize-none rounded-lg border border-border bg-[var(--site-bg)]/60 px-3 py-2 text-[12px] outline-none focus:border-[var(--site-accent)]/50"
            />
            <button
              type="button"
              onClick={submit}
              disabled={picked.length === 0}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--site-accent)] px-4 py-2.5 text-[12px] font-semibold text-[var(--site-on-accent)] disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> Send request
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
