import { useEffect, useMemo, useState } from "react";
import { FileText, Play, Sparkles, Tag } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { FilterTabs } from "@/components/common/FilterTabs";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";

const VAR_RE = /\{\{\s*([\w.\-]+)\s*\}\}/g;
function varsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function Prompts() {
  return (
    <div>
      <PageHeader icon={FileText} title="Prompts" description="Prompt registry backed by Langfuse." />
      <Tabs defaultValue="registry">
        <TabsList className="h-10 rounded-xl p-1">
          <TabsTrigger value="registry">Registry</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
        </TabsList>
        <TabsContent value="registry" className="mt-4"><Registry /></TabsContent>
        <TabsContent value="playground" className="mt-4"><Playground /></TabsContent>
      </Tabs>
    </div>
  );
}

function Registry() {
  const [rows, setRows] = useState<Array<Record<string, any>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [labelFor, setLabelFor] = useState<Record<string, any> | null>(null);
  const toast = useToast();

  async function refresh() {
    setErr(null);
    try {
      const r = await api.listPrompts();
      setRows((r as any).data || []);
    } catch (e: any) { setErr(e.message); setRows([]); }
  }
  useEffect(() => { refresh(); }, []);

  if (err) {
    return (
      <Card><CardContent className="py-8 text-center text-sm">
        <div className="font-medium text-destructive">{err}</div>
        <div className="mt-1 text-xs text-muted-foreground">Connect Langfuse in Settings → Connections.</div>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Versioned prompts with labels — production, staging or any name your workflows resolve.</p>
        <Button onClick={() => setCreating(true)}>New prompt</Button>
      </div>
      {rows === null ? <LoadingBlock rows={4} />
        : rows.length === 0 ? (
          <EmptyState icon={FileText} title="No prompts yet" body="Create a prompt to version it and use labels to promote changes." />
        ) : (
          <Card>
            <div className="divide-y">
              {rows.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-3 p-3.5 transition-colors hover:bg-muted/30">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="h-4 w-4" /></span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{p.type}</span>
                        <span>{p.versions?.length || 0} version(s)</span>
                        <span>·</span>
                        <span className="truncate">{(p.labels || []).join(", ") || "no labels"}</span>
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setLabelFor(p)}><Tag className="h-3.5 w-3.5" /> Labels</Button>
                </div>
              ))}
            </div>
          </Card>
        )}
      {creating && <CreatePrompt onClose={() => { setCreating(false); refresh(); }} />}
      {labelFor && <ManageLabels prompt={labelFor} onClose={() => { setLabelFor(null); refresh(); }} />}
    </div>
  );
}

