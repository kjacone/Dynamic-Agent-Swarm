import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
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

  if (err && traces === null) {
    return (
      <div>
        <PageHeader title="Observability" description="Traces and metrics from Langfuse." />
        <Card><CardContent className="py-6 text-sm">
          <div className="text-destructive">{err}</div>
          <div className="mt-1 text-xs text-muted-foreground">Connect Langfuse in Settings → Connections.</div>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Observability"
        description="Recent traces and daily usage from Langfuse."
        actions={link && <Button variant="outline" asChild><a href={link} target="_blank" rel="noreferrer">Open Langfuse</a></Button>}
      />

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-sm">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="text-xs">Limit</label><Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 25)} className="w-24" /></div>
            <div><label className="text-xs">Session</label><Input value={session} onChange={(e) => setSession(e.target.value)} className="w-48" /></div>
            <div><label className="text-xs">User</label><Input value={user} onChange={(e) => setUser(e.target.value)} className="w-40" /></div>
            <div><label className="text-xs">Tag</label><Input value={tag} onChange={(e) => setTag(e.target.value)} className="w-40" /></div>
            <Button size="sm" onClick={loadTraces}>Search</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-sm">Traces</CardTitle></CardHeader>
        <CardContent>
          {!traces ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : traces.length === 0 ? (
            <EmptyState title="No traces" body="Send some traffic with tracing enabled." />
          ) : (
            <Table>
              <THead><TR><TH>Name</TH><TH>User</TH><TH>Session</TH><TH>Started</TH><TH>Latency</TH><TH>Tags</TH><TH></TH></TR></THead>
              <TBody>
                {traces.map((t) => (
                  <TR key={t.id}>
                    <TD className="text-xs">{truncate(t.name || t.id, 40)}</TD>
                    <TD className="text-xs">{t.userId || "—"}</TD>
                    <TD className="text-xs">{truncate(t.sessionId || "—", 24)}</TD>
                    <TD className="text-xs">{fmtDate(t.timestamp)}</TD>
                    <TD className="text-xs tabular-nums">{t.latency != null ? `${Math.round(t.latency)}ms` : "—"}</TD>
                    <TD className="text-xs">{(t.tags || []).slice(0, 3).join(", ") || "—"}</TD>
                    <TD>
                      {t.consoleUrl && (
                        <a className="text-xs text-primary underline" href={t.consoleUrl} target="_blank" rel="noreferrer">Open</a>
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
        <CardHeader><CardTitle className="text-sm">Daily usage (14 days)</CardTitle></CardHeader>
        <CardContent>
          {metrics.length === 0 ? (
            <div className="text-sm text-muted-foreground">No metrics available.</div>
          ) : (
            <Table>
              <THead><TR><TH>Date</TH><TH>Traces</TH><TH>Observations</TH><TH>Tokens</TH><TH>Cost</TH></TR></THead>
              <TBody>
                {metrics.slice(-14).map((m, i) => (
                  <TR key={i}>
                    <TD className="text-xs">{String(m.date || "—")}</TD>
                    <TD className="tabular-nums">{String(m.countTraces ?? m.traces ?? "—")}</TD>
                    <TD className="tabular-nums">{String(m.countObservations ?? m.observations ?? "—")}</TD>
                    <TD className="tabular-nums">{String(m.totalTokens ?? m.tokens ?? "—")}</TD>
                    <TD className="tabular-nums">{m.totalCost != null ? `$${Number(m.totalCost).toFixed(4)}` : "—"}</TD>
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