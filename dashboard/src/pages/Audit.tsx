import { Fragment, useEffect, useState } from "react";
import { Download, ShieldCheck, ShieldAlert } from "lucide-react";
import { api, can, type AuditEventRow, type Me } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { JsonView } from "@/components/common/JsonView";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/utils";

type Verify = { ok: boolean; checked: number; first_bad_seq: number | null; reason: string };

export function Audit({ me }: { me: Me | null }) {
  const [rows, setRows] = useState<AuditEventRow[] | null>(null);
  const [f, setF] = useState({ action: "", actor: "", resource_id: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [cp, setCp] = useState<Record<string, unknown> | null>(null);
  const toast = useToast();

  async function load() {
    try { setRows((await api.queryAudit({ ...f, limit: 500 })).reverse()); } // newest first
    catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Audit trail" description="Append-only, hash-chained record of who did what. Any edit or deletion breaks the chain and is detected."
        actions={<>
          <AsyncButton variant="outline" onRun={async () => setVerify(await api.verifyAudit())}><ShieldCheck className="h-4 w-4" /> Verify integrity</AsyncButton>
          <AsyncButton variant="outline" onRun={async () => setCp(await api.auditCheckpoint())}>Signed checkpoint</AsyncButton>
          {can(me, "audit:export") && <AsyncButton variant="outline" onRun={() => api.exportAudit().catch((e) => toast.push(e.message, "error"))}><Download className="h-4 w-4" /> Export JSONL</AsyncButton>}
        </>} />

      {verify && (
        <div className={`mb-4 flex items-start gap-2 rounded-md border p-3 text-sm ${verify.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
          {verify.ok ? <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" /> : <ShieldAlert className="mt-0.5 h-4 w-4 text-red-600" />}
          {verify.ok ? <span><b>Chain intact.</b> {verify.checked} events verified from the first record to the latest.</span>
            : <span><b>Tampering detected</b> at event #{verify.first_bad_seq}: {verify.reason}. Treat as a security incident and preserve the database.</span>}
        </div>)}

      <form className="mb-4 grid gap-2 md:grid-cols-[1fr,1fr,1fr,auto]" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <Input placeholder="Action, e.g. approval.* or workflow.run.*" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
        <Input placeholder="Actor (user or system)" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        <Input placeholder="Resource id (run, approval, agent…)" value={f.resource_id} onChange={(e) => setF({ ...f, resource_id: e.target.value })} />
        <Button type="submit">Filter</Button>
      </form>

      {rows === null ? <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div>
        : rows.length === 0 ? <EmptyState title="No events match" />
        : <Card><CardContent className="p-0"><Table>
            <THead><TR><TH className="w-16">#</TH><TH>Time</TH><TH>Actor</TH><TH>Action</TH><TH>Resource</TH><TH>Outcome</TH></TR></THead>
            <TBody>{rows.map((r) => (<Fragment key={r.id}>
              <TR className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <TD className="font-mono text-xs">{r.seq}</TD><TD className="whitespace-nowrap text-xs">{fmtDate(r.ts)}</TD>
                <TD>{r.actor}{r.actor_type !== "user" && <span className="ml-1 text-xs text-muted-foreground">({r.actor_type})</span>}</TD>
                <TD className="font-mono text-xs">{r.action}</TD>
                <TD className="max-w-[200px] truncate text-xs">{r.resource_type && `${r.resource_type}:`}{r.resource_id.slice(0, 12)}</TD>
                <TD><StatusBadge value={r.outcome} /></TD></TR>
              {open === r.id && (<TR><TD colSpan={6} className="bg-muted/30">
                <JsonView data={r.details} />
                <div className="mt-2 grid gap-1 font-mono text-[10px] text-muted-foreground">
                  <div>prev: {r.prev_hash}</div><div>hash: {r.hash}</div></div></TD></TR>)}
            </Fragment>))}</TBody></Table></CardContent></Card>}

      {cp && (
        <Dialog open onOpenChange={(v) => !v && setCp(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Signed audit checkpoint</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Store this outside the platform (object-lock storage, SIEM, regulator). If events are later truncated, the head will no longer match.</p>
            <JsonView data={cp} />
            <DialogFooter><Button variant="outline" onClick={() => navigator.clipboard.writeText(JSON.stringify(cp, null, 2))}>Copy</Button><Button onClick={() => setCp(null)}>Close</Button></DialogFooter>
          </DialogContent>
        </Dialog>)}
    </div>
  );
}
