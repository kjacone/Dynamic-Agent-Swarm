import { useState } from "react";
import { Check, Fingerprint, Link2, Loader2, ShieldCheck } from "lucide-react";
import { AUDIT_EVENTS } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { DemoBadge, Mono, Panel, PanelHeader, SectionHeading, Stat } from "./ui";

const CHAIN = [
  { seq: 1276, prev: "7c41…9ab2", hash: "d18e…40f1", label: "approval.approve" },
  { seq: 1277, prev: "d18e…40f1", hash: "9f2a…c41d", label: "chat.policy_block" },
  { seq: 1278, prev: "9f2a…c41d", hash: "b7d3…118a", label: "auth.demo_login" },
  { seq: 1279, prev: "b7d3…118a", hash: "e60c…7f52", label: "licence.plan_saved" },
];

export function AuditSection() {
  const [verifying, setVerifying] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState<string | null>("09:47");

  function verify() {
    setVerifying(true);
    window.setTimeout(() => {
      setVerifying(false);
      setVerifiedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 900);
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Audit trail"
          description="Every request, tool call, policy decision and configuration change lands in a hash-chained log with actor, tenant and trace id."
        />
        <DemoBadge />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Events (30 days)" value="1,284" hint="+214 this week" />
        <Stat label="Chain state" value="Verified" hint={`last check ${verifiedAt ?? "—"}`} />
        <Stat label="Policy blocks" value="37" hint="prompt injection: 21" />
        <Stat label="Broken links" value="0" hint="since tenant creation" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Recent events"
            meta={<Mono>tenant: default</Mono>}
            action={
              <button
                type="button"
                onClick={verify}
                disabled={verifying}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[10.5px] font-medium disabled:opacity-60"
              >
                {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                {verifying ? "Verifying…" : "Verify chain"}
              </button>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Seq</th>
                  <th className="px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">Actor</th>
                  <th className="px-2 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {AUDIT_EVENTS.map((event) => (
                  <tr key={event.seq} className="border-b border-border/50 text-[11px] last:border-0">
                    <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">#{event.seq}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">{event.time}</td>
                    <td className="px-2 py-2">{event.actor}</td>
                    <td className="px-2 py-2">
                      <span className="font-mono text-[10.5px]">{event.action}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{event.resource}</span>
                    </td>
                    <td className="px-4 py-2">
                      {event.outcome === "denied" ? <Pill tone="red">denied</Pill> : <Pill tone="green">success</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border/70 px-4 py-2.5 text-[10.5px] text-muted-foreground">
            Showing the latest 10 of 1,284 events. In the console you page, filter by actor or trace id, and export.
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="How the chain works" meta={<Mono>sha-256</Mono>} />
            <div className="px-4 py-3">
              {CHAIN.map((link, index) => (
                <div key={link.seq}>
                  <div className="rounded-lg border border-border/80 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">#{link.seq}</span>
                      <span className="font-mono text-[10.5px]">{link.hash}</span>
                    </div>
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{link.label}</p>
                    <div className="mt-1 flex items-center gap-1 font-mono text-[9.5px] text-muted-foreground/80">
                      <Link2 className="h-2.5 w-2.5" /> prev {link.prev}
                    </div>
                  </div>
                  {index < CHAIN.length - 1 ? <div className="ml-5 h-3 w-px bg-border" /> : null}
                </div>
              ))}
              <div className={`mt-3 flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[10.5px] ${verifiedAt ? "bg-[var(--site-accent)]/8 text-[var(--site-accent)]" : "bg-[var(--site-bg)] text-muted-foreground"}`}>
                {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {verifying ? "Recomputing hashes…" : "Each hash covers the previous hash and the event payload."}
              </div>
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-[var(--site-accent)]" />
              <p className="text-[12px] font-semibold">What is captured</p>
            </div>
            <ul className="mt-2 space-y-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
              <li>• Actor, tenant, role and trace id</li>
              <li>• Model, tool and workflow version</li>
              <li>• Policy decision and matching rule id</li>
              <li>• Approval decision, note and timestamp</li>
              <li>• No full customer document bodies</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
