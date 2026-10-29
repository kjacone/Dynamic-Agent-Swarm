import { useEffect, useState } from "react";
import { api, type Rag, type SubAgent, type Tool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { useToast } from "@/components/ui/toast";

export function Subagents({ tenant }: { tenant: string }) {
  const [subs, setSubs] = useState<SubAgent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [rags, setRags] = useState<Rag[]>([]);
  const [editing, setEditing] = useState<SubAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<SubAgent | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const [s, t, r] = await Promise.all([
        api.listSubagents(tenant), api.listTools(tenant), api.listRag(tenant),
      ]);
      setSubs(s); setTools(t); setRags(r);
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  return (
    <div>
      <PageHeader
        title="Subagents"
        description="Sync helpers run in-process. Async helpers run as graphs on the LangGraph server."
        actions={<Button onClick={() => setCreating(true)}>New subagent</Button>}
      />

      {subs.length === 0 ? (
        <EmptyState title="No subagents" body="Delegation targets for the top-level agent." action={<Button onClick={() => setCreating(true)}>Create</Button>} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Mode</TH><TH>Model</TH><TH>Graph</TH><TH>Tools</TH><TH></TH></TR></THead>
            <TBody>
              {subs.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.description}</div>
                  </TD>
                  <TD><Badge variant={s.mode === "async" ? "warning" : "secondary"}>{s.mode}</Badge></TD>
                  <TD className="font-mono text-xs">{s.model || "—"}</TD>
                  <TD className="font-mono text-xs">{s.graph_id || "—"}</TD>
                  <TD className="tabular-nums">{s.tool_ids.length}</TD>
                  <TD>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setTesting(s)}>Test</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                        if (!confirm(`Delete ${s.name}?`)) return;
                        try { await api.deleteSubagent(s.id); refresh(); } catch (e: any) { toast.push(e.message, "error"); }
                      }}>Delete</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <SubagentForm open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }}
        tenant={tenant} tools={tools} rags={rags} />
      {editing && (
        <SubagentForm open initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }}
          tenant={tenant} tools={tools} rags={rags} />
      )}
      {testing && <TestSub sub={testing} tenant={tenant} onClose={() => setTesting(null)} />}
    </div>
  );
}

function SubagentForm({
  open, onClose, onSaved, tenant, tools, rags, initial,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; tenant: string;
  tools: Tool[]; rags: Rag[]; initial?: SubAgent;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [prompt, setPrompt] = useState(initial?.system_prompt || "");
  const [mode, setMode] = useState<"sync" | "async">(initial?.mode || "sync");
  const [model, setModel] = useState(initial?.model || "");
  const [graphId, setGraphId] = useState(initial?.graph_id || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [toolIds, setToolIds] = useState<string[]>(initial?.tool_ids || []);
  const [ragIds, setRagIds] = useState<string[]>(initial?.rag_collection_ids || []);
  const toast = useToast();

  async function save() {
    try {
      const body = {
        name, description, system_prompt: prompt, mode, tenant_id: tenant,
        model: model || null, graph_id: mode === "async" ? graphId || null : null,
        url: url || null,
        tool_ids: toolIds, rag_collection_ids: ragIds,
      };
      if (initial) await api.patchSubagent(initial.id, body);
      else await api.createSubagent(body);
      toast.push("Saved", "success"); onSaved();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{initial ? "Edit subagent" : "New subagent"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><Label>System prompt</Label><Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sync">sync</SelectItem>
                  <SelectItem value="async">async</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Model (optional)</Label><Input value={model} onChange={(e) => setModel(e.target.value)} /></div>
          </div>
          {mode === "async" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>Graph id</Label><Input value={graphId} onChange={(e) => setGraphId(e.target.value)} placeholder="researcher" /></div>
              <div><Label>URL (optional)</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} /></div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <MultiChecks label="Tools" items={tools.map((t) => ({ id: t.id, label: t.name }))} selected={toolIds} onChange={setToolIds} />
            <MultiChecks label="RAG" items={rags.map((r) => ({ id: r.id, label: r.name }))} selected={ragIds} onChange={setRagIds} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || (mode === "async" && !graphId)}>Save</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MultiChecks({ label, items, selected, onChange }: {
  label: string; items: { id: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  function toggle(id: string) { onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]); }
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 max-h-32 space-y-1 overflow-auto rounded-md border p-2">
        {items.map((it) => (
          <label key={it.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(it.id)} onCheckedChange={() => toggle(it.id)} />
            <span className="truncate">{it.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TestSub({ sub, tenant, onClose }: { sub: SubAgent; tenant: string; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try { setResult(await api.testSubagent(sub.id, message, tenant)); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Test · {sub.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Message</Label><Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{err}</div>}
          {result ? <JsonView data={result} /> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <AsyncButton onRun={run} disabled={!message || busy}>Run</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}