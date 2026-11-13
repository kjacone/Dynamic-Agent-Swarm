import { useEffect, useMemo, useState } from "react";
import { Activity, Clock, Coins, ExternalLink, Filter, Gauge, RotateCcw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { StatCard } from "@/components/common/StatCard";
import { fmtDate, truncate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export function Observability() {
  const [traces, setTraces] = useState<Array<Record<string, any>> | null>(null);
  const [metrics, setMetrics] = useState<Array<Record<string, any>>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);
  const [session, setSession] = useState("");
  const [user, setUser] = useState("");
  const [tag, setTag] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const toast = useToast();

  async function loadTraces() {
    setErr(null);
    try {
      const params: Record<string, string | number> = { limit };
      if (session) params.session_id = session;
      if (user) params.user_id = user;
      if (tag) params.tag = tag;
      const r = await api.listTraces(params);
      setTraces((r.data || []) as Array<Record<string, any>>);
    } catch (e: any) {
      setErr(e.message);
      setTraces(null);
    }
  }

  async function loadMetrics() {
    try { const m = await api.dailyMetrics(14); setMetrics((m.data || []) as Array<Record<string, any>>); }
    catch { setMetrics([]); }
  }

  useEffect(() => {
    loadTraces(); loadMetrics();
    api.obsLink("traces").then((r) => setLink(r.url)).catch(() => {});
  }, []);

  const summary = useMemo(() => {
    const list = traces ?? [];
    const latencies = list.map((t) => Number(t.latency)).filter((n) => Number.isFinite(n) && n > 0);
    const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
    const tokens = metrics.reduce((n, m) => n + Number(m.totalTokens ?? m.tokens ?? 0), 0);
    const cost = metrics.reduce((n, m) => n + Number(m.totalCost ?? 0), 0);
    return { avg, tokens, cost };
  }, [traces, metrics]);

  if (err && traces === null) {
    return (
      <div>
        <PageHeader icon={Activity} title="Observability" description="Traces and metrics from Langfuse." />
        <Card><CardContent className="py-8 text-center text-sm">
          <div className="font-medium text-destructive">{err}</div>
          <div className="mt-1 text-xs text-muted-foreground">Connect Langfuse in Settings → Connections.</div>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        icon={Activity}
        title="Observability"
        description="Recent traces and daily usage from Langfuse."
        actions={link ? <Button variant="outline" asChild><a href={link} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> Open Langfuse</a></Button> : undefined}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Activity} label="Traces loaded" value={traces?.length ?? "—"} tone="sky" hint={`Limit ${limit}`} />
        <StatCard icon={Gauge} label="Avg latency" value={summary.avg != null ? `${Math.round(summary.avg)}ms` : "—"} tone="violet" hint="Across loaded traces" />
        <StatCard icon={Clock} label="Tokens (14d)" value={summary.tokens ? summary.tokens.toLocaleString() : "—"} tone="emerald" />
        <StatCard icon={Coins} label="Cost (14d)" value={summary.cost ? `$${summary.cost.toFixed(4)}` : "—"} tone="amber" />
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Filter className="h-4 w-4 text-primary" /> Filters</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[80px,1fr,1fr,1fr,auto]" onSubmit={(e) => { e.preventDefault(); loadTraces(); }}>
            <div className="space-y-1"><Label className="text-xs">Limit</Label>
              <Input type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 25)} /></div>
            <div className="space-y-1"><Label className="text-xs">Session</Label>
              <Input placeholder="session id" value={session} onChange={(e) => setSession(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">User</Label>
              <Input placeholder="user id" value={user} onChange={(e) => setUser(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Tag</Label>
              <Input placeholder="tag" value={tag} onChange={(e) => setTag(e.target.value)} /></div>
            <div className="flex items-end gap-1">
              <Button type="submit"><Search className="h-4 w-4" /> Search</Button>
              {(session || user || tag) && (
                <Button type="button" variant="ghost" title="Clear filters"
                  onClick={() => { setSession(""); setUser(""); setTag(""); setTimeout(() => { loadTraces(); }, 0); }}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Traces</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!traces ? (
            <div className="p-4"><LoadingBlock rows={4} /></div>
          ) : traces.length === 0 ? (
            <div className="p-4"><EmptyState icon={Activity} title="No traces" body="Send some traffic with tracing enabled." /></div>
          ) : (
            <Table>
              <THead><TR><TH>Name</TH><TH>User</TH><TH>Session</TH><TH>Started</TH><TH className="text-right">Latency</TH><TH>Tags</TH><TH></TH></TR></THead>
              <TBody>
                {traces.map((t) => (
                  <TR key={t.id} className="group">
                    <TD className="max-w-[220px] truncate text-xs">{truncate(t.name || t.id, 40)}</TD>
                    <TD className="text-xs">{t.userId || "—"}</TD>
                    <TD className="max-w-[160px] truncate font-mono text-[11px] text-muted-foreground">{t.sessionId || "—"}</TD>
                    <TD className="whitespace-nowrap text-xs">{fmtDate(t.timestamp)}</TD>
                    <TD className="text-right tabular-nums text-xs">
                      {t.latency != null ? (
                        <span className={t.latency > 5000 ? "font-medium text-amber-600 dark:text-amber-400" : ""}>{Math.round(t.latency)}ms</span>
                      ) : "—"}
                    </TD>
                    <TD className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {(t.tags || []).slice(0, 3).map((g: string) => (
                          <span key={g} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{g}</span>
                        ))}
                        {!(t.tags || []).length && "—"}
                      </div>
                    </TD>
                    <TD>
                      {t.consoleUrl && (
                        <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={t.consoleUrl} target="_blank" rel="noreferrer">
                          Open <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Daily usage (14 days)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {metrics.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No metrics available.</div>
          ) : (
            <Table>
              <THead><TR><TH>Date</TH><TH className="text-right">Traces</TH><TH className="text-right">Observations</TH><TH className="text-right">Tokens</TH><TH className="text-right">Cost</TH></TR></THead>
              <TBody>
                {metrics.slice(-14).map((m, i) => (
                  <TR key={i}>
                    <TD className="text-xs">{String(m.date || "—")}</TD>
                    <TD className="text-right tabular-nums">{String(m.countTraces ?? m.traces ?? "—")}</TD>
                    <TD className="text-right tabular-nums">{String(m.countObservations ?? m.observations ?? "—")}</TD>
                    <TD className="text-right tabular-nums">{String(m.totalTokens ?? m.tokens ?? "—")}</TD>
                    <TD className="text-right tabular-nums">{m.totalCost != null ? `$${Number(m.totalCost).toFixed(4)}` : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
