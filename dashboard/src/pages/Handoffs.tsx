import { useEffect, useState } from "react";
import {
  ArrowLeftRight, CheckCircle2, Clock, Hand, Inbox, MessageSquare, SendHorizontal, UserCheck, Users,
} from "lucide-react";
import { api, can, type HandoffDetail, type HandoffItem, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  useEffect(() => { setItems(null); load(); }, [status]);
  useEffect(() => { const id = setInterval(load, 5000); return () => clearInterval(id); }, [status]);
  useEffect(() => { loadCounts(); const id = setInterval(loadCounts, 15000); return () => clearInterval(id); }, []);

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Conversations"
        description="Chats where a customer asked for a human. Claim one, reply in the same thread, then hand it back to the assistant."
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

      {items === null ? <LoadingBlock rows={3} />
        : items.length === 0 ? (
          <EmptyState
            icon={status === "requested" ? Inbox : MessageSquare}
            title={`No ${status} conversations`}
            body={status === "requested" ? "Nobody is waiting for a human right now." : undefined}
          />
        )
        : <div className="space-y-3">{items.map((h) => (
          <Card key={h.id} className="transition-shadow hover:shadow-md">
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
                    load(); loadCounts();
                  }}><Hand className="h-3.5 w-3.5" /> Claim</AsyncButton>
                )}
                <Button size="sm" variant={h.status === "requested" ? "default" : "outline"} onClick={() => setOpenId(h.id)}>
                  Open
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}</div>}

      {openId && <HandoffDialog id={openId} me={me} onClose={(changed) => { setOpenId(null); if (changed) { load(); loadCounts(); } }} />}
    </div>
  );
}

function HandoffDialog({ id, me, onClose }: { id: string; me: Me | null; onClose: (changed: boolean) => void }) {
  const [h, setH] = useState<HandoffDetail | null>(null);
  const [text, setText] = useState("");
  const [confirmBack, setConfirmBack] = useState(false);
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
    try { await api.claimHandoff(id); toast.push("Claimed — you can reply now", "success"); load(); }
    catch (e: any) { toast.push(e.message, "error"); }
  }
  async function resolve() {
    await api.resolveHandoff(id);
    toast.push("Conversation handed back to the assistant", "success");
    onClose(true);
  }

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Conversation <span className="font-mono text-sm text-muted-foreground">{h ? h.id.slice(0, 8) : ""}</span>
              {h && <StatusBadge value={h.status} />}
            </DialogTitle>
            {h && (
              <DialogDescription>
                agent <b className="font-medium text-foreground/80">{h.agent_id}</b>
                {h.customer_id && <> · customer <b className="font-medium text-foreground/80">{h.customer_id}</b></>}
                {h.assigned_to && <> · assigned to <b className="font-medium text-foreground/80">{h.assigned_to}</b></>}
                <> · since {fmtDate(h.created_at)}</>
              </DialogDescription>
            )}
          </DialogHeader>
          {!h ? <LoadingBlock rows={2} /> : (
            <div className="space-y-3">
              {h.reason && (
                <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm">
                  <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Reason</span>
                  “{h.reason}”
                </p>
              )}

              <div className="max-h-80 space-y-2 overflow-auto rounded-xl border bg-muted/20 p-3">
                {h.messages.length === 0 ? <div className="p-4 text-center text-xs text-muted-foreground">No messages yet.</div>
                  : h.messages.map((m) => (
                    <div key={m.id}
                      className={cn(
                        "max-w-[82%] rounded-2xl border p-2.5 text-sm shadow-sm",
                        m.role === "staff" ? "ml-auto border-primary/25 bg-primary/10" : "bg-card",
                      )}>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {m.role === "staff" ? `staff · ${m.author}` : "customer"} · {fmtDate(m.created_at)}
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap">{m.text}</div>
                    </div>
                  ))}
              </div>

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

              <DialogFooter>
                <Button variant="outline" onClick={() => onClose(false)}>Close</Button>
                {h.status !== "resolved" && canWrite && (
                  <Button variant="outline" onClick={() => setConfirmBack(true)}>
                    <ArrowLeftRight className="h-3.5 w-3.5" /> Hand back to assistant
                  </Button>
                )}
                {h.status === "active" && !assignedOther && canWrite && (
                  <AsyncButton onRun={send} disabled={!text.trim()}><SendHorizontal className="h-3.5 w-3.5" /> Send reply</AsyncButton>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {confirmBack && (
        <ConfirmDialog
          title="Hand this conversation back to the assistant?"
          description="The AI resumes replying in this thread and the conversation leaves the staff queue. You can request a human again later."
          confirmLabel="Hand back"
          onConfirm={resolve}
          onClose={() => setConfirmBack(false)}
        />
      )}
    </>
  );
}
