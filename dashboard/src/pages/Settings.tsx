import { useEffect, useMemo, useState } from "react";
import { Check, Copy, KeyRound, Settings2 } from "lucide-react";
import { api, type ApiKey, type Agent, type Connection, type ServiceStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/utils";
import { AsyncButton } from "@/components/common/AsyncButton";
import { cn } from "@/lib/utils";

const SERVICES = ["langfuse", "ollama", "vllm", "litellm", "langgraph"] as const;
type ServiceName = (typeof SERVICES)[number];

export function Settings({ tenant }: { tenant: string }) {
  return (
    <div>
      <PageHeader icon={Settings2} title="Settings" description="Service connections, API keys, and embed snippets." />
      <Tabs defaultValue="connections">
        <TabsList className="h-10 rounded-xl p-1">
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="embed">Embed</TabsTrigger>
        </TabsList>
        <TabsContent value="connections" className="mt-4">
          <ConnectionsTab />
        </TabsContent>
        <TabsContent value="keys" className="mt-4">
          <KeysTab tenant={tenant} />
        </TabsContent>
        <TabsContent value="embed" className="mt-4">
          <EmbedTab tenant={tenant} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Connections ────────────────────────────────────────────────────
function ConnectionsTab() {
  const [values, setValues] = useState<Record<string, Connection>>({});
  const [active, setActive] = useState<ServiceName>("langfuse");
  const [status, setStatus] = useState<Record<string, ServiceStatus>>({});
  const toast = useToast();

  async function load() {
    const [v, s] = await Promise.all([
      api.connections(),
      api.testConnection(active).catch(() => null),
    ]);
    setValues(v);
    if (s) setStatus((prev) => ({ ...prev, [active]: s }));
  }

  useEffect(() => { load().catch((e) => toast.push(e.message, "error")); }, []);
  useEffect(() => {
    api.testConnection(active)
      .then((s) => setStatus((prev) => ({ ...prev, [active]: s })))
      .catch(() => {});
  }, [active]);

  const fields = useMemo(() => Object.keys(values[active] || {}).filter((k) => !k.endsWith("_set")), [values, active]);

  function update(name: ServiceName, key: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: { ...(prev[name] || {}), [key]: value } }));
  }

  async function save() {
    try {
      const payload: Record<string, string> = {};
      for (const k of fields) {
        const v = (values[active] as any)[k];
        if (typeof v === "string") payload[k] = v;
      }
      await api.putConnection(active, payload);
      await load();
      toast.push("Saved", "success");
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  const st = status[active];

  return (
    <div className="grid gap-4 md:grid-cols-[240px,minmax(0,1fr)]">
      <Card className="self-start"><CardHeader className="pb-2"><CardTitle className="text-sm">Services</CardTitle></CardHeader>
        <CardContent className="space-y-1 p-2">
          {SERVICES.map((s) => (
            <button key={s} onClick={() => setActive(s)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                active === s ? "border-primary/40 bg-primary/5 font-medium shadow-sm" : "border-transparent hover:bg-muted/60",
              )}>
              <span className="capitalize">{s}</span>
              {status[s] && (
                <StatusBadge
                  value={status[s].ok ? "pass" : status[s].configured ? "fail" : "cancelled"}
                  label={status[s].ok ? "ok" : status[s].configured ? "bad" : "—"}
                />
              )}
            </button>
          ))}
        </CardContent></Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="capitalize">{active}</CardTitle>
          {st && <StatusBadge value={st.ok ? "pass" : st.configured ? "fail" : "cancelled"} label={st.ok ? "connected" : st.configured ? "failing" : "not configured"} />}
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.length === 0 && <div className="text-sm text-muted-foreground">No settings for this service.</div>}
          {fields.map((field) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={`${active}-${field}`} className="capitalize">{field.replace(/_/g, " ")}</Label>
              <Input
                id={`${active}-${field}`}
                value={(values[active] as any)?.[field] || ""}
                placeholder={`${field}_set` in (values[active] || {}) ? "•••• (unchanged)" : ""}
                onChange={(e) => update(active, field, e.target.value)}
              />
            </div>
          ))}
          <div className="flex gap-2 border-t border-border/60 pt-3">
            <AsyncButton onRun={save}>Save</AsyncButton>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const s = await api.testConnection(active);
                  setStatus((prev) => ({ ...prev, [active]: s }));
                  toast.push(s.ok ? "Connected" : s.detail, s.ok ? "success" : "error");
                } catch (e: any) {
                  toast.push(e.message, "error");
                }
              }}
            >
              Test connection
            </Button>
          </div>
          {st && (
            <div className={cn(
              "rounded-lg border p-2.5 text-xs",
              st.ok ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" : "border-border bg-muted/40 text-muted-foreground",
            )}>
              {st.detail}
              {st.latency_ms != null && ` · ${st.latency_ms}ms`}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── API keys ───────────────────────────────────────────────────────
function KeysTab({ tenant }: { tenant: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function refresh() {
    const [k, a] = await Promise.all([api.listKeys(tenant), api.listAgents(tenant)]);
    setKeys(k);
    setAgents(a);
  }
  useEffect(() => { refresh().catch((e) => toast.push(e.message, "error")); }, [tenant]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="h-4 w-4" /> Keys are shown once. Store them securely.
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New key</Button>
          </DialogTrigger>
          <DialogContent>
            <CreateKeyForm
              tenant={tenant}
              agents={agents}
              onCreated={(k) => {
                setCreated(k);
                setOpen(false);
                refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {created && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm text-emerald-700 dark:text-emerald-400">Key created — copy it now</CardTitle>
            <Button size="sm" variant="outline" onClick={async () => {
              await navigator.clipboard.writeText(created.key ?? "");
              setCopied(true);
              toast.push("Key copied", "success");
              setTimeout(() => setCopied(false), 1500);
            }}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
            </Button>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-lg border bg-background p-2.5 font-mono text-xs">{created.key}</code>
            <div className="mt-2 text-xs text-muted-foreground">This value is never shown again.</div>
          </CardContent>
        </Card>
      )}

      {keys.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No API keys yet. Create one to embed the assistant on a site.</CardContent></Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH><TH>Kind</TH><TH>Prefix</TH><TH>Agent</TH>
                <TH>Origins</TH><TH className="text-right">Rate</TH><TH>Created</TH><TH></TH>
              </TR>
            </THead>
            <TBody>
              {keys.map((k) => (
                <TR key={k.id}>
                  <TD className="font-medium">{k.name}</TD>
                  <TD><Badge variant="secondary">{k.kind}</Badge></TD>
                  <TD className="font-mono text-xs text-muted-foreground">{k.prefix}…</TD>
                  <TD className="font-mono text-xs text-muted-foreground">{k.agent_id.slice(0, 8)}…</TD>
                  <TD className="max-w-[180px] truncate text-xs">{k.allowed_origins.join(", ") || "—"}</TD>
                  <TD className="text-right text-xs tabular-nums">{k.rate_limit_per_min}/min</TD>
                  <TD className="whitespace-nowrap text-xs">{fmtDate(k.created_at)}</TD>
                  <TD>
                    {k.revoked ? (
                      <StatusBadge value="cancelled" label="revoked" />
                    ) : (
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setRevoking(k)}>
                        Revoke
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {revoking && (
        <ConfirmDialog
          title={`Revoke ${revoking.name}?`}
          description="Any site or service using this key will stop working immediately. This cannot be undone."
          confirmLabel="Revoke key" destructive
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await api.revokeKey(revoking.id);
            toast.push("Key revoked", "success");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateKeyForm({
  tenant, agents, onCreated,
}: {
  tenant: string;
  agents: Agent[];
  onCreated: (k: ApiKey) => void;
}) {
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [kind, setKind] = useState<"publishable" | "secret">("publishable");
  const [origins, setOrigins] = useState("*");
  const [rate, setRate] = useState(60);
  const toast = useToast();

  async function submit() {
    try {
      const k = await api.createKey({
        name, agent_id: agentId, tenant_id: tenant, kind,
        allowed_origins: origins.split(",").map((s) => s.trim()).filter(Boolean),
        rate_limit_per_min: rate,
      });
      onCreated(k);
      toast.push("Key created", "success");
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create API key</DialogTitle>
        <DialogDescription>One key per site or integration. Restrict origins in production.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label>Agent</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
            <SelectContent>
              {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="publishable">publishable</SelectItem>
              <SelectItem value="secret">secret</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Allowed origins</Label>
          <Input value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="* or https://app.example.com" />
        </div>
        <div>
          <Label>Rate limit (per minute)</Label>
          <Input type="number" value={rate} onChange={(e) => setRate(Number(e.target.value) || 60)} />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={!name || !agentId}>Create</Button>
      </DialogFooter>
    </>
  );
}

// ── Embed ──────────────────────────────────────────────────────────
function EmbedTab({ tenant }: { tenant: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [agentId, setAgentId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setAgents(await api.listAgents(tenant));
      setKeys(await api.listKeys(tenant));
    })();
  }, [tenant]);

  const snippet = useMemo(() => {
    if (!agentId || !keyId) return "";
    const key = keys.find((k) => k.id === keyId);
    if (!key) return "";
    const base = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/$/, "");
    return [
      `<script src="${base}/embed.js"`,
      `  data-api="${base}"`,
      `  data-agent="${agentId}"`,
      `  data-key="${key.prefix}…"`,
      `  data-tenant="${tenant}"></script>`,
    ].join("\n");
  }, [agentId, keyId, keys, tenant]);

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>API key</Label>
            <Select value={keyId} onValueChange={setKeyId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {keys.filter((k) => !k.revoked && k.agent_id === agentId).map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.name} ({k.prefix}…)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {snippet && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Embed snippet</Label>
              <Button size="sm" variant="outline" onClick={async () => {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
                toast.push("Snippet copied", "success");
                setTimeout(() => setCopied(false), 1500);
              }}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{snippet}</pre>
            <div className="text-xs text-muted-foreground">
              The prefix shown is a placeholder — paste the real key you saved when creating it.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}