import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, can, type ConnectorDetail, type ConnectorSummary, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";

const SECRET_REF = /^(env|file):\S+$/;
const TYPES = ["rest", "file_drop", "flat_file", "email", "rpa_bridge"] as const;
const FIXED_OPS: Record<string, string[]> = { file_drop: ["list", "read", "archive"], flat_file: ["parse"], email: ["fetch_unseen"] };
const TEMPLATES: Record<string, object> = {
  rest: { base_url: "https://", auth: { type: "bearer", secret: "env:" }, timeout_s: 20, retries: 2, operations: { get: { method: "GET", path: "/" } } },
  file_drop: { inbox: "/data/inbox", archive: "/data/processed", pattern: "*.csv" },
  flat_file: { layout: { kind: "fixed", fields: [{ name: "acct", start: 0, end: 8 }] } },
  email: { host: "imap.example.com", user: "claims@example.com", password_ref: "env:IMAP_PASSWORD", folder: "INBOX", allowed_senders: [] },
  rpa_bridge: { base_url: "https://rpa.internal", auth: { type: "bearer", secret: "env:RPA_TOKEN" }, scripts: ["lookup_account"], timeout_s: 120 },
};

/** Collect every credential-looking field so the UI can reject inline secrets before the server does. */
function badSecrets(o: any, path = ""): string[] {
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => badSecrets(v, path ? `${path}.${k}` : k));
  const key = path.split(".").pop() || "";
  return ["secret", "password", "password_ref", "token"].includes(key) && typeof o === "string" && !SECRET_REF.test(o) ? [path] : [];
}

