import { useEffect, useState } from "react";
import {
  AlertTriangle, Bot, Check, Copy, GitBranch, Plug, Plus, Play, ShieldAlert, Sparkles, Trash2,
  Workflow as WorkflowIcon, Zap,
} from "lucide-react";
import {
  api, can, type Agent, type ConnectorDetail, type ConnectorSummary, type Me, type RunView, type Tool,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { JsonView } from "@/components/common/JsonView";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const SECRET_REF = /^(env|file):\S+$/;
const TYPES = ["rest", "file_drop", "flat_file", "email", "rpa_bridge"] as const;
const FIXED_OPS: Record<string, string[]> = { file_drop: ["list", "read", "archive"], flat_file: ["parse"], email: ["fetch_unseen"] };
const TEMPLATES: Record<string, object> = {
  rest: { base_url: "https://", auth: { type: "none" }, timeout_s: 20, retries: 2, operations: { ping: { method: "GET", path: "/" } } },
  file_drop: { inbox: "/data/inbox", archive: "/data/processed", pattern: "*.csv" },
  flat_file: { layout: { kind: "fixed", fields: [{ name: "acct", start: 0, end: 8 }] } },
  email: { host: "imap.example.com", user: "claims@example.com", password_ref: "env:IMAP_PASSWORD", folder: "INBOX", allowed_senders: [] },
  rpa_bridge: { base_url: "https://rpa.internal", auth: { type: "bearer", secret: "env:RPA_TOKEN" }, scripts: ["lookup_account"], timeout_s: 120 },
};

interface Example {
  name: string; title: string; host: string; summary: string;
  config: Record<string, unknown>; operations: string[];
}

/** Keyless public APIs: add, test, enable, then call them from a workflow or an agent tool. */
const EXAMPLES: Example[] = [
  {
    name: "posts_api", title: "Sample posts API", host: "jsonplaceholder.typicode.com",
    summary: "Read-only JSON API with no key. Good first test for outbound calls and agent tools.",
    operations: ["list_posts", "get_post"],
    config: {
      base_url: "https://jsonplaceholder.typicode.com", auth: { type: "none" }, timeout_s: 15, retries: 1,
      operations: {
        list_posts: { method: "GET", path: "/posts", query: { _limit: 5 } },
        get_post: { method: "GET", path: "/posts/{id}" },
      },
    },
  },
  {
    name: "echo_api", title: "Echo endpoint (httpbin)", host: "httpbin.org",
    summary: "Echoes the JSON it receives — the clearest way to demo forwarding a conversation to a CRM.",
    operations: ["create_case", "headers"],
    config: {
      base_url: "https://httpbin.org", auth: { type: "none" }, timeout_s: 15, retries: 1,
      operations: {
        create_case: { method: "POST", path: "/anything" },
        headers: { method: "GET", path: "/headers" },
      },
    },
  },
  {
    name: "weather_api", title: "Open-Meteo weather", host: "api.open-meteo.com",
    summary: "Current weather for Dar es Salaam. No key, no signup.",
    operations: ["forecast"],
    config: {
      base_url: "https://api.open-meteo.com", auth: { type: "none" }, timeout_s: 15, retries: 1,
      operations: {
        forecast: {
          method: "GET", path: "/v1/forecast",
          query: { latitude: -6.7924, longitude: 39.2083, current: "temperature_2m,relative_humidity_2m" },
        },
      },
    },
  },
  {
    name: "holidays_api", title: "Public holidays", host: "date.nager.at",
    summary: "Market holidays by year and country; useful for settlement and business-day steps.",
    operations: ["public_holidays"],
    config: {
      base_url: "https://date.nager.at", auth: { type: "none" }, timeout_s: 15, retries: 1,
      operations: { public_holidays: { method: "GET", path: "/api/v3/PublicHolidays/{year}/{country}" } },
    },
  },
  {
    name: "fx_rates", title: "Exchange rates", host: "open.er-api.com",
    summary: "Daily reference rates, keyless. Pairs with the fx_convert builtin.",
    operations: ["latest"],
    config: {
      base_url: "https://open.er-api.com", auth: { type: "none" }, timeout_s: 15, retries: 1,
      operations: { latest: { method: "GET", path: "/v6/latest/{base}" } },
    },
  },
];

/** Collect every credential-looking field so the UI can reject inline secrets before the server does. */
function badSecrets(o: any, path = ""): string[] {
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => badSecrets(v, path ? `${path}.${k}` : k));
  const key = path.split(".").pop() || "";
  return ["secret", "password", "password_ref", "token"].includes(key) && typeof o === "string" && !SECRET_REF.test(o) ? [path] : [];
}

