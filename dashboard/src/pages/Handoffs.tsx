import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowLeftRight, Building2, CheckCircle2, Clock, Copy, Hand, Inbox, Mail, MessageSquare,
  SendHorizontal, Share2, Sparkles, UserCheck, Users, X,
} from "lucide-react";
import {
  api, can, type ConnectorSummary, type HandoffDetail, type HandoffForward, type HandoffItem,
  type HandoffSummary, type Me,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { StatusBadge } from "@/components/common/StatusBadge";
import { FilterTabs } from "@/components/common/FilterTabs";
import { StatCard } from "@/components/common/StatCard";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";

const FILTERS = ["requested", "active", "resolved"] as const;
type Filter = (typeof FILTERS)[number];

export function Handoffs({ me }: { me: Me | null }) {
  const [status, setStatus] = useState<Filter>("requested");
  const [items, setItems] = useState<HandoffItem[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    try { setItems(await api.listHandoffs(status)); }
    catch (e: any) { toast.push(e.message, "error"); setItems([]); }
  }
  async function loadCounts() {
    try {
      const lists = await Promise.all(FILTERS.map((f) => api.listHandoffs(f)));
      setCounts(Object.fromEntries(FILTERS.map((f, i) => [f, lists[i].length])));
    } catch { /* keep last known counts */ }
  }
  useEffect(() => { setItems(null); setOpenId(null); load(); }, [status]);
  useEffect(() => { const id = setInterval(load, 5000); return () => clearInterval(id); }, [status]);
  useEffect(() => { loadCounts(); const id = setInterval(loadCounts, 15000); return () => clearInterval(id); }, []);

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Conversations"
        description="Chats where a customer asked for a human. Claim one, reply in the same thread, then hand it back to the assistant or send it on to another channel."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard icon={Hand} tone="amber" label="Waiting for a human" value={counts.requested ?? "—"} hint="Unclaimed requests" />
        <StatCard icon={UserCheck} tone="sky" label="In progress" value={counts.active ?? "—"} hint="Claimed by staff" />
        <StatCard icon={CheckCircle2} tone="emerald" label="Resolved today" value={counts.resolved ?? "—"} hint="Handed back to the assistant" />
      </div>

      <FilterTabs
        className="mb-4"
        value={status}
        onChange={setStatus}
        options={FILTERS.map((f) => ({ id: f, label: f, count: counts[f] }))}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className={cn("space-y-3", openId && "hidden lg:block")}>
          {items === null ? <LoadingBlock rows={3} />
            : items.length === 0 ? (
              <EmptyState
                icon={status === "requested" ? Inbox : MessageSquare}
                title={`No ${status} conversations`}
                body={status === "requested" ? "Nobody is waiting for a human right now." : undefined}
              />
            )
            : items.map((h) => (
              <Card key={h.id}
                className={cn("cursor-pointer transition-shadow hover:shadow-md",
                  openId === h.id && "border-primary/40 bg-primary/[0.03] shadow-sm")}
                onClick={() => setOpenId(h.id)}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                      <MessageSquare className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        Conversation <span className="font-mono text-xs text-muted-foreground">{h.id.slice(0, 8)}</span>
                        <StatusBadge value={h.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>agent <b className="font-medium text-foreground/80">{h.agent_id}</b></span>
                        {h.customer_id && <span>· customer <b className="font-medium text-foreground/80">{h.customer_id}</b></span>}
                        {h.user_id && <span>· user <b className="font-medium text-foreground/80">{h.user_id}</b></span>}
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDate(h.created_at)}</span>
                        {h.assigned_to && <span>· assigned to <b className="font-medium text-foreground/80">{h.assigned_to}</b></span>}
                        {typeof h.message_count === "number" && <span>· {h.message_count} message{h.message_count === 1 ? "" : "s"}</span>}
                        {!!h.forward_count && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                            <Share2 className="h-2.5 w-2.5" /> shared ×{h.forward_count}
                          </span>
                        )}
                      </div>
                      {h.reason && <p className="mt-2 line-clamp-2 text-sm">{h.reason}</p>}
                      {h.resolved_at && <p className="mt-1 text-xs text-muted-foreground">Resolved {fmtDate(h.resolved_at)}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {h.status === "requested" && can(me, "handoffs:write") && (
                      <AsyncButton variant="outline" onRun={async () => {
                        await api.claimHandoff(h.id);
                        toast.push("Claimed — you can reply now", "success");
                        setOpenId(h.id);
                        load(); loadCounts();
                      }}><Hand className="h-3.5 w-3.5" /> Claim</AsyncButton>
                    )}
                    <Button size="sm" variant={openId === h.id ? "default" : h.status === "requested" ? "default" : "outline"}
                      onClick={(e) => { e.stopPropagation(); setOpenId(h.id); }}>
                      Open
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>

        <div className={cn("lg:sticky lg:top-4", !openId && "hidden lg:block")}>
          {openId ? (
            <HandoffPanel
              key={openId}
              id={openId}
              me={me}
              onClose={() => setOpenId(null)}
              onChanged={() => { load(); loadCounts(); }}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium">No conversation open</p>
                <p className="max-w-[260px] text-xs text-muted-foreground">
                  Pick a conversation from the queue to read the thread and reply. It opens here, next to the list.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function HandoffPanel({ id, me, onClose, onChanged }: {
  id: string; me: Me | null; onClose: () => void; onChanged: () => void;
}) {
  const [h, setH] = useState<HandoffDetail | null>(null);
  const [text, setText] = useState("");
  const [confirmBack, setConfirmBack] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const toast = useToast();
  const admin = !!me && (me.roles.includes("tenant_admin") || me.roles.includes("platform_admin"));
  const assignedOther = !!h?.assigned_to && h.assigned_to !== me?.sub && !admin;
  const canWrite = can(me, "handoffs:write");

  async function load() {
    try { setH(await api.getHandoff(id)); }
    catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [id]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    try {
      await api.replyHandoff(id, body);
      setText("");
      load();
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  async function claim() {
    try { await api.claimHandoff(id); toast.push("Claimed — you can reply now", "success"); load(); onChanged(); }
    catch (e: any) { toast.push(e.message, "error"); }
  }
  async function resolve() {
    await api.resolveHandoff(id);
    toast.push("Conversation handed back to the assistant", "success");
    onChanged();
    load();
  }

  return (
    <>
      <Card>
        <CardContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-3 overflow-y-auto p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <Button variant="ghost" size="icon" className="h-6 w-6 lg:hidden" onClick={onClose} title="Back to the queue">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                Conversation <span className="font-mono text-xs text-muted-foreground">{id.slice(0, 8)}</span>
                {h && <StatusBadge value={h.status} />}
              </div>
              {h && (
                <p className="mt-1 text-xs text-muted-foreground">
                  agent <b className="font-medium text-foreground/80">{h.agent_id}</b>
                  {h.customer_id && <> · customer <b className="font-medium text-foreground/80">{h.customer_id}</b></>}
                  {h.assigned_to && <> · assigned to <b className="font-medium text-foreground/80">{h.assigned_to}</b></>}
                  <> · since {fmtDate(h.created_at)}</>
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} title="Close conversation">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {!h ? <LoadingBlock rows={2} /> : (
            <div className="space-y-3">
              {h.reason && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm">
                  <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Reason</span>
                  “{h.reason}”
                </p>
              )}

              <ForwardLog forwards={h.forwards ?? []} />

              <div className="max-h-[min(50vh,420px)] space-y-2 overflow-auto rounded-xl border bg-muted/20 p-3">
                {h.messages.length === 0 ? <div className="p-4 text-center text-xs text-muted-foreground">No messages yet.</div>
                  : h.messages.map((m) => (
                    <div key={m.id}
                      className={cn(
                        "max-w-[86%] rounded-2xl border p-2.5 text-sm shadow-sm",
                        m.role === "staff" ? "ml-auto border-primary/25 bg-primary/10" : "bg-card",
                      )}>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {m.role === "staff" ? `staff · ${m.author}` : "customer"} · {fmtDate(m.created_at)}
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap">{m.text}</div>
                    </div>
                  ))}
              </div>

              {h.status === "resolved" && (
                <p className="rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
                  The assistant has this thread again. A new request from the customer will re-open the queue entry.
                </p>
              )}

              {h.status !== "resolved" && (assignedOther ? (
                <p className="rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
                  Assigned to {h.assigned_to}. Only that operator or a tenant admin can reply.
                </p>
              ) : h.status === "requested" ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3">
                  <Button size="sm" onClick={claim}><Hand className="h-3.5 w-3.5" /> Claim conversation</Button>
                  <span className="text-xs text-muted-foreground">Claim before replying so two operators do not answer at once.</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
                    placeholder="Reply to the customer…"
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
                  <p className="text-xs text-muted-foreground">
                    Replies are screened with the same secret/identifier policy as bot output. ⌘/Ctrl+Enter sends.
                  </p>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setForwardOpen(true)}>
                  <Share2 className="h-3.5 w-3.5" /> Send to another channel
                </Button>
                {h.status !== "resolved" && canWrite && (
                  <Button variant="outline" onClick={() => setConfirmBack(true)}>
                    <ArrowLeftRight className="h-3.5 w-3.5" /> Hand back to assistant
                  </Button>
                )}
                {h.status === "active" && !assignedOther && canWrite && (
                  <AsyncButton onRun={send} disabled={!text.trim()}><SendHorizontal className="h-3.5 w-3.5" /> Send reply</AsyncButton>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {confirmBack && (
        <ConfirmDialog
          title="Hand this conversation back to the assistant?"
          description="The AI resumes replying in this thread and the conversation leaves the staff queue. You can request a human again later."
          confirmLabel="Hand back"
          onConfirm={resolve}
          onClose={() => setConfirmBack(false)}
        />
      )}

      {forwardOpen && h && (
        <ForwardDialog h={h} canForward={canWrite && can(me, "connectors:write")} canRecord={canWrite}
          onClose={() => setForwardOpen(false)}
          onForwarded={() => { load(); onChanged(); }} />
      )}
    </>
  );
}

function ForwardLog({ forwards }: { forwards: HandoffForward[] }) {
  if (!forwards.length) return null;
  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-3 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-sky-700 dark:text-sky-300">
        <Share2 className="h-3.5 w-3.5" /> Shared outside this conversation
      </div>
      <ul className="mt-2 space-y-1.5">
        {forwards.map((f, i) => {
          const target = f.channel === "connector"
            ? `${f.connector}.${f.operation}`
            : f.channel === "email" ? (f.recipient || "email") : "clipboard";
          return (
            <li key={`${f.ts}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-full border bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                {f.channel === "connector" ? "crm" : f.channel}
              </span>
              <span className="font-mono text-[11px]">{target}</span>
              {f.compressed && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">summary</span>}
              <span className="text-muted-foreground">{fmtDate(f.ts)}</span>
              {f.outcome !== "success" && <StatusBadge value="fail" label={f.outcome} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function transcriptText(h: HandoffDetail): string {
  const header = [
    `Conversation ${h.id}`,
    `Status: ${h.status}`,
    `Agent: ${h.agent_id}`,
    h.customer_id ? `Customer: ${h.customer_id}` : "",
    h.user_id ? `User: ${h.user_id}` : "",
    h.reason ? `Reason: ${h.reason}` : "",
    "",
  ].filter((line) => line !== "");
  const lines = h.messages.map((m) => {
    const who = m.role === "staff" ? `Staff${m.author ? ` (${m.author})` : ""}` : "Customer";
    return `[${new Date(m.created_at).toLocaleString()}] ${who}: ${m.text}`;
  });
  return [...header, ...lines].join("\n");
}

type ForwardDest = "crm" | "email" | "copy";
const DESTINATIONS: Array<{ id: ForwardDest; label: string; icon: typeof Building2 }> = [
  { id: "crm", label: "CRM / system", icon: Building2 },
  { id: "email", label: "Email draft", icon: Mail },
  { id: "copy", label: "Copy transcript", icon: Copy },
];

function ForwardDialog({ h, canForward, canRecord, onClose, onForwarded }: {
  h: HandoffDetail; canForward: boolean; canRecord: boolean;
  onClose: () => void; onForwarded: () => void;
}) {
  const [dest, setDest] = useState<ForwardDest>("crm");
  const [connectors, setConnectors] = useState<ConnectorSummary[] | null>(null);
  const [connector, setConnector] = useState("");
  const [operation, setOperation] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(
    `Conversation ${h.id.slice(0, 8)}${h.customer_id ? ` — ${h.customer_id}` : ""}`,
  );
  const [note, setNote] = useState("");
  const [compress, setCompress] = useState(h.messages.length > 4);
  const [summary, setSummary] = useState<HandoffSummary | null>(null);
  const [summaryText, setSummaryText] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryErr, setSummaryErr] = useState("");
  const [summaryTick, setSummaryTick] = useState(0);
  const summaryInFlight = useRef(false);
  const toast = useToast();

  useEffect(() => {
    api.listConnectors()
      .then((list) => {
        setConnectors(list);
        const usable = list.filter((c) => c.operations.length > 0);
        const first = usable.find((c) => c.enabled) ?? usable[0];
        if (first) { setConnector(first.name); setOperation(first.operations[0] ?? ""); }
      })
      .catch(() => setConnectors([]));
  }, []);

  useEffect(() => {
    if (!compress || summary || summaryInFlight.current) return;
    let live = true;
    summaryInFlight.current = true;
    setSummaryBusy(true);
    setSummaryErr("");
    api.summariseHandoff(h.id)
      .then((s) => { if (!live) return; setSummary(s); setSummaryText(s.summary); })
      .catch((e: any) => { if (live) setSummaryErr(e.message); })
      .finally(() => { summaryInFlight.current = false; if (live) setSummaryBusy(false); });
    return () => { live = false; };
  }, [compress, summary, summaryTick, h.id]);

  const chosen = connectors?.find((c) => c.name === connector) ?? null;
  const ready = !!chosen && chosen.enabled && !!operation && canForward;
  const summaryReady = !compress || (!summaryBusy && !summaryErr && !!summaryText.trim());
  const effective = compress && summaryText.trim() ? summaryText : transcriptText(h);

  function regenerate() {
    setSummary(null);
    setSummaryErr("");
    setSummaryTick((t) => t + 1);
  }

  async function sendToConnector() {
    if (!ready || !summaryReady) return;
    try {
      const res = await api.forwardHandoff(h.id, {
        channel: "connector", connector, operation, subject, note,
        summary: compress ? summaryText : "", compress,
      });
      toast.push(res.ok ? `Shared with ${res.connector} · ${res.operation}` : `Connector refused the conversation`, res.ok ? "success" : "error");
      onForwarded();
      onClose();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  async function openEmail() {
    if (!to.trim() || !summaryReady) return;
    const body = `${note ? `${note}\n\n` : ""}${effective}`.slice(0, 5000);
    if (canRecord) {
      try {
        await api.forwardHandoff(h.id, {
          channel: "email", recipient: to.trim(), subject, note,
          summary: compress ? summaryText : "", compress,
        });
      } catch (e: any) {
        toast.push(`Could not record the share: ${e.message}`, "error");
        return;
      }
    }
    window.location.href = `mailto:${to.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast.push("Email draft opened — conversation marked as shared", "success");
    onForwarded();
    onClose();
  }

  async function copyTranscript() {
    if (!summaryReady) return;
    const text = effective;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      document.body.removeChild(area);
    }
    if (!copied) {
      toast.push("Could not access the clipboard", "error");
      return;
    }
    if (!canRecord) {
      toast.push("Copied", "success");
      onClose();
      return;
    }
    try {
      await api.forwardHandoff(h.id, {
        channel: "copy", subject, summary: compress ? summaryText : "", compress,
      });
      toast.push(compress ? "Summary copied and logged on the conversation" : "Transcript copied and logged on the conversation", "success");
      onForwarded();
      onClose();
    } catch (e: any) {
      toast.push(`Copied, but the share was not logged: ${e.message}`, "error");
    }
  }

  const previewLabel = compress
    ? "Summary to share (editable)"
    : dest === "email" ? "Email body preview"
      : dest === "copy" ? "What will be copied" : "Transcript the connector receives";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Share2 className="h-4 w-4" /> Send to another channel</DialogTitle>
          <DialogDescription>
            Hand this conversation to a CRM case queue, an email thread or the clipboard. Every share is written on the
            conversation, and connector delivery is audited and checked against the tenant egress allow-list.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1 rounded-xl border bg-muted/50 p-1">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon;
            return (
              <button key={d.id} type="button" onClick={() => setDest(d.id)}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  dest === d.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="h-3.5 w-3.5" /> {d.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="fwd-subject">Subject</Label>
            <Input id="fwd-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          {dest === "crm" && (
            connectors === null ? <LoadingBlock rows={2} />
              : connectors.length === 0 ? (
                <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  No connectors are configured for this tenant. Add a REST connector under <b className="text-foreground/80">Connectors</b>
                  {" "}(for example a CRM case endpoint), then forward the conversation again. Email and copy work without one.
                </p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="fwd-connector">Connector</Label>
                      <select id="fwd-connector" className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
                        value={connector}
                        onChange={(e) => {
                          const name = e.target.value;
                          setConnector(name);
                          const next = connectors.find((c) => c.name === name);
                          setOperation(next?.operations[0] ?? "");
                        }}>
                        {connectors.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name} ({c.type}){c.enabled ? "" : " · disabled"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="fwd-operation">Operation</Label>
                      <select id="fwd-operation" className="h-9 w-full rounded-lg border bg-background px-2 text-sm"
                        value={operation} onChange={(e) => setOperation(e.target.value)}
                        disabled={!chosen || chosen.operations.length === 0}>
                        {(chosen?.operations ?? []).map((op) => <option key={op} value={op}>{op}</option>)}
                      </select>
                    </div>
                  </div>
                  {chosen && !chosen.enabled && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      {chosen.name} is disabled. Enable it under Connectors once its endpoint and secret are set.
                    </p>
                  )}
                  {chosen?.needs_setup && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      {chosen.name} still points at a placeholder host — finish setup before sending conversations to it.
                    </p>
                  )}
                </>
              )
          )}

          {dest === "email" && (
            <div>
              <Label htmlFor="fwd-to">To</Label>
              <Input id="fwd-to" type="email" placeholder="case-management@bank.example" value={to}
                onChange={(e) => setTo(e.target.value)} />
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3">
            <Checkbox className="mt-0.5" checked={compress}
              onCheckedChange={(v) => setCompress(v === true)} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Compress the context first
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Share a short summary instead of the full transcript. It is generated locally from the stored thread —
                no model call, no content leaves the tenant. Useful for email and CRM case notes.
              </p>
            </div>
          </label>

          {dest !== "copy" && (
            <div>
              <Label htmlFor="fwd-note">Note for the receiving team <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="fwd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Customer asked for a callback about the duplicate debit." />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{previewLabel}</Label>
              {compress && (
                <div className="flex items-center gap-2">
                  {summary && (
                    <span className="text-[11px] text-muted-foreground">
                      {summary.message_count} msg · {summary.chars_before.toLocaleString()} → {summaryText.length.toLocaleString()} chars
                      {summary.compression > 0 && ` (${Math.round(summary.compression * 100)}% smaller)`}
                    </span>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={regenerate}>
                    Regenerate
                  </Button>
                </div>
              )}
            </div>
            {compress ? (
              summaryBusy ? <LoadingBlock rows={2} />
                : summaryErr ? (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/35 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">
                    <span>Could not create the summary: {summaryErr}. Turn compression off to send the full transcript.</span>
                  </div>
                ) : (
                  <Textarea rows={7} className="text-xs leading-relaxed" value={summaryText}
                    onChange={(e) => setSummaryText(e.target.value)} />
                )
            ) : (
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
                {effective}
              </pre>
            )}
          </div>

          {dest === "crm" && !canForward && (
            <p className="text-xs text-muted-foreground">
              Sending through a connector needs the handoffs:write and connectors:write permissions. Copy and email remain available.
            </p>
          )}
          {!canRecord && (
            <p className="text-xs text-muted-foreground">
              Your role cannot change conversations, so this share will not be written on the thread.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {dest === "crm" && (
            <AsyncButton onRun={sendToConnector} disabled={!ready || !summaryReady}>
              <Building2 className="h-3.5 w-3.5" /> Send via connector
            </AsyncButton>
          )}
          {dest === "email" && (
            <Button onClick={openEmail} disabled={!to.trim() || !summaryReady}>
              <Mail className="h-3.5 w-3.5" /> Open email draft
            </Button>
          )}
          {dest === "copy" && (
            <Button onClick={copyTranscript} disabled={!summaryReady}>
              <Copy className="h-3.5 w-3.5" /> {compress ? "Copy summary" : "Copy transcript"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
