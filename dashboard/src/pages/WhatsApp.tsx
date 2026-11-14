import { useEffect, useMemo, useState } from "react";
import { Plus, Send, Smartphone, Trash2 } from "lucide-react";
import {
  api,
  can,
  type Agent,
  type Me,
  type WfSummary,
  type WhatsAppAccount,
  type WhatsAppConfig,
  type WhatsAppContact,
  type WhatsAppTranscript,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function when(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export function WhatsApp({ me, tenant }: { me: Me | null; tenant: string }) {
  const toast = useToast();
  const canWrite = can(me, "connectors:write");
  const canRun = can(me, "workflows:run");

  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [contacts, setContacts] = useState<WhatsAppContact[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<WfSummary[]>([]);

  const [wa, setWa] = useState("");
  const [number, setNumber] = useState("");
  const [transcript, setTranscript] = useState<WhatsAppTranscript | null>(null);

  const [draftName, setDraftName] = useState("");
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState("");
  const [updateSubject, setUpdateSubject] = useState("[NMB] Account update");
  const [wfKey, setWfKey] = useState("");
  const [wfInputs, setWfInputs] = useState("{}");
  const [wfWait, setWfWait] = useState(true);

  const [newPid, setNewPid] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newAgent, setNewAgent] = useState("");

  const agentName = useMemo(() => {
    const map = new Map(agents.map((a) => [a.id, a.name]));
    return (id: string) => map.get(id) ?? id;
  }, [agents]);

  async function load() {
    try {
      const [cfg, accts, list, ags, wfs] = await Promise.all([
        api.whatsappConfig(),
        api.whatsappAccounts(),
        api.whatsappContacts(),
        api.listAgents(tenant),
        api.listWorkflows().catch(() => []),
      ]);
      setConfig(cfg);
      setAccounts(accts);
      setContacts(list);
      setAgents(ags);
      setWorkflows(wfs);
      setNewAgent((a) => a || ags[0]?.id || "");
      setWfKey((k) => k || wfs[0]?.key || "");
      setWa((w) => w || list[0]?.wa_id || "");
    } catch (e: any) {
      toast.push(e.message, "error");
      setContacts([]);
    }
  }

  useEffect(() => { load(); }, [tenant]);

  useEffect(() => { setNumber(wa); }, [wa]);

  useEffect(() => {
    if (!wa) { setTranscript(null); return; }
    let live = true;
    api.whatsappTranscript(wa).then((t) => { if (live) setTranscript(t); }).catch(() => { if (live) setTranscript(null); });
    return () => { live = false; };
  }, [wa]);

  async function reload(select?: string, name = "") {
    const list = await api.whatsappContacts().catch(() => contacts ?? []);
    setContacts(list);
    const target = select || wa;
    if (target) {
      setWa(target);
      const t = await api.whatsappTranscript(target).catch(() => null);
      setTranscript(t);
      const c = list.find((x) => x.wa_id === target);
      if (c && name) setDraftName(name);
    }
  }

  async function sendSimulated() {
    const to = digits(number || wa);
    if (!to || !message.trim()) return;
    try {
      const res = await api.simulateWhatsApp({ wa_id: to, text: message.trim(), display_name: draftName });
      if (res.ok) {
        setMessage("");
        toast.push(res.duplicate ? "Meta already delivered that message" : "Agent replied on WhatsApp", "success");
        await reload(to);
      } else {
        toast.push(res.reason || "The agent could not handle that message", "error");
        await reload(to);
      }
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  async function sendUpdate() {
    if (!wa || !update.trim()) return;
    try {
      const res = await api.notifyWhatsApp({ wa_id: wa, text: update.trim(), subject: updateSubject.trim() });
      setUpdate("");
      const ok = res.status === "sent";
      toast.push(
        ok ? "Update sent on WhatsApp" : res.status === "pending" ? "Update queued for delivery" : `Delivery ${res.status}: ${res.error ?? ""}`,
        ok || res.status === "pending" ? "success" : "error",
      );
      await reload(wa);
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  async function startTask() {
    if (!wa || !wfKey) return;
    let inputs: Record<string, unknown>;
    try { inputs = JSON.parse(wfInputs || "{}"); } catch { toast.push("Inputs must be valid JSON", "error"); return; }
    try {
      const run = await api.runWhatsAppTask({ wa_id: wa, workflow_key: wfKey, inputs, wait: wfWait });
      await api.dispatchNotifications().catch(() => {});
      toast.push(
        run.status === "waiting_approval"
          ? `Task ${run.id.slice(0, 8)} is waiting for approval — the customer is updated when it finishes`
          : `Task ${run.status.replace(/_/g, " ")} (${run.id.slice(0, 8)})`,
        run.status === "failed" ? "error" : "success",
      );
      await reload(wa);
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  async function bindNumber(agentId = newAgent) {
    if (!newPid.trim() || !agentId) return;
    try {
      await api.saveWhatsAppAccount({
        phone_number_id: newPid.trim(), agent_id: agentId, display_phone: newDisplay.trim(), enabled: true,
      });
      setNewPid(""); setNewDisplay("");
      toast.push("WhatsApp number bound", "success");
      await load();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  async function removeAccount(id: string) {
    try {
      await api.deleteWhatsAppAccount(id);
      toast.push("Number unbound", "success");
      await load();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  const contact = transcript?.contact ?? contacts?.find((c) => c.wa_id === wa) ?? null;

  return (
    <div>
      <PageHeader
        icon={Smartphone}
        title="WhatsApp"
        description="Customers start the conversation in WhatsApp; the same agent answers there and sends them an update when their task finishes."
        actions={config && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={config.graph_configured ? "pass" : "warn"}
              label={config.graph_configured ? "Graph API" : "Simulator"} />
            <StatusBadge value={config.app_secret_set ? "pass" : "warn"}
              label={config.app_secret_set ? "webhook signed" : "webhook secret missing"} />
          </div>
        )}
      />

      {config && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">Webhook</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{config.webhook_path}</code>
            </span>
            <span className="text-muted-foreground">
              {config.bound_numbers === 0 ? "No number bound yet" : `${config.bound_numbers} number${config.bound_numbers === 1 ? "" : "s"} bound`}
            </span>
            {!config.graph_configured && (
              <span className="text-muted-foreground">
                Set <code className="font-mono text-xs">WHATSAPP_ACCESS_TOKEN</code> and{" "}
                <code className="font-mono text-xs">WHATSAPP_PHONE_NUMBER_ID</code> for live delivery; sends are recorded in simulator mode until then.
              </span>
            )}
            {!config.app_secret_set && (
              <span className="text-amber-600 dark:text-amber-400">
                Set <code className="font-mono text-xs">WHATSAPP_APP_SECRET</code> and <code className="font-mono text-xs">WHATSAPP_VERIFY_TOKEN</code>; unsigned webhooks are refused.
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {contacts === null ? <LoadingBlock rows={5} /> : (
        <div className="grid gap-4 md:grid-cols-[320px,minmax(0,1fr)]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Numbers</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {accounts.length === 0 && <p className="text-sm text-muted-foreground">Bind the Meta phone number ID to the agent that should answer.</p>}
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{a.display_phone || a.phone_number_id}</div>
                      <div className="truncate text-xs text-muted-foreground">{agentName(a.agent_id)} · <span className="font-mono">{a.phone_number_id}</span></div>
                    </div>
                    <div className="flex items-center gap-1">
                      <StatusBadge value={a.enabled ? "pass" : "disabled"} />
                      {canWrite && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeAccount(a.id)} title="Unbind">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {canWrite && (
                  <div className="space-y-2 rounded-lg border border-dashed p-3">
                    <div className="text-xs font-medium text-muted-foreground">Bind a number</div>
                    <Input placeholder="Meta phone number ID" value={newPid} onChange={(e) => setNewPid(e.target.value)} />
                    <Input placeholder="Display phone (optional)" value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} />
                    <select className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={newAgent}
                      onChange={(e) => setNewAgent(e.target.value)}>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <AsyncButton className="w-full" variant="outline" onRun={() => bindNumber()}>
                      <Plus className="h-4 w-4" /> Bind number
                    </AsyncButton>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Conversations <span className="font-normal text-muted-foreground">({contacts.length})</span></CardTitle></CardHeader>
              <CardContent className="space-y-1 p-2">
                {contacts.length === 0 && <p className="px-2 pb-2 text-sm text-muted-foreground">No one has messaged yet.</p>}
                {contacts.map((c) => (
                  <button key={c.id} onClick={() => setWa(c.wa_id)}
                    className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      wa === c.wa_id ? "border-primary/40 bg-primary/5 shadow-sm" : "border-transparent hover:bg-muted/60")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.display_name || c.wa_id}</span>
                      <Chip>{c.message_count ?? 0}</Chip>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{c.wa_id}</div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="self-start">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {contact ? (contact.display_name || contact.wa_id) : "New conversation"}
                {contact && <Chip>{contact.wa_id}</Chip>}
                {contact?.thread_id && <Chip>thread {contact.thread_id.slice(0, 8)}</Chip>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {transcript && transcript.messages.length > 0 ? (
                <div className="max-h-[380px] space-y-2 overflow-auto rounded-xl border bg-muted/20 p-3">
                  {transcript.messages.map((m) => (
                    <div key={m.id} className={cn("flex", m.direction === "in" ? "justify-start" : "justify-end")}>
                      <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                        m.direction === "in" ? "bg-background border" : "bg-primary/10 border border-primary/20")}>
                        <div className="whitespace-pre-wrap">{m.body}</div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{when(m.created_at)}</span>
                          {m.direction === "out" && <span>{m.kind} · {m.status}</span>}
                          {m.error && <span className="text-red-500">{m.error}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Smartphone} title="No messages yet"
                  body="Send a simulated customer message below, or connect Meta and message the bound number from a phone." />
              )}

              <div className="grid gap-3 sm:grid-cols-[160px,minmax(0,1fr)]">
                <div>
                  <Label htmlFor="wa-number">Customer number</Label>
                  <Input id="wa-number" inputMode="tel" placeholder="254712345678" value={number}
                    onChange={(e) => setNumber(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="wa-name">Name (optional)</Label>
                  <Input id="wa-name" placeholder="Wanjiku" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                </div>
              </div>

              <div>
                <Label htmlFor="wa-message">Message as the customer</Label>
                <div className="mt-1 flex gap-2">
                  <Input id="wa-message" placeholder="Hi, can you check my application status?"
                    value={message} onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendSimulated(); }} />
                  <AsyncButton onRun={sendSimulated} disabled={!message.trim()}>
                    <Send className="h-4 w-4" /> Send
                  </AsyncButton>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Runs through the same gateway as the live webhook: guardrails, locale, audit and thread history apply.
                </p>
              </div>

              <div className="rounded-xl border p-3">
                <div className="mb-2 text-sm font-medium">Proactive update</div>
                <div className="space-y-2">
                  <Input value={updateSubject} onChange={(e) => setUpdateSubject(e.target.value)} placeholder="Subject" />
                  <Textarea rows={2} value={update} onChange={(e) => setUpdate(e.target.value)}
                    placeholder="Your card has been dispatched and will arrive in 3 working days." />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Sent through the approval outbox + guardrails.</span>
                    <AsyncButton onRun={sendUpdate} disabled={!wa || !update.trim()}>
                      <Send className="h-4 w-4" /> Send update
                    </AsyncButton>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border p-3">
                <div className="mb-2 text-sm font-medium">Run a task for this customer</div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr),120px]">
                  <select className="h-9 w-full rounded-lg border bg-background px-2 text-sm" value={wfKey}
                    onChange={(e) => setWfKey(e.target.value)}>
                    {workflows.length === 0 && <option value="">No workflows installed</option>}
                    {workflows.map((w) => <option key={w.key} value={w.key}>{w.name || w.key}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={wfWait} onChange={(e) => setWfWait(e.target.checked)} />
                    wait
                  </label>
                </div>
                <Textarea className="mt-2 font-mono text-xs" rows={3} value={wfInputs}
                  onChange={(e) => setWfInputs(e.target.value)} placeholder='{"customer_id": "..."}' />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    The run is attributed to this WhatsApp customer; completion, failure or cancellation is sent back here.
                  </span>
                  <AsyncButton onRun={startTask} disabled={!wa || !wfKey || !canRun}>Run task</AsyncButton>
                </div>
                {!canRun && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">You need the workflows:run permission.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
