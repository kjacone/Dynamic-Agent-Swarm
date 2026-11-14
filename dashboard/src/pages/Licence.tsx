import { useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, Crown, Pencil, Plus, XCircle } from "lucide-react";
import {
  api, can, type LicenceFeature, type LicencePlan, type LicenceUpgradeRequest, type LicenceView, type Me,
} from "@/lib/api";
import { PageHeader } from "@/components/common/PageHeader";
import { LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { UpgradeDialog } from "@/components/common/UpgradeDialog";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const STATE_TONE: Record<string, "green" | "amber" | "red" | "blue" | "gray"> = {
  valid: "green", active: "green", grace: "amber", expired: "red", invalid: "red",
  unenforced: "blue", development: "blue",
};

export function Licence({ me }: { me: Me | null }) {
  const [view, setView] = useState<LicenceView | null>(null);
  const [requests, setRequests] = useState<LicenceUpgradeRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const writer = can(me, "license:write");

  async function load() {
    try {
      const [v, r] = await Promise.all([api.licencePlan(), api.licenceRequests()]);
      setView(v);
      setRequests(r);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  if (!view) {
    return (
      <div>
        <PageHeader icon={Crown} title="Licence" description="Plan, active features and upgrade requests for this tenant." />
        {err
          ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">{err}</div>
          : <LoadingBlock rows={5} />}
      </div>
    );
  }

  const { plan, license } = view;
  const daysLeft = plan.expires_on
    ? Math.ceil((new Date(`${plan.expires_on}T23:59:59`).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div>
      <PageHeader
        icon={Crown}
        title="Licence"
        description="What this deployment is licensed for, the features switched on, and requests to the account team."
        actions={(
          <div className="flex gap-2">
            {writer && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                {plan.derived ? <><Plus className="h-4 w-4" /> Create plan</> : <><Pencil className="h-4 w-4" /> Edit plan</>}
              </Button>
            )}
            <Button onClick={() => setUpgrading(true)}>
              <ArrowUpRight className="h-4 w-4" /> Request upgrade
            </Button>
          </div>
        )}
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Pilot licence</CardTitle>
            <StatusBadge value={license.state} tone={STATE_TONE[license.state] ?? "gray"} />
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Customer" v={plan.customer || license.customer || "—"} />
            <Row k="Edition" v={plan.edition.replace(/^./, (c) => c.toUpperCase())} />
            <Row k="Seats" v={plan.seats.toLocaleString()} />
            <Row k="Expires" v={plan.expires_on
              ? `${new Date(`${plan.expires_on}T00:00:00`).toLocaleDateString()}${daysLeft != null ? ` · ${daysLeft >= 0 ? `${daysLeft} days left` : `${-daysLeft} days ago`}` : ""}`
              : "—"} />
            <Row k="Deployment" v={String(license.deployment).replace(/_/g, " ")} />
            {plan.note && <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{plan.note}</p>}
            {plan.derived && (
              <p className="text-xs text-muted-foreground">
                No plan saved yet — this view mirrors the signed licence. Create a plan to choose the features
                shown to the bank.
              </p>
            )}
            {license.state === "unenforced" && (
              <p className="text-xs text-muted-foreground">Development mode: enforcement is off (LICENSE_ENFORCE).</p>
            )}
            {!plan.derived && plan.updated_at && (
              <p className="text-[11px] text-muted-foreground">
                Updated {new Date(plan.updated_at).toLocaleString()}{plan.updated_by ? ` by ${plan.updated_by}` : ""}.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Active features</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-1.5">
              {view.features.map((f) => {
                const on = plan.features.includes(f.id);
                return (
                  <div key={f.id} className={cn("flex items-start gap-2 rounded-lg border p-2 text-sm", on ? "bg-emerald-500/[0.04]" : "opacity-55")}>
                    {on
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />}
                    <div>
                      <div className="font-medium">{f.label} {on && <Chip className="ml-1">active</Chip>}</div>
                      <div className="text-[11px] leading-relaxed text-muted-foreground">{f.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Upgrade requests</CardTitle>
          <span className="text-xs text-muted-foreground">{requests?.length ?? 0} total</span>
        </CardHeader>
        <CardContent className="p-0">
          {!requests || requests.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-muted-foreground">
              No upgrade requests yet. Requests are stored per tenant and audited — no email or external
              call is made.
            </div>
          ) : (
            <Table>
              <THead><TR><TH>When</TH><TH>Upgrade</TH><TH>Features</TH><TH>Status</TH><TH>Requested by</TH></TR></THead>
              <TBody>
                {requests.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString()}</TD>
                    <TD className="whitespace-nowrap capitalize">{r.current_edition} → <b>{r.target_edition}</b></TD>
                    <TD><div className="flex max-w-72 flex-wrap gap-1">{r.add_features.map((f) => <Chip key={f}>{f}</Chip>)}</div>
                      {r.message && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.message}</div>}
                    </TD>
                    <TD><StatusBadge value={r.status} /></TD>
                    <TD className="text-xs">{r.requested_by}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <PlanDialog
          plan={plan}
          features={view.features}
          editions={view.editions}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      )}
      {upgrading && (
        <UpgradeDialog
          view={view}
          onClose={() => setUpgrading(false)}
          onDone={() => { setUpgrading(false); load(); }}
        />
      )}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-4 border-b border-border/50 pb-1.5 last:border-0">
    <span className="text-muted-foreground">{k}</span><span className="truncate text-right">{v}</span>
  </div>
);

function PlanDialog({ plan, features, editions, onClose, onSaved }: {
  plan: LicencePlan; features: LicenceFeature[]; editions: string[];
  onClose: () => void; onSaved: () => void;
}) {
  const [customer, setCustomer] = useState(plan.customer);
  const [edition, setEdition] = useState(plan.edition);
  const [seats, setSeats] = useState(String(plan.seats));
  const [expires, setExpires] = useState(plan.expires_on ?? "");
  const [selected, setSelected] = useState<string[]>(plan.features);
  const [note, setNote] = useState(plan.note);
  const toast = useToast();

  const toggle = (id: string) =>
    setSelected((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  async function save() {
    try {
      await api.saveLicencePlan({
        customer,
        edition,
        features: selected,
        seats: Number(seats) || 1,
        expires_on: expires || null,
        note,
      });
      toast.push("Licence plan saved", "success");
      onSaved();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{plan.derived ? "Create licence plan" : "Edit licence plan"}</DialogTitle>
          <DialogDescription>
            The plan is what the console and Overview display for this tenant. The signed licence still
            decides which modules are enforced.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="NMB Bank" />
            </div>
            <div className="space-y-1.5">
              <Label>Edition</Label>
              <select value={edition} onChange={(e) => setEdition(e.target.value)}
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm capitalize">
                {editions.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Seats</Label>
              <Input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Expires on</Label>
              <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Active features</Label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {features.map((f) => (
                <label key={f.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm hover:bg-muted/40">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary"
                    checked={selected.includes(f.id)} disabled={f.id === "audit"}
                    onChange={() => toggle(f.id)} />
                  <span>
                    <span className="block font-medium">{f.label}{f.id === "audit" && <Chip className="ml-1">always on</Chip>}</span>
                    <span className="block text-[11px] text-muted-foreground">{f.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Pilot scope, procurement reference or renewal notes." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save}>Save plan</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
