import { Fragment, useEffect, useState } from "react";
import { Download, Filter, RotateCcw, ScrollText, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { api, can, type AuditEventRow, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";

type Verify = { ok: boolean; checked: number; first_bad_seq: number | null; reason: string };

const EMPTY = { action: "", actor: "", resource_id: "" };

export function Audit({ me }: { me: Me | null }) {
  const [rows, setRows] = useState<AuditEventRow[] | null>(null);
  const [f, setF] = useState(EMPTY);
  const [open, setOpen] = useState<string | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [cp, setCp] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function load() {
    try { setRows((await api.queryAudit({ ...f, limit: 500 })).reverse()); } // newest first
    catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { load(); }, []);

  const filtered = f.action || f.actor || f.resource_id;

  return (
    <div>
      <PageHeader
        icon={ScrollText}
        title="Audit trail"
        description="Append-only, hash-chained record of who did what. Any edit or deletion breaks the chain and is detected."
        actions={<>
          <AsyncButton variant="outline" onRun={async () => setVerify(await api.verifyAudit())}><ShieldCheck className="h-4 w-4" /> Verify integrity</AsyncButton>
          <AsyncButton variant="outline" onRun={async () => setCp(await api.auditCheckpoint())}>Signed checkpoint</AsyncButton>
          {can(me, "audit:export") && (
            <AsyncButton variant="outline" onRun={() => api.exportAudit().catch((e) => toast.push(e.message, "error"))}>
              <Download className="h-4 w-4" /> Export JSONL
            </AsyncButton>
          )}
        </>}
      />

      {verify && (
        <div className={cn(
          "mb-4 flex items-start gap-3 rounded-xl border p-3.5 text-sm",
          verify.ok ? "border-emerald-500/35 bg-emerald-500/10" : "border-red-500/35 bg-red-500/10",
        )}>
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", verify.ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-600 dark:text-red-400")}>
            {verify.ok ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          </span>
          {verify.ok
            ? <span><b>Chain intact.</b> {verify.checked.toLocaleString()} events verified from the first record to the latest.</span>
            : <span><b>Tampering detected</b> at event #{verify.first_bad_seq}: {verify.reason}. Treat as a security incident and preserve the database.</span>}
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="grid gap-2 md:grid-cols-[1fr,1fr,1fr,auto]" onSubmit={(e) => { e.preventDefault(); load(); }}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Action, e.g. approval.*" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
            </div>
            <Input placeholder="Actor (user or system)" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
            <Input placeholder="Resource id (run, approval, agent…)" value={f.resource_id} onChange={(e) => setF({ ...f, resource_id: e.target.value })} />
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 md:flex-none"><Filter className="h-4 w-4" /> Filter</Button>
              {filtered && (
                <Button type="button" variant="ghost" title="Clear filters" onClick={() => { setF(EMPTY); setTimeout(load, 0); }}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {rows === null ? (
        <Card><CardContent className="space-y-2 py-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/60" />)}
        </CardContent></Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No events match" body="Adjust the filters, or run an action elsewhere in the console to generate audit events." />
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
            <CardTitle className="text-sm">Events</CardTitle>
            <span className="text-xs text-muted-foreground">{rows.length.toLocaleString()} newest first · click a row for details</span>
          </CardHeader>
          <CardContent className="p-0"><Table>
            <THead><TR><TH className="w-16">#</TH><TH>Time</TH><TH>Actor</TH><TH>Action</TH><TH>Resource</TH><TH>Outcome</TH></TR></THead>
            <TBody>{rows.map((r) => (<Fragment key={r.id}>
              <TR className={cn("cursor-pointer", open === r.id && "bg-muted/40")} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <TD className="font-mono text-xs text-muted-foreground">{r.seq}</TD><TD className="whitespace-nowrap text-xs">{fmtDate(r.ts)}</TD>
                <TD>{r.actor}{r.actor_type !== "user" && <span className="ml-1 text-xs text-muted-foreground">({r.actor_type})</span>}</TD>
                <TD className="font-mono text-xs">{r.action}</TD>
                <TD className="max-w-[200px] truncate text-xs">{r.resource_type && `${r.resource_type}:`}{r.resource_id.slice(0, 12)}</TD>
                <TD><StatusBadge value={r.outcome} /></TD></TR>
              {open === r.id && (<TR><TD colSpan={6} className="bg-muted/25 p-4">
                <JsonView data={r.details} />
                <div className="mt-2 grid gap-1 font-mono text-[10px] text-muted-foreground">
                  <div className="truncate">prev: {r.prev_hash}</div><div className="truncate">hash: {r.hash}</div></div></TD></TR>)}
            </Fragment>))}</TBody></Table></CardContent></Card>
      )}

      {cp && (
        <Dialog open onOpenChange={(v) => !v && setCp(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Signed audit checkpoint</DialogTitle>
              <DialogDescription>Store this outside the platform (object-lock storage, SIEM, regulator). If events are later truncated, the head will no longer match.</DialogDescription>
            </DialogHeader>
            <JsonView data={cp} />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(JSON.stringify(cp, null, 2));
                  setCopied(true);
                  toast.push("Checkpoint copied to clipboard", "success");
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={() => setCp(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>)}
    </div>
  );
}
