import { useEffect, useState } from "react";
import { api, type TrainingJob } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { useToast } from "@/components/ui/toast";

export function Training() {
  return (
    <div>
      <PageHeader title="Training" description="LLaMA-Factory jobs run in the trainer container." />
      <Tabs defaultValue="jobs">
        <TabsList>
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          Trainer:{" "}
          {data?.runner_online
            ? <Badge variant="success">online</Badge>
            : <Badge variant="destructive">offline</Badge>}
          {!data?.runner_online && (
            <span className="ml-2 text-xs text-muted-foreground">docker compose --profile training up -d trainer</span>
          )}
        </div>
        <Button onClick={() => setCreating(true)}>New job</Button>
      </div>

      {data && data.jobs.length === 0 ? (
        <EmptyState title="No jobs" body="Create a job to start a fine-tune." action={<Button onClick={() => setCreating(true)}>Create job</Button>} />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Status</TH><TH>Dataset</TH><TH>Loss</TH><TH>Progress</TH><TH></TH></TR></THead>
            <TBody>
              {data?.jobs.map((j) => (
                <TR key={j.id}>
                  <TD className="font-medium">{j.name}</TD>
                  <TD>
                    <Badge variant={
                      j.status === "completed" ? "success"
                        : j.status === "failed" ? "destructive"
                        : j.status === "running" ? "warning"
                        : "secondary"
                    }>{j.status}</Badge>
                  </TD>
                  <TD className="font-mono text-xs">{String(j.params.dataset || "—")}</TD>
                  <TD className="tabular-nums">{j.progress?.loss?.toFixed(4) ?? "—"}</TD>
                  <TD className="text-xs">{j.progress?.percentage != null ? `${j.progress.percentage.toFixed(1)}%` : "—"}</TD>
                  <TD>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setViewing(j)}>View</Button>
                      {(j.status === "running" || j.status === "queued") && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                          try { await api.cancelTrainingJob(j.id); toast.push("Cancel requested", "success"); refresh(); }
                          catch (e: any) { toast.push(e.message, "error"); }
                        }}>Cancel</Button>
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
      toast.push("Queued", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>New training job</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Job name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Dataset</Label>
            <select value={dataset} onChange={(e) => setDataset(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
              <option value="">Select dataset…</option>
              {datasets.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.rows} rows)</option>)}
            </select>
          </div>
          <div><Label>Base model</Label><Input value={baseModel} onChange={(e) => setBaseModel(e.target.value)} /></div>
          <div>
            <Label>Template</Label>
            <select value={template} onChange={(e) => setTemplate(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
              {["default","qwen","llama3","mistral","gemma","phi","chatml"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Epochs</Label><Input type="number" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} /></div>
            <div><Label>Learning rate</Label><Input type="number" step="0.00001" value={lr} onChange={(e) => setLr(Number(e.target.value))} /></div>
            <div><Label>Batch size</Label><Input type="number" value={bs} onChange={(e) => setBs(Number(e.target.value))} /></div>
            <div><Label>Grad accum</Label><Input type="number" value={ga} onChange={(e) => setGa(Number(e.target.value))} /></div>
            <div className="col-span-2"><Label>Cutoff len</Label><Input type="number" value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))} /></div>
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
        <DialogHeader><DialogTitle>{job.name} · {detail?.status || job.status}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {err && <div className="text-xs text-destructive">{err}</div>}
          <div className="grid grid-cols-4 gap-2 text-sm">
            <Stat label="Step" value={detail?.progress?.step ?? "—"} />
            <Stat label="Total" value={detail?.progress?.total ?? "—"} />
            <Stat label="Loss" value={detail?.progress?.loss?.toFixed(4) ?? "—"} />
            <Stat label="Epoch" value={detail?.progress?.epoch?.toFixed(2) ?? "—"} />
          </div>
          {series.length > 1 && <Sparkline data={series} />}
          <div>
            <Label>Log (last 200 lines)</Label>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{log || "—"}</pre>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular-nums">{value}</div>
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
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full rounded-md border bg-background text-primary">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={coords.map((c) => `${c.cx.toFixed(1)},${c.cy.toFixed(1)}`).join(" ")}
      />
      {coords.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={5} fill="transparent">
          <title>{`step ${c.step}: loss ${c.loss.toFixed(4)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function Datasets() {
  const [rows, setRows] = useState<Array<{ name: string; rows: number; updated_at: number }>>([]);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listTrainingDatasets()); } catch (e: any) { toast.push(e.message, "error"); }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => setCreating(true)}>New dataset</Button></div>
      {rows.length === 0 ? (
        <EmptyState title="No training datasets" body="Build one from manually-entered rows or thumbs-up feedback." />
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Rows</TH><TH>Updated</TH></TR></THead>
            <TBody>
              {rows.map((d) => (
                <TR key={d.name}>
                  <TD className="font-mono text-sm">{d.name}</TD>
                  <TD className="tabular-nums">{d.rows}</TD>
                  <TD className="text-xs">{new Date(d.updated_at * 1000).toLocaleString()}</TD>
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
      toast.push("Created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New training dataset</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Source</Label>
            <select value={source} onChange={(e) => setSource(e.target.value as any)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
              <option value="rows">manual rows</option>
              <option value="feedback">thumbs-up feedback</option>
            </select>
          </div>
          {source === "rows" ? (
            <div><Label>Rows (alpaca JSON)</Label><Textarea rows={8} value={rowsJson} onChange={(e) => setRowsJson(e.target.value)} /></div>
          ) : (
            <div>
              <Label>Agent (optional filter)</Label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm">
                <option value="">All agents</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name}>Create</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}