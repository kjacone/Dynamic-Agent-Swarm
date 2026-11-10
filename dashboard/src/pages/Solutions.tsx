import { useEffect, useState } from "react";
import { api, can, type Me, type Pack } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";

const INDUSTRY: Record<string, string> = { banking: "Banking", insurance: "Insurance", telecom: "Telecoms", government: "Government",
  healthcare: "Healthcare", ngo: "NGOs", corporate: "Corporate", education: "Education" };

export function Solutions({ me }: { me: Me | null }) {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [installing, setInstalling] = useState<Pack | null>(null);
  const [done, setDone] = useState<{ pack: Pack; res: Awaited<ReturnType<typeof api.installPack>> } | null>(null);
  const toast = useToast();
  const load = () => api.listPacks().then(setPacks).catch((e) => { toast.push(e.message, "error"); setPacks([]); });
  useEffect(() => { load(); }, []);

  const group = (p: "first" | "later") => (packs || []).filter((x) => x.priority === p);
  return (
    <div>
      <PageHeader title="Industry solutions" description="Ready-made agents, workflows, policies and evaluation sets on one platform. Install, tune parameters, connect your systems." />
      {packs === null ? <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading…</div>
        : packs.length === 0 ? <EmptyState title="No solutions available" />
        : (<>
          {([["first", "Launch solutions"], ["later", "Next wave"]] as const).map(([k, title]) => group(k).length > 0 && (
            <section key={k} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group(k).map((p) => (
                  <Card key={p.id}><CardContent className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{INDUSTRY[p.industry] ?? p.industry} · v{p.version}</div></div>
                      {p.installed ? <StatusBadge value="installed" label={`installed v${p.installed_version}`} /> : !p.entitled && <StatusBadge value="warn" label="not in licence" />}
                    </div>
                    <p className="text-sm">{p.summary}</p>
                    <div className="flex flex-wrap gap-1">{p.frameworks.map((f) => <Chip key={f}>{f}</Chip>)}</div>
                    <div className="text-xs text-muted-foreground">{p.agents} agents · {p.workflows} workflow{p.workflows !== 1 ? "s" : ""}{p.kpis.length > 0 && <> · KPIs: {p.kpis.slice(0, 2).map((x) => x.replace(/_/g, " ")).join(", ")}</>}</div>
                    <div className="mt-auto pt-1">
                      {can(me, "solutions:write") && <Button size="sm" variant={p.installed ? "outline" : "default"} disabled={!p.entitled} onClick={() => setInstalling(p)}>
                        {p.installed ? "Configure / upgrade" : "Install"}</Button>}
                    </div>
                  </CardContent></Card>))}
              </div>
            </section>))}
        </>)}

      {installing && <InstallDialog pack={installing} onClose={(res) => { if (res) { setDone({ pack: installing, res }); load(); } setInstalling(null); }} />}
      {done && (
        <Dialog open onOpenChange={(v) => !v && setDone(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{done.pack.name} is ready</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div>Created <b>{Object.keys(done.res.created.agents).length}</b> agents and <b>{done.res.created.workflows.length}</b> workflow(s): {done.res.created.workflows.map((w) => <Chip key={w.key}>{w.key} v{w.version}</Chip>)}</div>
              {done.res.created.connectors.length > 0 && <div>Connector templates added <b>(disabled)</b>: {done.res.created.connectors.map((c) => <Chip key={c}>{c}</Chip>)}</div>}
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Add endpoints and secret references (<code>env:NAME</code>) for each connector, then enable it.</li>
                <li>Assign named users the roles the workflow needs (e.g. approvers) in your identity provider.</li>
                <li>Run the pack’s evaluation dataset, then start a test workflow run.</li>
              </ol>
            </div>
            <DialogFooter><Button onClick={() => setDone(null)}>Done</Button></DialogFooter>
          </DialogContent>
        </Dialog>)}
    </div>
  );
}

function InstallDialog({ pack, onClose }: { pack: Pack; onClose: (res?: Awaited<ReturnType<typeof api.installPack>>) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(pack.parameters).map(([k, v]) => [k, typeof v.default === "string" ? v.default : JSON.stringify(v.default)])));
  const toast = useToast();
  async function go() {
    try {
      const parameters: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(pack.parameters)) {
        const raw = vals[k] ?? "";
        const orig = typeof v.default === "string" ? v.default : JSON.stringify(v.default);
        if (raw === orig) continue; // only send what the customer changed
        parameters[k] = typeof v.default === "string" ? raw : JSON.parse(raw);
      }
      onClose(await api.installPack(pack.id, parameters));
    } catch (e: any) { toast.push(e.message, "error"); }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{pack.installed ? "Configure" : "Install"} {pack.name}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto">
          {Object.keys(pack.parameters).length === 0 && <p className="text-sm text-muted-foreground">This solution has no tunable parameters.</p>}
          {Object.entries(pack.parameters).map(([k, v]) => (
            <div key={k}><Label>{k.replace(/_/g, " ")}</Label>
              <Input value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
              {v.description && <p className="mt-1 text-xs text-muted-foreground">{v.description}</p>}</div>))}
          <p className="text-xs text-muted-foreground">Installing again upgrades in place and keeps your earlier settings. Workflow definitions are versioned, so running cases are not affected.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onClose()}>Cancel</Button><AsyncButton onRun={go}>{pack.installed ? "Apply" : "Install"}</AsyncButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
