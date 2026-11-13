import { useEffect, useMemo, useState } from "react";
import { Boxes, Network, Zap } from "lucide-react";
import { api, type ModelCfg, type Rag, type SubAgent, type Tool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { FilterTabs } from "@/components/common/FilterTabs";
import { JsonView } from "@/components/common/JsonView";
import { StatCard } from "@/components/common/StatCard";
import { ModelSelect } from "@/components/common/ModelSelect";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export function Subagents({ tenant }: { tenant: string }) {
  const [subs, setSubs] = useState<SubAgent[] | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [rags, setRags] = useState<Rag[]>([]);
  const [models, setModels] = useState<ModelCfg[]>([]);
  const [editing, setEditing] = useState<SubAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<SubAgent | null>(null);
  const [deleting, setDeleting] = useState<SubAgent | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const [s, t, r, m] = await Promise.all([
        api.listSubagents(tenant), api.listTools(tenant), api.listRag(tenant), api.listModels(tenant),
      ]);
      setSubs(s); setTools(t); setRags(r); setModels(m);
    } catch (e: any) { toast.push(e.message, "error"); setSubs([]); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  const counts = useMemo(() => ({
    sync: (subs ?? []).filter((s) => s.mode === "sync").length,
    async: (subs ?? []).filter((s) => s.mode === "async").length,
  }), [subs]);

  return (
    <div>
      <PageHeader
        icon={Boxes}
        title="Subagents"
        description="Sync helpers run in-process. Async helpers run as graphs on the LangGraph server."
        actions={<Button onClick={() => setCreating(true)}>New subagent</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard icon={Boxes} label="Subagents" value={subs?.length ?? "—"} tone="indigo" />
        <StatCard icon={Zap} label="Sync" value={subs ? counts.sync : "—"} tone="emerald" hint="In-process, low latency" />
        <StatCard icon={Network} label="Async" value={subs ? counts.async : "—"} tone="sky" hint="Graphs on the LangGraph server" />
      </div>

      {subs === null ? (
        <Card><CardContent className="space-y-2 py-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />)}
        </CardContent></Card>
      ) : subs.length === 0 ? (
        <EmptyState icon={Boxes} title="No subagents yet" body="Delegation targets for the top-level agent."
          action={<Button onClick={() => setCreating(true)}>Create subagent</Button>} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Mode</TH><TH>Model</TH><TH>Graph</TH><TH className="text-right">Tools</TH><TH className="text-right">Actions</TH></TR></THead>
            <TBody>
              {subs.map((s) => (
                <TR key={s.id} className="group">
                  <TD className="max-w-[280px]">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{s.description}</div>
                  </TD>
                  <TD>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                      s.mode === "async"
                        ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", s.mode === "async" ? "bg-amber-500" : "bg-emerald-500")} />
                      {s.mode}
                    </span>
                  </TD>
                  <TD className="font-mono text-xs text-muted-foreground">{s.model || "inherit"}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">{s.graph_id || "—"}</TD>
                  <TD className="text-right tabular-nums">{s.tool_ids.length}</TD>
                  <TD>
                    <div className="flex justify-end gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                      <Button size="sm" variant="outline" onClick={() => setEditing(s)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setTesting(s)}>Test</Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(s)}>Delete</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <SubagentForm open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }}
        tenant={tenant} tools={tools} rags={rags} models={models} />
      {editing && (
        <SubagentForm open initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }}
          tenant={tenant} tools={tools} rags={rags} models={models} />
      )}
      {testing && <TestSub sub={testing} tenant={tenant} onClose={() => setTesting(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          description="The supervisor will no longer be able to delegate to this subagent. Existing runs are unaffected."
          confirmLabel="Delete subagent" destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteSubagent(deleting.id);
            toast.push("Subagent deleted", "success");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SubagentForm({
  open, onClose, onSaved, tenant, tools, rags, models, initial,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; tenant: string;
  tools: Tool[]; rags: Rag[]; models: ModelCfg[]; initial?: SubAgent;
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
      toast.push("Subagent saved", "success"); onSaved();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "New subagent"}</DialogTitle>
          <DialogDescription>Give the supervisor a focused helper with its own prompt, model and tools.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. researcher" /></div>
            <div className="space-y-1.5"><Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it good at?" /></div>
          </div>
          <div className="space-y-1.5"><Label>System prompt</Label>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Instructions the subagent follows" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <FilterTabs value={mode} onChange={setMode}
                options={[{ id: "sync", label: "Sync" }, { id: "async", label: "Async" }]} />
              <p className="text-xs text-muted-foreground">
                {mode === "sync" ? "Runs in-process — fastest, shares the current runtime." : "Runs as a graph on the LangGraph server."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <ModelSelect value={model} onChange={setModel} models={models} allowEmpty emptyLabel="Inherit supervisor model" />
            </div>
          </div>
          {mode === "async" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5"><Label>Graph id</Label>
                <Input value={graphId} onChange={(e) => setGraphId(e.target.value)} placeholder="researcher" /></div>
              <div className="space-y-1.5"><Label>URL (optional)</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="LangGraph server URL" /></div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <MultiChecks label="Tools" items={tools.map((t) => ({ id: t.id, label: t.name }))} selected={toolIds} onChange={setToolIds} />
            <MultiChecks label="Knowledge" items={rags.map((r) => ({ id: r.id, label: r.name }))} selected={ragIds} onChange={setRagIds} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || (mode === "async" && !graphId)}>Save subagent</AsyncButton>
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
    <div className="space-y-1.5">
      <Label>{label} <span className="text-xs font-normal text-muted-foreground">({selected.length} selected)</span></Label>
      <div className="max-h-32 space-y-0.5 overflow-auto rounded-lg border bg-muted/20 p-1.5">
        {items.length === 0 && <div className="p-2 text-xs text-muted-foreground">None available.</div>}
        {items.map((it) => (
          <label key={it.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60">
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
        <DialogHeader>
          <DialogTitle>Test · {sub.name}</DialogTitle>
          <DialogDescription>Sends a single message straight to this subagent, bypassing the supervisor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Message</Label>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && message) run(); }} /></div>
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
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
