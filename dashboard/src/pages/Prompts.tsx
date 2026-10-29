import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { AsyncButton } from "@/components/common/AsyncButton";
import { useToast } from "@/components/ui/toast";
import { truncate } from "@/lib/utils";

const VAR_RE = /\{\{\s*([\w.\-]+)\s*\}\}/g;
function varsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function Prompts() {
  return (
    <div>
      <PageHeader title="Prompts" description="Prompt registry backed by Langfuse." />
      <Tabs defaultValue="registry">
        <TabsList>
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
  const [rows, setRows] = useState<Array<Record<string, any>>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [labelFor, setLabelFor] = useState<Record<string, any> | null>(null);
  const toast = useToast();

  async function refresh() {
    setErr(null);
    try {
      const r = await api.listPrompts();
      setRows((r as any).data || []);
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { refresh(); }, []);

  if (err) {
    return (
      <Card><CardContent className="py-6 text-sm">
        <div className="text-destructive">{err}</div>
        <div className="mt-1 text-xs text-muted-foreground">Connect Langfuse in Settings → Connections.</div>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>New prompt</Button>
      </div>
      <Card>
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No prompts yet.</div>
        ) : (
          <div className="divide-y">
            {rows.map((p) => (
              <div key={p.name} className="flex items-center justify-between p-3">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.type} · {p.versions?.length || 0} version(s) · labels: {(p.labels || []).join(", ") || "—"}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setLabelFor(p)}>Manage labels</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
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

  async function save() {
    try {
      await api.createPrompt({
        name, type,
        prompt: type === "text" ? text : [{ role: "system", content: text }],
        labels: labelInput.split(",").map((s) => s.trim()).filter(Boolean),
      });
      toast.push("Created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>New prompt</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value as any)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
              <option value="text">text</option>
              <option value="chat">chat</option>
            </select>
          </div>
          <div><Label>Prompt content</Label>
            <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Use {{variables}} for templating" />
          </div>
          <div><Label>Labels (comma-separated)</Label><Input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !text}>Create</AsyncButton>
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
      toast.push(`v${v} labels saved`, "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Labels · {prompt.name}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {versions.map((v) => (
            <div key={v.version} className="flex items-center gap-2">
              <Badge variant="secondary" className="w-16 justify-center">v{v.version}</Badge>
              <Input value={labels[v.version] ?? ""} onChange={(e) => setLabels((prev) => ({ ...prev, [v.version]: e.target.value }))} />
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
        <CardHeader><CardTitle>Prompt</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[1fr,120px,80px] gap-2">
            <select value={promptName} onChange={(e) => setPromptName(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm">
              <option value="">Select a prompt…</option>
              {prompts.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label" />
            <Button size="sm" onClick={load} disabled={!promptName}>Load</Button>
          </div>

          {prompt && Object.entries(variables).map(([k, v]) => (
            <div key={k}>
              <Label>{k}</Label>
              <Input value={v} onChange={(e) => setVariables((prev) => ({ ...prev, [k]: e.target.value }))} />
            </div>
          ))}
          <div><Label>User input (optional)</Label>
            <Textarea rows={3} value={userInput} onChange={(e) => setUserInput(e.target.value)} />
          </div>
          <div><Label>Models (comma-separated, max 4)</Label>
            <Input value={modelsInput} onChange={(e) => setModelsInput(e.target.value)}
              placeholder="ollama:llama3.2, anthropic:claude-sonnet-4-5-20250929" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={trace} onChange={(e) => setTrace(e.target.checked)} /> Trace to Langfuse
          </label>
          {err && <div className="text-xs text-destructive">{err}</div>}
          <AsyncButton onRun={run} disabled={!prompt || busy}>Run</AsyncButton>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Results</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!result && <div className="text-sm text-muted-foreground">Run the prompt to see outputs.</div>}
          {result?.results?.map((r: any, i: number) => (
            <div key={i} className="rounded-md border p-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-mono">{r.model}</span>
                <span className={r.ok ? "text-emerald-700" : "text-destructive"}>
                  {r.ok ? `${r.latency_ms}ms` : "error"}
                </span>
              </div>
              <div className="whitespace-pre-wrap text-sm">
                {r.ok ? r.output : r.error}
              </div>
              {r.usage && Object.keys(r.usage).length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  tokens: {JSON.stringify(r.usage)}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}