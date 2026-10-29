import { useEffect, useState } from "react";
import { api, type SystemStatus } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/common/StatusPill";
import { PageHeader } from "@/components/common/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const COUNT_LABELS: Record<string, string> = {
  agents: "Agents",
  subagents: "Subagents",
  tools: "Tools",
  rag: "Collections",
  models: "Models",
  datasets: "Eval datasets",
};

export function Overview({ tenant }: { tenant: string }) {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setData(await api.status(tenant));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [tenant]);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Live status of every dependency the agent runtime talks to."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />

      {err && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Services</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loading && !data && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          {data?.services.map((s) => (
            <StatusPill
              key={s.id}
              label={s.name}
              ok={s.ok}
              configured={s.configured}
              detail={s.latency_ms != null ? `${s.detail} · ${s.latency_ms}ms` : s.detail}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Counts</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {data &&
            Object.entries(COUNT_LABELS).map(([k, label]) => (
              <Card key={k}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold tabular-nums">{data.counts[k] ?? 0}</div>
                </CardContent>
              </Card>
            ))}
        </div>
      </section>
    </div>
  );
}