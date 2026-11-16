import { useState } from "react";
import { ArrowDown, LockKeyhole, ShieldCheck, ShieldOff, Sparkles, TerminalSquare } from "lucide-react";
import { ATTACKS, GUARDRAILS, type DemoGuardrail } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { evaluateShield, type ShieldDirection, type ShieldVerdict } from "@/lib/shield";
import { DemoBadge, Mono, Panel, PanelHeader, SectionHeading } from "./ui";

export function GuardrailsSection() {
  const [guards, setGuards] = useState<DemoGuardrail[]>(GUARDRAILS);
  const [direction, setDirection] = useState<ShieldDirection>("input");
  const [text, setText] = useState<string>(ATTACKS[0].text);
  const [verdict, setVerdict] = useState<ShieldVerdict | null>(null);

  function test() {
    if (!text.trim()) return;
    setVerdict(evaluateShield(text, direction, guards));
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Guardrails"
          description="Tenant directives are injected into every agent's system prompt and re-checked on input, documents and tool results. Try an attack below."
        />
        <DemoBadge />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader
            title="Tenant directives"
            meta={<Mono>{guards.filter((g) => g.enabled).length} of {guards.length} enabled</Mono>}
          />
          <div className="divide-y divide-border/70">
            {guards.map((guard) => (
              <div key={guard.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12.5px] font-medium leading-snug">{guard.title}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{guard.instruction}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={guard.enabled}
                    aria-label={`${guard.enabled ? "Disable" : "Enable"} ${guard.title}`}
                    onClick={() =>
                      setGuards((current) =>
                        current.map((item) => (item.id === guard.id ? { ...item, enabled: !item.enabled } : item)),
                      )
                    }
                    className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
                      guard.enabled ? "bg-[var(--site-accent)]" : "bg-border"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        guard.enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Mono>{guard.phrases.length} watch phrases</Mono>
                  <Pill tone={guard.action === "block" ? "red" : "amber"}>{guard.action}</Pill>
                </div>
              </div>
            ))}
          </div>
          <p className="border-t border-border/70 px-4 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
            These match the five presets seeded in the console. Toggles are local to this tour.
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Prompt-injection lab"
              meta={<Pill tone="gold">try it</Pill>}
              action={
                <button type="button" onClick={test} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--site-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--site-on-accent)]">
                  <ShieldCheck className="h-3.5 w-3.5" /> Run shield
                </button>
              }
            />
            <div className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {ATTACKS.map((attack) => (
                  <button
                    key={attack.id}
                    type="button"
                    onClick={() => {
                      setText(attack.text);
                      setDirection(attack.direction as ShieldDirection);
                      setVerdict(null);
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[10.5px] transition-colors ${
                      text === attack.text
                        ? "border-[var(--site-accent)]/45 bg-[var(--site-accent)]/8 text-[var(--site-accent)]"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {attack.label}
                  </button>
                ))}
              </div>
              <label htmlFor="attack-text" className="sr-only">
                Content to screen
              </label>
              <textarea
                id="attack-text"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setVerdict(null);
                }}
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-[var(--site-bg)]/60 px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-[var(--site-accent)]/50"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] text-muted-foreground">Screened as</span>
                <select
                  value={direction}
                  onChange={(event) => {
                    setDirection(event.target.value as ShieldDirection);
                    setVerdict(null);
                  }}
                  className="rounded-md border border-border bg-card px-2 py-1 text-[11px] outline-none"
                >
                  <option value="input">Customer input</option>
                  <option value="document">Retrieved document</option>
                  <option value="tool_result">Tool result</option>
                </select>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ArrowDown className="h-3 w-3" /> every turn, before the model
                </span>
              </div>
            </div>
          </Panel>

          <Panel className={verdict ? "" : "opacity-95"}>
            <PanelHeader title="Shield verdict" meta={verdict ? <Mono>score {verdict.score.toFixed(2)}</Mono> : <Mono>idle</Mono>} />
            {verdict ? (
              <div className="px-4 py-3">
                <div
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                    verdict.action === "block"
                      ? "border-red-500/25 bg-red-500/6"
                      : verdict.action === "log"
                        ? "border-amber-500/30 bg-amber-500/8"
                        : "border-[var(--site-accent)]/25 bg-[var(--site-accent)]/6"
                  }`}
                >
                  {verdict.action === "allow" ? (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-accent)]" />
                  ) : (
                    <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <div>
                    <p className={`text-[12px] font-semibold ${verdict.action === "block" ? "text-red-700" : verdict.action === "log" ? "text-amber-700" : "text-[var(--site-accent)]"}`}>
                      {verdict.action === "block"
                        ? "Blocked before the model saw it"
                        : verdict.action === "log"
                          ? "Allowed but flagged to the audit trail"
                          : "No injection signal"}
                    </p>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                      {verdict.action === "block"
                        ? `Matched ${verdict.findings.length} rule${verdict.findings.length === 1 ? "" : "s"}. The turn is refused and the policy engine records the rule id.`
                        : verdict.action === "log"
                          ? "A log-only directive matched. The turn proceeds and the event is attached to the trace."
                          : `Checked against ${verdict.checked} enabled directives and the heuristic set. Nothing matched.`}
                    </p>
                  </div>
                </div>

                {verdict.findings.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {verdict.findings.map((finding) => (
                      <div key={`${finding.rule}-${finding.phrase}`} className="rounded-lg border border-border/80 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11.5px] font-medium">{finding.label}</p>
                          <span className="rounded-md bg-[var(--site-bg)] px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                            {finding.rule}
                          </span>
                        </div>
                        <p className="mt-1 truncate rounded bg-red-500/5 px-1.5 py-1 font-mono text-[10px] text-red-700">
                          “{finding.phrase}”
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <details className="mt-3 rounded-lg border border-border/80 bg-[var(--site-bg)]/50 px-3 py-2">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground">
                    <TerminalSquare className="h-3 w-3" /> Preview the system-prompt directives
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground">
{`SECURITY DIRECTIVES (tenant: default)
- ${guards.filter((g) => g.enabled).map((g) => g.title).join("\n- ")}`}
                  </pre>
                </details>
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <Sparkles className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-[12px] font-medium">Run the shield to see a verdict</p>
                <p className="mx-auto mt-1 max-w-xs text-[10.5px] leading-relaxed text-muted-foreground">
                  The same matcher sits on customer input, retrieved documents and tool results. Demo evaluation runs in your browser.
                </p>
              </div>
            )}
          </Panel>

          <div className="flex items-start gap-2 rounded-xl border border-border/80 bg-[var(--site-bg)]/50 px-3.5 py-3 text-[10.5px] leading-relaxed text-muted-foreground">
            <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Directives are defence in depth, not a sandbox. The model still only receives the tools the tenant has bound,
            and high-risk tool calls still need a human approval.
          </div>
        </div>
      </div>
    </div>
  );
}
