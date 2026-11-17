import { useEffect, useMemo, useState } from "react";
import { GenUi, uiSpecs } from "langgraph-kit";
import {
  BellRing, Braces, ClipboardList, Code2, Gauge, Globe, History, LayoutGrid, LineChart, ListChecks,
  MousePointerClick, Play, Plug, Search, Sparkles, Table2, Terminal, Wrench,
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
import { StatCard } from "@/components/common/StatCard";
import { FilterTabs } from "@/components/common/FilterTabs";
import { useToast } from "@/components/ui/toast";
import { cn, truncate } from "@/lib/utils";

const TYPE_TONE: Record<string, string> = {
  builtin: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  http: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  python: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  frontend: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  connector: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
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
    <span className={cn("inline-flex rounded-md border px-2 py-0.5 font-mono text-[11px]", TYPE_TONE[type] ?? "bg-muted text-muted-foreground")}>
      {type === "frontend" ? "browser" : type}
    </span>
  );
}

export function Tools({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Tool[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<Tool | null>(null);
  const [deleting, setDeleting] = useState<Tool | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listTools(tenant)); } catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { refresh(); }, [tenant]);

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

  return (
    <div>
      <PageHeader icon={Wrench} title="Tools"
        description="What agents can do, and how answers look. Generative-UI tools render native cards, tables, charts and forms in the chat; the rest reach your systems."
        actions={<Button onClick={() => setCreating(true)}><Sparkles className="h-4 w-4" /> New tool</Button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Sparkles} label="Generative UI" value={rows ? counts.generative : "—"} tone="indigo"
          hint="Structured answers, rendered in the chat" />
        <StatCard icon={Terminal} label="Platform" value={rows ? counts.builtin : "—"} tone="sky" hint="Builtin tools shipped with the platform" />
        <StatCard icon={Globe} label="Integrations" value={rows ? counts.http + counts.connector : "—"} tone="violet"
          hint="HTTP endpoints and connector operations" />
        <StatCard icon={Code2} label="Custom code" value={rows ? counts.python : "—"} tone="amber" hint="Tenant-defined Python functions" />
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools by name, description or type…" className="pl-8" />
      </div>

      {rows === null ? (
        <Card><CardContent className="space-y-2 py-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />)}
        </CardContent></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={Wrench} title="No tools yet" body="Seeded tools include calculator, web search and the generative-UI set."
          action={<Button onClick={() => setCreating(true)}>Add tool</Button>} />
      ) : (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" /> Generative UI tools</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  They return one structured spec — <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{'{"ui":{"type":"cards",…}}'}</code> — and the chat renders it natively.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{generative.length} tool{generative.length === 1 ? "" : "s"}</span>
            </div>
            {generative.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
                No generative tools match. Create a browser tool, or attach one of the builtin <code className="font-mono text-xs">ui_*</code> tools.
              </CardContent></Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {generative.map((t) => (
                  <GenerativeCard key={t.id} tool={t} onTest={() => setTesting(t)} onDelete={() => setDeleting(t)} />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Plug className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Data &amp; action tools</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Builtin, HTTP, Python and connector tools. Their output also renders as cards, tables or charts when it can.</p>
              </div>
              <span className="text-xs text-muted-foreground">{others.length} tool{others.length === 1 ? "" : "s"}</span>
            </div>
            {others.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No other tools match “{query}”.</CardContent></Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="divide-y">
                  {others.map((t) => {
                    const Icon = TYPE_ICON[t.type] ?? Wrench;
                    return (
                      <div key={t.id} className="group flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{t.name}</span>
                            <TypeChip type={t.type} />
                          </div>
                          <div className="truncate text-xs text-muted-foreground" title={t.description}>{t.description || "—"}</div>
                        </div>
                        <code className="hidden max-w-[240px] truncate rounded bg-muted/70 px-2 py-1 text-[11px] text-muted-foreground lg:block">
                          {truncate(JSON.stringify(t.config), 42)}
                        </code>
                        <div className="flex shrink-0 gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                          <Button size="sm" variant="outline" onClick={() => setTesting(t)}><Play className="h-3.5 w-3.5" /> Test</Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(t)}>Delete</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </section>
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

function GenerativeCard({ tool: t, onTest, onDelete }: { tool: Tool; onTest: () => void; onDelete: () => void }) {
  const Icon = UI_ICON[t.name] ?? MousePointerClick;
  const params = (t.config?.parameters as any)?.properties;
  const detail = t.type === "frontend"
    ? `${params ? Object.keys(params).length : "?"} browser argument${params && Object.keys(params).length === 1 ? "" : "s"} · waits for the page`
    : "JSON spec in, native UI out";
  return (
    <Card className="group flex flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="h-1 bg-gradient-to-r from-teal-500/70 via-sky-500/50 to-indigo-500/40" />
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500/20 to-sky-500/10 text-teal-600 dark:text-teal-300">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{t.name}</span>
              <TypeChip type={t.type} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={t.description}>{t.description || "Renders a structured answer in the chat."}</p>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2.5">
          <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
          <div className="flex shrink-0 gap-1">
            {t.type !== "frontend" && <Button size="sm" variant="outline" onClick={onTest}><Play className="h-3.5 w-3.5" /> Test</Button>}
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>Delete</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const CONFIG_HELP: Record<string, string> = {
  builtin: "Builtin tools are shipped with the platform: use the tool's shipped name (calculator, tavily_search, ui_cards…).",
  http: "HTTP tools call one endpoint. Config: {\"endpoint\": \"https://…\"}.",
  python: "Python tools load a function you deploy. Config: {\"dotted_path\": \"nmb_marketplace_agent.custom_tools.…\"}.",
  frontend: "Browser tools pause the run, act on the page, then resume. Config: {\"parameters\": {JSON schema}}.",
  connector: "Connector tools expose an operation from the Connectors page. Config: {\"connector\": \"…\", \"operation\": \"…\"}.",
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
          <DialogDescription>Register a tool agents can call. Configuration is a JSON object.</DialogDescription>
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
            <Textarea rows={5} className="font-mono text-xs" value={config} onChange={(e) => setConfig(e.target.value)}
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
          <DialogDescription>Calls the tool directly with the input below. No agent or workflow is involved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Input</Label>
            <Textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={TEST_PLACEHOLDER[tool.name]
                || (tool.type === "builtin" && tool.name === "calculator" ? "2+2"
                  : tool.type === "connector" ? '{"limit": 5}'
                    : "query")} />
            {tool.name.startsWith("ui_") && (
              <p className="text-[11px] text-muted-foreground">The tool returns the UI spec the chat renders. Paste JSON arguments.</p>
            )}
          </div>
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          {result && specs?.length ? (
            <div className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Rendered preview</div>
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
