import { useEffect, useState } from "react";
import { api, type Tool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { useToast } from "@/components/ui/toast";
import { truncate } from "@/lib/utils";

export function Tools({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<Tool[]>([]);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<Tool | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listTools(tenant)); } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, [tenant]);

  return (
    <div>
      <PageHeader title="Tools" description="Builtin, HTTP, and Python tools the agent can call."
        actions={<Button onClick={() => setCreating(true)}>New tool</Button>} />

      {rows.length === 0 ? (
        <EmptyState title="No tools" body="Seeded tools include calculator and tavily_search."
          action={<Button onClick={() => setCreating(true)}>Add tool</Button>} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Type</TH><TH>Description</TH><TH>Config</TH><TH></TH></TR></THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD>
                  <TD><Badge variant="secondary">{t.type}</Badge></TD>
                  <TD className="text-xs">{truncate(t.description, 60)}</TD>
                  <TD className="font-mono text-xs">{truncate(JSON.stringify(t.config), 40)}</TD>
                  <TD>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setTesting(t)}>Test</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                        if (!confirm(`Delete ${t.name}?`)) return;
                        try { await api.deleteTool(t.id); refresh(); } catch (e: any) { toast.push(e.message, "error"); }
                      }}>Delete</Button>
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
      toast.push("Created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New tool</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value as any)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
              <option value="builtin">builtin</option>
              <option value="http">http</option>
              <option value="python">python</option>
            </select>
          </div>
          <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><Label>Config (JSON)</Label>
            <Textarea rows={5} value={config} onChange={(e) => setConfig(e.target.value)}
              placeholder={type === "http" ? '{"endpoint":"https://example.com"}' : type === "python" ? '{"dotted_path":"nmb_marketplace_agent.custom_tools.my_tool.fn"}' : '{}'} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name}>Create</AsyncButton>
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
        <DialogHeader><DialogTitle>Test · {tool.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Input</Label>
            <Textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={tool.type === "builtin" && tool.name === "calculator" ? "2+2" : "query"} />
          </div>
          {err && <div className="text-xs text-destructive">{err}</div>}
          {result && <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">{result}</pre>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <AsyncButton onRun={run} disabled={busy}>Run</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}