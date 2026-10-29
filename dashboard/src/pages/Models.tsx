import { useEffect, useState } from "react";
import { api, getToken, type ModelCfg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { useToast } from "@/components/ui/toast";

const BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/$/, "");

export function Models({ tenant }: { tenant: string }) {
  return (
    <div>
      <PageHeader title="Models" description="Registry of provider endpoints and locally-served runtimes." />
      <Tabs defaultValue="registry">
        <TabsList>
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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ModelCfg | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listModels(tenant)); } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => setCreating(true)}>Register model</Button></div>
      {rows.length === 0 ? (
        <EmptyState title="No models registered" body="Register one to use it by id in agents." />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Provider</TH><TH>Model</TH><TH>Base URL</TH><TH>API env</TH><TH></TH></TR></THead>
            <TBody>
              {rows.map((m) => (
                <TR key={m.id}>
                  <TD className="font-medium">{m.name}</TD>
                  <TD><Badge variant="secondary">{m.provider}</Badge></TD>
                  <TD className="font-mono text-xs">{m.model_name}</TD>
                  <TD className="font-mono text-xs">{m.base_url || "—"}</TD>
                  <TD className="font-mono text-xs">{m.api_key_env || "—"}</TD>
                  <TD>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { const r = await api.testModel(m.id); toast.push(`OK · ${r.latency_ms}ms · ${r.reply.slice(0, 60)}`, "success"); }
                        catch (e: any) { toast.push(e.message, "error"); }
                      }}>Test</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                        if (!confirm(`Delete ${m.name}?`)) return;
                        try { await api.deleteModel(m.id); refresh(); } catch (e: any) { toast.push(e.message, "error"); }
                      }}>Delete</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
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
        <DialogHeader><DialogTitle>{initial ? "Edit model" : "Register model"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name (used in agents)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Provider</Label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
                <option value="google_genai">google_genai</option>
                <option value="ollama">ollama</option>
              </select>
            </div>
            <div><Label>Model name</Label><Input value={modelName} onChange={(e) => setModelName(e.target.value)} /></div>
          </div>
          <div><Label>Base URL (optional)</Label><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>
          <div><Label>API key env var (optional)</Label><Input value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value)}
            placeholder="ANTHROPIC_API_KEY" /></div>
          <div><Label>Params (JSON)</Label><Textarea rows={4} value={params} onChange={(e) => setParams(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !modelName}>{initial ? "Save" : "Register"}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateModel({ tenant, onClose }: { tenant: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [params, setParams] = useState("{}");
  const toast = useToast();

  async function save() {
    try {
      await api.createModel({
        name, provider, model_name: modelName,
        base_url: baseUrl || null, api_key_env: apiKeyEnv || null,
        params: JSON.parse(params || "{}"), tenant_id: tenant,
      });
      toast.push("Registered", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Register model</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name (used in agents)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Provider</Label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
                <option value="google_genai">google_genai</option>
                <option value="ollama">ollama</option>
              </select>
            </div>
            <div><Label>Model name</Label><Input value={modelName} onChange={(e) => setModelName(e.target.value)} /></div>
          </div>
          <div><Label>Base URL (optional)</Label><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>
          <div><Label>API key env var (optional)</Label><Input value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value)}
            placeholder="ANTHROPIC_API_KEY" /></div>
          <div><Label>Params (JSON)</Label><Textarea rows={4} value={params} onChange={(e) => setParams(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !modelName}>Register</AsyncButton>
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

  async function deleteModel(name: string) {
    if (!confirm(`Delete ${name} from Ollama?`)) return;
    try { await api.deleteOllama(name); toast.push("Deleted", "success"); refresh(); }
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
        <CardHeader><CardTitle>Installed models</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {err && <div className="text-xs text-destructive">{err}</div>}
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No models. Pull one below.</div>
          ) : (
            <div className="divide-y rounded-md border">
              {rows.map((m) => (
                <div key={m.name} className="flex items-center justify-between p-2 text-sm">
                  <div>
                    <div className="font-mono text-xs">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.params || "—"} · {m.family || "—"} · {(m.size / 1e9).toFixed(2)} GB
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteModel(m.name)}>Delete</Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input placeholder="llama3.2" value={pullName} onChange={(e) => setPullName(e.target.value)} />
            <Button onClick={pull} disabled={!pullName || pulling}>{pulling ? "Pulling…" : "Pull"}</Button>
          </div>
          {pullLog.length > 0 && (
            <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 text-xs">{pullLog.slice(-20).join("\n")}</pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Catalog</CardTitle></CardHeader>
        <CardContent>
          {catalog.length === 0 ? (
            <div className="text-sm text-muted-foreground">No runtimes configured besides Ollama.</div>
          ) : (
            <div className="divide-y rounded-md border">
              {catalog.map((c, i) => (
                <div key={i} className="flex items-center justify-between p-2 text-sm">
                  <div>
                    <div className="font-mono text-xs">{c.model_name}</div>
                    <div className="text-xs text-muted-foreground">{c.runtime} · {c.provider}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => register(c)}>Register</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChatPlayground({ tenant }: { tenant: string }) {
  const [model, setModel] = useState("ollama:llama3.2");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([{ role: "user", content: "" }]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
        <CardHeader><CardTitle>Prompt</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Model (provider:model or registered id)</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          {messages.map((m, i) => (
            <div key={i}>
              <Label>Message {i + 1} · {m.role}</Label>
              <Textarea rows={3} value={m.content} onChange={(e) => setMessages((prev) => prev.map((mm, j) => j === i ? { ...mm, content: e.target.value } : mm))} />
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setMessages((prev) => [...prev, { role: "user", content: "" }])}>Add message</Button>
          {err && <div className="text-xs text-destructive">{err}</div>}
          <AsyncButton onRun={run} disabled={busy}>Run</AsyncButton>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Output</CardTitle></CardHeader>
        <CardContent>
          {!result && <div className="text-sm text-muted-foreground">Run to see the response.</div>}
          {result && (
            <>
              <div className="whitespace-pre-wrap text-sm">{result.output}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {result.latency_ms}ms · tokens: {JSON.stringify(result.usage)}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}