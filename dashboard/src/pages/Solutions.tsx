import { useEffect, useMemo, useState } from "react";
import { api, can, type Me, type Pack } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";

const INDUSTRY: Record<string, string> = { banking: "Banking", insurance: "Insurance", telecom: "Telecoms", government: "Government",
  healthcare: "Healthcare", ngo: "NGOs", corporate: "Corporate", education: "Education" };
const DELIVERY: Record<string, { label: string; tone: "gray" | "blue" | "green"; hint: string }> = {
  workflow: { label: "Backend workflow", tone: "gray" as const, hint: "Runs behind the scenes: documents, approvals, system integrations" },
  agent_kit: { label: "Agent-kit widget", tone: "blue" as const, hint: "A chat assistant embedded in your website or app" },
  both: { label: "Widget + workflow", tone: "green" as const, hint: "Customer-facing assistant plus back-office process" },
};

export function Solutions({ me }: { me: Me | null }) {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [industry, setIndustry] = useState<string>("all");
  const [delivery, setDelivery] = useState<string>("all");
  const [open, setOpen] = useState<Pack | null>(null);
  const [installing, setInstalling] = useState<Pack | null>(null);
  const [done, setDone] = useState<{ pack: Pack; res: Awaited<ReturnType<typeof api.installPack>> } | null>(null);
  const toast = useToast();

  const load = () => api.listPacks().then(setPacks).catch((e) => { toast.push(e.message, "error"); setPacks([]); });
  useEffect(() => { load(); }, []);

  const industries = useMemo(() => {
    const m = new Map<string, number>();
    (packs || []).forEach((p) => m.set(p.industry, (m.get(p.industry) ?? 0) + 1));
    return [...m.entries()];
  }, [packs]);

  const shown = (packs || []).filter((p) =>
    (industry === "all" || p.industry === industry) &&
    (delivery === "all" || p.delivery === delivery ||
      (delivery !== "workflow" && p.delivery === "both") ||
      (delivery === "workflow" && p.delivery === "both")));

  const launch = shown.filter((p) => p.priority === "first");
  const next = shown.filter((p) => p.priority === "later");
  const rest = shown.filter((p) => p.priority !== "first" && p.priority !== "later");

  return (
    <div>
      <PageHeader title="Industry solutions" description="Agents, workflows, knowledge, sample data and evaluations per industry. Install, try a sample case, connect your systems, go live." />
      {packs === null ? (
        <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div>
      ) : packs.length === 0 ? (
        <EmptyState title="No solutions available" />
      ) : (
        <div className="grid gap-6 md:grid-cols-[200px,1fr]">
          <nav className="space-y-1">
            <Rail active={industry === "all"} onClick={() => setIndustry("all")} label="All industries" n={packs.length} />
            {industries.map(([k, n]) => <Rail key={k} active={industry === k} onClick={() => setIndustry(k)} label={INDUSTRY[k] ?? k} n={n} />)}
            <div className="px-3 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery</div>
            {(["all", "workflow", "agent_kit"] as const).map((d) => (
              <Rail key={d} active={delivery === d} onClick={() => setDelivery(d)} label={d === "all" ? "Any" : DELIVERY[d].label} />))}
          </nav>
          <div>
            {shown.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nothing matches these filters.</div>
            ) : (
              ([
                ["first", "Launch solutions", launch],
                ["later", "Next wave", next],
                ["rest", "", rest],
              ] as const).map(([k, title, list]) => list.length > 0 && (
                <section key={k} className="mb-8">
                  {title && <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>}
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {list.map((p) => <PackCard key={p.id} p={p} onOpen={() => setOpen(p)} />)}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      )}

      {open && (
        <Detail
          pack={open}
          me={me}
          onClose={() => setOpen(null)}
          onInstall={() => { setInstalling(open); setOpen(null); }}
        />
      )}

      {installing && (
        <InstallDialog
          pack={installing}
          onClose={(res) => {
            if (res) { setDone({ pack: installing, res }); load(); }
            setInstalling(null);
          }}
        />
      )}

      {done && (
        <Dialog open onOpenChange={(v) => !v && setDone(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{done.pack.name} is ready</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div>Created <b>{Object.keys(done.res.created.agents).length}</b> agents and <b>{done.res.created.workflows.length}</b> workflow(s): {done.res.created.workflows.map((w) => <Chip key={w.key}>{w.key} v{w.version}</Chip>)}</div>
              {done.res.created.connectors.length > 0 && <div>Connector templates added <b>(disabled)</b>: {done.res.created.connectors.map((c) => <Chip key={c}>{c}</Chip>)}</div>}
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Add endpoints and secret references (<code>env:NAME</code>) for each connector, then enable it.</li>
                <li>Assign named users the roles the workflow needs (e.g. approvers) in your identity provider.</li>
                <li>Run the pack’s evaluation dataset, then start a test workflow run.</li>
              </ol>
            </div>
            <DialogFooter><Button onClick={() => setDone(null)}>Done</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

const Rail = ({ active, onClick, label, n }: { active: boolean; onClick: () => void; label: string; n?: number }) => (
  <button onClick={onClick} className={`flex w-full justify-between rounded-md px-3 py-1.5 text-sm ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>
    <span>{label}</span>{n !== undefined && <span className="text-xs">{n}</span>}</button>);

function PackCard({ p, onOpen }: { p: Pack; onOpen: () => void }) {
  const d = DELIVERY[p.delivery];
  const a = p.assets;
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onOpen}>
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-muted-foreground">{INDUSTRY[p.industry] ?? p.industry} · v{p.version}</div>
          </div>
          {p.installed
            ? <StatusBadge value="installed" label={`installed v${p.installed_version}`} />
            : !p.entitled && <StatusBadge value="warn" label="not in licence" />}
        </div>
        <div title={d.hint}><StatusBadge value={p.delivery} label={d.label} tone={d.tone} /></div>
        <p className="text-sm">{p.summary}</p>
        <div className="flex flex-wrap gap-1 text-[11px]">
          <Chip>{a.agents + (a.supervisor ? 1 : 0)} agents</Chip><Chip>{a.workflows} workflows</Chip>
          {a.knowledge_docs > 0 && <Chip>{a.knowledge_docs} KB docs</Chip>}
          {a.training_rows > 0 && <Chip>{a.training_rows} training rows</Chip>}
          {a.eval_cases > 0 && <Chip>{a.eval_cases} eval cases</Chip>}
          {a.samples > 0 && <Chip>{a.samples} sample cases</Chip>}
        </div>
        {p.kpis.length > 0 && <div className="text-xs text-muted-foreground">KPIs: {p.kpis.slice(0, 2).map((x) => x.replace(/_/g, " ")).join(", ")}</div>}
        <div className="mt-auto flex flex-wrap gap-1">{p.frameworks.slice(0, 3).map((f) => <Chip key={f}>{f}</Chip>)}</div>
      </CardContent>
    </Card>
  );
}

function Detail({ pack: p, me, onClose, onInstall }: {
  pack: Pack; me: Me | null; onClose: () => void; onInstall: () => void;
}) {
  const [tab, setTab] = useState<"journey" | "samples" | "models" | "embed">("journey");
  const [ran, setRan] = useState<string[]>([]);
  const [embed, setEmbed] = useState<{ script: string; steps: string[] } | null>(null);
  const toast = useToast();
  const writer = can(me, "solutions:write");
  const steps = [
    { label: "Install the pack", done: p.installed, hint: "Creates agents, workflows, policies, sample data" },
    { label: "Connect your systems", done: false, hint: "Connectors tab: enable and test each template" },
    { label: "Run a sample case", done: ran.length > 0, hint: "Samples tab: no real data needed" },
    { label: "Run the evaluation set", done: false, hint: "Evaluations tab: dataset was added on install" },
    ...(p.delivery !== "workflow"
      ? [{ label: "Embed the assistant", done: false, hint: "Embed tab: script tag or agent-kit" }]
      : []),
    { label: "Go live in shadow mode", done: false, hint: "Run beside your team and compare decisions before switching over" },
  ];
  const TABS = [
    ["journey", "Getting started"],
    ["samples", "Sample cases"],
    ["models", "Models"],
    ...(p.delivery !== "workflow" ? [["embed", "Embed"]] : []),
  ] as const;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{p.name}</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <StatusBadge value={p.delivery} label={DELIVERY[p.delivery].label} tone={DELIVERY[p.delivery].tone} />
          <span className="text-xs text-muted-foreground">{DELIVERY[p.delivery].hint}</span>
        </div>
        <div className="flex gap-1 border-b">
          {TABS.map(([id, l]) => (
            <button
              key={id}
              onClick={() => setTab(id as any)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                tab === id ? "border-primary font-medium" : "border-transparent text-muted-foreground"
              }`}
            >{l}</button>
          ))}
        </div>
        <div className="max-h-[55vh] overflow-auto text-sm">
          {tab === "journey" && (
            <>
              <ol className="space-y-3">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                      s.done ? "bg-emerald-500 text-white" : "bg-muted"
                    }`}>{s.done ? "✓" : i + 1}</span>
                    <div>
                      <div className="font-medium">{s.label}</div>
                      <div className="text-xs text-muted-foreground">{s.hint}</div>
                    </div>
                  </li>
                ))}
              </ol>
              {p.conformance && (
                p.conformance.error ? (
                  <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    <b>Conformance</b> could not run: {p.conformance.error}
                  </div>
                ) : (
                  <div className={`mt-3 rounded-md border p-3 text-xs ${
                    (p.conformance.passed ?? 0) === (p.conformance.total ?? 0)
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-amber-500/40 bg-amber-500/10"
                  }`}>
                    <b>Conformance</b> — {p.conformance.passed}/{p.conformance.total} cases pass
                    {(p.conformance.passed ?? 0) < (p.conformance.total ?? 0) && (
                      <span className="text-muted-foreground"> · publish is blocked until resolved</span>
                    )}
                  </div>
                )
              )}
            </>
          )}
          {tab === "samples" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Synthetic cases that exercise the happy path, escalation and attack handling.
                Results appear in Workflows.
              </p>
              {p.samples.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border p-2">
                  <div>
                    <div className="font-medium">{c.title}</div>
                    {c.expect && (
                      <div className="text-xs text-muted-foreground">Expected: {c.expect.replace(/_/g, " ")}</div>
                    )}
                  </div>
                  <AsyncButton
                    size="sm"
                    variant="outline"
                    disabled={!p.installed || !can(me, "workflows:run")}
                    onRun={async () => {
                      try {
                        await api.runSample(p.id, c.id);
                        setRan([...ran, c.id]);
                        toast.push("Sample started: see Workflows", "success");
                      } catch (e: any) { toast.push(e.message, "error"); }
                    }}
                  >Run</AsyncButton>
                </div>
              ))}
              {!p.installed && <p className="text-xs text-amber-600">Install the pack first.</p>}
            </div>
          )}
          {tab === "models" && (
            <div className="space-y-2">
              {p.models.map((m) => (
                <div key={m.role} className="rounded-md border p-2">
                  <div className="flex justify-between"><b>{m.role}</b><Chip>{m.tier}</Chip></div>
                  <code className="text-xs">{m.recommended}</code>
                  {m.notes && <div className="text-xs text-muted-foreground">{m.notes}</div>}
                </div>
              ))}
            </div>
          )}
          {tab === "embed" && (
            <div className="space-y-3">
              {p.widget && (
                <div className="rounded-md border p-3">
                  <div className="font-medium">{p.widget.title}</div>
                  <div className="text-muted-foreground">“{p.widget.greeting}”</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.widget.suggested_prompts.map((s) => <Chip key={s}>{s}</Chip>)}
                  </div>
                </div>
              )}
              {!embed ? (
                <AsyncButton
                  variant="outline"
                  disabled={!p.installed}
                  onRun={async () => setEmbed(await api.solutionEmbed(p.id))}
                >Show embed code</AsyncButton>
              ) : (
                <>
                  <pre className="overflow-auto rounded-md bg-muted p-2 text-xs">{embed.script}</pre>
                  <ol className="list-decimal pl-5 text-xs text-muted-foreground">
                    {embed.steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                </>
              )}
            </div>
          )}
        </div>
        {writer && (
          <div className="flex justify-end">
            <Button disabled={!p.entitled} onClick={onInstall}>
              {p.installed ? "Configure / upgrade" : "Install"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InstallDialog({ pack, onClose }: { pack: Pack; onClose: (res?: Awaited<ReturnType<typeof api.installPack>>) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(pack.parameters).map(([k, v]) => [k, typeof v.default === "string" ? v.default : JSON.stringify(v.default)])));
  const toast = useToast();
  async function go() {
    try {
      const parameters: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(pack.parameters)) {
        const raw = vals[k] ?? "";
        const orig = typeof v.default === "string" ? v.default : JSON.stringify(v.default);
        if (raw === orig) continue; // only send what the customer changed
        parameters[k] = typeof v.default === "string" ? raw : JSON.parse(raw);
      }
      onClose(await api.installPack(pack.id, parameters));
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{pack.installed ? "Configure" : "Install"} {pack.name}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto">
          {Object.keys(pack.parameters).length === 0 && <p className="text-sm text-muted-foreground">This solution has no tunable parameters.</p>}
          {Object.entries(pack.parameters).map(([k, v]) => (
            <div key={k}><Label>{k.replace(/_/g, " ")}</Label>
              <Input value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
              {v.description && <p className="mt-1 text-xs text-muted-foreground">{v.description}</p>}</div>))}
          <p className="text-xs text-muted-foreground">Installing again upgrades in place and keeps your earlier settings. Workflow definitions are versioned, so running cases are not affected.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><AsyncButton onRun={go}>{pack.installed ? "Apply" : "Install"}</AsyncButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}