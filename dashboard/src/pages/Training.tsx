import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, GraduationCap, Server } from "lucide-react";
import { api, type TrainingJob } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { FilterTabs } from "@/components/common/FilterTabs";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/utils";

export function Training() {
  return (
    <div>
      <PageHeader icon={GraduationCap} title="Training" description="LLaMA-Factory jobs run in the trainer container." />
      <Tabs defaultValue="jobs">
        <TabsList className="h-10 rounded-xl p-1">
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
        </TabsList>
        <TabsContent value="jobs" className="mt-4"><Jobs /></TabsContent>
        <TabsContent value="datasets" className="mt-4"><Datasets /></TabsContent>
      </Tabs>
    </div>
  );
}

function Jobs() {
  const [data, setData] = useState<{ runner_online: boolean; jobs: TrainingJob[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<TrainingJob | null>(null);
  const [cancelling, setCancelling] = useState<TrainingJob | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setData(await api.listTrainingJobs()); } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, []);

  // Poll while anything is running/queued.
  useEffect(() => {
    if (!data) return;
    const busy = data.jobs.some((j) => j.status === "running" || j.status === "queued");
    if (!busy) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [data]);

  const counts = useMemo(() => {
    const jobs = data?.jobs ?? [];
    return {
      running: jobs.filter((j) => j.status === "running" || j.status === "queued").length,
      done: jobs.filter((j) => j.status === "completed").length,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Server} label="Trainer" value={data ? (data.runner_online ? "Online" : "Offline") : "—"}
          tone={data?.runner_online ? "emerald" : "red"}
          hint={data && !data.runner_online ? "docker compose --profile training up -d trainer" : "GPU container reachable"} />
        <StatCard icon={Activity} label="Active jobs" value={data ? counts.running : "—"} tone="sky" hint="Running or queued" />
        <StatCard icon={CheckCircle2} label="Completed" value={data ? counts.done : "—"} tone="violet" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Loss and progress stream from the trainer while a job runs.</p>
        <Button onClick={() => setCreating(true)}>New job</Button>
      </div>

      {data === null ? <LoadingBlock rows={4} />
        : data.jobs.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No training jobs" body="Create a job to start a fine-tune from one of your datasets."
            action={<Button onClick={() => setCreating(true)}>Create job</Button>} />
        ) : (
          <Card>
            <Table>
              <THead><TR><TH>Name</TH><TH>Status</TH><TH>Dataset</TH><TH className="text-right">Loss</TH><TH>Progress</TH><TH className="text-right">Actions</TH></TR></THead>
              <TBody>
                {data.jobs.map((j) => (
                  <TR key={j.id} className="group">
                    <TD className="font-medium">{j.name}</TD>
                    <TD><StatusBadge value={j.status} /></TD>
                    <TD className="font-mono text-xs text-muted-foreground">{String(j.params.dataset || "—")}</TD>
                    <TD className="text-right tabular-nums">{j.progress?.loss?.toFixed(4) ?? "—"}</TD>
                    <TD className="min-w-24">
                      {j.progress?.percentage != null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.min(100, j.progress.percentage)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{j.progress.percentage.toFixed(0)}%</span>
                        </div>
                      ) : "—"}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                        <Button size="sm" variant="outline" onClick={() => setViewing(j)}>View</Button>
                        {(j.status === "running" || j.status === "queued") && (
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelling(j)}>Cancel</Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}

      {creating && <CreateJob onClose={() => { setCreating(false); refresh(); }} />}
      {viewing && <JobView job={viewing} onClose={() => setViewing(null)} />}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${cancelling.name}?`}
          description="The trainer is asked to stop. Checkpoints already written are kept, but this run will not finish."
          confirmLabel="Cancel job" destructive
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            await api.cancelTrainingJob(cancelling.id);
            toast.push("Cancel requested", "success");
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateJob({ onClose }: { onClose: () => void }) {
  const [datasets, setDatasets] = useState<Array<{ name: string; rows: number }>>([]);
  const [name, setName] = useState("");
  const [dataset, setDataset] = useState("");
  const [baseModel, setBaseModel] = useState("Qwen/Qwen2.5-1.5B-Instruct");
  const [template, setTemplate] = useState("qwen");
  const [epochs, setEpochs] = useState(3);
  const [lr, setLr] = useState(1e-4);
  const [bs, setBs] = useState(1);
  const [ga, setGa] = useState(8);
  const [cutoff, setCutoff] = useState(2048);
  const toast = useToast();

  useEffect(() => { api.listTrainingDatasets().then(setDatasets); }, []);

  async function save() {
    try {
      await api.createTrainingJob({
        name, dataset, base_model: baseModel, template,
        epochs, learning_rate: lr, batch_size: bs, grad_accum: ga, cutoff_len: cutoff,
      });
      toast.push("Job queued", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New training job</DialogTitle>
          <DialogDescription>Defaults are tuned for a single small GPU. Adjust only if you know the trainer's capacity.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Job name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="refunds-lora-v1" /></div>
            <div className="space-y-1.5">
              <Label>Dataset</Label>
              <select value={dataset} onChange={(e) => setDataset(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                <option value="">Select dataset…</option>
                {datasets.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.rows} rows)</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Base model</Label>
              <Input className="font-mono text-xs" value={baseModel} onChange={(e) => setBaseModel(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Template</Label>
              <select value={template} onChange={(e) => setTemplate(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                {["default", "qwen", "llama3", "mistral", "gemma", "phi", "chatml"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hyperparameters</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Epochs</Label><Input type="number" min={1} value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} /></div>
              <div className="space-y-1.5"><Label>Learning rate</Label><Input type="number" step="0.00001" value={lr} onChange={(e) => setLr(Number(e.target.value))} /></div>
              <div className="space-y-1.5"><Label>Batch size</Label><Input type="number" min={1} value={bs} onChange={(e) => setBs(Number(e.target.value))} /></div>
              <div className="space-y-1.5"><Label>Grad accum</Label><Input type="number" min={1} value={ga} onChange={(e) => setGa(Number(e.target.value))} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Cutoff len</Label><Input type="number" min={128} value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))} /></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !dataset}>Queue job</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobView({ job, onClose }: { job: TrainingJob; onClose: () => void }) {
  const [detail, setDetail] = useState<TrainingJob | null>(null);
  const [log, setLog] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const [d, l] = await Promise.all([api.getTrainingJob(job.id), api.getTrainingLog(job.id, 200)]);
      setDetail(d); setLog(l.log);
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { refresh(); const id = setInterval(refresh, 3000); return () => clearInterval(id); }, []);

  const series = detail?.loss_series || [];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{job.name} <StatusBadge value={detail?.status || job.status} /></DialogTitle>
          <DialogDescription>Live progress and trainer output, refreshed every 3 seconds.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {err && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{err}</div>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Step" value={detail?.progress?.step ?? "—"} />
            <Stat label="Total" value={detail?.progress?.total ?? "—"} />
            <Stat label="Loss" value={detail?.progress?.loss?.toFixed(4) ?? "—"} />
            <Stat label="Epoch" value={detail?.progress?.epoch?.toFixed(2) ?? "—"} />
          </div>
          {series.length > 1 && <Sparkline data={series} />}
          <div className="space-y-1.5">
            <Label>Log (last 200 lines)</Label>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-[11px] leading-relaxed">{log || "—"}</pre>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function Sparkline({ data }: { data: { step: number; loss: number }[] }) {
  const W = 480, H = 80, PAD = 4;
  const xs = data.map((d) => d.step);
  const ys = data.map((d) => d.loss);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;

  const coords = data.map((d) => ({
    cx: PAD + ((d.step - minX) / dx) * (W - 2 * PAD),
    cy: H - PAD - ((d.loss - minY) / dy) * (H - 2 * PAD),
    step: d.step,
    loss: d.loss,
  }));

  return (
    <div className="rounded-xl border bg-muted/20 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full text-primary">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5"
          points={coords.map((c) => `${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(" ")} />
        {coords.map((c, i) => (
          <circle key={i} cx={c.cx} cy={c.cy} r={5} fill="transparent">
            <title>{`step ${c.step}: loss ${c.loss.toFixed(4)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function Datasets() {
  const [rows, setRows] = useState<Array<{ name: string; rows: number; updated_at: number }> | null>(null);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listTrainingDatasets()); } catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Alpaca-style rows, or every thumbs-up conversation with an agent.</p>
        <Button onClick={() => setCreating(true)}>New dataset</Button>
      </div>
      {rows === null ? <LoadingBlock rows={3} />
        : rows.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No training datasets" body="Build one from manually-entered rows or thumbs-up feedback." />
        ) : (
          <Card>
            <Table>
              <THead><TR><TH>Name</TH><TH className="text-right">Rows</TH><TH>Updated</TH></TR></THead>
              <TBody>
                {rows.map((d) => (
                  <TR key={d.name}>
                    <TD className="font-mono text-sm">{d.name}</TD>
                    <TD className="text-right tabular-nums">{d.rows}</TD>
                    <TD className="text-xs text-muted-foreground">{fmtDate(new Date(d.updated_at * 1000).toISOString())}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      {creating && <CreateDataset onClose={() => { setCreating(false); refresh(); }} />}
    </div>
  );
}

function CreateDataset({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"rows" | "feedback">("rows");
  const [rowsJson, setRowsJson] = useState(
    '[\n  {"instruction": "What is 2+2?", "input": "", "output": "4"}\n]',
  );
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const toast = useToast();

  useEffect(() => { api.listAgents().then(setAgents).catch(() => {}); }, []);

  async function save() {
    try {
      const body: any = { name, source };
      if (source === "rows") body.rows = JSON.parse(rowsJson);
      else body.agent_id = agentId || undefined;
      await api.createTrainingDataset(body);
      toast.push("Dataset created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New training dataset</DialogTitle>
          <DialogDescription>Pick the source of the examples. Rows must be valid JSON before the dataset is created.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="refunds-sft-v1" /></div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <FilterTabs value={source} onChange={setSource}
              options={[{ id: "rows", label: "Manual rows" }, { id: "feedback", label: "Thumbs-up feedback" }]} />
          </div>
          {source === "rows" ? (
            <div className="space-y-1.5"><Label>Rows (alpaca JSON)</Label>
              <Textarea rows={8} className="font-mono text-xs" value={rowsJson} onChange={(e) => setRowsJson(e.target.value)} /></div>
          ) : (
            <div className="space-y-1.5">
              <Label>Agent (optional filter)</Label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                <option value="">All agents</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name}>Create dataset</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
