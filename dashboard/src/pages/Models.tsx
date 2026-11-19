import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Cloud, Cpu, HardDrive, Pencil, Play, Plus, Send, Server, Trash2, X } from "lucide-react";

import { api, type Agent, type ModelCfg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatCard } from "@/components/common/StatCard";
import { ModelSelect } from "@/components/common/ModelSelect";
import { ProviderKeys } from "@/components/common/ProviderKeys";
import { ModelConnections, ModelPlaybook, type ModelSection } from "@/components/models/ModelPlaybook";
import type { TabId } from "@/components/layout/nav";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/* ───────────────────────── Providers ───────────────────────── */

const PROVIDER_TONE: Record<string, string> = {
  openai: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  openai_compatible: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  groq: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  openrouter: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  litellm: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  vllm: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  anthropic: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  google_genai: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  ollama: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  sample: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
};
const tone = (id: string) => PROVIDER_TONE[id] ?? "bg-muted text-muted-foreground";

type ProviderInfo = {
  id: string; label: string; base_url: string | null;
  api_key_env: string | null; key_source?: "dashboard" | "environment" | null;
  local: boolean; hint: string;
};

const FALLBACK_PROVIDERS: ProviderInfo[] = [
  { id: "openai", label: "OpenAI", base_url: null, api_key_env: "OPENAI_API_KEY", local: false, hint: "gpt-4o-mini" },
  { id: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1", api_key_env: "GROQ_API_KEY", local: false, hint: "openai/gpt-oss-120b" },
  { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY", local: false, hint: "openai/gpt-oss-120b" },
  { id: "litellm", label: "LiteLLM gateway", base_url: null, api_key_env: "LITELLM_API_KEY", local: true, hint: "groq/openai/gpt-oss-120b" },
  { id: "openai_compatible", label: "OpenAI-compatible server", base_url: null, api_key_env: null, local: true, hint: "model name as served" },
  { id: "ollama", label: "Ollama", base_url: null, api_key_env: null, local: true, hint: "llama3.1:8b" },
  { id: "anthropic", label: "Anthropic", base_url: null, api_key_env: "ANTHROPIC_API_KEY", local: false, hint: "claude-3-5-sonnet-latest" },
  { id: "google_genai", label: "Google Gemini", base_url: null, api_key_env: "GOOGLE_API_KEY", local: false, hint: "gemini-2.0-flash" },
  { id: "sample", label: "Sample (canned demo responses)", base_url: null, api_key_env: null, local: true, hint: "demo" },
];

function keyNote(p?: ProviderInfo) {
  if (!p) return "Add the web address and key name for this service.";
  if (p.local) return "Runs without a key. Add the web address if it lives on another server.";
  if (!p.api_key_env) return "Add the web address and the name of the key to use.";
  const where = p.key_source === "dashboard" ? "saved on the Keys tab" : p.key_source === "environment" ? "found on the server" : "not added yet, add it on the Keys tab";
  return `Uses the key called ${p.api_key_env}, ${where}.`;
}

const Field = ({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) => (
  <div className={cn("space-y-1.5", className)}>
    <Label>{label}</Label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

function ProviderPicker({ providers, value, onChange, cols = "sm:grid-cols-3" }: {
  providers: ProviderInfo[]; value?: string; onChange: (id: string) => void; cols?: string;
}) {
  return (
    <div role="radiogroup" className={cn("grid grid-cols-2 gap-2", cols)}>
      {providers.map((p) => (
        <button
          key={p.id} type="button" role="radio" aria-checked={value === p.id} onClick={() => onChange(p.id)}
          className={cn("flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors",
            value === p.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}
        >
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone(p.id))}>
            {p.local ? <HardDrive className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{p.label}</span>
            <span className="block text-[11px] text-muted-foreground">{p.local ? "Runs on your side" : "Online service"}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export function Models({ tenant, onOpenTab }: { tenant: string; onOpenTab?: (tab: TabId) => void }) {
  const [section, setSection] = useState<ModelSection>("registry");
  return (
    <div>
      <PageHeader
        icon={Cpu}
        title="Models"
        description="The AI brains behind your agents. Connect a model once, then pick it anywhere: agents, workflows, evaluations and training."
      />
      <div className="mb-4"><ModelConnections onOpenTab={onOpenTab} onOpenSection={setSection} /></div>
      <Tabs value={section} onValueChange={(v) => setSection(v as ModelSection)}>
        <TabsList className="h-auto flex-wrap justify-start rounded-xl p-1">
          <TabsTrigger value="registry">My models</TabsTrigger>
          <TabsTrigger value="ollama">On this computer</TabsTrigger>
          <TabsTrigger value="playground">Try a model</TabsTrigger>
          <TabsTrigger value="playbook">Playbook</TabsTrigger>
          <TabsTrigger value="keys">Keys</TabsTrigger>
        </TabsList>
        <TabsContent value="registry" className="mt-4"><Registry tenant={tenant} /></TabsContent>
        <TabsContent value="ollama" className="mt-4"><OllamaTab tenant={tenant} /></TabsContent>
        <TabsContent value="playground" className="mt-4"><ChatPlayground tenant={tenant} /></TabsContent>
        <TabsContent value="playbook" className="mt-4"><ModelPlaybook onOpenTab={onOpenTab} onOpenSection={setSection} /></TabsContent>
        <TabsContent value="keys" className="mt-4"><ProviderKeys page="models" /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────────────── My models ───────────────────────── */

type TestState = { state: "busy" | "ok" | "err"; ms?: number; reply?: string; tools?: "ok" | "fail" | "skipped"; toolErr?: string; msg?: string };

function Registry({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<ModelCfg[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>(FALLBACK_PROVIDERS);
  const [creating, setCreating] = useState<{ provider?: string } | null>(null);
  const [editing, setEditing] = useState<ModelCfg | null>(null);
  const [deleting, setDeleting] = useState<ModelCfg | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const toast = useToast();

  async function refresh() {
    try {
      const [m, a] = await Promise.all([api.listModels(tenant), api.listAgents(tenant)]);
      setRows(m); setAgents(a);
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, [tenant]);
  useEffect(() => { api.listProviders().then(setProviders).catch(() => {}); }, []);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of agents) counts.set(a.model, (counts.get(a.model) ?? 0) + 1);
    return counts;
  }, [agents]);

  const groups = useMemo(() => {
    const by = new Map<string, ModelCfg[]>();
    for (const m of rows) by.set(m.provider, [...(by.get(m.provider) ?? []), m]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const inUse = rows.filter((m) => usage.has(m.name)).length;
  const label = (id: string) => providers.find((p) => p.id === id)?.label ?? id;

  async function test(m: ModelCfg) {
    setTests((s) => ({ ...s, [m.id]: { state: "busy" } }));
    try {
      const r: any = await api.testModel(m.id);
      const tc = r.tool_calls;
      setTests((s) => ({ ...s, [m.id]: { state: "ok", ms: r.latency_ms, reply: r.reply, tools: !tc ? undefined : tc.skipped ? "skipped" : tc.ok ? "ok" : "fail", toolErr: tc?.error } }));
    } catch (e: any) { setTests((s) => ({ ...s, [m.id]: { state: "err", msg: e.message } })); }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Server} label="Providers" value={groups.length} tone="sky" />
        <StatCard icon={Cpu} label="Models connected" value={rows.length} tone="violet" />
        <StatCard icon={Play} label="Working for agents" value={inUse} tone="emerald" hint="Used by at least one agent" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-muted/20 p-5">
          <div className="text-base font-semibold">Connect your first model</div>
          <p className="mb-4 mt-1 max-w-xl text-sm text-muted-foreground">Choose where the model lives. You can add more later and switch between them any time.</p>
          <ProviderPicker providers={providers} onChange={(id) => setCreating({ provider: id })} cols="sm:grid-cols-3 lg:grid-cols-4" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Connected models show up first in every model list across the app.</p>
            <Button onClick={() => setCreating({})}><Plus /> Connect a model</Button>
          </div>
          <div className="grid items-start gap-4 md:grid-cols-2">
            {groups.map(([provider, models]) => (
              <Card key={provider}>
                <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
                  <CardTitle className="flex items-center gap-2.5 text-sm">
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", tone(provider))}><Server className="h-4 w-4" /></span>
                    {label(provider)}
                  </CardTitle>
                  <Badge variant="secondary">{models.length}</Badge>
                </CardHeader>
                <CardContent className="p-0">
                  {models.map((m) => {
                    const used = usage.get(m.name) ?? 0;
                    const t = tests[m.id];
                    return (
                      <div key={m.id} className="border-t px-4 py-3 first:border-t-0">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{m.name}</span>
                              {used > 0 && <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">{used} agent{used === 1 ? "" : "s"}</span>}
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">{m.model_name}</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {m.base_url ? `At ${m.base_url}` : "Standard address"}{m.api_key_env ? `, key ${m.api_key_env}` : ""}
                            </div>
                          </div>
                          <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={t?.state === "busy"} onClick={() => test(m)}>
                            <Play className={cn("h-3.5 w-3.5", t?.state === "busy" && "animate-pulse")} /> {t?.state === "busy" ? "Testing…" : "Test"}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete" aria-label={`Delete ${m.name}`} onClick={() => setDeleting(m)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                        {t && t.state !== "busy" && <TestResult t={t} />}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {creating && <ModelForm tenant={tenant} providers={providers} startProvider={creating.provider} onClose={() => { setCreating(null); refresh(); }} />}
      {editing && <ModelForm tenant={tenant} providers={providers} initial={editing} onClose={() => { setEditing(null); refresh(); }} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description={`${usage.get(deleting.name) ? `${usage.get(deleting.name)} agent(s) use it right now. ` : ""}Agents pointing at this model will switch to the default.`}
          confirmLabel="Delete model" destructive onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.deleteModel(deleting.id); toast.push("Model deleted", "success"); refresh(); }}
        />
      )}
    </div>
  );
}

function TestResult({ t }: { t: TestState }) {
  if (t.state === "err") {
    return (
      <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>It did not answer. {t.msg}</span>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1.5 rounded-lg bg-muted/40 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3" /> Answered in {t.ms} ms</span>
        {t.tools === "ok" && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">Can use tools</span>}
        {t.tools === "fail" && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-700 dark:text-red-400" title={t.toolErr}>Cannot use tools</span>}
        {t.tools === "skipped" && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Tools not checked</span>}
      </div>
      {t.reply && <p className="line-clamp-2 italic text-muted-foreground" dir="auto">“{t.reply.slice(0, 160)}”</p>}
    </div>
  );
}

/* ───────────────────────── Connect form ───────────────────────── */

type Extra = { key: string; value: string };
const KNOWN_PARAMS = ["temperature", "max_tokens", "top_p"];
const parseVal = (v: string): unknown => { try { return JSON.parse(v); } catch { return v; } };
const showVal = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function OptionalSlider({ label, value, onChange, min, max, step, auto, describe }: {
  label: string; value: number | null; onChange: (v: number | null) => void; min: number; max: number; step: number; auto: number; describe: (v: number) => string;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : auto)} />
          Let the provider decide
        </label>
      </div>
      <input type="range" aria-label={label} className="mt-2 w-full accent-primary disabled:opacity-40" min={min} max={max} step={step} disabled={value === null}
        value={value ?? auto} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{value === null ? "Default" : `${value}, ${describe(value)}`}</span>
      </div>
    </div>
  );
}

function ModelForm({ tenant, initial, providers, startProvider, onClose }: {
  tenant: string; initial?: ModelCfg; providers: ProviderInfo[]; startProvider?: string; onClose: () => void;
}) {
  const p0: Record<string, unknown> = (initial?.params as any) ?? {};
  const [name, setName] = useState(initial?.name || "");
  const [nameTouched, setNameTouched] = useState(!!initial);
  const [provider, setProvider] = useState(initial?.provider || startProvider || "openai");
  const [modelName, setModelName] = useState(initial?.model_name || "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url || "");
  const [apiKeyEnv, setApiKeyEnv] = useState(initial?.api_key_env || "");
  const [temp, setTemp] = useState<number | null>(typeof p0.temperature === "number" ? p0.temperature : null);
  const [topP, setTopP] = useState<number | null>(typeof p0.top_p === "number" ? p0.top_p : null);
  const [maxTokens, setMaxTokens] = useState(p0.max_tokens != null ? String(p0.max_tokens) : "");
  const [extras, setExtras] = useState<Extra[]>(Object.entries(p0).filter(([k]) => !KNOWN_PARAMS.includes(k)).map(([key, v]) => ({ key, value: showVal(v) })));
  const toast = useToast();
  const preset = providers.find((p) => p.id === provider);

  function pickProvider(id: string) {
    const prev = providers.find((p) => p.id === provider);
    const next = providers.find((p) => p.id === id);
    setProvider(id);
    if (!next) return;
    // Only replace values that came from the previous preset; keep anything the user typed.
    if (!baseUrl || baseUrl === (prev?.base_url ?? "")) setBaseUrl(next.base_url ?? "");
    if (!apiKeyEnv || apiKeyEnv === (prev?.api_key_env ?? "")) setApiKeyEnv(next.api_key_env ?? "");
  }
  useEffect(() => { if (startProvider && !initial) pickProvider(startProvider); /* eslint-disable-next-line */ }, []);

  async function save() {
    try {
      const params: Record<string, unknown> = {};
      if (temp !== null) params.temperature = temp;
      if (topP !== null) params.top_p = topP;
      if (maxTokens.trim() && !Number.isNaN(Number(maxTokens))) params.max_tokens = Math.round(Number(maxTokens));
      for (const x of extras) if (x.key.trim()) params[x.key.trim()] = parseVal(x.value);
      const body = { name: name.trim(), provider, model_name: modelName.trim(), base_url: baseUrl.trim() || null, api_key_env: apiKeyEnv.trim() || null, params };
      if (initial) { await api.patchModel(initial.id, body); toast.push("Saved", "success"); }
      else { await api.createModel({ ...body, tenant_id: tenant }); toast.push("Model connected", "success"); }
      onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  const providerList = providers.some((p) => p.id === provider) ? providers : [...providers, { id: provider, label: provider, base_url: null, api_key_env: null, local: false, hint: "" }];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "Connect a model"}</DialogTitle>
          <DialogDescription>Pick where it runs, tell us which model, and tune how it behaves.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Field label="Where does it run?"><ProviderPicker providers={providerList} value={provider} onChange={pickProvider} /></Field>
          <p className="-mt-3 text-xs text-muted-foreground">{keyNote(preset)}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Model" hint="The exact model name from the provider.">
              <Input className="font-mono text-xs" value={modelName} placeholder={preset?.hint || "gpt-4o-mini"}
                onChange={(e) => { setModelName(e.target.value); if (!nameTouched) setName(e.target.value.split("/").pop() ?? ""); }} />
            </Field>
            <Field label="Nickname" hint="How it appears in agent and workflow lists.">
              <Input value={name} placeholder="fast-and-cheap" onChange={(e) => { setName(e.target.value); setNameTouched(true); }} />
            </Field>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">How should it behave?</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <OptionalSlider label="Creativity" value={temp} onChange={setTemp} min={0} max={2} step={0.1} auto={0.7}
                describe={(v) => (v < 0.3 ? "precise and repeatable" : v < 0.9 ? "balanced" : "imaginative")} />
              <div className="rounded-xl border p-3">
                <Label>Reply length</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[["Short", "256"], ["Medium", "1024"], ["Long", "4096"], ["Provider default", ""]].map(([t, v]) => (
                    <button key={t} type="button" onClick={() => setMaxTokens(v)}
                      className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", maxTokens === v ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>{t}</button>
                  ))}
                </div>
                <Input type="number" min={1} className="mt-2 h-8 text-xs" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="Or type a limit in tokens" aria-label="Maximum reply length in tokens" />
              </div>
            </div>
          </div>

          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
            <div className="mt-3 space-y-4">
              <Field label="Web address" hint="Only needed for a self-hosted server or gateway.">
                <Input className="font-mono text-xs" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </Field>
              <Field label="Name of the key to use" hint="We look it up on the Keys tab, then on the server. The key itself is never stored here.">
                <Input className="font-mono text-xs" value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value)} placeholder="ANTHROPIC_API_KEY" />
              </Field>
              <OptionalSlider label="Word variety" value={topP} onChange={setTopP} min={0.1} max={1} step={0.05} auto={1}
                describe={(v) => (v < 0.5 ? "sticks to likely words" : "draws on a wide range of words")} />
              <Field label="Other settings" hint="Extra options your provider understands.">
                <div className="space-y-2">
                  {extras.map((x, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input className="font-mono text-xs" value={x.key} placeholder="setting" aria-label="Setting name" onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, key: e.target.value } : y)))} />
                      <Input className="font-mono text-xs" value={x.value} placeholder="value" aria-label="Setting value" onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Remove setting" onClick={() => setExtras(extras.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="outline" onClick={() => setExtras([...extras, { key: "", value: "" }])}><Plus /> Add a setting</Button>
                </div>
              </Field>
            </div>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name.trim() || !modelName.trim()}>{initial ? "Save changes" : "Connect model"}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── On this computer (Ollama) ───────────────────────── */

const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const SUGGESTED = ["llama3.2", "qwen2.5", "mistral", "gemma2", "phi3"];

function OllamaTab({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Array<{ name: string; size: number; params: string | null; family: string | null }>>([]);
  const [catalog, setCatalog] = useState<Array<{ runtime: string; model_name: string; provider: string; base_url: string }>>([]);
  const [pullName, setPullName] = useState("");
  const [pull, setPull] = useState<{ status: string; pct: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const toast = useToast();

  async function refresh() {
    setErr(null);
    try { setRows(await api.listOllama()); } catch (e: any) { setErr(e.message); }
    api.catalog().then(setCatalog).catch(() => {});
  }
  useEffect(() => { refresh(); }, []);

  async function doPull(name = pullName) {
    if (!name.trim()) return;
    setPull({ status: "Starting…", pct: null }); setErr(null);
    try {
      const res = await api.pullOllama(name);
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const block of parts) {
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.error) throw new Error(ev.error);
            setPull({ status: ev.status || "Working…", pct: ev.total ? Math.round(((ev.completed ?? 0) / ev.total) * 100) : null });
          } catch (e: any) { if (e instanceof SyntaxError) continue; throw e; }
        }
      }
      toast.push(`${name} is ready`, "success");
      setPullName(""); refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setPull(null); }
  }

  async function register(m: { runtime: string; model_name: string; provider: string; base_url: string }) {
    try {
      await api.createModel({ name: `${m.runtime}-${m.model_name}`.replace(/[^\w.-]/g, "-"), provider: m.provider, model_name: m.model_name, base_url: m.base_url, tenant_id: tenant });
      toast.push("Model connected", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><HardDrive className="h-4 w-4" /> Downloaded to this computer</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {err && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{err}</div>}
          {rows.length === 0 ? (
            <EmptyState title="Nothing downloaded yet" body="Download a model below and it runs privately on this machine, with no key needed." />
          ) : (
            <div className="divide-y rounded-xl border">
              {rows.map((m) => (
                <div key={m.name} className="flex items-center justify-between gap-2 p-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{[m.params, m.family, bytes(m.size)].filter(Boolean).join(", ")}</div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(m.name)}>Remove</Button>
                </div>
              ))}
            </div>
          )}
          <Field label="Download a model">
            <div className="flex gap-2">
              <Input placeholder="llama3.2" value={pullName} onChange={(e) => setPullName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !pull && doPull()} className="font-mono" disabled={!!pull} />
              <AsyncButton onRun={() => doPull()} disabled={!pullName.trim() || !!pull}>{pull ? "Downloading…" : "Download"}</AsyncButton>
            </div>
          </Field>
          {!pull && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Popular:</span>
              {SUGGESTED.map((s) => <button key={s} type="button" onClick={() => setPullName(s)} className="rounded-full border px-2.5 py-0.5 font-mono transition-colors hover:bg-muted/50">{s}</button>)}
            </div>
          )}
          {pull && (
            <div className="space-y-1.5" aria-live="polite">
              <div className="flex justify-between text-xs text-muted-foreground"><span className="truncate">{pull.status}</span>{pull.pct !== null && <span>{pull.pct}%</span>}</div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full bg-primary transition-all", pull.pct === null && "w-1/3 animate-pulse")} style={pull.pct !== null ? { width: `${pull.pct}%` } : undefined} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Ready to connect</CardTitle></CardHeader>
        <CardContent>
          {catalog.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other local runtimes were found. Models you download here appear automatically.</p>
          ) : (
            <div className="divide-y rounded-xl border">
              {catalog.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">{c.model_name}</div>
                    <div className="text-xs text-muted-foreground">Runs on {c.runtime}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => register(c)}><Plus /> Connect</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {deleting && (
        <ConfirmDialog
          title={`Remove ${deleting} from this computer?`} description="The files are deleted from this machine. You can download it again later."
          confirmLabel="Remove model" destructive onClose={() => setDeleting(null)}
          onConfirm={async () => { try { await api.deleteOllama(deleting); toast.push("Model removed", "success"); refresh(); } catch (e: any) { toast.push(e.message, "error"); } }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Try a model ───────────────────────── */

type Turn = { role: "user" | "assistant"; content: string };
const STARTERS = ["Say hello in three languages.", "Explain what a loan is to a 10 year old.", "Write a polite reply to a late payment."];

function usageText(u: any) {
  if (!u || typeof u !== "object") return null;
  const inp = u.prompt_tokens ?? u.input_tokens, out = u.completion_tokens ?? u.output_tokens;
  if (inp == null && out == null) return u.total_tokens != null ? `${u.total_tokens} tokens` : null;
  return `${inp ?? 0} in, ${out ?? 0} out`;
}

function ChatPlayground({ tenant }: { tenant: string }) {
  const [models, setModels] = useState<ModelCfg[]>([]);
  const [model, setModel] = useState("ollama:llama3.1:8b");
  const [system, setSystem] = useState("");
  const [turns, setTurns] = useState<Turn[]>([{ role: "user", content: "" }]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listModels(tenant).then((m) => { setModels(m); if (m[0]) setModel(m[0].name); }).catch(() => {}); }, [tenant]);

  const messages = [...(system.trim() ? [{ role: "system", content: system.trim() }] : []), ...turns.filter((t) => t.content.trim())];
  const canRun = !busy && !!model && turns.some((t) => t.role === "user" && t.content.trim());

  async function run() {
    if (!canRun) return;
    setBusy(true); setErr(null); setResult(null);
    try { setResult(await api.chat({ model, messages, tenant_id: tenant })); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  const setTurn = (i: number, p: Partial<Turn>) => setTurns((prev) => prev.map((t, j) => (j === i ? { ...t, ...p } : t)));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Your conversation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Model"><ModelSelect value={model} onChange={setModel} models={models} /></Field>
          <Field label="Instructions (optional)" hint="Tell the model who it is and how to answer.">
            <Textarea rows={2} value={system} onChange={(e) => setSystem(e.target.value)} placeholder="You are a friendly support agent for a microfinance bank." />
          </Field>
          <div className="space-y-2">
            {turns.map((t, i) => (
              <div key={i} className={cn("space-y-1", t.role === "assistant" && "pl-6")}>
                <div className="flex items-center justify-between">
                  <button type="button" className="text-xs font-medium underline-offset-4 hover:underline" title="Switch who says this"
                    onClick={() => setTurn(i, { role: t.role === "user" ? "assistant" : "user" })}>
                    {t.role === "user" ? "You say" : "Assistant said"}
                  </button>
                  {turns.length > 1 && <button type="button" aria-label="Remove message" className="text-muted-foreground hover:text-foreground" onClick={() => setTurns(turns.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>}
                </div>
                <Textarea rows={3} value={t.content} dir="auto" onChange={(e) => setTurn(i, { content: e.target.value })}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(); }} placeholder={t.role === "user" ? "Type your message" : "What the assistant said earlier"} />
              </div>
            ))}
          </div>
          {turns.length === 1 && !turns[0].content && (
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((s) => <button key={s} type="button" onClick={() => setTurn(0, { content: s })} className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted/50">{s}</button>)}
            </div>
          )}
          {err && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setTurns((p) => [...p, { role: p[p.length - 1]?.role === "user" ? "assistant" : "user", content: "" }])}><Plus /> Add a message</Button>
            <AsyncButton onRun={run} disabled={!canRun}><Send /> Send</AsyncButton>
            <span className="text-xs text-muted-foreground">or press Ctrl+Enter</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">What it says</CardTitle></CardHeader>
        <CardContent>
          {busy ? (
            <div className="flex min-h-40 items-center justify-center gap-1.5" aria-live="polite" aria-label="Thinking">
              {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms` }} />)}
            </div>
          ) : !result ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
              <Play className="h-7 w-7 opacity-40" />
              Send a message to hear back from {model || "a model"}.
            </div>
          ) : (
            <>
              <div className="w-fit max-w-full whitespace-pre-wrap rounded-2xl rounded-bl-sm border bg-muted/30 px-4 py-3 text-sm leading-relaxed" dir="auto">{result.output}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary">{result.latency_ms} ms</Badge>
                {usageText(result.usage) && <Badge variant="outline">{usageText(result.usage)}</Badge>}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}