function CreatePrompt({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "chat">("text");
  const [text, setText] = useState("");
  const [labelInput, setLabelInput] = useState("production");
  const toast = useToast();
  const detected = useMemo(() => varsOf(text), [text]);

  async function save() {
    try {
      await api.createPrompt({
        name, type,
        prompt: type === "text" ? text : [{ role: "system", content: text }],
        labels: labelInput.split(",").map((s) => s.trim()).filter(Boolean),
      });
      toast.push("Prompt created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New prompt</DialogTitle>
          <DialogDescription>Use <code className="rounded bg-muted px-1">{"{{variable}}"}</code> syntax; detected variables are listed below.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="refunds-triage" /></div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <FilterTabs value={type} onChange={setType} options={[{ id: "text", label: "Text" }, { id: "chat", label: "Chat" }]} />
          </div>
          <div className="space-y-1.5"><Label>Prompt content</Label>
            <Textarea rows={8} className="font-mono text-xs leading-relaxed" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="You are a bank support agent. Customer: {{customer_name}}…" />
            {detected.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                Variables:
                {detected.map((v) => <span key={v} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{v}</span>)}
              </div>
            )}
          </div>
          <div className="space-y-1.5"><Label>Labels (comma-separated)</Label>
            <Input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !text}>Create prompt</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageLabels({ prompt, onClose }: { prompt: Record<string, any>; onClose: () => void }) {
  const versions = (prompt.versions || []) as Array<{ version: number; labels: string[] }>;
  const [labels, setLabels] = useState<Record<number, string>>(() =>
    Object.fromEntries(versions.map((v) => [v.version, (v.labels || []).join(",")])),
  );
  const toast = useToast();

  async function save(v: number) {
    try {
      await api.setPromptLabels(prompt.name, v, labels[v].split(",").map((s) => s.trim()).filter(Boolean));
      toast.push(`Labels for v${v} saved`, "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Labels · {prompt.name}</DialogTitle>
          <DialogDescription>Point a label (e.g. production) at a version. Workflows resolve prompts by label.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {versions.length === 0 && <div className="text-sm text-muted-foreground">No versions recorded yet.</div>}
          {versions.map((v) => (
            <div key={v.version} className="flex items-center gap-2">
              <span className="w-14 shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-center font-mono text-xs">v{v.version}</span>
              <Input value={labels[v.version] ?? ""} placeholder="production, staging"
                onChange={(e) => setLabels((prev) => ({ ...prev, [v.version]: e.target.value }))} />
              <Button size="sm" variant="outline" onClick={() => save(v.version)}>Save</Button>
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Playground() {
  const [prompts, setPrompts] = useState<Array<Record<string, any>>>([]);
  const [promptName, setPromptName] = useState("");
  const [label, setLabel] = useState("latest");
  const [prompt, setPrompt] = useState<{ prompt: any; variables: string[] } | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [userInput, setUserInput] = useState("");
  const [modelsInput, setModelsInput] = useState("ollama:llama3.2");
  const [trace, setTrace] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.listPrompts().then((r) => setPrompts((r as any).data || [])).catch(() => {});
  }, []);

  async function load() {
    try {
      const p = await api.getPrompt(promptName, label) as { prompt: any; variables: string[] };
      setPrompt(p);
      const vars = p.variables && p.variables.length ? p.variables
        : typeof p.prompt === "string" ? varsOf(p.prompt) : [];
      setVariables(Object.fromEntries(vars.map((v: string) => [v, ""])));
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  async function run() {
    if (!prompt) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const models = modelsInput.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await api.testPrompt({
        prompt: prompt.prompt, variables, user_input: userInput || null,
        models, trace,
      });
      setResult(r);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">Prompt</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[1fr,110px,auto] gap-2">
            <select value={promptName} onChange={(e) => setPromptName(e.target.value)} className="h-9 rounded-lg border bg-background px-2 text-sm">
              <option value="">Select a prompt…</option>
              {prompts.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label" />
            <Button onClick={load} disabled={!promptName}>Load</Button>
          </div>

          {prompt && Object.entries(variables).map(([k, v]) => (
            <div key={k} className="space-y-1.5">
              <Label className="font-mono text-xs">{k}</Label>
              <Input value={v} onChange={(e) => setVariables((prev) => ({ ...prev, [k]: e.target.value }))} />
            </div>
          ))}
          <div className="space-y-1.5"><Label>User input (optional)</Label>
            <Textarea rows={3} value={userInput} onChange={(e) => setUserInput(e.target.value)} />
          </div>
          <div className="space-y-1.5"><Label>Models (comma-separated, max 4)</Label>
            <Input className="font-mono text-xs" value={modelsInput} onChange={(e) => setModelsInput(e.target.value)}
              placeholder="ollama:llama3.2, ollama:llama3.1:8b" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={trace} onCheckedChange={(v) => setTrace(v === true)} /> Trace to Langfuse
          </label>
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          <AsyncButton onRun={run} disabled={!prompt || busy}><Sparkles className="h-4 w-4" /> Run</AsyncButton>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Results</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!result && (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
              <Play className="h-7 w-7 opacity-40" />
              Run the prompt to compare models.
            </div>
          )}
          {result?.results?.map((r: any, i: number) => (
            <div key={i} className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono">{r.model}</span>
                <StatusBadge value={r.ok ? "pass" : "fail"} label={r.ok ? `${r.latency_ms}ms` : "error"} />
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{r.ok ? r.output : r.error}</div>
              {r.usage && Object.keys(r.usage).length > 0 && (
                <div className="mt-2 text-[11px] text-muted-foreground">tokens: {JSON.stringify(r.usage)}</div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
