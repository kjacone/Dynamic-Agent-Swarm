import { useEffect, useMemo, useState } from "react";
import { api, type ApiKey, type Agent, type Connection, type ServiceStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/common/PageHeader";
import { useToast } from "@/components/ui/toast";
import { fmtDate, truncate } from "@/lib/utils";
import { AsyncButton } from "@/components/common/AsyncButton";

const SERVICES = ["langfuse", "ollama", "vllm", "litellm", "langgraph"] as const;
type ServiceName = (typeof SERVICES)[number];

export function Settings({ tenant }: { tenant: string }) {
  return (
    <div>
      <PageHeader title="Settings" description="Service connections, API keys, and embed snippets." />
      <Tabs defaultValue="connections">
        <TabsList>
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
    <div className="grid gap-4 md:grid-cols-[220px,1fr]">
      <div className="space-y-1">
        {SERVICES.map((s) => (
          <button
            key={s}
            onClick={() => setActive(s)}
            className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${
              active === s ? "bg-muted font-medium" : "hover:bg-muted/60"
            }`}
          >
            <span className="capitalize">{s}</span>
            {status[s] && (
              <Badge variant={status[s].ok ? "success" : status[s].configured ? "destructive" : "outline"}>
                {status[s].ok ? "ok" : status[s].configured ? "bad" : "—"}
              </Badge>
            )}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="capitalize">{active}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.map((field) => (
            <div key={field} className="space-y-1">
              <Label htmlFor={`${active}-${field}`}>{field.replace(/_/g, " ")}</Label>
              <Input
                id={`${active}-${field}`}
                value={(values[active] as any)?.[field] || ""}
                placeholder={`${field}_set` in (values[active] || {}) ? "•••• (unchanged)" : ""}
                onChange={(e) => update(active, field, e.target.value)}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-2">
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
              Test
            </Button>
          </div>
          {st && (
            <div className="text-xs text-muted-foreground">
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
        <div className="text-sm text-muted-foreground">Keys are shown once. Store them securely.</div>
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
        <Card className="border-emerald-300 bg-emerald-50">
          <CardHeader><CardTitle>Key created — copy now</CardTitle></CardHeader>
          <CardContent>
            <code className="block break-all rounded bg-white p-2 text-xs">{created.key}</code>
            <div className="mt-2 text-xs text-emerald-900">This value is never shown again.</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH><TH>Kind</TH><TH>Prefix</TH><TH>Agent</TH>
              <TH>Origins</TH><TH>Rate</TH><TH>Created</TH><TH></TH>
            </TR>
          </THead>
          <TBody>
            {keys.map((k) => (
              <TR key={k.id}>
                <TD>{k.name}</TD>
                <TD><Badge variant="secondary">{k.kind}</Badge></TD>
                <TD className="font-mono text-xs">{k.prefix}…</TD>
                <TD className="font-mono text-xs">{k.agent_id.slice(0, 8)}…</TD>
                <TD className="text-xs">{k.allowed_origins.join(", ") || "—"}</TD>
                <TD className="text-xs tabular-nums">{k.rate_limit_per_min}/min</TD>
                <TD className="text-xs">{fmtDate(k.created_at)}</TD>
                <TD>
                  {k.revoked ? (
                    <Badge variant="outline">revoked</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await api.revokeKey(k.id);
                        toast.push("Revoked", "success");
                        refresh();
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
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
      <DialogHeader><DialogTitle>Create API key</DialogTitle></DialogHeader>
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
          <div>
            <Label>Embed snippet</Label>
            <pre className="overflow-auto rounded-md border bg-muted/40 p-3 text-xs">{snippet}</pre>
            <div className="mt-1 text-xs text-muted-foreground">
              The prefix shown is a placeholder — paste the real key you saved when creating it.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}