import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Plus, RefreshCw, Send, Smartphone, Trash2 } from "lucide-react";
import {
  api,
  can,
  type Agent,
  type Me,
  type WfSummary,
  type WhatsAppAccount,
  type WhatsAppConfig,
  type WhatsAppContact,
  type WhatsAppMessage,
  type WhatsAppTranscript,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { PhoneFrame } from "@/components/demo/PhoneFrame";
import { useToast } from "@/components/ui/toast";
import { agentRole } from "@/lib/workflows";
import { cn } from "@/lib/utils";

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function clock(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "WA";
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
  const [sending, setSending] = useState(false);
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
    setTranscript(null);
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
    if (!to || !message.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.simulateWhatsApp({ wa_id: to, text: message.trim(), display_name: draftName });
      setMessage("");
      if (res.ok) toast.push(res.duplicate ? "Meta already delivered that message" : "Agent replied on WhatsApp", "success");
      else toast.push(res.reason || "The agent could not handle that message", "error");
      await reload(to);
    } catch (e: any) {
      toast.push(e.message, "error");
    } finally {
      setSending(false);
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
  const account = accounts.find((a) => a.id === contact?.account_id) ?? accounts[0];
  const boundAgent = account ? agentRole(agentName(account.agent_id)) : null;

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
        <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
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

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,392px)_minmax(0,1fr)]">
            <WaPhone
              contact={contact}
              wa={wa}
              boundAgent={boundAgent}
              simulator={!config?.graph_configured}
              messages={transcript?.messages ?? []}
              message={message}
              onMessage={setMessage}
              onSend={sendSimulated}
              sending={sending}
              canSend={!!digits(number || wa)}
              onRefresh={() => reload(wa)}
              onSuggestion={(text) => { setMessage(text); }}
            />

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Send as a customer</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid gap-3 sm:grid-cols-2">
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
                  <p className="text-xs text-muted-foreground">
                    Type into the phone on the left. The message enters through the same inbound webhook handler as Meta —
                    guardrails, locale, audit and thread history apply — but the Graph API call is stubbed.
                  </p>
                  {transcript?.contact?.thread_id && (
                    <p className="font-mono text-[11px] text-muted-foreground">thread {transcript.contact.thread_id.slice(0, 8)}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Proactive update</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Input value={updateSubject} onChange={(e) => setUpdateSubject(e.target.value)} placeholder="Subject" />
                  <Textarea rows={2} value={update} onChange={(e) => setUpdate(e.target.value)}
                    placeholder="Your card has been dispatched and will arrive in 3 working days." />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Sent through the approval outbox + guardrails.</span>
                    <AsyncButton onRun={sendUpdate} disabled={!wa || !update.trim()}>
                      <Send className="h-4 w-4" /> Send update
                    </AsyncButton>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Run a task for this customer</CardTitle></CardHeader>
                <CardContent className="space-y-2">
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
                  <Textarea className="font-mono text-xs" rows={3} value={wfInputs}
                    onChange={(e) => setWfInputs(e.target.value)} placeholder='{"customer_id": "..."}' />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      The run is attributed to this WhatsApp customer; completion, failure or cancellation is sent back here.
                    </span>
                    <AsyncButton onRun={startTask} disabled={!wa || !wfKey || !canRun}>Run task</AsyncButton>
                  </div>
                  {!canRun && <p className="text-xs text-amber-600 dark:text-amber-400">You need the workflows:run permission.</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WaPhone({
  contact, wa, boundAgent, simulator, messages, message, onMessage, onSend, sending, canSend, onRefresh, onSuggestion,
}: {
  contact: WhatsAppContact | null;
  wa: string;
  boundAgent: string | null;
  simulator: boolean;
  messages: WhatsAppMessage[];
  message: string;
  onMessage: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  canSend: boolean;
  onRefresh: () => void;
  onSuggestion: (text: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  const title = contact ? (contact.display_name || contact.wa_id) : wa ? wa : "No conversation";
  const suggestions = ["Where is my order?", "Check my balance", "Nimetumwa malipo mara mbili"];

  return (
    <PhoneFrame
      tone="whatsapp" screenHeight="h-[600px]" screenClassName="bg-[#efe7dd]"
      caption="WhatsApp surface · the real inbound handler with the Graph API stubbed. Messages here are recorded and answered like live traffic."
    >
      <div className="flex shrink-0 items-center gap-2.5 bg-[#075e54] px-3.5 py-2.5 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[11px] font-semibold">
          {initials(title)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold">{title}</p>
          <p className="truncate text-[10px] text-white/70">
            +{wa || "—"} · {boundAgent ? `via ${boundAgent}` : "no agent bound"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-wide">
            {simulator ? "simulated" : "live"}
          </span>
          <button type="button" onClick={onRefresh} title="Reload transcript"
            className="rounded-full bg-white/15 p-1.5 text-white/90 hover:bg-white/25"><RefreshCw className="h-3 w-3" /></button>
        </div>
      </div>

      <div ref={scroller}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
        style={{ backgroundColor: "#efe7dd", backgroundImage: "radial-gradient(rgba(120,100,80,0.14) 1px, transparent 1px)", backgroundSize: "14px 14px" }}>
        {!wa ? (
          <div className="mx-auto mt-12 max-w-[240px] space-y-2 text-center text-[11px] leading-relaxed text-slate-600">
            <Smartphone className="mx-auto h-6 w-6 text-slate-500" />
            <p>Pick a conversation on the left, or type a customer number and send the first message.</p>
          </div>
        ) : messages.length === 0 && !sending ? (
          <div className="mx-auto mt-12 max-w-[240px] space-y-1 rounded-lg bg-white/70 px-3 py-2 text-center text-[10.5px] leading-relaxed text-slate-600">
            <p className="font-medium text-slate-700">No messages yet</p>
            <p>Send one below — it goes through the real inbound webhook handler with the Graph call stubbed.</p>
          </div>
        ) : messages.map((m) => {
          const out = m.direction === "out";
          return (
            <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[86%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug shadow-sm",
                out ? "rounded-tr-none bg-[#d9fdd3] text-slate-900" : "rounded-tl-none bg-white text-slate-900")}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[8.5px] text-slate-500">
                  {clock(m.created_at)}
                  {out ? (m.status === "read" || m.status === "delivered"
                    ? <CheckCheck className="h-3 w-3 text-sky-600" />
                    : <Check className="h-3 w-3 text-slate-500" />) : null}
                  {m.status === "failed" ? <span className="text-red-500">failed</span> : null}
                </p>
              </div>
            </div>
          );
        })}
        {sending ? (
          <div className="flex justify-end">
            <div className="flex items-center gap-1 rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-slate-500" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-slate-500 [animation-delay:120ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-slate-500 [animation-delay:240ms]" />
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 bg-[#efe7dd] px-2.5 pb-2.5">
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" disabled={sending || !canSend} onClick={() => onSuggestion(s)}
              className="shrink-0 rounded-full border border-[#c9c2b2] bg-white/70 px-2 py-0.5 text-[10px] text-slate-700 disabled:opacity-40">{s}</button>
          ))}
        </div>
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
          <input value={message} onChange={(e) => onMessage(e.target.value)} placeholder="Type a message"
            className="h-9 min-w-0 flex-1 rounded-full border border-[#c9c2b2] bg-white px-3 text-[12px] text-slate-900 placeholder:text-slate-500 outline-none focus:border-[#075e54]" />
          <button type="submit" aria-label="Send WhatsApp message" disabled={!message.trim() || sending || !canSend}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#075e54] text-white disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </PhoneFrame>
  );
}
