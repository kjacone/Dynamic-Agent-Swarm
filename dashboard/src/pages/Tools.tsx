import { useEffect, useMemo, useState } from "react";
import { Globe, Play, Terminal, Wrench } from "lucide-react";
import { api, type Tool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatCard } from "@/components/common/StatCard";
import { FilterTabs } from "@/components/common/FilterTabs";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { truncate } from "@/lib/utils";

const TYPE_TONE: Record<string, string> = {
  builtin: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  http: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  python: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
};

export function Tools({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Tool[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<Tool | null>(null);
  const [deleting, setDeleting] = useState<Tool | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listTools(tenant)); } catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  const counts = useMemo(() => {
    const c = { builtin: 0, http: 0, python: 0 };
    (rows ?? []).forEach((t) => { if (t.type in c) c[t.type as keyof typeof c] += 1; });
    return c;
  }, [rows]);

  return (
    <div>
      <PageHeader icon={Wrench} title="Tools"
        description="Builtin, HTTP, and Python tools agents can call at runtime."
        actions={<Button onClick={() => setCreating(true)}>New tool</Button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Wrench} label="Total tools" value={rows?.length ?? "—"} tone="sky" />
        <StatCard icon={Terminal} label="Builtin" value={rows ? counts.builtin : "—"} tone="slate" hint="Shipped with the platform" />
        <StatCard icon={Globe} label="HTTP" value={rows ? counts.http : "—"} tone="violet" hint="Call external endpoints" />
        <StatCard icon={Play} label="Python" value={rows ? counts.python : "—"} tone="amber" hint="Tenant-defined functions" />
      </div>

      {rows === null ? (
        <Card><CardContent className="space-y-2 py-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />)}
        </CardContent></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={Wrench} title="No tools yet" body="Seeded tools include calculator and tavily_search."
          action={<Button onClick={() => setCreating(true)}>Add tool</Button>} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Type</TH><TH>Description</TH><TH>Config</TH><TH className="text-right">Actions</TH></TR></THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id} className="group">
                  <TD className="font-medium">{t.name}</TD>
                  <TD><span className={`inline-flex rounded-md border px-2 py-0.5 font-mono text-[11px] ${TYPE_TONE[t.type] ?? "bg-muted text-muted-foreground"}`}>{t.type}</span></TD>
                  <TD className="max-w-[280px] truncate text-xs text-muted-foreground">{truncate(t.description, 60) || "—"}</TD>
                  <TD className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">{truncate(JSON.stringify(t.config), 40)}</TD>
                  <TD>
                    <div className="flex justify-end gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                      <Button size="sm" variant="outline" onClick={() => setTesting(t)}>Test</Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(t)}>Delete</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
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

function CreateTool({ onClose, tenant }: { onClose: () => void; tenant: string }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"builtin" | "http" | "python">("builtin");
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
          <DialogDescription>Register a tool the agents can call. Configuration is a JSON object.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. lookup_customer" /></div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <FilterTabs value={type} onChange={setType}
              options={[{ id: "builtin", label: "Builtin" }, { id: "http", label: "HTTP" }, { id: "python", label: "Python" }]} />
          </div>
          <div className="space-y-1.5"><Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this tool do?" /></div>
          <div className="space-y-1.5"><Label>Config (JSON)</Label>
            <Textarea rows={5} className="font-mono text-xs" value={config} onChange={(e) => setConfig(e.target.value)}
              placeholder={type === "http" ? '{"endpoint":"https://example.com"}' : type === "python" ? '{"dotted_path":"nmb_marketplace_agent.custom_tools.my_tool.fn"}' : '{}'} />
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

function TestTool({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try { const r = await api.testTool(tool.id, input); setResult(r.result); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="h-4 w-4 text-primary" /> Test · {tool.name}</DialogTitle>
          <DialogDescription>Calls the tool directly with the input below. No agent or workflow is involved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Input</Label>
            <Textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={tool.type === "builtin" && tool.name === "calculator" ? "2+2" : "query"} />
          </div>
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          {result && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">{result}</pre>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <AsyncButton onRun={run} disabled={busy}>Run</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
