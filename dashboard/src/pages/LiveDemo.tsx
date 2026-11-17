import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Bot, Check, CheckCheck, CircleCheck, Clock3, GitBranch,
  Globe2, Languages, Loader2, MessageSquare, Mic, PhoneCall, PhoneOff, Play, RefreshCw, Send,
  Smartphone, Sparkles, Volume2, XCircle,
} from "lucide-react";
import {
  api, API_BASE, type Agent, type LocaleProfileRow, type RunView, type WfSpec, type WfStep,
  type WfSummary, type WhatsAppAccount, type WhatsAppConfig, type WhatsAppContact, type WhatsAppMessage,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { AsyncButton } from "@/components/common/AsyncButton";
import { PhoneFrame } from "@/components/demo/PhoneFrame";
import { LiveDemoHost } from "@/pages/LiveDemoHost";
import { agentRole, describeStep } from "@/lib/workflows";
import { cn } from "@/lib/utils";

type Channel = "chat" | "whatsapp" | "voice";
type Mode = "chat" | "workflow";
export type DemoRequest = { agentId?: string; channel?: Channel; nonce: number };

type Turn = { id: number; role: "user" | "agent"; text: string; time: string; meta?: string; blocked?: boolean };
type TraceLine = { label: string; detail: string; tone?: "ok" | "warn" };

const CHANNELS: { id: Channel; label: string; icon: typeof MessageSquare; hint: string }[] = [
  { id: "chat", label: "App chat", icon: MessageSquare, hint: "the web widget, on a phone" },
  { id: "whatsapp", label: "WhatsApp", icon: Smartphone, hint: "simulated number · no Meta calls" },
  { id: "voice", label: "Voice call", icon: PhoneCall, hint: "browser speech · call screen" },
];

let turnSeq = 0;
const nextTurn = (role: Turn["role"], text: string, extra: Partial<Turn> = {}): Turn => ({
  id: ++turnSeq, role, text, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), ...extra,
});

function greetingFor(agent: Agent | undefined, profile: LocaleProfileRow | undefined): string {
  const role = agent ? agentRole(agent.name) : "the assistant";
  if (profile?.default_language?.toLowerCase().startsWith("kis")) {
    return `Habari! Umeunganishwa na ${role}. Nikusaidie nini leo?`;
  }
  return `Hello — you're through to ${role}. What can I help you with today?`;
}

export function LiveDemo({
  tenant, request, onOpenSolutions, onOpenApprovals, onOpenWorkflows, onOpenWhatsApp, onOpenLocale,
}: {
  tenant: string;
  request?: DemoRequest | null;
  onOpenSolutions?: () => void;
  onOpenApprovals?: () => void;
  onOpenWorkflows?: () => void;
  onOpenWhatsApp?: () => void;
  onOpenLocale?: () => void;
}) {
  const [hostView, setHostView] = useState(false);
  return hostView ? (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={() => setHostView(false)}>← Back to the demo bench</Button>
      <LiveDemoHost tenant={tenant} onOpenSolutions={onOpenSolutions} />
    </div>
  ) : (
    <DemoBench
      tenant={tenant}
      request={request}
      onOpenApprovals={onOpenApprovals}
      onOpenWorkflows={onOpenWorkflows}
      onOpenWhatsApp={onOpenWhatsApp}
      onOpenLocale={onOpenLocale}
      onOpenHost={() => setHostView(true)}
    />
  );
}

