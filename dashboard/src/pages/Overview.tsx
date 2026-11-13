import { useEffect, useState } from "react";
import { Activity, Bot, Boxes, Cpu, Database, Gauge, Layers, LayoutDashboard, RotateCw, Server, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import { api, type SystemStatus } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { cn } from "@/lib/utils";

const COUNTS: Array<{ key: string; label: string; icon: typeof Bot; tone: "sky" | "violet" | "emerald" | "amber" | "indigo" | "slate" }> = [
  { key: "agents", label: "Agents", icon: Bot, tone: "violet" },
  { key: "subagents", label: "Subagents", icon: Boxes, tone: "indigo" },
  { key: "tools", label: "Tools", icon: Wrench, tone: "sky" },
  { key: "rag", label: "Collections", icon: Layers, tone: "emerald" },
  { key: "models", label: "Models", icon: Cpu, tone: "amber" },
  { key: "datasets", label: "Eval datasets", icon: Database, tone: "slate" },
];

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

  const services = data?.services ?? [];
  const healthy = services.filter((s) => s.ok).length;
  const broken = services.filter((s) => !s.ok && s.configured).length;
  const unset = services.filter((s) => !s.ok && !s.configured).length;

  return (
    <div>
      <PageHeader
        icon={LayoutDashboard}
        title="Overview"
        description="Live status of every dependency the agent runtime talks to."
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RotateCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Could not reach the API.</b> {err}
          </div>
        </div>
      )}

      {data && (
        <Card className="mb-6 overflow-hidden">
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl",
                broken ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              )}
            >
              {broken ? <TriangleAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                {broken ? `${broken} dependency${broken === 1 ? "" : "ies"} need attention` : "All configured services are healthy"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {healthy} online · {broken} failing · {unset} not configured · checked live against tenant “{tenant}”
              </div>
            </div>
            <div className="flex gap-1.5">
              {services.map((s) => (
                <span
                  key={s.id}
                  title={`${s.name}: ${s.ok ? "online" : s.configured ? "offline" : "not configured"}`}
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    s.ok ? "bg-emerald-500" : s.configured ? "bg-red-500" : "bg-muted-foreground/30",
                  )}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Services</h2>
          {data && <span className="text-xs text-muted-foreground">{services.length}</span>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {loading && !data && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)}
          {services.map((s) => (
            <Card key={s.id} className="p-3.5 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "relative flex h-2 w-2",
                      s.ok ? "text-emerald-500" : s.configured ? "text-red-500" : "text-muted-foreground/40",
                    )}
                  >
                    <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-60", s.ok ? "animate-ping bg-emerald-500" : "hidden")} />
                    <span className={cn("relative inline-flex h-2 w-2 rounded-full", s.ok ? "bg-emerald-500" : s.configured ? "bg-red-500" : "bg-muted-foreground/40")} />
                  </span>
                  <span className="text-sm font-medium">{s.name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {s.latency_ms != null && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{s.latency_ms}ms</span>
                  )}
                  <StatusBadge value={s.ok ? "pass" : s.configured ? "fail" : "cancelled"} label={s.ok ? "online" : s.configured ? "offline" : "not set"} />
                </div>
              </div>
              <div className="mt-2 line-clamp-2 text-xs text-muted-foreground" title={s.detail}>{s.detail || "No detail reported."}</div>
            </Card>
          ))}
          {!loading && services.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No services reported by the API.
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Registry at a glance</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {!data && loading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)}
          {data && COUNTS.map(({ key, label, icon, tone }) => (
            <StatCard key={key} icon={icon} tone={tone} label={label} value={(data.counts[key] ?? 0).toLocaleString()} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" /> Status refreshes automatically every 20 seconds.
        </div>
      </section>
    </div>
  );
}
