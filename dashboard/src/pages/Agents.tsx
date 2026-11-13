import { useEffect, useState } from "react";
import { api, type Agent, type Rag, type SubAgent, type Tool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { truncate } from "@/lib/utils";

export function Agents({ tenant }: { tenant: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [rags, setRags] = useState<Rag[]>([]);
  const [subs, setSubs] = useState<SubAgent[]>([]);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<Agent | null>(null);
  const [versionsFor, setVersionsFor] = useState<Agent | null>(null);
  const toast = useToast();

  async function refresh() {
    try {
      const [a, t, r, s] = await Promise.all([
        api.listAgents(tenant), api.listTools(tenant), api.listRag(tenant), api.listSubagents(tenant),
      ]);
      setAgents(a); setTools(t); setRags(r); setSubs(s);
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  useEffect(() => { refresh(); }, [tenant]);

  return (
    <div>
      <PageHeader
        title="Agents"
        description="The top-level graph each chat session runs against."
        actions={<Button onClick={() => setCreating(true)}>New agent</Button>}
      />

      {agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          body="Create one and configure its tools, RAG collections, and subagents."
          action={<Button onClick={() => setCreating(true)}>Create agent</Button>}
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH><TH>Model</TH><TH>Tools</TH><TH>RAG</TH><TH>Subagents</TH><TH>Tenant</TH><TH></TH>
              </TR>
            </THead>
            <TBody>
              {agents.map((a) => (
                <TR key={a.id}>
                  <TD className="font-medium">{a.name}</TD>
                  <TD className="font-mono text-xs">{truncate(a.model, 32)}</TD>
                  <TD className="tabular-nums">{a.tool_ids.length}</TD>
                  <TD className="tabular-nums">{a.rag_collection_ids.length}</TD>
                  <TD className="tabular-nums">{a.subagent_ids.length}</TD>
                  <TD><Badge variant="secondary">{a.tenant_id}</Badge></TD>
                  <TD className="whitespace-nowrap">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setTesting(a)}>Test</Button>
                      <Button size="sm" variant="ghost" onClick={() => setVersionsFor(a)}>Versions</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={async () => {
                          if (!confirm(`Delete ${a.name}?`)) return;
                          try { await api.deleteAgent(a.id); toast.push("Deleted", "success"); refresh(); }
                          catch (e: any) { toast.push(e.message, "error"); }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <AgentForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); refresh(); }}
        tenant={tenant}
        tools={tools} rags={rags} subs={subs}
      />
      {editing && (
        <AgentForm
          open
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
          tenant={tenant}
          tools={tools} rags={rags} subs={subs}
        />
      )}
      {testing && <TestChat agent={testing} tenant={tenant} onClose={() => setTesting(null)} />}
      {versionsFor && <VersionsDialog agent={versionsFor} tenant={tenant} onClose={() => setVersionsFor(null)} />}
    </div>
  );
}

function AgentForm({
  open, onClose, onSaved, tenant, tools, rags, subs, initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  tenant: string;
  tools: Tool[]; rags: Rag[]; subs: SubAgent[];
  initial?: Agent;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [model, setModel] = useState(initial?.model || "ollama:llama3.1:8b");
  const [prompt, setPrompt] = useState(initial?.system_prompt || "");
  const [toolIds, setToolIds] = useState<string[]>(initial?.tool_ids || []);
  const [ragIds, setRagIds] = useState<string[]>(initial?.rag_collection_ids || []);
  const [subIds, setSubIds] = useState<string[]>(initial?.subagent_ids || []);
  const toast = useToast();

  async function save() {
    try {
      const body = {
        name, model, system_prompt: prompt, tenant_id: tenant,
        tool_ids: toolIds, rag_collection_ids: ragIds, subagent_ids: subIds,
      };
      if (initial) await api.patchAgent(initial.id, body);
      else await api.createAgent(body);
      toast.push("Saved", "success");
      onSaved();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{initial ? "Edit agent" : "New agent"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Model (provider:model or registered id)</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div><Label>System prompt</Label>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="Or a Langfuse ref: langfuse:my-prompt:production" />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <MultiSelect label="Tools" items={tools.map((t) => ({ id: t.id, label: t.name }))}
              selected={toolIds} onChange={setToolIds} />
            <MultiSelect label="RAG" items={rags.map((r) => ({ id: r.id, label: `${r.name} (${r.status})` }))}
              selected={ragIds} onChange={setRagIds} />
            <MultiSelect label="Subagents" items={subs.map((s) => ({ id: s.id, label: `${s.name} · ${s.mode}` }))}
              selected={subIds} onChange={setSubIds} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name}>Save</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MultiSelect({ label, items, selected, onChange }: {
  label: string;
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 max-h-40 space-y-1 overflow-auto rounded-md border p-2">
        {items.length === 0 && <div className="text-xs text-muted-foreground">None available</div>}
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

function TestChat({ agent, tenant, onClose }: { agent: Agent; tenant: string; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [useDraft, setUseDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try {
      const out = await api.testAgent({
        agent_id: agent.id, message, tenant_id: tenant, use_draft: useDraft,
      });
      setResult(out);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Test · {agent.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Message</Label><Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={useDraft} onCheckedChange={(v) => setUseDraft(!!v)} /> Use draft config
          </label>
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

function VersionsDialog({ agent, tenant, onClose }: { agent: Agent; tenant: string; onClose: () => void }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [note, setNote] = useState("");
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listVersions(agent.id)); } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, []);

  async function publish() {
    try {
      await api.publishAgent(agent.id, note);
      setNote("");
      refresh();
      toast.push("Published", "success");
    } catch (e: any) {
      const body = e.body as
        | { error?: string;
            detail?: {
              failed?: Array<{ id: string; notes: string[] }>;
              failures?: Array<{ dimension: string; pass_rate: number | null; threshold: number }>;
              reason?: string; message?: string;
              pass_rate?: number | null; threshold?: number | null;
            };
            hint?: string }
        | undefined;

      if (body?.error === "conformance_failed") {
        const reason = prompt(
          `Publish blocked by conformance (${body.detail?.failed?.length ?? 0} failing cases).\n\n` +
          (body.detail?.failed ?? []).map((f) => `• ${f.id}: ${f.notes.join("; ")}`).join("\n") +
          `\n\n${body.hint}\n\nOverride reason:`,
        );
        if (reason?.trim()) {
          try {
            await api.publishAgent(agent.id, note, reason);
            setNote(""); refresh(); toast.push("Published with conformance override (audited)", "success");
          } catch (e2: any) { toast.push(e2.message, "error"); }
        }
        return;
      }

      if (body?.error === "eval_failed") {
        const d = body.detail;
        const lines = d?.reason === "no_eval_run"
          ? [`• ${d.message ?? "no draft eval run"}`]
          : (d?.failures ?? []).map(
              (f) => `• ${f.dimension}: pass ${f.pass_rate ?? "—"} < ${f.threshold}`,
            );
        const reason = prompt(
          `Publish blocked by eval gate.\n\n` +
          (lines.join("\n") || "(no details)") +
          `\n\n${body.hint}\n\nOverride reason:`,
        );
        if (reason?.trim()) {
          try {
            await api.publishAgent(agent.id, note, reason);
            setNote(""); refresh(); toast.push("Published with eval override (audited)", "success");
          } catch (e2: any) { toast.push(e2.message, "error"); }
        }
        return;
      }

      toast.push(e.message, "error");
    }
  }
  async function rollback(v: number) {
    try { await api.rollback(agent.id, v); refresh(); toast.push(`v${v} live`, "success"); }
    catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Versions · {agent.name}</DialogTitle></DialogHeader>
        <div className="flex gap-2">
          <Input placeholder="Publish note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <AsyncButton onRun={publish}>Publish current</AsyncButton>
        </div>
        <Table>
          <THead><TR><TH>v</TH><TH>Note</TH><TH>Status</TH><TH></TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={String(r.id)}>
                <TD className="tabular-nums">{String(r.version)}</TD>
                <TD className="text-xs">{String(r.note || "—")}</TD>
                <TD>{r.published ? <Badge variant="success">live</Badge> : <Badge variant="outline">archived</Badge>}</TD>
                <TD>
                  {!r.published && (
                    <Button size="sm" variant="outline" onClick={() => rollback(Number(r.version))}>Rollback</Button>
                  )}
                </TD>
              </TR>
            ))}
            {rows.length === 0 && <TR><TD colSpan={4} className="text-center text-xs text-muted-foreground">No versions yet</TD></TR>}
          </TBody>
        </Table>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}