function DemoBench({
  tenant, request, onOpenApprovals, onOpenWorkflows, onOpenWhatsApp, onOpenLocale, onOpenHost,
}: {
  tenant: string;
  request?: DemoRequest | null;
  onOpenApprovals?: () => void;
  onOpenWorkflows?: () => void;
  onOpenWhatsApp?: () => void;
  onOpenLocale?: () => void;
  onOpenHost: () => void;
}) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [profiles, setProfiles] = useState<LocaleProfileRow[]>([]);
  const [workflows, setWorkflows] = useState<WfSummary[]>([]);
  const [waConfig, setWaConfig] = useState<WhatsAppConfig | null>(null);
  const [waAccounts, setWaAccounts] = useState<WhatsAppAccount[]>([]);
  const [waContacts, setWaContacts] = useState<WhatsAppContact[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [agentId, setAgentId] = useState(request?.agentId || "");
  const [channel, setChannel] = useState<Channel>("chat");
  const [mode, setMode] = useState<Mode>("chat");
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    Promise.all([
      api.listAgents(tenant),
      api.listLocaleProfiles(tenant).catch(() => [] as LocaleProfileRow[]),
      api.listWorkflows().catch(() => [] as WfSummary[]),
      api.whatsappConfig().catch(() => null),
      api.whatsappAccounts().catch(() => [] as WhatsAppAccount[]),
      api.whatsappContacts().catch(() => [] as WhatsAppContact[]),
    ])
      .then(([a, p, w, cfg, accts, contacts]) => {
        if (off) return;
        setAgents(a); setProfiles(p); setWorkflows(w); setWaConfig(cfg); setWaAccounts(accts); setWaContacts(contacts);
      })
      .catch((e: Error) => { if (!off) setLoadError(e.message); });
    return () => { off = true; };
  }, [tenant]);

  useEffect(() => {
    if (!request) return;
    if (request.agentId) setAgentId(request.agentId);
    if (request.channel) setChannel(request.channel);
    setMode("chat");
  }, [request?.nonce, request?.agentId, request?.channel]);

  const agent = useMemo(() => agents?.find((a) => a.id === agentId) ?? agents?.[0], [agents, agentId]);
  const preferredAgent = useMemo(() => {
    if (request?.agentId) return request.agentId;
    const attached = profiles.find((p) => p.attached_to?.length)?.attached_to[0];
    return attached || agents?.[0]?.id;
  }, [request?.agentId, profiles, agents]);
  useEffect(() => {
    if (!agentId && preferredAgent) setAgentId(preferredAgent);
  }, [agentId, preferredAgent]);

  const profileFor = (id: string | undefined) => profiles.find((p) => p.attached_to?.includes(id ?? ""));
  const locale = profileFor(agent?.id);

  const bound = waAccounts.find((a) => a.enabled);
  const waAgent = agents?.find((a) => a.id === bound?.agent_id);
  const waId = waContacts[0]?.wa_id || "255700000001";

  function resetTrace(first?: TraceLine) {
    setTrace(first ? [first] : []);
  }

  // ── chat ──────────────────────────────────────────────────────────
  const [chatTurns, setChatTurns] = useState<Turn[]>([]);
  const [chatThread, setChatThread] = useState<string | undefined>();
  const [chatBusy, setChatBusy] = useState(false);

  async function sendChat(text: string) {
    if (!agent) return;
    setError(null);
    setChatBusy(true);
    const started = performance.now();
    setChatTurns((t) => [...t, nextTurn("user", text)]);
    resetTrace({ label: "publishable key", detail: `minted for ${window.location.origin}` });
    try {
      const sent = await gatewayTurn(agent, text, chatThread);
      setChatThread(sent.thread_id);
      const ms = Math.round(performance.now() - started);
      setChatTurns((t) => [...t, nextTurn("agent", sent.reply || "No reply text came back for that turn — try rephrasing.", {
        blocked: sent.blocked, meta: `thread ${sent.thread_id.slice(0, 8)} · ${ms} ms`,
      })]);
      setTrace([
        { label: "gateway · /v1/chat", detail: `thread ${sent.thread_id.slice(0, 8)}`, tone: "ok" },
        { label: "guardrails", detail: sent.blocked ? "output blocked" : "input + output screened", tone: sent.blocked ? "warn" : "ok" },
        { label: "locale formatter", detail: locale ? `${locale.locale_code} · ${locale.default_language}` : "no profile attached", tone: locale ? "ok" : undefined },
        { label: "next step", detail: "the model chose it from this turn", tone: "ok" },
      ]);
    } catch (e: any) {
      setError(e.message);
      setChatTurns((t) => [...t, nextTurn("agent", `The gateway did not answer: ${e.message}`, { blocked: true })]);
    } finally {
      setChatBusy(false);
    }
  }

  // ── whatsapp ──────────────────────────────────────────────────────
  const [waMessages, setWaMessages] = useState<WhatsAppMessage[]>([]);
  const [waBusy, setWaBusy] = useState(false);
  const [waNotice, setWaNotice] = useState<string | null>(null);

  async function refreshWhatsApp(id = waId) {
    if (!waContacts.length && !id) return;
    try {
      const t = await api.whatsappTranscript(id);
      setWaMessages(t.messages);
    } catch {
      setWaMessages([]); // first contact on this number — nothing recorded yet
    }
  }
  useEffect(() => {
    if (channel === "whatsapp") refreshWhatsApp();
  }, [channel, waId]);

  async function sendWhatsApp(text: string) {
    setWaBusy(true);
    setError(null);
    setWaNotice(null);
    resetTrace({ label: "webhook", detail: "POST /whatsapp/webhook → simulator", tone: "ok" });
    try {
      const result = await api.simulateWhatsApp({ wa_id: waId, text, display_name: "Demo customer" });
      if (result.duplicate) setWaNotice("Duplicate inbound — the webhook deduped this message.");
      else if (!result.ok) setError(result.reason || "The simulator accepted the message but the agent produced no reply.");
      await refreshWhatsApp();
      setTracesForWhatsApp(result.ok, result.reason);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWaBusy(false);
    }
  }
  function setTracesForWhatsApp(ok: boolean, reason?: string) {
    setTrace([
      { label: "number → agent", detail: waAgent ? agentRole(waAgent.name) : "no number bound", tone: waAgent ? "ok" : "warn" },
      { label: "webhook path", detail: "same /v1/chat gateway as the widget", tone: "ok" },
      { label: "guardrails", detail: "screen + audit per turn", tone: "ok" },
      { label: "graph api", detail: "skipped — simulator records locally", tone: "warn" },
      ...(ok ? [] : [{ label: "turn", detail: reason || "no reply", tone: "warn" as const }]),
    ]);
  }

  // ── voice ─────────────────────────────────────────────────────────
  const [voiceTurns, setVoiceTurns] = useState<Turn[]>([]);
  const [voiceThread, setVoiceThread] = useState<string | undefined>();
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!callActive) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [callActive]);

  function startCall() {
    setCallActive(true);
    setSeconds(0);
    if (voiceTurns.length === 0) setVoiceTurns([nextTurn("agent", greetingFor(agent, locale))]);
    setTrace([
      { label: "speech → text", detail: "microphone stays off in the bench; typed turns stand in", tone: "warn" },
      { label: "gateway · /v1/chat", detail: "same agent as chat, one call thread", tone: "ok" },
      { label: "text → speech", detail: speak ? "spoken in the browser" : "captions only" },
    ]);
  }
  function endCall() {
    setCallActive(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  async function sendVoice(text: string) {
    if (!agent) return;
    setError(null);
    setVoiceBusy(true);
    setVoiceTurns((t) => [...t, nextTurn("user", text)]);
    try {
      const sent = await gatewayTurn(agent, text, voiceThread);
      setVoiceThread(sent.thread_id);
      setVoiceTurns((t) => [...t, nextTurn("agent", sent.reply || "No spoken reply came back for that turn — try rephrasing.", { blocked: sent.blocked })]);
      if (speak && "speechSynthesis" in window && sent.reply) {
        const u = new SpeechSynthesisUtterance(sent.reply);
        u.lang = locale?.locale_code || "en-US";
        window.speechSynthesis.speak(u);
      }
    } catch (e: any) {
      setError(e.message);
      setVoiceTurns((t) => [...t, nextTurn("agent", `The call dropped that turn: ${e.message}`, { blocked: true })]);
    } finally {
      setVoiceBusy(false);
    }
  }

  // ── workflow ──────────────────────────────────────────────────────
  const [wfKey, setWfKey] = useState("");
  const [spec, setSpec] = useState<WfSpec | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [run, setRun] = useState<RunView | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  useEffect(() => {
    if (!wfKey && workflows.length) setWfKey(workflows[0].key);
  }, [workflows, wfKey]);
  useEffect(() => {
    if (!wfKey) { setSpec(null); return; }
    let off = false;
    api.getWorkflow(wfKey)
      .then((s) => { if (!off) { setSpec(s); setInputs(Object.fromEntries(Object.keys(s.inputs || {}).map((k) => [k, ""]))); setRun(null); } })
      .catch((e: Error) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [wfKey]);

  useEffect(() => {
    if (!run || !["running", "waiting_approval"].includes(run.status)) return;
    const id = setInterval(() => {
      api.getRun(run.id).then(setRun).catch(() => {});
    }, 1500);
    return () => clearInterval(id);
  }, [run?.id, run?.status]);

  function fillSample() {
    if (!spec) return;
    const sample: Record<string, string> = {
      amount: "7500000", currency: "USD", beneficiary_country: "Kenya", country: "TZ",
      city: "Dar es Salaam", start_date: "2026-11-20", received: "2026-11-17",
      customer_id: "NMB-4417", phone: "255700000001", full_name: "Amina Juma",
    };
    setInputs(Object.fromEntries(Object.keys(spec.inputs || {}).map((k) => [k, sample[k] ?? ""])));
  }

  async function startRun() {
    if (!spec) return;
    const missing = Object.entries(spec.inputs || {}).filter(([k, s]) => s.required && !inputs[k]?.trim());
    if (missing.length) { setError(`Fill required inputs: ${missing.map(([k]) => k).join(", ")}`); return; }
    setError(null); setRunBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(inputs)) {
        if (!v.trim()) continue;
        const type = spec.inputs[k]?.type;
        if (type === "number") payload[k] = Number(v);
        else if (type === "boolean") payload[k] = v === "true";
        else if (type === "object" || type === "array") {
          try { payload[k] = JSON.parse(v); } catch { throw new Error(`Input ${k} must be valid JSON`); }
        } else payload[k] = v;
      }
      setRun(await api.runWorkflow(spec.key, payload, false));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunBusy(false);
    }
  }

  const steps = spec?.steps ?? [];
  const stepState = (s: WfStep): "done" | "current" | "pending" | "failed" => {
    if (!run) return "pending";
    const done = run.history.some((h) => h.step === s.id && h.status === "ok");
    if (done) return "done";
    if (run.current_step === s.id) return run.status === "failed" ? "failed" : "current";
    return "pending";
  };
  const localeSteps = steps.filter((s) => s.type === "agent" && profileFor(s.agent));

  return (
    <div>
      <PageHeader
        icon={Smartphone}
        title="Demo bench"
        description="Test any agent the way a customer meets it — app chat, WhatsApp or a call — then run the same request as a workflow and watch who decides each step, where localisation lands, and what the audit trail keeps."
        actions={
          <Button variant="outline" size="sm" onClick={onOpenHost}>
            Browser-tool host demo <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        }
      />

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{loadError}</div>
      )}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3 py-3.5">
          <label className="flex min-w-0 items-center gap-2 text-xs">
            <span className="text-muted-foreground">Agent</span>
            <select
              value={agent?.id ?? ""}
              onChange={(e) => { setAgentId(e.target.value); setChatTurns([]); setChatThread(undefined); setVoiceTurns([]); setVoiceThread(undefined); endCall(); }}
              className="h-8 max-w-[320px] rounded-lg border bg-background px-2 text-xs"
            >
              {!agents ? <option value="">Loading agents…</option> : null}
              {(agents ?? []).map((a) => (
                <option key={a.id} value={a.id}>{agentRole(a.name)} · {a.id.slice(0, 8)}</option>
              ))}
            </select>
          </label>

          <LocaleChip agent={agent} locale={locale} />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border p-0.5" role="group" aria-label="Channel">
              {CHANNELS.map(({ id, label, icon: Icon, hint }) => (
                <button key={id} type="button" title={hint} aria-pressed={channel === id}
                  onClick={() => setChannel(id)}
                  className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                    channel === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted-foreground">Engine</span>
            <div className="flex rounded-full border p-0.5" role="group" aria-label="Engine">
              <button type="button" aria-pressed={mode === "chat"} onClick={() => setMode("chat")}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  mode === "chat" ? "bg-sky-600 text-white" : "text-muted-foreground hover:text-foreground")}>
                <MessageSquare className="h-3.5 w-3.5" /> Agent chat
              </button>
              <button type="button" aria-pressed={mode === "workflow"} onClick={() => setMode("workflow")}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  mode === "workflow" ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground")}>
                <GitBranch className="h-3.5 w-3.5" /> Workflow
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">{error}</div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div>
          {mode === "workflow" ? (
            <WorkflowPhone
              spec={spec} run={run} stepState={stepState}
              profileFor={profileFor}
              agentName={(id) => { const a = agents?.find((x) => x.id === id); return a ? agentRole(a.name) : undefined; }}
              onOpenApprovals={onOpenApprovals}
            />
          ) : channel === "chat" ? (
            <ChatPhone agent={agent} locale={locale} turns={chatTurns} busy={chatBusy} onSend={sendChat}
              onReset={() => { setChatTurns([]); setChatThread(undefined); setTrace([]); }} />
          ) : channel === "whatsapp" ? (
            <WhatsAppPhone
              boundAgent={waAgent} config={waConfig} messages={waMessages} waId={waId}
              busy={waBusy} notice={waNotice} onSend={sendWhatsApp}
              onRefresh={() => refreshWhatsApp()}
              onOpenWhatsApp={onOpenWhatsApp}
            />
          ) : (
            <VoicePhone
              agent={agent} locale={locale} turns={voiceTurns} busy={voiceBusy}
              callActive={callActive} seconds={seconds} speak={speak}
              onToggleCall={() => (callActive ? endCall() : startCall())}
              onSpeak={() => setSpeak((s) => !s)}
              onSend={sendVoice}
              onReset={() => { endCall(); setVoiceTurns([]); setVoiceThread(undefined); setTrace([]); }}
            />
          )}
        </div>

        <div className="space-y-4">
          {mode === "chat" ? (
            <EngineCard trace={trace} locale={locale} agent={agent} onSwitch={() => setMode("workflow")} />
          ) : (
            <WorkflowEngineCard
              workflows={workflows} spec={spec} wfKey={wfKey} onKey={setWfKey}
              inputs={inputs} onInput={(k, v) => setInputs((s) => ({ ...s, [k]: v }))}
              run={run} busy={runBusy} onRun={startRun} onSample={fillSample}
              stepState={stepState} profileFor={profileFor}
              onOpenWorkflows={onOpenWorkflows} onOpenApprovals={onOpenApprovals}
            />
          )}
        </div>
      </div>

      <DiffBand mode={mode} profileFor={profileFor} localeSteps={localeSteps} onMode={setMode} />

      <LocaleCard
        profiles={profiles} agents={agents ?? []} agent={agent} locale={locale}
        mode={mode} spec={spec} onOpenLocale={onOpenLocale}
      />
    </div>
  );
}

