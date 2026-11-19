import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { GenUi, uiSpecs } from "langgraph-kit";
import {
  BellRing, Braces, ChevronDown, ClipboardList, Code2, Gauge, Globe, History, LayoutGrid, LineChart, ListChecks,
  MousePointerClick, Play, Plug, Plus, Search, Sparkles, Table2, Terminal, Trash2, Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, type Tool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { FilterTabs } from "@/components/common/FilterTabs";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/* ---------- visual tokens ---------- */

const TYPE_TONE: Record<string, string> = {
  builtin: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  http: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  python: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  frontend: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  connector: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
};

const TYPE_ICON_TONE: Record<string, string> = {
  builtin: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  http: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  python: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  connector: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  frontend: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
};

const TYPE_ICON: Record<string, LucideIcon> = {
  builtin: Terminal, http: Globe, python: Code2, connector: Plug, frontend: MousePointerClick,
};

const UI_ICON: Record<string, LucideIcon> = {
  ui_cards: LayoutGrid, ui_table: Table2, ui_stats: Gauge, ui_chart: LineChart,
  ui_timeline: History, ui_status: ListChecks, ui_form: ClipboardList, ui_alert: BellRing, ui_render: Braces,
};

const isGenerative = (t: Tool) => t.type === "frontend" || t.name.startsWith("ui_");

function TypeChip({ type }: { type: string }) {
  return (
    <span className={cn("inline-flex rounded border px-1.5 py-px font-mono text-[10px] leading-4", TYPE_TONE[type] ?? "bg-muted text-muted-foreground")}>
      {type === "frontend" ? "browser" : type}
    </span>
  );
}

/* ---------- collapsible section ---------- */

function Section({ icon: Icon, title, hint, count, accent, open, onToggle, children }: {
  icon: LucideIcon; title: string; hint: string; count: number; accent: string;
  open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", accent)}><Icon className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{count}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden"><div className="border-t">{children}</div></div>
      </div>
    </section>
  );
}

/* ---------- page ---------- */

export function Tools({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Tool[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<Tool | null>(null);
  const [deleting, setDeleting] = useState<Tool | null>(null);
  const [openActions, setOpenActions] = useState(true);
  const [openGen, setOpenGen] = useState(false);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listTools(tenant)); } catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  const searching = query.trim().length > 0;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((t) => `${t.name} ${t.description ?? ""} ${t.type}`.toLowerCase().includes(q));
  }, [rows, query]);

  const generative = filtered.filter(isGenerative);
  const others = filtered.filter((t) => !isGenerative(t));

  const counts = useMemo(() => {
    const c = { generative: 0, builtin: 0, http: 0, python: 0, connector: 0 };
    (rows ?? []).forEach((t) => {
      if (isGenerative(t)) c.generative += 1;
      else if (t.type in c) c[t.type as keyof typeof c] += 1;
    });
    return c;
  }, [rows]);

  const summary = [
    { label: "Platform", value: counts.builtin, icon: Terminal, tone: TYPE_ICON_TONE.builtin },
    { label: "Integrations", value: counts.http + counts.connector, icon: Globe, tone: TYPE_ICON_TONE.http },
    { label: "Custom code", value: counts.python, icon: Code2, tone: TYPE_ICON_TONE.python },
    { label: "Generative UI", value: counts.generative, icon: Sparkles, tone: TYPE_ICON_TONE.frontend },
  ];

  return (
    <div className="space-y-4">
      <PageHeader icon={Wrench} title="Tools"
        description="What agents can do, and how answers look."
        actions={<Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New tool</Button>} />

      {/* slim summary + search on one row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools…" className="h-9 pl-8 text-sm" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {summary.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-0.5 pr-2.5 text-xs text-muted-foreground">
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", s.tone)}><s.icon className="h-3 w-3" /></span>
              <span className="font-semibold tabular-nums text-foreground">{rows ? s.value : "–"}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </span>
          ))}
        </div>
      </div>

      {rows === null ? (
        <Card><CardContent className="space-y-2 py-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/60" />)}
        </CardContent></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={Wrench} title="No tools yet" body="Add a tool so agents can call your systems or render rich answers."
          action={<Button onClick={() => setCreating(true)}>Add tool</Button>} />
      ) : (
        <div className="space-y-3">
          {/* 1 — data & action tools first */}
          <Section icon={Plug} title="Data & action tools" accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            hint="Builtin, HTTP, Python and connector tools" count={others.length}
            open={openActions || searching} onToggle={() => setOpenActions((v) => !v)}>
            {others.length === 0 ? (
              <p className="px-4 py-5 text-center text-xs text-muted-foreground">No tools match “{query}”.</p>
            ) : (
              <ul className="divide-y">
                {others.map((t) => {
                  const Icon = TYPE_ICON[t.type] ?? Wrench;
                  return (
                    <li key={t.id} className="group flex items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-muted/40">
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", TYPE_ICON_TONE[t.type] ?? "bg-muted text-muted-foreground")}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{t.name}</span>
                          <TypeChip type={t.type} />
                        </div>
                        <div className="truncate text-xs text-muted-foreground" title={t.description}>{t.description || "—"}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setTesting(t)}><Play className="h-3 w-3" /> Test</Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* 2 — generative UI below */}
          <Section icon={Sparkles} title="Generative UI tools" accent="bg-gradient-to-br from-teal-500/20 to-indigo-500/15 text-teal-600 dark:text-teal-300"
            hint="Return a JSON spec the chat renders as native UI" count={generative.length}
            open={openGen || searching} onToggle={() => setOpenGen((v) => !v)}>
            {generative.length === 0 ? (
              <p className="px-4 py-5 text-center text-xs text-muted-foreground">
                {searching ? `No tools match “${query}”.` : "None yet. Create a browser tool or attach a builtin ui_* tool."}
              </p>
            ) : (
              <div className="grid gap-2 p-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {generative.map((t) => (
                  <GenerativeTile key={t.id} tool={t} onTest={() => setTesting(t)} onDelete={() => setDeleting(t)} />
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {creating && <CreateTool onClose={() => { setCreating(false); refresh(); }} tenant={tenant} />}
      {testing && <TestTool tool={testing} onClose={() => setTesting(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description="Agents using this tool will fail when they try to call it. This cannot be undone."
          confirmLabel="Delete tool" destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteTool(deleting.id);
            toast.push("Tool deleted", "success");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function GenerativeTile({ tool: t, onTest, onDelete }: { tool: Tool; onTest: () => void; onDelete: () => void }) {
  const Icon = UI_ICON[t.name] ?? MousePointerClick;
  const params = (t.config?.parameters as any)?.properties;
  const n = params ? Object.keys(params).length : 0;
  const detail = t.type === "frontend" ? `${params ? n : "?"} browser arg${n === 1 ? "" : "s"}` : "JSON spec → native UI";
  return (
    <div className="group flex items-center gap-2.5 rounded-lg border bg-background/60 p-2.5 transition-colors hover:border-teal-500/40 hover:bg-teal-500/[0.04]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500/20 to-sky-500/10 text-teal-600 dark:text-teal-300">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{t.name}</span>
          {t.type === "frontend" && <TypeChip type={t.type} />}
        </div>
        <div className="truncate text-[11px] text-muted-foreground" title={t.description}>{t.description || detail}</div>
      </div>
      <div className="flex shrink-0 items-center opacity-70 transition-opacity group-hover:opacity-100">
        {t.type !== "frontend" && (
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Test ${t.name}`} onClick={onTest}><Play className="h-3.5 w-3.5" /></Button>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete ${t.name}`} onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ---------- create dialog ---------- */

const CONFIG_HELP: Record<string, string> = {
  builtin: "Use the shipped name (calculator, tavily_search, ui_cards…).",
  http: "Calls one endpoint. Config: {\"endpoint\": \"https://…\"}.",
  python: "Loads a function you deploy. Config: {\"dotted_path\": \"nmb_marketplace_agent.custom_tools.…\"}.",
  frontend: "Pauses the run, acts on the page, then resumes. Config: {\"parameters\": {JSON schema}}.",
  connector: "Exposes a Connectors-page operation. Config: {\"connector\": \"…\", \"operation\": \"…\"}.",
};

function CreateTool({ onClose, tenant }: { onClose: () => void; tenant: string }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"builtin" | "http" | "python" | "frontend" | "connector">("builtin");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState("{}");
  const toast = useToast();

  async function save() {
    try {
      const cfg = JSON.parse(config || "{}");
      await api.createTool({ name, type, description, config: cfg, tenant_id: tenant });
      toast.push("Tool created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New tool</DialogTitle>
          <DialogDescription>Register a tool agents can call.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. lookup_customer" /></div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <FilterTabs value={type} onChange={setType}
              options={[{ id: "builtin", label: "Builtin" }, { id: "http", label: "HTTP" }, { id: "python", label: "Python" }, { id: "frontend", label: "Browser" }, { id: "connector", label: "Connector" }]} />
            <p className="text-[11px] text-muted-foreground">{CONFIG_HELP[type]}</p>
          </div>
          <div className="space-y-1.5"><Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this tool do?" /></div>
          <div className="space-y-1.5"><Label>Config (JSON)</Label>
            <Textarea rows={4} className="font-mono text-xs" value={config} onChange={(e) => setConfig(e.target.value)}
              placeholder={type === "http" ? '{"endpoint":"https://example.com"}'
                : type === "python" ? '{"dotted_path":"nmb_marketplace_agent.custom_tools.my_tool.fn"}'
                : type === "frontend" ? '{"parameters":{"type":"object","properties":{"path":{"type":"string"}}}}'
                : type === "connector" ? '{"connector":"posts_api","operation":"list_posts"}'
                : '{}'} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name}>Create tool</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- test dialog ---------- */

const TEST_PLACEHOLDER: Record<string, string> = {
  ui_cards: '{"title": "Plans", "items": [{"name": "Basic", "price": 1000}, {"name": "Pro", "price": 4000}]}',
  ui_table: '{"title": "Rows", "rows": [{"account": "A-1", "balance": 12000}]}',
  ui_stats: '{"title": "Today", "metrics": {"Tickets": 34, "Reopened": 2}}',
  ui_chart: '{"title": "Volume", "labels": ["Mon", "Tue"], "values": [12, 18]}',
  ui_timeline: '{"title": "Case", "events": [{"title": "Received", "time": "09:00"}]}',
  ui_status: '{"title": "Checks", "checks": {"Sanctions": "clear", "ID": "expired"}}',
  ui_form: '{"title": "Details", "fields": [{"name": "amount", "label": "Amount", "type": "number"}]}',
  ui_alert: '{"title": "Heads up", "message": "The policy changed on Monday.", "tone": "warn"}',
};

function TestTool({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const specs = useMemo(() => {
    if (!result) return null;
    try { return uiSpecs(JSON.parse(result)); } catch { return null; }
  }, [result]);

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try { const r = await api.testTool(tool.id, input); setResult(r.result); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={specs?.length ? "max-w-2xl" : undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="h-4 w-4 text-primary" /> Test · {tool.name}</DialogTitle>
          <DialogDescription>Calls the tool directly. No agent or workflow is involved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Input</Label>
            <Textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={TEST_PLACEHOLDER[tool.name]
                || (tool.type === "builtin" && tool.name === "calculator" ? "2+2"
                  : tool.type === "connector" ? '{"limit": 5}'
                    : "query")} />
            {tool.name.startsWith("ui_") && (
              <p className="text-[11px] text-muted-foreground">Paste JSON arguments. The tool returns the UI spec the chat renders.</p>
            )}
          </div>
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          {result && specs?.length ? (
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">Rendered preview</div>
              <div className="lgk max-h-80 overflow-auto rounded-lg border p-3"
                style={{ background: "var(--lgk-panel)", color: "var(--lgk-ink)" }}>
                <GenUi specs={specs} />
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Raw spec</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 leading-relaxed">{result}</pre>
              </details>
            </div>
          ) : result && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">{result}</pre>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <AsyncButton onRun={run} disabled={busy}>Run</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}