function hostAllowed(host: string, patterns: string[]): boolean {
  return patterns.some((p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i").test(host));
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
}

export function Connectors({ me }: { me: Me | null }) {
  const tenant = sessionStorage.getItem("nmb_tenant") || "default";
  const [list, setList] = useState<ConnectorSummary[] | null>(null);
  const [egress, setEgress] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const canWrite = can(me, "connectors:write");
  const canAdmin = me?.auth === "admin_token" || !!me?.roles.includes("platform_admin");
  const canWriteWorkflow = can(me, "workflows:write");
  const canRunWorkflow = can(me, "workflows:run");

  const load = () => Promise.all([
    api.listConnectors(),
    api.connectorEgress().then((r) => r.egress_allowed_hosts).catch(() => []),
  ])
    .then(([l, e]) => { setList(l); setEgress(e); setActive((a) => a ?? l[0]?.name ?? null); })
    .catch((e) => { toast.push(e.message, "error"); setList([]); });
  useEffect(() => { load(); }, []);

  async function addExample(ex: Example) {
    try {
      await api.saveConnector(ex.name, { type: "rest", config: ex.config, enabled: false });
      toast.push(`${ex.title} added — test it, then enable it`, "success");
      setActive(ex.name);
      load();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={Plug} title="Connectors"
        description="One interface for core systems, public APIs, legacy files, mailboxes and RPA workers. Workflows and agents call the same connector; secrets stay as vault references."
        actions={canWrite ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add connector</Button> : undefined} />

      <ExamplesCard
        examples={EXAMPLES}
        egress={egress}
        existing={new Set((list ?? []).map((c) => c.name))}
        canWrite={canWrite}
        onAdd={addExample}
      />

      {list === null ? <LoadingBlock rows={3} />
        : list.length === 0 ? (
          <EmptyState icon={Plug} title="No connectors yet"
            body="Add one of the examples above, or create a connector for your own system." />
        ) : (
          <div className="grid gap-4 md:grid-cols-[280px,minmax(0,1fr)]">
            <Card className="self-start"><CardHeader className="pb-2"><CardTitle className="text-sm">Connectors <span className="font-normal text-muted-foreground">({list.length})</span></CardTitle></CardHeader>
              <CardContent className="space-y-1 p-2">
                {list.map((c) => (
                  <button key={c.name} onClick={() => setActive(c.name)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      active === c.name ? "border-primary/40 bg-primary/5 font-medium shadow-sm" : "border-transparent hover:bg-muted/60",
                    )}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      {c.needs_setup ? <StatusBadge value="warn" label="setup" /> : <StatusBadge value={c.enabled ? "pass" : "cancelled"} label={c.enabled ? "on" : "off"} />}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{c.type}</div>
                  </button>))}
              </CardContent></Card>
            {active && (
              <Editor key={active} name={active} canWrite={canWrite} canAdmin={canAdmin}
                canWriteWorkflow={canWriteWorkflow} canRunWorkflow={canRunWorkflow} tenant={tenant}
                onChanged={load} onDeleted={() => { setActive(null); load(); }} />
            )}
          </div>)}
      {adding && <AddDialog onClose={(n) => { setAdding(false); if (n) { setActive(n); load(); } }} />}
    </div>
  );
}

function ExamplesCard({ examples, egress, existing, canWrite, onAdd }: {
  examples: Example[]; egress: string[]; existing: Set<string>; canWrite: boolean;
  onAdd: (ex: Example) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" /> Start from a free public endpoint
          <span className="font-normal text-muted-foreground">(no key needed)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Add one — it starts disabled. Run a test, enable it, then call the same connector from a workflow step or an
          agent tool. The server still enforces <code className="rounded bg-muted px-1">EGRESS_ALLOWED_HOSTS</code>.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {examples.map((ex) => {
            const added = existing.has(ex.name);
            const allowed = egress.length === 0 ? false : hostAllowed(ex.host, egress);
            return (
              <div key={ex.name} className="flex flex-col rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{ex.title}</span>
                  {egress.length > 0 && (
                    <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                      allowed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                      {allowed ? "host allowed" : "egress blocked"}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{ex.host}</div>
                <p className="mt-1.5 line-clamp-3 flex-1 text-xs text-muted-foreground">{ex.summary}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10px] text-muted-foreground">{ex.operations.join(" · ")}</span>
                  <Button size="sm" variant="outline" disabled={!canWrite || added} onClick={() => onAdd(ex)}>
                    {added ? <><Check className="h-3.5 w-3.5" /> Added</> : "Add"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Egress allow-list: {egress.length ? egress.join(", ") : "empty — every outbound call is refused until an admin adds a host"}
        </p>
      </CardContent>
    </Card>
  );
}

function Editor({ name, canWrite, canAdmin, canWriteWorkflow, canRunWorkflow, tenant, onChanged, onDeleted }: {
  name: string; canWrite: boolean; canAdmin: boolean; canWriteWorkflow: boolean; canRunWorkflow: boolean;
  tenant: string; onChanged: () => void; onDeleted: () => void;
}) {
  const [d, setD] = useState<ConnectorDetail | null>(null);
  const [text, setText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();

  const load = () => api.getConnector(name).then((x) => { setD(x); setText(JSON.stringify(x.config, null, 2)); }).catch((e) => toast.push(e.message, "error"));
  useEffect(() => { load(); }, [name]);
  if (!d) return <LoadingBlock rows={5} />;

  let cfg: any = null, parseErr = "";
  try { cfg = JSON.parse(text); } catch (e: any) { parseErr = e.message; }
  const secrets = cfg ? badSecrets(cfg) : [];
  const host = (() => { try { return new URL(cfg?.base_url).hostname; } catch { return ""; } })();
  const hostOk = !host || d.egress_allowed_hosts.some((p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i").test(host));
  const ops: string[] = FIXED_OPS[d.type] ?? (d.type === "rpa_bridge" ? cfg?.scripts ?? [] : Object.keys(cfg?.operations ?? {}));

  async function save() {
    if (!cfg) return;
    try { await api.saveConnector(name, { type: d!.type, config: cfg, enabled: d!.enabled }); toast.push("Connector saved", "success"); await load(); onChanged(); }
    catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">{d.name} <Chip>{d.type}</Chip>
            <StatusBadge value={d.needs_setup ? "warn" : d.enabled ? "pass" : "cancelled"} label={d.needs_setup ? "setup needed" : d.enabled ? "enabled" : "disabled"} />
          </CardTitle>
          {canWrite && <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={d.enabled} disabled={d.needs_setup && !d.enabled}
                onCheckedChange={async (v) => {
                  try { await api.setConnectorEnabled(name, v === true); await load(); onChanged(); }
                  catch (x: any) { toast.push(x.message, "error"); }
                }} />
              Enabled
            </label>
            <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>}
        </CardHeader>
        <CardContent className="space-y-3">
          {d.needs_setup && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              This is a template with a placeholder endpoint. Set the real address and secret reference, save, test, then enable.
            </div>
          )}
          <div className="space-y-1.5"><Label>Configuration (JSON)</Label>
            <Textarea rows={14} className="font-mono text-xs leading-relaxed" value={text} disabled={!canWrite} onChange={(e) => setText(e.target.value)} />
            {parseErr && <p className="text-xs text-red-600 dark:text-red-400">Invalid JSON: {parseErr}</p>}
            {secrets.length > 0 && <p className="text-xs text-red-600 dark:text-red-400">Use vault references, not raw values: {secrets.join(", ")} must look like <code>env:NAME</code> or <code>file:/run/secrets/name</code>.</p>}
            {!hostOk && <p className="text-xs text-amber-600 dark:text-amber-400">Host <b>{host}</b> is not in the server's EGRESS_ALLOWED_HOSTS ({d.egress_allowed_hosts.join(", ") || "empty: all outbound blocked"}). Calls will be refused until an admin adds it.</p>}
          </div>
          {canWrite && <AsyncButton onRun={save} disabled={!!parseErr || secrets.length > 0}>Save changes</AsyncButton>}
        </CardContent>
      </Card>
      {canWrite && <TestPanel name={name} ops={ops} />}
      <Integrations name={name} operations={ops} enabled={d.enabled} canWriteWorkflow={canWriteWorkflow}
        canRunWorkflow={canRunWorkflow} canAdmin={canAdmin} tenant={tenant} />
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete connector ${name}?`}
          description="Workflows that call this connector will fail at that step until another connector is configured."
          confirmLabel="Delete connector" destructive
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { await api.deleteConnector(name); onDeleted(); }}
        />
      )}
    </div>
  );
}

function TestPanel({ name, ops }: { name: string; ops: string[] }) {
  const [op, setOp] = useState(ops[0] ?? "");
  const [params, setParams] = useState("{}");
  const [res, setRes] = useState<{ ok: boolean; result: unknown; error: string | null } | null>(null);
  useEffect(() => { if (!ops.includes(op)) setOp(ops[0] ?? ""); }, [ops.join(",")]);
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Zap className="h-4 w-4 text-primary" /> Test connection</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">Saved configuration is used. Works while the connector is disabled; every test is written to the audit trail.</p>
        <div className="flex gap-2">
          <select className="h-9 rounded-lg border bg-background px-2 font-mono text-xs" value={op} onChange={(e) => setOp(e.target.value)}>
            {ops.map((o) => <option key={o}>{o}</option>)}</select>
          <AsyncButton disabled={!op} onRun={async () => {
            try { setRes(await api.testConnector(name, op, JSON.parse(params || "{}"))); }
            catch (e: any) { setRes({ ok: false, result: null, error: e.message }); }
          }}>Run test</AsyncButton>
        </div>
        <Textarea rows={3} className="font-mono text-xs" value={params} onChange={(e) => setParams(e.target.value)} placeholder='Parameters, e.g. {"body": {"name": "Jane"}}' />
        {res && (res.ok
          ? <div><StatusBadge value="pass" label="reachable" /><JsonView data={res.result} className="mt-2" /></div>
          : <div className="flex items-start gap-2 rounded-lg border border-red-500/35 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{res.error}
          </div>)}
      </CardContent></Card>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  const toast = useToast();
  return (
    <div className="rounded-xl border bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs"
          onClick={async () => { const ok = await copyText(code); toast.push(ok ? "Copied" : "Could not copy", ok ? "success" : "error"); }}>
          <Copy className="h-3 w-3" /> Copy
        </Button>
      </div>
      <pre className="max-h-44 overflow-auto p-3 font-mono text-[11px] leading-relaxed">{code}</pre>
    </div>
  );
}

function Integrations({ name, operations, enabled, canWriteWorkflow, canRunWorkflow, canAdmin, tenant }: {
  name: string; operations: string[]; enabled: boolean;
  canWriteWorkflow: boolean; canRunWorkflow: boolean; canAdmin: boolean; tenant: string;
}) {
  const [tab, setTab] = useState<"workflow" | "agent">("workflow");
  const [op, setOp] = useState(operations[0] ?? "");
  const [params, setParams] = useState("{}");
  const [saved, setSaved] = useState<{ key: string; version: number } | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [toolId, setToolId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [toolResult, setToolResult] = useState("");
  const [usedWorkflows, setUsedWorkflows] = useState<string[]>([]);
  const toast = useToast();
  useEffect(() => { if (!operations.includes(op)) setOp(operations[0] ?? ""); }, [operations.join(",")]);
  useEffect(() => { setSaved(null); setRun(null); setToolResult(""); }, [op]);

  useEffect(() => {
    if (!canAdmin) return;
    Promise.all([api.listTools(tenant), api.listAgents(tenant)])
      .then(([t, a]) => {
        setTools(t); setAgents(a); setAgentId((prev) => prev || a[0]?.id || "");
        const existing = t.find((x) => x.type === "connector" && x.config.connector === name && x.config.operation === op);
        setToolId(existing?.id ?? "");
      })
      .catch(() => { setTools([]); setAgents([]); });
  }, [tenant, name, op, canAdmin]);

  const reloadUsage = () => api.listWorkflows()
    .then((list) => Promise.all(list.map((w) => api.getWorkflow(w.key).catch(() => null))))
    .then((specs) => setUsedWorkflows(specs.filter((s) => s && s.steps.some((st) => st.connector === name)).map((s) => s!.key)))
    .catch(() => {});
  useEffect(() => { reloadUsage(); }, [name, saved?.key]);

  let input: Record<string, unknown> = {};
  let inputErr = "";
  try { input = params.trim() ? JSON.parse(params) : {}; } catch (e: any) { inputErr = e.message; }

  const stepCode = JSON.stringify({
    id: "call_connector", type: "connector", name: `Call ${name}.${op}`,
    connector: name, operation: op, input, next: "done",
  }, null, 2);
  const toolCode = JSON.stringify({
    name: `${name}_${op}`, type: "connector", description: `Call ${name}.${op}`,
    config: { connector: name, operation: op },
  }, null, 2);

  async function createWorkflow() {
    if (inputErr) { toast.push("Step input must be valid JSON", "error"); return; }
    try {
      const res = await api.saveWorkflow({
        key: `connector_demo_${name}`,
        name: `Connector demo · ${name}`,
        description: `Calls ${name}.${op} through a connector step and records the result in the run context.`,
        inputs: {},
        start: "call_connector",
        steps: [
          { id: "call_connector", type: "connector", name: `Call ${name}.${op}`, connector: name, operation: op, input },
          { id: "done", type: "end", outcome: "success" },
        ],
      });
      setSaved(res);
      toast.push(`Workflow ${res.key} saved (v${res.version})`, "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  async function runWorkflow() {
    if (!saved) return;
    try {
      const started = await api.runWorkflow(saved.key, {}, true);
      // POST returns the summary; the step outputs live on the run detail.
      setRun(started.status === "running" ? started : await api.getRun(started.id).catch(() => started));
    } catch (e: any) { toast.push(e.message, "error"); setRun(null); }
  }

  async function createTool() {
    try {
      const t = await api.createTool({
        name: `${name}_${op}`, type: "connector", description: `Call ${name}.${op} from an agent.`,
        config: { connector: name, operation: op }, tenant_id: tenant,
      });
      setTools((prev) => [...(prev ?? []), t]);
      setToolId(t.id);
      toast.push(`Tool ${t.name} created`, "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  async function attachToAgent() {
    const agent = agents?.find((a) => a.id === agentId);
    if (!agent || !toolId) return;
    if (agent.tool_ids.includes(toolId)) { toast.push("Already attached to this agent"); return; }
    try {
      const updated = await api.patchAgent(agent.id, { tool_ids: [...agent.tool_ids, toolId] });
      setAgents((prev) => (prev ?? []).map((a) => (a.id === updated.id ? updated : a)));
      toast.push(`Attached to ${updated.name}`, "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  async function testTool() {
    if (!toolId) return;
    if (inputErr) { toast.push("Parameters must be valid JSON", "error"); return; }
    try {
      const res = await api.testTool(toolId, JSON.stringify(input));
      setToolResult(res.ok ? res.result : "Tool failed");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  const connectorToolIds = (tools ?? []).filter((t) => t.type === "connector" && t.config.connector === name).map((t) => t.id);
  const agentUsers = (agents ?? []).filter((a) => a.tool_ids.some((id) => connectorToolIds.includes(id)));
  const runResult = run?.context?.["call_connector"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><GitBranch className="h-4 w-4 text-primary" /> Use this connector</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          The same connector works in two places. Workflows use a <code className="rounded bg-muted px-1">connector</code> step;
          agents and subagents call it as a tool attached to the agent. Both paths check the egress allow-list, require the
          connector to be enabled and metre <code className="rounded bg-muted px-1">connector_calls</code>.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <span><span className="text-muted-foreground">Workflows:</span> {usedWorkflows.length ? usedWorkflows.join(", ") : "none yet"}</span>
          <span><span className="text-muted-foreground">Agents:</span> {agentUsers.length ? agentUsers.map((a) => a.name).join(", ") : "none yet"}</span>
        </div>

        <div className="flex gap-1 rounded-xl border bg-muted/50 p-1">
          {([
            { id: "workflow", label: "In a workflow", icon: WorkflowIcon },
            { id: "agent", label: "As an agent tool", icon: Bot },
          ] as const).map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  tab === t.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="int-op">Operation</Label>
            <select id="int-op" className="h-9 w-full rounded-lg border bg-background px-2 font-mono text-xs"
              value={op} onChange={(e) => setOp(e.target.value)}>
              {operations.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="int-params">Parameters (JSON)</Label>
            <Input id="int-params" className="font-mono text-xs" value={params} onChange={(e) => setParams(e.target.value)}
              placeholder='{"query": {"limit": 5}}' />
          </div>
        </div>
        {inputErr && <p className="text-xs text-red-600 dark:text-red-400">Invalid JSON: {inputErr}</p>}

        {tab === "workflow" ? (
          <div className="space-y-3">
            <Snippet title="Workflow step" code={stepCode} />
            <div className="flex flex-wrap items-center gap-2">
              <AsyncButton variant="outline" onRun={createWorkflow} disabled={!canWriteWorkflow || !op || !!inputErr || !operations.length}>
                <Plus className="h-3.5 w-3.5" /> Save demo workflow
              </AsyncButton>
              {saved && (
                <AsyncButton onRun={runWorkflow} disabled={!canRunWorkflow || !enabled}>
                  <Play className="h-3.5 w-3.5" /> Run now
                </AsyncButton>
              )}
              {!canWriteWorkflow && <span className="text-xs text-muted-foreground">Needs workflows:write.</span>}
              {saved && !enabled && <span className="text-xs text-amber-600 dark:text-amber-400">Enable the connector to run it.</span>}
            </div>
            {saved && <p className="text-xs text-muted-foreground">Saved as <b>{saved.key}</b> v{saved.version}. Open Workflows to run it with history.</p>}
            {run && (
              <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center gap-2 text-xs">
                  <StatusBadge value={run.status === "completed" ? "pass" : run.status === "failed" ? "fail" : "warn"} label={run.status} />
                  {run.outcome && <span className="text-muted-foreground">outcome: {run.outcome}</span>}
                  {run.error && <span className="text-red-600 dark:text-red-400">{run.error}</span>}
                </div>
                <JsonView data={runResult ?? run.context ?? {}} />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Snippet title="Agent tool" code={toolCode} />
            {!canAdmin ? (
              <p className="text-xs text-muted-foreground">Creating tools and attaching them to agents needs a platform administrator.</p>
            ) : tools === null || agents === null ? <LoadingBlock rows={2} /> : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {toolId ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> tool {`${name}_${op}`} exists
                    </span>
                  ) : (
                    <AsyncButton variant="outline" onRun={createTool} disabled={!operations.length}>
                      <Plus className="h-3.5 w-3.5" /> Create tool
                    </AsyncButton>
                  )}
                  {toolId && (
                    <AsyncButton variant="outline" onRun={testTool} disabled={!!inputErr}>
                      <Play className="h-3.5 w-3.5" /> Test tool
                    </AsyncButton>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[180px] flex-1">
                    <Label htmlFor="int-agent">Attach to agent</Label>
                    <select id="int-agent" className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
                      value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!agents.length}>
                      {agents.length === 0 && <option value="">No agents in this tenant</option>}
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}{toolId && a.tool_ids.includes(toolId) ? " · attached" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <Button variant="outline" onClick={attachToAgent} disabled={!toolId || !agentId}>
                    <Bot className="h-3.5 w-3.5" /> Attach
                  </Button>
                </div>
                {toolResult && <JsonView data={toolResult} />}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddDialog({ onClose }: { onClose: (name?: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("rest");
  const toast = useToast();
  async function go() {
    try { await api.saveConnector(name, { type, config: TEMPLATES[type] as any, enabled: false }); onClose(name); }
    catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add connector</DialogTitle>
          <DialogDescription>Starts disabled with an example configuration for you to edit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase())} placeholder="core_banking" className="font-mono" /></div>
          <div className="space-y-1.5"><Label>Type</Label>
            <select className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><AsyncButton onRun={go} disabled={!name}>Create connector</AsyncButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