// ── transport ───────────────────────────────────────────────────────
async function publishableKey(tenant: string, agent: Agent): Promise<string> {
  const cache = `nmb_demo_key:${tenant}:${agent.id}`;
  const raw = sessionStorage.getItem(cache);
  if (raw) {
    try {
      const stored = JSON.parse(raw) as { key?: string };
      if (stored.key) return stored.key;
    } catch { /* stale cache */ }
  }
  const created = await api.createKey({
    name: `demo bench · ${agentRole(agent.name)}`.slice(0, 80),
    agent_id: agent.id, tenant_id: tenant,
    allowed_origins: [window.location.origin], rate_limit_per_min: 120,
  });
  if (!created.key) throw new Error("The key was created but not returned.");
  sessionStorage.setItem(cache, JSON.stringify({ id: created.id, key: created.key }));
  return created.key;
}

async function gatewayTurn(agent: Agent, message: string, threadId?: string) {
  const key = await publishableKey(agent.tenant_id || "default", agent);
  const res = await fetch(`${API_BASE}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ message, thread_id: threadId || undefined, user_id: "demo-visitor" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.detail || `${res.status} ${res.statusText}`);
  return body as { thread_id: string; reply: string; blocked: boolean; sources?: unknown[] };
}

// ── phone screens ───────────────────────────────────────────────────
function ChannelHeader({ icon: Icon, title, subtitle, right, tone = "light" }: {
  icon: typeof MessageSquare; title: string; subtitle: string; right?: React.ReactNode; tone?: "light" | "green";
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2.5 px-3.5 py-2.5",
      tone === "green" ? "bg-[#075e54] text-white" : "border-b bg-white text-slate-900")}>
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-full",
        tone === "green" ? "bg-white/20" : "bg-primary/10 text-primary")}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-semibold">{title}</p>
        <p className={cn("truncate text-[10px]", tone === "green" ? "text-white/70" : "text-slate-500")}>{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function Bubble({ turn, skin }: { turn: Turn; skin: "chat" | "whatsapp" | "voice" }) {
  const mine = turn.role === "user";
  if (skin === "voice") {
    return (
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div className={cn("max-w-[88%] text-right", !mine && "text-left")}>
          <p className="mb-0.5 text-[9px] uppercase tracking-[0.12em] text-slate-500">{mine ? "Caller" : "Agent · spoken"}</p>
          <div className={cn("rounded-2xl px-3 py-2 text-[12px] leading-relaxed",
            mine ? "bg-amber-400 text-slate-950" : "border border-white/10 bg-white/[0.06] text-slate-100")}>
            {turn.text}
          </div>
        </div>
      </div>
    );
  }
  if (skin === "whatsapp") {
    return (
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div className={cn("max-w-[86%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug shadow-sm",
          mine ? "rounded-tr-none bg-[#d9fdd3] text-slate-900" : "rounded-tl-none bg-white text-slate-900")}>
          <p className="whitespace-pre-wrap">{turn.text}</p>
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[8.5px] text-slate-500">
            {turn.time}
            {mine ? <CheckCheck className="h-3 w-3 text-sky-600" /> : null}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[86%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed",
        mine ? "bg-sky-600 text-white" : turn.blocked ? "border border-amber-400/50 bg-amber-50 text-slate-800" : "bg-white text-slate-800 shadow-sm")}>
        <p className="whitespace-pre-wrap">{turn.text}</p>
        {turn.meta ? <p className={cn("mt-1 text-[9px]", mine ? "text-white/70" : "text-slate-400")}>{turn.meta}</p> : null}
      </div>
    </div>
  );
}

function ChatPhone({ agent, locale, turns, busy, onSend, onReset }: {
  agent?: Agent; locale?: LocaleProfileRow; turns: Turn[]; busy: boolean;
  onSend: (text: string) => void; onReset: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [turns, busy]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy || !agent) return;
    onSend(t);
    setDraft("");
  }
  const suggestions = ["Hello — what can you help me with?", "Nina tatizo na mtandao wangu", "What do you need from me to proceed?"];

  return (
    <PhoneFrame
      tone="light" screenClassName="bg-slate-100"
      caption="App chat · the same /v1/chat gateway the web widget uses. Each turn is policy-screened before and after the model."
    >
      <ChannelHeader icon={Bot} title={agent ? agentRole(agent.name) : "No agent selected"}
        subtitle={locale ? `${locale.locale_code} · ${locale.default_language} · replies reformatted` : "no locale profile attached"}
        right={<button type="button" onClick={onReset} className="ml-auto text-[10px] text-slate-500 underline-offset-2 hover:underline">reset</button>} />
      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {turns.length === 0 ? (
          <div className="mx-auto mt-8 max-w-[250px] space-y-2 text-center text-[11px] leading-relaxed text-slate-500">
            <Bot className="mx-auto h-6 w-6 text-slate-400" />
            <p>Ask anything a customer would. The model decides which tool or specialist answers — and may ask a follow-up instead of finishing.</p>
          </div>
        ) : turns.map((t) => <Bubble key={t.id} turn={t} skin="chat" />)}
        {busy ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl bg-white px-3 py-2 text-[11px] text-slate-500 shadow-sm">
              <Loader2 className="h-3 w-3 animate-spin" /> the model is choosing the next step…
            </div>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-t bg-white px-3 py-2">
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" disabled={busy || !agent} onClick={() => submit(s)}
              className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">{s}</button>
          ))}
        </div>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message…"
            className="h-8 min-w-0 flex-1 rounded-full border bg-slate-50 px-3 text-[12px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-sky-400" />
          <button type="submit" disabled={!draft.trim() || busy || !agent} aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white disabled:opacity-40">
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </PhoneFrame>
  );
}

function WhatsAppPhone({ boundAgent, config, messages, waId, busy, notice, onSend, onRefresh, onOpenWhatsApp }: {
  boundAgent?: Agent; config: WhatsAppConfig | null; messages: WhatsAppMessage[]; waId: string;
  busy: boolean; notice?: string | null;
  onSend: (text: string) => void; onRefresh: () => void; onOpenWhatsApp?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  }
  const simulator = config?.simulator;
  const suggestions = ["My data isn't working", "Nimetumwa malipo mara mbili", "I want a 4 GB bundle"];

  return (
    <PhoneFrame
      tone="whatsapp" screenClassName="bg-[#efe7dd]"
      caption={`WhatsApp · simulator only. Text is recorded in the transcript and answered by the bound agent — no Graph API call, no template, no Meta cost.`}
    >
      <ChannelHeader
        icon={Smartphone} title={boundAgent ? agentRole(boundAgent.name) : "No number bound"} tone="green"
        subtitle={`+${waId} · ${simulator ? "simulator" : config?.graph_configured ? "graph configured" : "not configured"}`}
        right={
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={onRefresh} title="Reload transcript"
              className="rounded-full bg-white/15 p-1.5 text-white/90 hover:bg-white/25"><RefreshCw className="h-3 w-3" /></button>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          </div>
        }
      />
      <div ref={scroller}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
        style={{ backgroundColor: "#efe7dd", backgroundImage: "radial-gradient(rgba(120,100,80,0.14) 1px, transparent 1px)", backgroundSize: "14px 14px" }}>
        {!boundAgent ? (
          <div className="mx-auto mt-8 max-w-[250px] space-y-2 text-center text-[11px] leading-relaxed text-slate-600">
            <Smartphone className="mx-auto h-6 w-6 text-slate-500" />
            <p>No WhatsApp number is bound to this tenant yet.</p>
            {onOpenWhatsApp ? <Button size="sm" variant="outline" onClick={onOpenWhatsApp}>Bind a number</Button> : null}
          </div>
        ) : messages.length === 0 && !busy ? (
          <div className="mx-auto mt-10 max-w-[240px] space-y-1 rounded-lg bg-white/70 px-3 py-2 text-center text-[10.5px] leading-relaxed text-slate-600">
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
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {out ? (m.status === "read" || m.status === "delivered"
                    ? <CheckCheck className="h-3 w-3 text-sky-600" />
                    : <Check className="h-3 w-3 text-slate-500" />) : null}
                  {m.status === "failed" ? <span className="text-red-500">failed</span> : null}
                </p>
              </div>
            </div>
          );
        })}
        {busy ? (
          <div className="flex justify-end">
            <div className="flex items-center gap-1 rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 text-[11px] text-slate-500">
              <span className="h-1 w-1 animate-bounce rounded-full bg-slate-500" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-slate-500 [animation-delay:120ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-slate-500 [animation-delay:240ms]" />
            </div>
          </div>
        ) : null}
        {notice ? <div className="rounded-md bg-white/80 px-2 py-1 text-[10px] text-amber-700">{notice}</div> : null}
      </div>
      <div className="shrink-0 bg-[#efe7dd] px-2.5 pb-2.5">
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" disabled={busy || !boundAgent} onClick={() => submit(s)}
              className="shrink-0 rounded-full border border-[#c9c2b2] bg-white/70 px-2 py-0.5 text-[10px] text-slate-700 disabled:opacity-40">{s}</button>
          ))}
        </div>
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); submit(draft); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message"
            className="h-9 min-w-0 flex-1 rounded-full border border-[#c9c2b2] bg-white px-3 text-[12px] text-slate-900 placeholder:text-slate-500 outline-none focus:border-[#075e54]" />
          <button type="submit" aria-label="Send WhatsApp message" disabled={!draft.trim() || busy || !boundAgent}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#075e54] text-white disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </PhoneFrame>
  );
}

function VoicePhone({ agent, locale, turns, busy, callActive, seconds, speak, onToggleCall, onSpeak, onSend, onReset }: {
  agent?: Agent; locale?: LocaleProfileRow; turns: Turn[]; busy: boolean; callActive: boolean;
  seconds: number; speak: boolean;
  onToggleCall: () => void; onSpeak: () => void; onSend: (text: string) => void; onReset: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [turns, busy]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <PhoneFrame
      tone="dark" screenClassName="bg-slate-950" caption="Voice · typed turns stand in for speech in the bench; replies are spoken with the browser voice. Open Voice line for real microphone audio."
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-2 text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1"><Mic className="h-3 w-3" /> mic off · captions</span>
        <span className="font-mono">{callActive ? `${mm}:${ss}` : "standby"}</span>
      </div>
      <div className="shrink-0 px-4 pb-3 pt-4 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-300/30 to-amber-500/10 text-2xl font-semibold text-amber-100 ring-1 ring-amber-300/30">
          {(agent ? agentRole(agent.name) : "??").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
        </div>
        <p className="mt-2 text-sm font-semibold text-slate-100">{agent ? agentRole(agent.name) : "No agent selected"}</p>
        <p className="text-[10.5px] text-slate-400">
          {callActive ? "on call" : "tap to open the line"} · voice · {locale?.locale_code ?? "en-US"}
        </p>
        <button type="button" onClick={onSpeak}
          className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-slate-300">
          <Volume2 className={cn("h-3 w-3", !speak && "opacity-40")} /> {speak ? "speaks replies" : "captions only"}
        </button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {turns.map((t) => <Bubble key={t.id} turn={t} skin="voice" />)}
        {busy ? <div className="text-center text-[11px] text-slate-500">the line is thinking…</div> : null}
      </div>
      <div className="shrink-0 border-t border-white/10 px-3.5 py-3">
        <form className="mb-2.5 flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); setDraft(""); if (t && !busy) onSend(t); }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={callActive ? "Type what you would say…" : "Open the line first"}
            disabled={!callActive} className="h-9 min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.06] px-3 text-[12px] text-slate-100 placeholder:text-slate-500 outline-none disabled:opacity-40" />
          <button type="submit" disabled={!draft.trim() || busy || !callActive} aria-label="Send spoken turn"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-950 disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </form>
        <div className="flex items-center justify-between">
          <button type="button" onClick={onReset} className="text-[10px] text-slate-500 hover:text-slate-300">new call</button>
          <button type="button" onClick={onToggleCall} aria-label={callActive ? "End call" : "Start call"}
            className={cn("flex h-12 w-12 items-center justify-center rounded-full transition-transform hover:-translate-y-0.5",
              callActive ? "bg-white/10 text-amber-100 ring-1 ring-white/20" : "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/30")}>
            {callActive ? <PhoneOff className="h-5 w-5" /> : <PhoneCall className="h-5 w-5" />}
          </button>
          <span className="w-12" />
        </div>
      </div>
    </PhoneFrame>
  );
}

function WorkflowPhone({ spec, run, stepState, profileFor, agentName, onOpenApprovals }: {
  spec: WfSpec | null; run: RunView | null;
  stepState: (s: WfStep) => "done" | "current" | "pending" | "failed";
  profileFor: (id?: string) => LocaleProfileRow | undefined;
  agentName: (id?: string) => string | undefined;
  onOpenApprovals?: () => void;
}) {
  const waiting = run?.status === "waiting_approval";
  return (
    <PhoneFrame
      tone="light" screenClassName="bg-slate-100"
      caption="Workflow · the run on the customer's phone. The graph fixes the order; approvals pause it; every step lands in the audit trail."
    >
      <ChannelHeader icon={GitBranch} title={spec?.name || "Workflow"} subtitle={spec ? `${spec.key} · v${run?.version ?? spec.version}` : "pick a workflow →"} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        <div className="rounded-xl border bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-slate-500">{run ? `run ${run.id.slice(0, 8)}` : "no run yet"}</span>
            <RunPill status={run?.status} />
          </div>
          {run?.outcome ? <p className="mt-1 text-[11px] text-slate-600">Outcome · <span className="font-medium">{run.outcome}</span></p> : null}
        </div>

        {spec ? (
          <ol className="space-y-1.5">
            {spec.steps.map((s, i) => {
              const state = stepState(s);
              const loc = s.type === "agent" ? profileFor(s.agent) : undefined;
              return (
                <li key={s.id} className={cn("flex items-start gap-2.5 rounded-lg border bg-white px-2.5 py-2",
                  state === "current" && "border-violet-400/60 bg-violet-50/60",
                  state === "failed" && "border-red-400/60 bg-red-50/60")}>
                  <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
                    state === "done" ? "bg-emerald-500 text-white" : state === "current" ? "bg-violet-600 text-white"
                      : state === "failed" ? "bg-red-500 text-white" : "bg-slate-200 text-slate-600")}>
                    {state === "done" ? <CircleCheck className="h-3 w-3" /> : state === "failed" ? <XCircle className="h-3 w-3" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-medium text-slate-800">{s.name || s.id}</p>
                    <p className="truncate text-[10px] text-slate-500">
                      {s.type} · {describeStep(s, s.type === "agent" ? agentName(s.agent) : undefined) || s.type}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {loc ? <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[8.5px] font-medium text-violet-700">{loc.locale_code}</span> : null}
                    {state === "current" ? <span className="text-[9px] font-medium text-violet-700">{waiting ? "waiting" : "running"}</span> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-xl border bg-white px-3 py-6 text-center text-[11px] text-slate-500">
            Choose a workflow on the right and start a run.
          </div>
        )}

        {waiting ? (
          <div className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-[10.5px] leading-relaxed text-amber-800">
            Paused for a human approver. The run waits for hours or days with no model in the loop, then continues at this
            step. {onOpenApprovals ? <button type="button" onClick={onOpenApprovals} className="font-semibold underline">Open Approvals</button> : null}
          </div>
        ) : null}
        {run?.error ? <div className="rounded-lg border border-red-400/40 bg-red-50 px-3 py-2 text-[10.5px] text-red-700">{run.error}</div> : null}
      </div>
      <div className="shrink-0 border-t bg-white px-3.5 py-2 text-[9.5px] text-slate-500">
        {spec ? `${spec.steps.length} steps · ${spec.steps.filter((s) => s.type === "approval").length} approval gate(s)` : "—"}
      </div>
    </PhoneFrame>
  );
}

function RunPill({ status }: { status?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    running: { label: "running", cls: "bg-sky-100 text-sky-700" },
    waiting_approval: { label: "waiting approval", cls: "bg-amber-100 text-amber-800" },
    completed: { label: "completed", cls: "bg-emerald-100 text-emerald-700" },
    failed: { label: "failed", cls: "bg-red-100 text-red-700" },
    cancelled: { label: "cancelled", cls: "bg-slate-200 text-slate-600" },
  };
  const s = status ? map[status] ?? { label: status, cls: "bg-slate-200 text-slate-600" } : { label: "idle", cls: "bg-slate-200 text-slate-600" };
  return <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide", s.cls)}>{s.label}</span>;
}

// ── engine panels ───────────────────────────────────────────────────
function EngineCard({ trace, locale, agent, onSwitch }: {
  trace: TraceLine[]; locale?: LocaleProfileRow; agent?: Agent; onSwitch: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageSquare className="h-4 w-4 text-sky-600" /> Agent chat · what happens on a turn
        </CardTitle>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700">path decided at runtime</span>
      </CardHeader>
      <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
        <p>
          Every message is one model turn. The model reads what was said, picks the tool or specialist it wants, and
          decides whether it has enough to answer. Nothing about the sequence is fixed in advance — good for mixed asks,
          honest follow-ups and “while you’re at it”.
        </p>
        <div className="rounded-xl border bg-muted/20 p-2.5">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">last turn</p>
          {trace.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Send a message on the phone to see the gateway trace.</p>
          ) : (
            <ul className="space-y-1 font-mono text-[10.5px]">
              {trace.map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                    t.tone === "warn" ? "bg-amber-500" : t.tone === "ok" ? "bg-emerald-500" : "bg-slate-400")} />
                  <span className="text-foreground">{t.label}</span>
                  <span className="text-muted-foreground">· {t.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoTile icon={Sparkles} title="Model picks the next step" body="Two phrasings of the same ask can take two different tool paths." />
          <InfoTile icon={Languages} title={locale ? `Localised · ${locale.locale_code}` : "No locale profile"}
            body={locale ? "The gateway reformats every reply with the agent's locale profile." : "Attach a profile on the Locale page to shape language, currency and dates."} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-500/25 bg-violet-500/5 px-3 py-2">
          <p className="text-[11px] text-violet-800 dark:text-violet-300">
            The same request, run as a fixed graph with an approval gate?
          </p>
          <Button size="sm" variant="outline" onClick={onSwitch}><GitBranch className="h-3.5 w-3.5" /> Run as workflow</Button>
        </div>
        {agent ? <p className="text-[10.5px]">Testing <span className="font-medium text-foreground">{agentRole(agent.name)}</span> · <span className="font-mono">{agent.id.slice(0, 8)}</span> · model <span className="font-mono">{agent.model}</span></p> : null}
      </CardContent>
    </Card>
  );
}

function InfoTile({ icon: Icon, title, body }: { icon: typeof Sparkles; title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground"><Icon className="h-3.5 w-3.5 text-primary" /> {title}</p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function WorkflowEngineCard({ workflows, spec, wfKey, onKey, inputs, onInput, run, busy, onRun, onSample, stepState, profileFor, onOpenWorkflows, onOpenApprovals }: {
  workflows: WfSummary[]; spec: WfSpec | null; wfKey: string; onKey: (k: string) => void;
  inputs: Record<string, string>; onInput: (k: string, v: string) => void;
  run: RunView | null; busy: boolean; onRun: () => Promise<unknown>; onSample: () => void;
  stepState: (s: WfStep) => "done" | "current" | "pending" | "failed";
  profileFor: (id?: string) => LocaleProfileRow | undefined;
  onOpenWorkflows?: () => void; onOpenApprovals?: () => void;
}) {
  const agentStep = spec?.steps.find((s) => s.type === "agent");
  const loc = agentStep ? profileFor(agentStep.agent) : undefined;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <GitBranch className="h-4 w-4 text-violet-600" /> Workflow · the graph runs the request
        </CardTitle>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700">fixed by the design</span>
      </CardHeader>
      <CardContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide">Workflow</span>
            <select value={wfKey} onChange={(e) => onKey(e.target.value)}
              className="h-8 w-full rounded-lg border bg-background px-2 text-xs">
              {workflows.length === 0 && <option value="">No workflows installed</option>}
              {workflows.map((w) => <option key={w.key} value={w.key}>{w.name || w.key} · v{w.version}</option>)}
            </select>
          </label>
          {onOpenWorkflows ? <Button size="sm" variant="outline" onClick={onOpenWorkflows}>Workflows</Button> : null}
        </div>

        {spec && Object.keys(spec.inputs || {}).length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(spec.inputs).map(([k, s]) => (
              <label key={k} className="space-y-0.5 text-[11px]">
                <span className="font-medium text-foreground">{k}{s.required ? " *" : ""}</span>
                <input value={inputs[k] ?? ""} onChange={(e) => onInput(k, e.target.value)}
                  placeholder={s.description || s.type}
                  className="h-8 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:border-violet-400" />
              </label>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <AsyncButton onRun={onRun} disabled={!spec || busy}><Play className="h-3.5 w-3.5" /> Start run</AsyncButton>
          {spec && Object.keys(spec.inputs || {}).length > 0 ? (
            <Button size="sm" variant="ghost" onClick={onSample}>Fill demo values</Button>
          ) : null}
          {run ? <span className="font-mono text-[10px]">run {run.id.slice(0, 8)} · v{run.version}</span> : null}
        </div>

        {spec ? (
          <div className="rounded-xl border bg-muted/20 p-2.5">
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              graph · {spec.steps.length} steps
            </p>
            <ol className="space-y-1">
              {spec.steps.map((s, i) => {
                const state = stepState(s);
                const loc2 = s.type === "agent" ? profileFor(s.agent) : undefined;
                return (
                  <li key={s.id} className={cn("flex items-center gap-2 rounded-md px-1.5 py-1",
                    state === "current" && "bg-violet-500/10")}>
                    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold",
                      state === "done" ? "bg-emerald-500 text-white" : state === "current" ? "bg-violet-600 text-white"
                        : state === "failed" ? "bg-red-500 text-white" : "bg-slate-300 text-slate-700")}>
                      {state === "done" ? "✓" : state === "failed" ? "!" : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{s.name || s.id}</span>
                    <span className="rounded bg-muted px-1 py-0.5 font-mono text-[8.5px] uppercase text-muted-foreground">{s.type}</span>
                    {loc2 ? <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[8.5px] font-medium text-violet-700">{loc2.locale_code}</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {run ? (
          <div className="space-y-1.5 rounded-xl border border-violet-500/25 bg-violet-500/5 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-violet-900 dark:text-violet-300">Run {run.id.slice(0, 8)}</span>
              <RunPill status={run.status} />
            </div>
            <p className="text-[10.5px]">
              current step · <span className="font-mono">{run.current_step ?? "—"}</span>
              {run.outcome ? <> · outcome · <span className="font-medium">{run.outcome}</span></> : null}
            </p>
            {run.status === "waiting_approval" && onOpenApprovals ? (
              <Button size="sm" variant="outline" onClick={onOpenApprovals}>Open Approvals</Button>
            ) : null}
            {run.error ? <p className="text-[10.5px] text-red-600">{run.error}</p> : null}
          </div>
        ) : null}

        <p className="text-[11px]">
          Here a versioned graph fixes the steps. Agents fill named steps, tools run in read/write scope, approvals stop
          the run until a human signs off, and every step is written to the hash-chained audit trail.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <InfoTile icon={Clock3} title="Pauses survive restarts" body="Approvals wait hours or days with no model in the loop, then resume at the paused step." />
          <InfoTile icon={Languages} title="Localisation is per agent step"
            body={loc ? `The agent step runs with ${loc.locale_code} formatting and register compiled in; other steps keep their own config.` : "Attach a locale profile to the agent this step calls and the step itself inherits it."} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── comparison + localisation ───────────────────────────────────────
const COMPARE = [
  {
    dimension: "Who picks the next step",
    chat: "The model, from the last message. Two phrasings of the same ask can take two tool paths.",
    flow: "The published graph. Version N runs the same steps in the same order on every request.",
  },
  {
    dimension: "What you can guarantee",
    chat: "An answer. Tool choice, sequence and stopping point are decided per turn.",
    flow: "Named steps, an approval gate, an SLA and one audit entry per step — designed before the first run.",
  },
  {
    dimension: "Where it fits",
    chat: "Mixed asks, follow-ups, \"while you're at it\", and anything the script did not anticipate.",
    flow: "Money moves, KYC, SIM swaps and onboarding — journeys a regulator will ask you to reproduce.",
  },
];

function DiffBand({ mode, profileFor, localeSteps, onMode }: {
  mode: Mode;
  profileFor: (id?: string) => LocaleProfileRow | undefined;
  localeSteps: WfStep[];
  onMode: (m: Mode) => void;
}) {
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><GitBranch className="h-4 w-4 text-violet-600" /> What actually differs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => onMode("chat")} aria-pressed={mode === "chat"}
            className={cn("rounded-xl border p-3 text-left transition-colors",
              mode === "chat" ? "border-sky-500/50 bg-sky-500/5" : "hover:bg-muted/40")}>
            <p className="flex items-center gap-1.5 text-xs font-semibold"><MessageSquare className="h-3.5 w-3.5 text-sky-600" /> Agent chat</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Open-ended. Each turn is one model decision; the path is chosen at runtime.</p>
          </button>
          <button type="button" onClick={() => onMode("workflow")} aria-pressed={mode === "workflow"}
            className={cn("rounded-xl border p-3 text-left transition-colors",
              mode === "workflow" ? "border-violet-500/50 bg-violet-500/5" : "hover:bg-muted/40")}>
            <p className="flex items-center gap-1.5 text-xs font-semibold"><GitBranch className="h-3.5 w-3.5 text-violet-600" /> Workflow</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Designed. The graph fixes the steps; agents, tools and approvals fill named slots.</p>
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border">
          <div className="hidden gap-3 border-b bg-muted/40 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:grid sm:grid-cols-[1fr_1.2fr_1.2fr]">
            <span>Dimension</span><span>Agent chat</span><span>Workflow</span>
          </div>
          {COMPARE.map((row) => (
            <div key={row.dimension} className="grid gap-1 border-b px-3 py-2 text-[11px] last:border-0 sm:grid-cols-[1fr_1.2fr_1.2fr] sm:gap-3">
              <p className="font-medium text-foreground">{row.dimension}</p>
              <p className="text-muted-foreground"><span className="mr-1 font-mono text-[8px] uppercase text-sky-700 sm:hidden">chat</span>{row.chat}</p>
              <p className="text-muted-foreground"><span className="mr-1 font-mono text-[8px] uppercase text-violet-700 sm:hidden">workflow</span>{row.flow}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Rule of thumb:</span> if the outcome is a conversation, use chat.
          If it is a decision someone will audit, use a workflow — and let a chat start it.
          {mode === "workflow" && localeSteps.length > 0 ? (
            <span className="mt-1 block text-violet-700">
              Localised steps in this graph:{" "}
              {localeSteps.map((s) => `${s.name || s.id} (${profileFor(s.agent)?.locale_code ?? "locale"})`).join(", ")}.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function LocaleChip({ agent, locale }: { agent?: Agent; locale?: LocaleProfileRow }) {
  if (!agent) return null;
  return locale ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
      <Languages className="h-3 w-3" /> localised · {locale.locale_code} · {locale.default_language}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
      <Globe2 className="h-3 w-3" /> no locale profile on this agent
    </span>
  );
}

function LocaleCard({ profiles, agents, agent, locale, mode, spec, onOpenLocale }: {
  profiles: LocaleProfileRow[]; agents: Agent[]; agent?: Agent; locale?: LocaleProfileRow; mode: Mode;
  spec: WfSpec | null; onOpenLocale?: () => void;
}) {
  const nameOf = (id: string) => agents.find((a) => a.id === id);
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Languages className="h-4 w-4 text-violet-600" /> Where localisation lands</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p><span className="font-medium text-foreground">1 · Attach a profile to an agent.</span> The Locale page compiles a locale specialist (register, glossary, currency/date formats, sample cases) into that agent's runtime — it applies on every channel, chat, WhatsApp and voice.</p>
          <p><span className="font-medium text-foreground">2 · The gateway formats the reply.</span> The agent's profile is fetched per turn and the reply is reformatted before it leaves the gateway, so the same agent answers in Kiswahili here that it does on the phone.</p>
          <p><span className="font-medium text-foreground">3 · A workflow inherits it step by step.</span> Workflow steps that call that agent run localised; tool, connector and approval steps follow their own configuration. So localisation is a property of the <em>agent</em>, and the workflow composes localised and non-localised steps deliberately.</p>
          {agent ? (
            <p className="rounded-lg border bg-muted/30 px-3 py-2">
              Selected agent · <span className="font-medium text-foreground">{agentRole(agent.name)}</span>{" "}
              {locale ? <>is attached to <span className="font-medium text-foreground">{locale.name}</span> ({locale.locale_code}) — chat replies here should show {locale.default_language} register and {locale.currency_code} formatting.</> : <>has no locale profile, so replies use the model's default tone and formats.</>}
            </p>
          ) : null}
          {mode === "workflow" && spec ? (
            <div className="space-y-1.5 rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-[11px]">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-violet-700">Agent steps in {spec.name}</p>
              {spec.steps.filter((s) => s.type === "agent").map((s) => {
                const a = nameOf(s.agent ?? "");
                const p = profiles.find((pr) => pr.attached_to?.includes(s.agent ?? ""));
                return (
                  <div key={s.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-foreground">{s.name || s.id}</span>
                    <span className="truncate text-muted-foreground">{a ? agentRole(a.name) : (s.agent ?? "—").slice(0, 8)}</span>
                    <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                      p ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground")}>
                      {p ? `${p.locale_code} · localised` : "no profile"}
                    </span>
                  </div>
                );
              })}
              {spec.steps.every((s) => s.type !== "agent") ? <p className="text-muted-foreground">No agent steps in this graph.</p> : null}
              {spec.steps.some((s) => s.type === "agent" && !profiles.some((pr) => pr.attached_to?.includes(s.agent ?? ""))) && onOpenLocale ? (
                <p className="pt-0.5 text-[10px] text-muted-foreground">
                  Attach a profile to one of these agents and its step inherits it —{" "}
                  <button type="button" onClick={onOpenLocale} className="font-medium text-violet-700 underline">open Locale</button>.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          {profiles.length === 0 ? (
            <div className="rounded-xl border px-3 py-6 text-center text-xs text-muted-foreground">
              No locale profiles on this tenant yet. Create one on the Locale page to see chat replies and workflow steps pick it up.
            </div>
          ) : profiles.map((p) => (
            <div key={p.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">{p.name}</p>
                <span className="rounded-full bg-violet-100 px-2 py-0.5 font-mono text-[9px] text-violet-700">{p.locale_code}</span>
              </div>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {p.languages.join(" / ")} · default {p.default_language} · {p.currency_code} {p.currency_position} · {p.date_format}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(p.attached_to ?? []).length === 0 ? <span className="text-[10px] text-muted-foreground">not attached to an agent yet</span>
                  : (p.attached_to ?? []).map((id) => (
                    <span key={id} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{nameOf(id) ? agentRole(nameOf(id)!.name) : id.slice(0, 8)}</span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
