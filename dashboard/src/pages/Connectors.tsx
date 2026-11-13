import { useEffect, useState } from "react";
import { AlertTriangle, Plug, Plus, ShieldAlert, Trash2, Zap } from "lucide-react";
import { api, can, type ConnectorDetail, type ConnectorSummary, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { JsonView } from "@/components/common/JsonView";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

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
      <PageHeader icon={Plug} title="Connectors"
        description="Link workflows to core systems, legacy files, mailboxes and RPA workers. Secrets are references to your vault, never stored here."
        actions={canWrite ? <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add connector</Button> : undefined} />
      {list === null ? <LoadingBlock rows={4} />
        : list.length === 0 ? <EmptyState icon={Plug} title="No connectors yet" body="Install a solution to get connector templates, or add one."
          action={canWrite ? <Button onClick={() => setAdding(true)}>Add connector</Button> : undefined} />
        : (
          <div className="grid gap-4 md:grid-cols-[280px,minmax(0,1fr)]">
            <Card className="self-start"><CardHeader className="pb-2"><CardTitle className="text-sm">Connectors <span className="font-normal text-muted-foreground">({list.length})</span></CardTitle></CardHeader>
              <CardContent className="space-y-1 p-2">
                {list.map((c) => (
                  <button key={c.name} onClick={() => setActive(c.name)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      active === c.name ? "border-primary/40 bg-primary/5 font-medium shadow-sm" : "border-transparent hover:bg-muted/60",
                    )}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      {c.needs_setup ? <StatusBadge value="warn" label="setup" /> : <StatusBadge value={c.enabled ? "pass" : "cancelled"} label={c.enabled ? "on" : "off"} />}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{c.type}</div>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();

  const load = () => api.getConnector(name).then((x) => { setD(x); setText(JSON.stringify(x.config, null, 2)); }).catch((e) => toast.push(e.message, "error"));
  useEffect(() => { load(); }, [name]);
  if (!d) return <LoadingBlock rows={5} />;

  let cfg: any = null, parseErr = "";
  try { cfg = JSON.parse(text); } catch (e: any) { parseErr = e.message; }
  const secrets = cfg ? badSecrets(cfg) : [];
  const host = (() => { try { return new URL(cfg?.base_url).hostname; } catch { return ""; } })();
  const hostOk = !host || d.egress_allowed_hosts.some((p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i").test(host));
  const ops: string[] = FIXED_OPS[d.type] ?? (d.type === "rpa_bridge" ? cfg?.scripts ?? [] : Object.keys(cfg?.operations ?? {}));

  async function save() {
    if (!cfg) return;
    try { await api.saveConnector(name, { type: d!.type, config: cfg, enabled: d!.enabled }); toast.push("Connector saved", "success"); await load(); onChanged(); }
    catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">{d.name} <Chip>{d.type}</Chip>
            <StatusBadge value={d.needs_setup ? "warn" : d.enabled ? "pass" : "cancelled"} label={d.needs_setup ? "setup needed" : d.enabled ? "enabled" : "disabled"} />
          </CardTitle>
          {canWrite && <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={d.enabled} disabled={d.needs_setup && !d.enabled}
                onCheckedChange={async (v) => {
                  try { await api.setConnectorEnabled(name, v === true); await load(); onChanged(); }
                  catch (x: any) { toast.push(x.message, "error"); }
                }} />
              Enabled
            </label>
            <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>}
        </CardHeader>
        <CardContent className="space-y-3">
          {d.needs_setup && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              This is a template with a placeholder endpoint. Set the real address and secret reference, save, test, then enable.
            </div>
          )}
          <div className="space-y-1.5"><Label>Configuration (JSON)</Label>
            <Textarea rows={16} className="font-mono text-xs leading-relaxed" value={text} disabled={!canWrite} onChange={(e) => setText(e.target.value)} />
            {parseErr && <p className="text-xs text-red-600 dark:text-red-400">Invalid JSON: {parseErr}</p>}
            {secrets.length > 0 && <p className="text-xs text-red-600 dark:text-red-400">Use vault references, not raw values: {secrets.join(", ")} must look like <code>env:NAME</code> or <code>file:/run/secrets/name</code>.</p>}
            {!hostOk && <p className="text-xs text-amber-600 dark:text-amber-400">Host <b>{host}</b> is not in the server's EGRESS_ALLOWED_HOSTS ({d.egress_allowed_hosts.join(", ") || "empty: all outbound blocked"}). Calls will be refused until an admin adds it.</p>}
          </div>
          {canWrite && <AsyncButton onRun={save} disabled={!!parseErr || secrets.length > 0}>Save changes</AsyncButton>}
        </CardContent>
      </Card>
      {canWrite && <TestPanel name={name} ops={ops} />}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete connector ${name}?`}
          description="Workflows that call this connector will fail at that step until another connector is configured."
          confirmLabel="Delete connector" destructive
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { await api.deleteConnector(name); onDeleted(); }}
        />
      )}
    </div>
  );
}

function TestPanel({ name, ops }: { name: string; ops: string[] }) {
  const [op, setOp] = useState(ops[0] ?? "");
  const [params, setParams] = useState("{}");
  const [res, setRes] = useState<{ ok: boolean; result: unknown; error: string | null } | null>(null);
  useEffect(() => { if (!ops.includes(op)) setOp(ops[0] ?? ""); }, [ops.join(",")]);
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Zap className="h-4 w-4 text-primary" /> Test connection</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">Saved configuration is used. Works while the connector is disabled; every test is written to the audit trail.</p>
        <div className="flex gap-2">
          <select className="h-9 rounded-lg border bg-background px-2 font-mono text-xs" value={op} onChange={(e) => setOp(e.target.value)}>
            {ops.map((o) => <option key={o}>{o}</option>)}</select>
          <AsyncButton disabled={!op} onRun={async () => {
            try { setRes(await api.testConnector(name, op, JSON.parse(params || "{}"))); }
            catch (e: any) { setRes({ ok: false, result: null, error: e.message }); }
          }}>Run test</AsyncButton>
        </div>
        <Textarea rows={3} className="font-mono text-xs" value={params} onChange={(e) => setParams(e.target.value)} placeholder='Parameters, e.g. {"body": {"name": "Jane"}}' />
        {res && (res.ok
          ? <div><StatusBadge value="pass" label="reachable" /><JsonView data={res.result} className="mt-2" /></div>
          : <div className="flex items-start gap-2 rounded-lg border border-red-500/35 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />{res.error}
          </div>)}
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
        <DialogHeader>
          <DialogTitle>Add connector</DialogTitle>
          <DialogDescription>Starts disabled with an example configuration for you to edit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase())} placeholder="core_banking" className="font-mono" /></div>
          <div className="space-y-1.5"><Label>Type</Label>
            <select className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><AsyncButton onRun={go} disabled={!name}>Create connector</AsyncButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
