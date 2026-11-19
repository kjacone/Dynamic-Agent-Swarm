import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Blocks, Building2, CheckCircle2, ChevronRight, Landmark, Layers, Package, RefreshCw, Search,
  ShieldCheck, Sparkles, Stethoscope, GraduationCap, Store, Radio, Heart, Briefcase, Scale, type LucideIcon,
} from "lucide-react";
import { api, can, type MarketplaceCatalog, type MarketplacePackDetail, type Me, type Pack } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { FilterTabs } from "@/components/common/FilterTabs";
import { StatCard } from "@/components/common/StatCard";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const INDUSTRY: Record<string, string> = { banking: "Banking", insurance: "Insurance", telecom: "Telecoms", government: "Government",
  healthcare: "Healthcare", ngo: "NGOs", corporate: "Corporate", education: "Education", retail: "Retail & commerce" };

// One colour per industry so cards are recognisable at a glance. Full class names so Tailwind keeps them.
const THEME: Record<string, { icon: LucideIcon; tile: string; bar: string; dot: string }> = {
  banking:    { icon: Landmark,      tile: "bg-sky-500/15 text-sky-600 dark:text-sky-400",             bar: "from-sky-500 to-sky-400/0",         dot: "bg-sky-500" },
  insurance:  { icon: ShieldCheck,   tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", bar: "from-emerald-500 to-emerald-400/0", dot: "bg-emerald-500" },
  telecom:    { icon: Radio,         tile: "bg-violet-500/15 text-violet-600 dark:text-violet-400",    bar: "from-violet-500 to-violet-400/0",   dot: "bg-violet-500" },
  government: { icon: Scale,         tile: "bg-slate-500/15 text-slate-600 dark:text-slate-300",       bar: "from-slate-500 to-slate-400/0",     dot: "bg-slate-500" },
  healthcare: { icon: Stethoscope,   tile: "bg-rose-500/15 text-rose-600 dark:text-rose-400",          bar: "from-rose-500 to-rose-400/0",       dot: "bg-rose-500" },
  ngo:        { icon: Heart,         tile: "bg-orange-500/15 text-orange-600 dark:text-orange-400",    bar: "from-orange-500 to-orange-400/0",   dot: "bg-orange-500" },
  corporate:  { icon: Briefcase,     tile: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",    bar: "from-indigo-500 to-indigo-400/0",   dot: "bg-indigo-500" },
  education:  { icon: GraduationCap, tile: "bg-amber-500/15 text-amber-600 dark:text-amber-400",       bar: "from-amber-500 to-amber-400/0",     dot: "bg-amber-500" },
  retail:     { icon: Store,         tile: "bg-teal-500/15 text-teal-600 dark:text-teal-400",          bar: "from-teal-500 to-teal-400/0",       dot: "bg-teal-500" },
};
const FALLBACK_THEME = { icon: Blocks, tile: "bg-primary/10 text-primary", bar: "from-primary to-primary/0", dot: "bg-primary" };
const themeOf = (industry: string) => THEME[industry] ?? FALLBACK_THEME;

const DELIVERY: Record<string, { label: string; tone: "gray" | "blue" | "green"; hint: string }> = {
  workflow: { label: "Backend workflow", tone: "gray" as const, hint: "Runs behind the scenes: documents, approvals, system integrations" },
  agent_kit: { label: "Agent-kit widget", tone: "blue" as const, hint: "A chat assistant embedded in your website or app" },
  both: { label: "Widget + workflow", tone: "green" as const, hint: "Customer-facing assistant plus back-office process" },
};

export function Solutions({ me }: { me: Me | null }) {
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [industry, setIndustry] = useState<string>("all");
  const [delivery, setDelivery] = useState<string>("all");
  const [status, setStatus] = useState<"all" | "installed" | "upgrade" | "available">("all");
  const [group, setGroup] = useState<"first" | "later" | "rest">("first");
  const [open, setOpen] = useState<Pack | null>(null);
  const [testDrive, setTestDrive] = useState<Pack | null>(null);
  const [installing, setInstalling] = useState<Pack | null>(null);
  const [done, setDone] = useState<{ pack: Pack; res: Awaited<ReturnType<typeof api.installPack>> } | null>(null);
  const toast = useToast();
  const packs = catalog?.packs ?? null;

  const load = () => api.marketplace()
    .then((c) => { setCatalog(c); setFailed(false); })
    .catch((e) => { toast.push(e.message, "error"); setFailed(true); });
  useEffect(() => { load(); }, []);

  const industries = useMemo(() => {
    const m = new Map<string, number>();
    (packs || []).forEach((p) => m.set(p.industry, (m.get(p.industry) ?? 0) + 1));
    return [...m.entries()];
  }, [packs]);

  const q = query.trim().toLowerCase();
  const shown = (packs || []).filter((p) =>
    (industry === "all" || p.industry === industry) &&
    (delivery === "all" || p.delivery === delivery || p.delivery === "both") &&
    (status === "all" ||
      (status === "installed" && p.installed) ||
      (status === "upgrade" && p.upgrade_available) ||
      (status === "available" && !p.installed)) &&
    (!q || `${p.name} ${p.summary} ${INDUSTRY[p.industry] ?? p.industry}`.toLowerCase().includes(q)));

  const launch = shown.filter((p) => p.priority === "first");
  const next = shown.filter((p) => p.priority === "later");
  const rest = shown.filter((p) => p.priority !== "first" && p.priority !== "later");
  const groups = ([
    { id: "first", label: "Launch solutions", sub: "Ready to install and proven in production", list: launch },
    { id: "later", label: "Next wave", sub: "Coming soon, available to preview", list: next },
    { id: "rest", label: "More solutions", sub: "", list: rest },
  ] as const).filter((g) => g.list.length > 0);
  const activeGroup = groups.some((g) => g.id === group) ? group : groups[0]?.id ?? "first";

  return (
    <div>
      <PageHeader
        icon={Package}
        title="Industry solutions"
        description="Agents, workflows, knowledge, sample data and evaluations per industry. Install, try a sample case, connect your systems, go live."
      />

      {catalog && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Package} label="Solutions" value={catalog.counts.total} tone="sky" hint="In the marketplace catalogue" />
          <StatCard icon={CheckCircle2} label="Installed" value={catalog.counts.installed} tone="emerald" />
          <StatCard icon={RefreshCw} label="Updates" value={catalog.counts.upgrades} tone="amber"
            hint={catalog.counts.upgrades ? "Review and upgrade to pick up fixes" : "Everything is current"} />
          <StatCard icon={Layers} label="Licence" value={catalog.license.edition} tone="violet"
            hint={`State: ${catalog.license.state}`} />
        </div>
      )}

      {packs === null ? (
        failed
          ? <EmptyState icon={Package} title="Could not load the marketplace" body="Check the API and your licence." />
          : <LoadingBlock rows={4} />
      ) : packs.length === 0 ? (
        <EmptyState icon={Package} title="No solutions available" body="Your licence does not include any industry packs." />
      ) : (
        <div className="grid gap-6 md:grid-cols-[230px,minmax(0,1fr)]">
          <Card className="h-fit overflow-hidden md:sticky md:top-4">
            <CardContent className="space-y-0.5 p-2">
              <div className="flex items-center gap-2 px-3 pb-2 pt-2 text-xs font-semibold text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" /> Browse by industry
              </div>
              <Rail active={industry === "all"} onClick={() => setIndustry("all")} label="All industries" n={packs.length} />
              {industries.map(([k, n]) => (
                <Rail key={k} active={industry === k} onClick={() => setIndustry(k)} label={INDUSTRY[k] ?? k} n={n} theme={themeOf(k)} />
              ))}
            </CardContent>
          </Card>

          <div className="min-w-0">
            <div className="mb-5 space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search solutions, e.g. loan onboarding or claims"
                  className="h-11 rounded-xl pl-10"
                  aria-label="Search solutions"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <FilterTabs
                  value={delivery}
                  onChange={setDelivery}
                  options={[
                    { id: "all", label: "Any delivery" },
                    { id: "workflow", label: "Workflow" },
                    { id: "agent_kit", label: "Widget" },
                  ]}
                />
                <FilterTabs
                  value={status}
                  onChange={(v) => setStatus(v as typeof status)}
                  options={[
                    { id: "all", label: "Any status" },
                    { id: "installed", label: "Installed", count: catalog?.counts.installed },
                    { id: "upgrade", label: "Updates", count: catalog?.counts.upgrades },
                    { id: "available", label: "Not installed" },
                  ]}
                />
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {shown.length} of {packs.length} solutions
                </span>
              </div>
            </div>

            {shown.length === 0 ? (
              <EmptyState title="Nothing matches these filters" body="Clear the search or pick a different industry or status." />
            ) : (
              <>
                <FilterTabs
                  value={activeGroup}
                  onChange={(v) => setGroup(v as typeof group)}
                  options={groups.map((g) => ({ id: g.id, label: g.label, count: g.list.length }))}
                />
                <p className="mb-3 mt-2 text-xs text-muted-foreground">{groups.find((g) => g.id === activeGroup)?.sub}</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {(groups.find((g) => g.id === activeGroup)?.list ?? []).map((p) => (
                    <PackCard key={p.id} p={p} onOpen={() => setOpen(p)} onTestDrive={() => setTestDrive(p)} />
                  ))}
                </div>
              </>
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
          onUpgraded={() => { setOpen(null); load(); }}
        />
      )}

      {testDrive && (
        <TestDrive
          pack={testDrive}
          me={me}
          onClose={() => setTestDrive(null)}
          onInstall={() => { setInstalling(testDrive); setTestDrive(null); }}
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
            <DialogHeader>
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <DialogTitle>{done.pack.name} is ready</DialogTitle>
              <DialogDescription>Everything below was created in this tenant. Connectors arrive disabled until you add endpoints and secrets.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span>Created <b>{Object.keys(done.res.created.agents).length}</b> agents and <b>{done.res.created.workflows.length}</b> workflow(s):</span>
                {done.res.created.workflows.map((w) => <Chip key={w.key}>{w.key} v{w.version}</Chip>)}
              </div>
              {done.res.created.connectors.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>Connector templates added <b>(disabled)</b>:</span>
                  {done.res.created.connectors.map((c) => <Chip key={c}>{c}</Chip>)}
                </div>
              )}
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="mb-2 text-xs font-medium">What to do next</div>
                <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
                  <li>Add endpoints and secret references (<code className="rounded bg-background px-1">env:NAME</code>) for each connector, then enable it.</li>
                  <li>Assign named users the roles the workflow needs (e.g. approvers) in your identity provider.</li>
                  <li>Run the pack’s evaluation dataset, then start a test workflow run.</li>
                </ol>
              </div>
            </div>
            <DialogFooter><Button onClick={() => setDone(null)}>Done</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

const Rail = ({ active, onClick, label, n, theme }: {
  active: boolean; onClick: () => void; label: string; n?: number; theme?: { icon: LucideIcon; tile: string };
}) => {
  const Icon = theme?.icon ?? Building2;
  return (
    <button onClick={onClick} aria-pressed={active} className={cn(
      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      active ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    )}>
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", theme?.tile ?? "bg-muted text-muted-foreground")}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
      {n !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{n}</span>}
    </button>
  );
};

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-muted/40 px-2 py-1.5 text-center">
      <div className="text-sm font-semibold tabular-nums leading-tight">{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function PackCard({ p, onOpen, onTestDrive }: { p: Pack; onOpen: () => void; onTestDrive: () => void }) {
  const d = DELIVERY[p.delivery];
  const a = p.assets;
  const t = themeOf(p.industry);
  const Icon = t.icon;
  const agents = a.agents + (a.supervisor ? 1 : 0);

  return (
    <Card
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        p.upgrade_available && "ring-1 ring-amber-500/40",
      )}
      onClick={onOpen}
    >
      <div className={cn("h-0.5 w-full bg-gradient-to-r", t.bar)} />
      <CardContent className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", t.tile)}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight" title={p.name}>{p.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {INDUSTRY[p.industry] ?? p.industry} · v{p.version}
            </div>
          </div>
          {p.installed && !p.upgrade_available && (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Installed" />
          )}
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{p.summary}</p>

        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge value={p.delivery} label={d.label} tone={d.tone} />
          {p.upgrade_available && <StatusBadge value="warn" label={`update v${p.version}`} />}
          {!p.installed && !p.entitled && <StatusBadge value="warn" label="not in licence" />}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-2">
          <span className="truncate text-[11px] tabular-nums text-muted-foreground">
            {agents} agents · {a.workflows} workflows
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 gap-1 px-2 text-xs"
            onClick={(e) => { e.stopPropagation(); onTestDrive(); }}
          >
            <Sparkles className="h-3 w-3" /> Test drive
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Detail({ pack: p, me, onClose, onInstall, onUpgraded }: {
  pack: Pack; me: Me | null; onClose: () => void; onInstall: () => void; onUpgraded: () => void;
}) {
  const [tab, setTab] = useState<"journey" | "contents" | "samples" | "models" | "embed">("journey");
  const [ran, setRan] = useState<string[]>([]);
  const [embed, setEmbed] = useState<{ script: string; steps: string[] } | null>(null);
  const [contents, setContents] = useState<MarketplacePackDetail | null>(null);
  const [loadingContents, setLoadingContents] = useState(false);
  const toast = useToast();
  const writer = can(me, "solutions:write");
  const pc = p.parameter_changes;
  const t = themeOf(p.industry);
  const Icon = t.icon;

  useEffect(() => {
    if (tab !== "contents" || contents) return;
    setLoadingContents(true);
    api.marketplacePack(p.id)
      .then(setContents)
      .catch((e) => toast.push(e.message, "error"))
      .finally(() => setLoadingContents(false));
  }, [tab, contents, p.id]);
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
  const doneCount = steps.filter((s) => s.done).length;
  const TABS = [
    ["journey", "Getting started"],
    ["contents", "Contents"],
    ["samples", "Sample cases"],
    ["models", "Models"],
    ...(p.delivery !== "workflow" ? [["embed", "Embed"]] : []),
  ] as const;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", t.tile)}>
              <Icon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{p.name}</DialogTitle>
              <DialogDescription>
                {INDUSTRY[p.industry] ?? p.industry} · v{p.version} · {DELIVERY[p.delivery].hint}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={p.delivery} label={DELIVERY[p.delivery].label} tone={DELIVERY[p.delivery].tone} />
          {p.installed && <StatusBadge value="installed" label={`installed v${p.installed_version}`} />}
          {!p.installed && !p.entitled && <StatusBadge value="warn" label="not in licence" />}
        </div>
        {p.upgrade_available && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <div>
              <b className="text-amber-700 dark:text-amber-400">Update available</b> — v{p.installed_version} → v{p.version}. Your settings are kept and workflow
              definitions are versioned, so running cases are unaffected.
              {pc && (pc.added.length > 0 || pc.removed.length > 0) && (
                <div className="mt-1 text-muted-foreground">
                  {pc.added.length > 0 && <>New parameters take defaults: {pc.added.join(", ")}. </>}
                  {pc.removed.length > 0 && <>No longer used: {pc.removed.join(", ")}.</>}
                </div>
              )}
            </div>
            {writer && (
              <AsyncButton size="sm" onRun={async () => {
                try {
                  const res = await api.upgradePack(p.id);
                  toast.push(`${p.name} upgraded to v${res.to_version}`, "success");
                  onUpgraded();
                } catch (e: any) { toast.push(e.message, "error"); }
              }}>Upgrade</AsyncButton>
            )}
          </div>
        )}
        <FilterTabs
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={TABS.map(([id, l]) => ({ id, label: l }))}
        />
        <div className="max-h-[55vh] overflow-auto pr-1 text-sm">
          {tab === "journey" && (
            <>
              <div className="mb-4">
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Your progress</span>
                  <span className="tabular-nums">{doneCount} of {steps.length} steps</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                    style={{ width: `${(doneCount / steps.length) * 100}%` }}
                  />
                </div>
              </div>
              <ol>
                {steps.map((s, i) => (
                  <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < steps.length - 1 && (
                      <span className={cn("absolute left-3 top-7 h-[calc(100%-1.75rem)] w-px", s.done ? "bg-emerald-500/40" : "bg-border")} />
                    )}
                    <span className={cn(
                      "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                      s.done ? "bg-emerald-500 text-white" : "border bg-background text-muted-foreground",
                    )}>{s.done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}</span>
                    <div>
                      <div className={cn("font-medium", s.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>{s.label}</div>
                      <div className="text-xs text-muted-foreground">{s.hint}</div>
                    </div>
                  </li>
                ))}
              </ol>
              {p.conformance && (
                p.conformance.error ? (
                  <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                    <b>Conformance</b> could not run: {p.conformance.error}
                  </div>
                ) : (
                  <div className={cn(
                    "mt-4 rounded-xl border p-3 text-xs",
                    (p.conformance.passed ?? 0) === (p.conformance.total ?? 0)
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-500/30 bg-amber-500/5",
                  )}>
                    <b>Conformance</b> — {p.conformance.passed}/{p.conformance.total} cases pass
                    {(p.conformance.passed ?? 0) < (p.conformance.total ?? 0) && (
                      <span className="text-muted-foreground"> · publish is blocked until resolved</span>
                    )}
                  </div>
                )
              )}
              {p.upgrade_history && p.upgrade_history.length > 0 && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Last upgrade: v{p.upgrade_history[p.upgrade_history.length - 1].from_version} →{" "}
                  v{p.upgrade_history[p.upgrade_history.length - 1].to_version} ·{" "}
                  {new Date(p.upgrade_history[p.upgrade_history.length - 1].at).toLocaleDateString()}
                </div>
              )}
              {p.installed && p.rollback_versions && p.rollback_versions.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <h4 className="text-xs font-semibold text-muted-foreground">Previous versions</h4>
                  <p className="text-xs text-muted-foreground">
                    Re-applies the saved pack and its settings. You can upgrade again afterwards.
                  </p>
                  {p.rollback_versions.map((v) => (
                    <div key={v.version} className="flex items-center justify-between rounded-lg border p-2 text-xs">
                      <div>
                        <b>v{v.version}</b>{" "}
                        <span className="text-muted-foreground">
                          saved {new Date(v.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {writer && (
                        <AsyncButton size="sm" variant="outline" onRun={async () => {
                          try {
                            const res = await api.rollbackPack(p.id, v.version);
                            toast.push(`Rolled back to v${res.to_version}`, "success");
                            onUpgraded();
                          } catch (e: any) { toast.push(e.message, "error"); }
                        }}>Roll back</AsyncButton>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "contents" && (
            <div className="space-y-4">
              {loadingContents && <div className="animate-pulse text-xs text-muted-foreground">Loading…</div>}
              {!loadingContents && !contents && (
                <p className="text-xs text-muted-foreground">Could not load this pack’s contents.</p>
              )}
              {contents && <PackContents d={contents} />}
            </div>
          )}
          {tab === "samples" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Synthetic cases that exercise the happy path, escalation and attack handling.
                Results appear in Workflows.
              </p>
              {p.samples.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-colors hover:bg-muted/30">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.title}</div>
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
              {!p.installed && <p className="text-xs text-amber-600 dark:text-amber-400">Install the pack first.</p>}
            </div>
          )}
          {tab === "models" && (
            <div className="space-y-2">
              {p.models.map((m) => (
                <div key={m.role} className="rounded-xl border p-2.5">
                  <div className="flex items-center justify-between gap-2"><b>{m.role}</b><Chip>{m.tier}</Chip></div>
                  <code className="text-xs">{m.recommended}</code>
                  {m.notes && <div className="text-xs text-muted-foreground">{m.notes}</div>}
                </div>
              ))}
            </div>
          )}
          {tab === "embed" && (
            <div className="space-y-3">
              {p.widget && (
                <div className="rounded-xl border p-3">
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
                  <pre className="overflow-auto rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed">{embed.script}</pre>
                  <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
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
              {p.installed ? "Configure" : "Install"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PackContents({ d }: { d: MarketplacePackDetail }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric value={d.agents.length + (d.supervisor ? 1 : 0)} label="agents" />
        <Metric value={d.workflows.length} label="workflows" />
        <Metric value={d.connectors.length} label="connectors" />
        <Metric value={d.evals.reduce((n, e) => n + e.cases, 0)} label="eval cases" />
      </div>
      {(d.policy.rules > 0 || d.policy.tool_rules > 0) && (
        <div className="flex flex-wrap gap-1">
          {d.policy.rules > 0 && <Chip>{d.policy.rules} policy rules</Chip>}
          {d.policy.tool_rules > 0 && <Chip>{d.policy.tool_rules} tool rules</Chip>}
        </div>
      )}
      {d.supervisor && (
        <Section title="Supervisor">
          <div className="space-y-1.5 rounded-xl border bg-muted/20 p-3">
            <div className="font-medium">{d.supervisor.name}</div>
            <div className="flex flex-wrap gap-1">
              {d.supervisor.delegates.map((x) => <Chip key={x}>{x}</Chip>)}
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(d.supervisor.limits).map(([k, v]) => (
                <Chip key={k}>{k.replace(/_/g, " ")}: {String(v)}</Chip>
              ))}
            </div>
          </div>
        </Section>
      )}
      <Section title="Agents">
        {d.agents.map((a) => (
          <div key={a.key} className="flex items-center justify-between gap-3 rounded-xl border p-2.5">
            <div className="min-w-0">
              <div className="truncate font-medium">{a.name}</div>
              <code className="text-[11px] text-muted-foreground">{a.key}</code>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {a.tools.length ? a.tools.map((t) => <Chip key={t}>{t}</Chip>) : <Chip>no tools</Chip>}
            </div>
          </div>
        ))}
      </Section>
      <Section title="Workflows">
        {d.workflows.map((w) => (
          <div key={w.key} className="rounded-xl border p-2.5">
            <div className="font-medium">{w.name}</div>
            <code className="text-[11px] text-muted-foreground">{w.key}</code>
            {w.description && <div className="mt-0.5 text-xs text-muted-foreground">{w.description}</div>}
          </div>
        ))}
      </Section>
      {d.knowledge.length > 0 && (
        <Section title="Knowledge">
          {d.knowledge.map((k) => (
            <div key={k.collection} className="flex items-center justify-between rounded-xl border p-2.5">
              <div>
                <div className="font-medium">{k.collection}</div>
                {k.description && <div className="text-xs text-muted-foreground">{k.description}</div>}
              </div>
              <Chip>{k.documents} docs</Chip>
            </div>
          ))}
        </Section>
      )}
      {d.connectors.length > 0 && (
        <Section title="Connector templates">
          {d.connectors.map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-xl border p-2.5">
              <code className="text-xs">{c.name}</code><Chip>{c.type}</Chip>
            </div>
          ))}
        </Section>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Evaluations">
          {d.evals.length === 0
            ? <p className="text-xs text-muted-foreground">None</p>
            : d.evals.map((e) => (
                <div key={e.name} className="flex justify-between text-xs">
                  <span>{e.name}</span><span className="text-muted-foreground">{e.cases} cases</span>
                </div>
              ))}
        </Section>
        <Section title="Training data">
          {d.training.length === 0
            ? <p className="text-xs text-muted-foreground">None</p>
            : d.training.map((t) => (
                <div key={t.name ?? "training"} className="flex justify-between text-xs">
                  <span>{t.name ?? "dataset"}</span><span className="text-muted-foreground">{t.rows} rows</span>
                </div>
              ))}
        </Section>
      </div>
      {d.kpis.length > 0 && (
        <Section title="KPIs">
          {d.kpis.map((k) => (
            <div key={k.name} className="text-xs">
              <b>{k.name.replace(/_/g, " ")}</b>
              {k.formula && <span className="text-muted-foreground"> · {k.formula}</span>}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function TestDrive({ pack, me, onClose, onInstall }: {
  pack: Pack; me: Me | null; onClose: () => void; onInstall: () => void;
}) {
  const [detail, setDetail] = useState<MarketplacePackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writer = can(me, "solutions:write");
  const delivery = DELIVERY[pack.delivery];
  const t = themeOf(pack.industry);
  const Icon = t.icon;

  useEffect(() => {
    let alive = true;
    api.marketplacePack(pack.id)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [pack.id]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", t.tile)}>
              <Icon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{pack.name} · test drive</DialogTitle>
              <DialogDescription>
                {INDUSTRY[pack.industry] ?? pack.industry} · v{pack.version} · preview only, nothing is installed
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={pack.delivery} label={delivery.label} tone={delivery.tone} />
          <span className="text-xs text-muted-foreground">{delivery.hint}</span>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-auto pr-1 text-sm">
          <p className="leading-relaxed">{pack.summary}</p>
          <div className="flex flex-wrap gap-1">
            {pack.frameworks.map((f) => <Chip key={f}>{f}</Chip>)}
            {pack.audience.map((a) => <Chip key={a}>{a.replace(/_/g, " ")}</Chip>)}
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
          {!detail && !error && <LoadingBlock rows={4} />}
          {detail && (
            <>
              <PackContents d={detail} />
              {detail.samples.length > 0 && (
                <Section title="Sample cases">
                  {detail.samples.map((s) => (
                    <div key={s.id} className="rounded-xl border p-2.5">
                      <div className="font-medium">{s.title}</div>
                      {s.expect && (
                        <div className="text-xs text-muted-foreground">
                          Expected: {s.expect.replace(/_/g, " ")}
                        </div>
                      )}
                    </div>
                  ))}
                </Section>
              )}
              {detail.models.length > 0 && (
                <Section title="Recommended models">
                  {detail.models.map((m) => (
                    <div key={m.role} className="flex items-center justify-between rounded-xl border p-2.5 text-xs">
                      <div><b>{m.role}</b> · <code>{m.recommended}</code></div>
                      <Chip>{m.tier}</Chip>
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            Preview only — install to run sample cases.
          </span>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {writer && (
            <Button disabled={!pack.entitled} onClick={onInstall}>
              {pack.installed ? "Configure" : "Install"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
      {children}
    </section>
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
        <DialogHeader>
          <DialogTitle>{pack.installed ? "Configure" : "Install"} {pack.name}</DialogTitle>
          <DialogDescription>
            {Object.keys(pack.parameters).length
              ? "Only values you change are sent. Re-installing upgrades in place and keeps earlier settings."
              : "This solution has no tunable parameters."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-auto pr-1">
          {Object.entries(pack.parameters).map(([k, v]) => (
            <div key={k} className="space-y-1.5">
              <Label className="capitalize">{k.replace(/_/g, " ")}</Label>
              <Input value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
              {v.description && <p className="text-xs text-muted-foreground">{v.description}</p>}
            </div>
          ))}
          <p className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
            Workflow definitions are versioned, so running cases are not affected by this change.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose()}>Cancel</Button>
          <AsyncButton onRun={go}>{pack.installed ? "Apply" : "Install"}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}