export function Connectors({ me }: { me: Me | null }) {
  const [list, setList] = useState<ConnectorSummary[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const canWrite = can(me, "connectors:write");

  const load = () => api.listConnectors().then((l) => { setList(l); setActive((a) => a ?? l[0]?.name ?? null); })
    .catch((e) => { toast.push(e.message, "error"); setList([]); });
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Connectors" description="Link workflows to core systems, legacy files, mailboxes and RPA workers. Secrets are references to your vault, never stored here."
        actions={canWrite ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add connector</Button> : undefined} />
      {list === null ? <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div>
        : list.length === 0 ? <EmptyState title="No connectors" body="Install a solution to get connector templates, or add one." />
        : (
          <div className="grid gap-4 md:grid-cols-[260px,1fr]">
            <Card><CardContent className="space-y-1 p-2">
              {list.map((c) => (
                <button key={c.name} onClick={() => setActive(c.name)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${active === c.name ? "bg-muted font-medium" : "hover:bg-muted/60"}`}>
                  <div className="flex items-center justify-between gap-2"><span>{c.name}</span>
                    {c.needs_setup ? <StatusBadge value="warn" label="setup needed" /> : <StatusBadge value={c.enabled ? "pass" : "cancelled"} label={c.enabled ? "enabled" : "disabled"} />}</div>
                  <div className="text-xs text-muted-foreground">{c.type}</div>
                </button>))}
            </CardContent></Card>
            {active && <Editor key={active} name={active} canWrite={canWrite} onChanged={load}
              onDeleted={() => { setActive(null); load(); }} />}
          </div>)}
      {adding && <AddDialog onClose={(n) => { setAdding(false); if (n) { setActive(n); load(); } }} />}
    </div>
  );
}

function Editor({ name, canWrite, onChanged, onDeleted }: { name: string; canWrite: boolean; onChanged: () => void; onDeleted: () => void }) {
  const [d, setD] = useState<ConnectorDetail | null>(null);
  const [text, setText] = useState("");
  const toast = useToast();

  const load = () => api.getConnector(name).then((x) => { setD(x); setText(JSON.stringify(x.config, null, 2)); }).catch((e) => toast.push(e.message, "error"));
  useEffect(() => { load(); }, [name]);
  if (!d) return <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div>;

  let cfg: any = null, parseErr = "";
  try { cfg = JSON.parse(text); } catch (e: any) { parseErr = e.message; }
  const secrets = cfg ? badSecrets(cfg) : [];
  const host = (() => { try { return new URL(cfg?.base_url).hostname; } catch { return ""; } })();
  const hostOk = !host || d.egress_allowed_hosts.some((p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i").test(host));
  const ops: string[] = FIXED_OPS[d.type] ?? (d.type === "rpa_bridge" ? cfg?.scripts ?? [] : Object.keys(cfg?.operations ?? {}));

  async function save() {
    if (!cfg) return;
    try { await api.saveConnector(name, { type: d!.type, config: cfg, enabled: d!.enabled }); toast.push("Saved", "success"); await load(); onChanged(); }
    catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{d.name} <Chip>{d.type}</Chip></CardTitle>
          {canWrite && <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.enabled} disabled={d.needs_setup && !d.enabled}
              onChange={async (e) => { try { await api.setConnectorEnabled(name, e.target.checked); await load(); onChanged(); } catch (x: any) { toast.push(x.message, "error"); } }} /> Enabled</label>
            <Button size="sm" variant="ghost" onClick={async () => { if (confirm(`Delete connector ${name}?`)) { await api.deleteConnector(name); onDeleted(); } }}><Trash2 className="h-4 w-4" /></Button>
          </div>}
        </CardHeader>
        <CardContent className="space-y-3">
          {d.needs_setup && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">This is a template with a placeholder endpoint. Set the real address and secret reference, save, test, then enable.</div>}
          <div><Label>Configuration (JSON)</Label>
            <Textarea rows={16} className="font-mono text-xs" value={text} disabled={!canWrite} onChange={(e) => setText(e.target.value)} />
            {parseErr && <p className="mt-1 text-xs text-red-600">Invalid JSON: {parseErr}</p>}
            {secrets.length > 0 && <p className="mt-1 text-xs text-red-600">Use vault references, not raw values: {secrets.join(", ")} must look like <code>env:NAME</code> or <code>file:/run/secrets/name</code>.</p>}
            {!hostOk && <p className="mt-1 text-xs text-amber-600">Host <b>{host}</b> is not in the server's EGRESS_ALLOWED_HOSTS ({d.egress_allowed_hosts.join(", ") || "empty: all outbound blocked"}). Calls will be refused until an admin adds it.</p>}
          </div>
          {canWrite && <AsyncButton onRun={save} disabled={!!parseErr || secrets.length > 0}>Save</AsyncButton>}
        </CardContent>
      </Card>
      {canWrite && <TestPanel name={name} ops={ops} />}
    </div>
  );
}

function TestPanel({ name, ops }: { name: string; ops: string[] }) {
  const [op, setOp] = useState(ops[0] ?? "");
  const [params, setParams] = useState("{}");
  const [res, setRes] = useState<{ ok: boolean; result: unknown; error: string | null } | null>(null);
  useEffect(() => { if (!ops.includes(op)) setOp(ops[0] ?? ""); }, [ops.join(",")]);
  return (
    <Card><CardHeader><CardTitle className="text-sm">Test connection</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Saved configuration is used. Works while the connector is disabled; every test is written to the audit trail.</p>
        <div className="flex gap-2">
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={op} onChange={(e) => setOp(e.target.value)}>{ops.map((o) => <option key={o}>{o}</option>)}</select>
          <AsyncButton disabled={!op} onRun={async () => { try { setRes(await api.testConnector(name, op, JSON.parse(params || "{}"))); } catch (e: any) { setRes({ ok: false, result: null, error: e.message }); } }}>Run</AsyncButton>
        </div>
        <Textarea rows={3} className="font-mono text-xs" value={params} onChange={(e) => setParams(e.target.value)} placeholder='Parameters, e.g. {"body": {"name": "Jane"}}' />
        {res && (res.ok ? <div><StatusBadge value="pass" label="reachable" /><JsonView data={res.result} className="mt-2" /></div>
          : <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{res.error}</div>)}
      </CardContent></Card>
  );
}

function AddDialog({ onClose }: { onClose: (name?: string) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("rest");
  const toast = useToast();
  async function go() {
    try { await api.saveConnector(name, { type, config: TEMPLATES[type] as any, enabled: false }); onClose(name); }
    catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add connector</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase())} placeholder="core_banking" /></div>
          <div><Label>Type</Label><select className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <p className="text-xs text-muted-foreground">Starts disabled with an example configuration for you to edit.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><AsyncButton onRun={go} disabled={!name}>Create</AsyncButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}