import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Cpu, Pencil, Play, Plus, Server, Trash2 } from "lucide-react";

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
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const PROVIDER_TONE: Record<string, string> = {
  openai: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  anthropic: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  google_genai: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  ollama: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

export function Models({ tenant }: { tenant: string }) {
  return (
    <div>
      <PageHeader icon={Cpu} title="Models" description="Registry of provider endpoints and locally-served runtimes." />
      <Tabs defaultValue="registry">
        <TabsList className="h-10 rounded-xl p-1">
          <TabsTrigger value="registry">Registry</TabsTrigger>
          <TabsTrigger value="ollama">Ollama</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
        </TabsList>
        <TabsContent value="registry" className="mt-4"><Registry tenant={tenant} /></TabsContent>
        <TabsContent value="ollama" className="mt-4"><OllamaTab tenant={tenant} /></TabsContent>
        <TabsContent value="playground" className="mt-4"><ChatPlayground tenant={tenant} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Registry({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<ModelCfg[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ModelCfg | null>(null);
  const [deleting, setDeleting] = useState<ModelCfg | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const [m, a] = await Promise.all([api.listModels(tenant), api.listAgents(tenant)]);
      setRows(m); setAgents(a);
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of agents) counts.set(a.model, (counts.get(a.model) ?? 0) + 1);
    return counts;
  }, [agents]);

  const groups = useMemo(() => {
    const by = new Map<string, ModelCfg[]>();
    for (const m of rows) {
      const list = by.get(m.provider) ?? [];
      list.push(m);
      by.set(m.provider, list);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const inUse = rows.filter((m) => usage.has(m.name)).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Server} label="Providers" value={groups.length} tone="sky" />
        <StatCard icon={Cpu} label="Registered models" value={rows.length} tone="violet" />
        <StatCard icon={Play} label="Wired to agents" value={inUse} tone="emerald" hint="Used by at least one agent" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Registered models appear first in every model dropdown across agents and workflows.
        </p>
        <Button onClick={() => setCreating(true)}><Plus /> Register model</Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No models registered" body="Register one to use it by id in agents." />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {groups.map(([provider, models]) => (
            <Card key={provider}>
              <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", PROVIDER_TONE[provider] ?? "bg-muted text-muted-foreground")}>
                    <Server className="h-3.5 w-3.5" />
                  </span>
                  {provider}
                </CardTitle>
                <Badge variant="secondary">{models.length}</Badge>
              </CardHeader>
              <CardContent className="p-0">
                {models.map((m) => {
                  const used = usage.get(m.name) ?? 0;
                  return (
                    <div key={m.id} className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{m.name}</span>
                          {used > 0 && (
                            <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                              {used} agent{used === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground">{m.model_name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {m.base_url || "default endpoint"}{m.api_key_env ? ` · ${m.api_key_env}` : ""}
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Test"
                        onClick={async () => {
                          try { const r = await api.testModel(m.id); toast.push(`OK · ${r.latency_ms}ms · ${r.reply.slice(0, 60)}`, "success"); }
                          catch (e: any) { toast.push(e.message, "error"); }
                        }}>
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => setEditing(m)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete"
                        onClick={() => setDeleting(m)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {creating && (
        <ModelForm
          tenant={tenant}
          onClose={() => { setCreating(false); refresh(); }}
        />
      )}
      {editing && (
        <ModelForm
          tenant={tenant}
          initial={editing}
          onClose={() => { setEditing(null); refresh(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description={`${usage.get(deleting.name) ? `It is currently used by ${usage.get(deleting.name)} agent(s). ` : ""}Agents pointing at this model will fall back to the default.`}
          confirmLabel="Delete model" destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteModel(deleting.id);
            toast.push("Model deleted", "success");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ModelForm({
  tenant, initial, onClose,
}: {
  tenant: string;
  initial?: ModelCfg;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [provider, setProvider] = useState(initial?.provider || "openai");
  const [modelName, setModelName] = useState(initial?.model_name || "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url || "");
  const [apiKeyEnv, setApiKeyEnv] = useState(initial?.api_key_env || "");
  const [params, setParams] = useState(JSON.stringify(initial?.params || {}, null, 2));
  const toast = useToast();

  async function save() {
    try {
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(params || "{}"); }
      catch { throw new Error("Params is not valid JSON"); }
      if (initial) {
        await api.patchModel(initial.id, {
          name, provider, model_name: modelName,
          base_url: baseUrl || null, api_key_env: apiKeyEnv || null,
          params: parsed,
        });
        toast.push("Saved", "success");
      } else {
        await api.createModel({
          name, provider, model_name: modelName,
          base_url: baseUrl || null, api_key_env: apiKeyEnv || null,
          params: parsed, tenant_id: tenant,
        });
        toast.push("Registered", "success");
      }
      onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "Register model"}</DialogTitle>
          <DialogDescription>Registered models appear first in every model dropdown across agents and workflows.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name (used in agents)</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. gpt-4o-fast" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
                <option value="google_genai">google_genai</option>
                <option value="ollama">ollama</option>
              </select>
            </div>
            <div className="space-y-1.5"><Label>Model name</Label><Input className="font-mono text-xs" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="gpt-4o-mini" /></div>
          </div>
          <div className="space-y-1.5"><Label>Base URL (optional)</Label><Input className="font-mono text-xs" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" /></div>
          <div className="space-y-1.5"><Label>API key env var (optional)</Label><Input className="font-mono text-xs" value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value)}
            placeholder="ANTHROPIC_API_KEY" />
            <div className="text-xs text-muted-foreground">The platform reads the key from the environment — it is never stored in the database.</div>
          </div>
          <div className="space-y-1.5"><Label>Params (JSON)</Label><Textarea rows={4} className="font-mono text-xs" value={params} onChange={(e) => setParams(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !modelName}>{initial ? "Save changes" : "Register model"}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OllamaTab({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Array<{ name: string; size: number; params: string | null; family: string | null }>>([]);
  const [catalog, setCatalog] = useState<Array<{ runtime: string; model_name: string; provider: string; base_url: string }>>([]);
  const [pullName, setPullName] = useState("");
  const [pullLog, setPullLog] = useState<string[]>([]);
  const [pulling, setPulling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const toast = useToast();

  async function refresh() {
    setErr(null);
    try { setRows(await api.listOllama()); } catch (e: any) { setErr(e.message); }
    api.catalog().then(setCatalog).catch(() => {});
  }
  useEffect(() => { refresh(); }, []);

  async function pull() {
    setPulling(true); setPullLog([]); setErr(null);
    try {
      const res = await api.pullOllama(pullName);
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
            if (ev.error) setPullLog((prev) => [...prev, `error: ${ev.error}`]);
            else setPullLog((prev) => [...prev, ev.status || JSON.stringify(ev)]);
          } catch { /* ignore */ }
        }
      }
      toast.push(`Pulled ${pullName}`, "success");
      setPullName("");
      refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setPulling(false); }
  }

  async function deleteOllamaModel(name: string) {
    try { await api.deleteOllama(name); toast.push("Deleted from Ollama", "success"); refresh(); }
    catch (e: any) { toast.push(e.message, "error"); }
  }

  async function register(m: { runtime: string; model_name: string; provider: string; base_url: string }) {
    try {
      await api.createModel({
        name: `${m.runtime}-${m.model_name}`.replace(/[^\w.-]/g, "-"),
        provider: m.provider, model_name: m.model_name,
        base_url: m.base_url, tenant_id: tenant,
      });
      toast.push("Registered", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">Installed models</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {err && <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{err}</div>}
          {rows.length === 0 ? (
            <EmptyState title="No local models" body="Pull one below to serve it from this machine." />
          ) : (
            <div className="divide-y rounded-xl border">
              {rows.map((m) => (
                <div key={m.name} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.params || "—"} · {m.family || "—"} · {(m.size / 1e9).toFixed(2)} GB
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(m.name)}>Delete</Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input placeholder="llama3.2" value={pullName} onChange={(e) => setPullName(e.target.value)} className="font-mono" />
            <AsyncButton onRun={pull} disabled={!pullName || pulling}>{pulling ? "Pulling…" : "Pull"}</AsyncButton>
          </div>
          {pullLog.length > 0 && (
            <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-2.5 text-[11px] leading-relaxed">{pullLog.slice(-20).join("\n")}</pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Catalog</CardTitle></CardHeader>
        <CardContent>
          {catalog.length === 0 ? (
            <div className="text-sm text-muted-foreground">No runtimes configured besides Ollama.</div>
          ) : (
            <div className="divide-y rounded-xl border">
              {catalog.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs">{c.model_name}</div>
                    <div className="text-xs text-muted-foreground">{c.runtime} · {c.provider}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => register(c)}>Register</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting} from Ollama?`}
          description="The model files are removed from this machine. You can pull them again later."
          confirmLabel="Delete model" destructive
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteOllamaModel(deleting)}
        />
      )}
    </div>
  );
}

function ChatPlayground({ tenant }: { tenant: string }) {
  const [models, setModels] = useState<ModelCfg[]>([]);
  const [model, setModel] = useState("ollama:llama3.1:8b");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([{ role: "user", content: "" }]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listModels(tenant)
      .then((m) => { setModels(m); if (m[0]) setModel(m[0].name); })
      .catch(() => {});
  }, [tenant]);

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try {
      setResult(await api.chat({ model, messages, tenant_id: tenant }));
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">Prompt</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Model</Label>
            <ModelSelect value={model} onChange={setModel} models={models} />
          </div>
          {messages.map((m, i) => (
            <div key={i} className="space-y-1.5">
              <Label>Message {i + 1} · <span className="font-mono text-xs text-muted-foreground">{m.role}</span></Label>
              <Textarea rows={3} value={m.content} onChange={(e) => setMessages((prev) => prev.map((mm, j) => j === i ? { ...mm, content: e.target.value } : mm))} />
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setMessages((prev) => [...prev, { role: "user", content: "" }])}>Add message</Button>
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          <div><AsyncButton onRun={run} disabled={busy || !model}>Run prompt</AsyncButton></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Output</CardTitle></CardHeader>
        <CardContent>
          {!result ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
              <Play className="h-7 w-7 opacity-40" />
              Run a prompt to see the response.
            </div>
          ) : (
            <>
              <div className="whitespace-pre-wrap rounded-xl border bg-muted/30 p-3 text-sm leading-relaxed">{result.output}</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                <Badge variant="secondary">{result.latency_ms}ms</Badge>
                <Badge variant="outline">tokens {JSON.stringify(result.usage)}</Badge>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
