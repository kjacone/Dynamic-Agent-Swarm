import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Activity, CheckCircle2, Cloud, Cpu, Download, ExternalLink, FileText, GraduationCap, Play, RotateCcw, Server, Trash2, TrendingDown, X } from "lucide-react";
import { api, type PlaygroundPreview, type PlaygroundResult, type TrainingJob } from "@/lib/api";
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
import { cn, fmtDate } from "@/lib/utils";

export function Training() {
  return (
    <div>
      <PageHeader icon={GraduationCap} title="Training" description="Fine-tune on GPUs with LLaMA-Factory, or try the CPU playground that runs the same training loop at toy scale." />
      <Tabs defaultValue="playground">
        <TabsList className="h-10 rounded-xl p-1">
          <TabsTrigger value="playground">Playground</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
          <TabsTrigger value="colab">Google Colab</TabsTrigger>
        </TabsList>
        <TabsContent value="playground" className="mt-4"><Playground /></TabsContent>
        <TabsContent value="jobs" className="mt-4"><Jobs /></TabsContent>
        <TabsContent value="datasets" className="mt-4"><Datasets /></TabsContent>
        <TabsContent value="colab" className="mt-4"><ColabPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

const EXPLAINER = [
  { title: "Your examples", body: "A handful of approved replies. This is the dataset." },
  { title: "Model guesses", body: "A tiny next-word model starts with random weights." },
  { title: "Loss measures error", body: "Cross-entropy: how surprised the model is by your text." },
  { title: "Weights update", body: "Gradient descent nudges the weights to lower the loss." },
];

function Playground() {
  const toast = useToast();
  const [corpus, setCorpus] = useState("");
  const [exampleCorpus, setExampleCorpus] = useState("");
  const [epochs, setEpochs] = useState(40);
  const [lr, setLr] = useState(1);
  const [temperature, setTemperature] = useState(0.8);
  const [prefix, setPrefix] = useState("your");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getTrainingPlayground()
      .then((info) => {
        setCorpus(info.corpus);
        setExampleCorpus(info.corpus);
        setEpochs(info.defaults.epochs);
        setLr(info.defaults.learning_rate);
        setTemperature(info.defaults.temperature);
        setPrefix(info.defaults.prefix);
      })
      .catch((e: any) => toast.push(e.message, "error"));
  }, []);

  async function run() {
    setErr(null);
    try {
      setResult(await api.runTrainingPlayground({ corpus, epochs, learning_rate: lr, temperature, prefix }));
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-primary/[0.06] to-transparent">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Cpu className="h-4 w-4 text-primary" />
            Same loop as a GPU fine-tune, at toy scale
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {EXPLAINER.map((step, i) => (
              <div key={step.title} className="rounded-lg border bg-background/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary">{i + 1}</span>
                  {step.title}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            A real fine-tune repeats this exact loop over billions of parameters, which is why it needs GPUs. Here it runs on the CPU in
            milliseconds with ~5,000 parameters, so you can watch what training actually does.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Training data</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Examples (one per line)</Label>
                <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => setCorpus(exampleCorpus)} disabled={!exampleCorpus || corpus === exampleCorpus}>
                  <RotateCcw className="h-3 w-3" /> Reset example
                </Button>
              </div>
              <Textarea rows={8} className="font-mono text-xs" value={corpus} onChange={(e) => setCorpus(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">The model learns which word tends to follow which. Add your own approved replies to steer it.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Predict after this word</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. your" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label>Epochs</Label>
                <Input type="number" min={1} max={80} value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} />
                <p className="text-[10px] text-muted-foreground">Passes over the data</p>
              </div>
              <div className="space-y-1.5">
                <Label>Learning rate</Label>
                <Input type="number" step="0.1" min={0.01} max={5} value={lr} onChange={(e) => setLr(Number(e.target.value))} />
                <p className="text-[10px] text-muted-foreground">Step size for updates</p>
              </div>
              <div className="space-y-1.5">
                <Label>Temperature</Label>
                <Input type="number" step="0.1" min={0.1} max={2} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
                <p className="text-[10px] text-muted-foreground">Sampling randomness</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-[11px] text-muted-foreground">Runs locally on the API — no GPU, no external LLM.</p>
              <AsyncButton onRun={run} disabled={!corpus.trim()}>
                <Play className="mr-1 h-3.5 w-3.5" /> Run training
              </AsyncButton>
            </div>
            {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{err}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">What the model learned</CardTitle></CardHeader>
          <CardContent>
            {!result ? (
              <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                Run training to see the loss curve and how the model's next-word guesses change.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Vocab" value={result.vocab_size} />
                  <Stat label="Parameters" value={result.parameters.toLocaleString()} />
                  <Stat label="Final loss" value={result.final_loss.toFixed(3)} />
                  <Stat label="Time" value={`${result.elapsed_ms} ms`} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <TrendingDown className="h-3.5 w-3.5 text-primary" />
                    Loss per epoch — {result.loss_series[0].loss.toFixed(2)} → {result.final_loss.toFixed(2)}
                  </div>
                  <Sparkline data={result.loss_series} />
                  <p className="text-[11px] text-muted-foreground">Lower is better. The model is becoming less surprised by your examples.</p>
                </div>
                <Predictions title={`Next word after “${result.prefix}”`} before={result.before} after={result.after} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <GenerationBox label="Before training" text={result.before.generation} muted />
                  <GenerationBox label="After training" text={result.after.generation} />
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Before = random weights, so the model guesses almost uniformly. After = the same weights updated by gradient descent on your
                  lines. That is the whole idea of fine-tuning; a real run just has far more weights, data and compute.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const COLAB_STEPS = [
  { title: "Pick a dataset", body: "Any dataset from the Datasets tab, with the base model and hyperparameters." },
  { title: "Download the notebook", body: "A self-contained .ipynb with the rows and settings embedded." },
  { title: "Upload to Colab", body: "File → Upload notebook, then Runtime → Change runtime type → T4 GPU." },
  { title: "Run all", body: "Installs, trains, compares base vs tuned, downloads the adapter zip." },
];

function ColabPanel() {
  const toast = useToast();
  const [datasets, setDatasets] = useState<Array<{ name: string; rows: number }>>([]);
  const [mode, setMode] = useState<"train" | "infer">("train");
  const [dataset, setDataset] = useState("");
  const [baseModel, setBaseModel] = useState("Qwen/Qwen2.5-0.5B-Instruct");
  const [prompt, setPrompt] = useState("");
  const [epochs, setEpochs] = useState(3);
  const [lr, setLr] = useState(0.0002);
  const [bs, setBs] = useState(1);
  const [ga, setGa] = useState(8);
  const [seq, setSeq] = useState(1024);

  useEffect(() => {
    api.trainingColab()
      .then((info) => {
        const d = info.defaults;
        setMode(d.mode);
        setBaseModel(d.base_model);
        setEpochs(d.epochs);
        setLr(d.learning_rate);
        setBs(d.batch_size);
        setGa(d.grad_accum);
        setSeq(d.max_seq_length);
      })
      .catch((e: any) => toast.push(e.message, "error"));
    api.listTrainingDatasets()
      .then((list) => {
        setDatasets(list);
        if (list.length) setDataset((cur) => cur || list[0].name);
      })
      .catch((e: any) => toast.push(e.message, "error"));
  }, []);

  const rows = datasets.find((d) => d.name === dataset)?.rows;

  async function download() {
    if (!dataset) return;
    try {
      const blob = await api.downloadColabNotebook({
        mode, dataset, base_model: baseModel.trim(), epochs, learning_rate: lr,
        batch_size: bs, grad_accum: ga, max_seq_length: seq, prompt,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `colab-${dataset}-${mode}.ipynb`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.push("Notebook downloaded — upload it in Colab and hit Run all", "success");
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-br from-primary/[0.06] to-transparent">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Cloud className="h-4 w-4 text-primary" />
            Train on Colab's free T4 — no GPU needed here
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {COLAB_STEPS.map((step, i) => (
              <div key={step.title} className="rounded-lg border bg-background/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary">{i + 1}</span>
                  {step.title}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            The notebook embeds the dataset and runs in the client's own Google account, so the rows leave this
            deployment — export synthetic or already-approved data only. Colab sessions are time-limited and subject
            to GPU availability; the console trainer stays the production path.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Notebook settings</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FilterTabs
              value={mode}
              onChange={setMode}
              options={[{ id: "train", label: "Fine-tune (LoRA)" }, { id: "infer", label: "Inference only" }]}
            />
            <div className="space-y-1.5">
              <Label>Dataset</Label>
              <select value={dataset} onChange={(e) => setDataset(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                {datasets.length === 0 && <option value="">No datasets yet — create one in Datasets</option>}
                {datasets.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.rows} rows)</option>)}
              </select>
              {rows != null && <p className="text-[11px] text-muted-foreground">{rows} rows will be embedded in the notebook.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Base model</Label>
              <Input className="font-mono text-xs" value={baseModel} onChange={(e) => setBaseModel(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">0.5B–1.5B instruct models fit the free T4 comfortably; larger ones run out of memory.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Test prompt (optional)</Label>
              <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Show me phones under 250,000 TZS" />
              <p className="text-[11px] text-muted-foreground">
                {mode === "train" ? "Used to compare the base model with the tuned adapter." : "The question the notebook asks the base model."}
              </p>
            </div>
            {mode === "train" && (
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label>Epochs</Label>
                  <Input type="number" min={1} max={20} value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Learning rate</Label>
                  <Input type="number" step="0.00005" min={0.000001} max={0.01} value={lr} onChange={(e) => setLr(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Batch size</Label>
                  <Input type="number" min={1} max={16} value={bs} onChange={(e) => setBs(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Grad accum</Label>
                  <Input type="number" min={1} max={64} value={ga} onChange={(e) => setGa(Number(e.target.value))} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Max seq length</Label>
                  <Input type="number" min={128} max={4096} step={128} value={seq} onChange={(e) => setSeq(Number(e.target.value))} />
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-[11px] text-muted-foreground">Generates a .ipynb — nothing is trained or charged here.</p>
              <AsyncButton onRun={download} disabled={!dataset || !baseModel.trim()}>
                <Download className="mr-1 h-3.5 w-3.5" /> Download notebook
              </AsyncButton>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">How to run it</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-xs">
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>Download the notebook with the settings on the left.</li>
              <li>In Colab, choose <span className="font-medium">File → Upload notebook</span>.</li>
              <li>Set <span className="font-medium">Runtime → Change runtime type → T4 GPU</span>, then <span className="font-medium">Runtime → Run all</span>.</li>
              <li>The first cell installs packages (~2 minutes). Training logs, the base-vs-tuned comparison and the adapter download follow.</li>
            </ol>
            <div className="rounded-lg border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Expected: a 0.5B LoRA over a few hundred rows trains in roughly 5–15 minutes on a T4. Sessions are
              time-limited; if Colab interrupts a run, "Run all" again after uploading.
            </div>
            <a href="https://colab.research.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Open colab.research.google.com <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Predictions({ title, before, after }: { title: string; before: PlaygroundPreview; after: PlaygroundPreview }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{title}</div>
      {[{ label: "Before", data: before, tone: "bg-muted-foreground/40" }, { label: "After", data: after, tone: "bg-primary" }].map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{row.label}</div>
          <div className="flex flex-wrap gap-1.5">
            {row.data.predictions.map((p) => (
              <div key={p.token} className="min-w-24 flex-1 rounded-md border p-1.5">
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate font-medium">{p.token}</span>
                  <span className="tabular-nums text-muted-foreground">{(p.p * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", row.tone)} style={{ width: `${Math.min(100, Math.max(2, p.p * 240))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GenerationBox({ label, text, muted = false }: { label: string; text: string; muted?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-2.5", muted ? "bg-muted/30" : "border-primary/30 bg-primary/[0.04]")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-1 text-xs leading-relaxed">{text}</p>
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
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const toast = useToast();

  async function refresh() {
    try { setRows(await api.listTrainingDatasets()); } catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  useEffect(() => { refresh(); }, []);

  async function download(name: string) {
    setDownloading(name);
    try {
      const blob = await api.downloadTrainingDataset(name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.push(e.message, "error");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">How datasets are created</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              {
                title: "1 · Upload or type rows",
                body: "Alpaca-style examples with instruction + output (input optional). Upload a .json, .jsonl or .csv file, or edit the JSON by hand. question/answer columns are accepted as aliases.",
              },
              {
                title: "2 · Or collect feedback",
                body: "Every thumbs-up conversation becomes a row: the user's message is the instruction and the agent's reply is the output. Optionally restrict to one agent.",
              },
              {
                title: "3 · Use it in a job",
                body: "Datasets are saved as <name>.json and registered in dataset_info.json. A Jobs entry runs SFT + LoRA with LLaMA-Factory in the trainer container, which needs a GPU.",
              },
            ].map((step) => (
              <div key={step.title} className="rounded-lg border bg-muted/20 p-2.5">
                <div className="text-xs font-medium">{step.title}</div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
          <div className="space-y-1 rounded-lg border bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Row format:</span>{" "}
              <code>{'{"instruction": "…", "input": "", "output": "…"}'}</code>
            </div>
            <div>Names may use letters, digits, - and _ (max 64). Rows missing an instruction or output are dropped.</div>
            <div>Keep replies final, consistent and free of customer PII, credentials or secrets — a fine-tuned model can memorise them.</div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Alpaca-style rows, or every thumbs-up conversation with an agent.</p>
        <Button onClick={() => setCreating(true)}>New dataset</Button>
      </div>
      {rows === null ? <LoadingBlock rows={3} />
        : rows.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No training datasets" body="Build one from manually-entered rows, an uploaded file, or thumbs-up feedback." />
        ) : (
          <Card>
            <Table>
              <THead><TR><TH>Name</TH><TH className="text-right">Rows</TH><TH>Updated</TH><TH className="text-right">Actions</TH></TR></THead>
              <TBody>
                {rows.map((d) => (
                  <TR key={d.name} className="group">
                    <TD className="font-mono text-sm">{d.name}</TD>
                    <TD className="text-right tabular-nums">{d.rows}</TD>
                    <TD className="text-xs text-muted-foreground">{fmtDate(new Date(d.updated_at * 1000).toISOString())}</TD>
                    <TD>
                      <div className="flex justify-end gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                        <Button size="sm" variant="outline" onClick={() => download(d.name)} disabled={downloading === d.name}>
                          <Download className="mr-1 h-3.5 w-3.5" /> {downloading === d.name ? "…" : "Download"}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(d.name)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      {creating && <CreateDataset onClose={() => { setCreating(false); refresh(); }} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting}?`}
          description="The dataset file is removed and unregistered from dataset_info.json. Finished jobs are unaffected, but a queued or running job that uses this dataset must be cancelled first."
          confirmLabel="Delete dataset"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteTrainingDataset(deleting);
            toast.push("Dataset deleted", "success");
            refresh();
          }}
        />
      )}
    </div>
  );
}

type DatasetRow = { instruction: string; input: string; output: string };

const MAX_UPLOAD_ROWS = 10_000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function normalizeRow(raw: unknown): DatasetRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const instruction = String(r.instruction ?? r.question ?? r.prompt ?? "").trim();
  const output = String(r.output ?? r.answer ?? r.response ?? "").trim();
  if (!instruction || !output) return null;
  return { instruction, input: String(r.input ?? r.context ?? ""), output };
}

function rowsFromJson(text: string): unknown[] {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of ["rows", "data", "examples", "items"]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  throw new Error("expected a JSON array of rows");
}

function parseCsv(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); grid.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); grid.push(row); }
  return grid.filter((cells) => cells.some((c) => c.trim()));
}

function parseDatasetFile(filename: string, text: string): { rows: DatasetRow[]; skipped: number } {
  const ext = filename.toLowerCase().split(".").pop();
  let raw: unknown[];
  if (ext === "jsonl" || ext === "ndjson") {
    raw = text.split(/\r?\n/).filter((line) => line.trim()).map((line, i) => {
      try { return JSON.parse(line); } catch { throw new Error(`line ${i + 1} is not valid JSON`); }
    });
  } else if (ext === "json") {
    raw = rowsFromJson(text);
  } else if (ext === "csv") {
    const grid = parseCsv(text);
    if (grid.length < 2) throw new Error("CSV needs a header row and at least one data row");
    const header = grid[0].map((h) => h.trim().toLowerCase());
    const column = (...names: string[]) => {
      const i = names.map((n) => header.indexOf(n)).find((idx) => idx >= 0);
      return i ?? -1;
    };
    const iInstruction = column("instruction", "question", "prompt");
    const iInput = column("input", "context");
    const iOutput = column("output", "answer", "response");
    if (iInstruction < 0 || iOutput < 0) throw new Error("CSV needs instruction (or question) and output (or answer) columns");
    raw = grid.slice(1).map((cells) => ({
      instruction: cells[iInstruction],
      input: iInput >= 0 ? cells[iInput] : "",
      output: cells[iOutput],
    }));
  } else {
    throw new Error("use a .json, .jsonl or .csv file");
  }
  if (raw.length > MAX_UPLOAD_ROWS) throw new Error(`the file has ${raw.length} rows; the limit is ${MAX_UPLOAD_ROWS}`);
  const normalized = raw.map(normalizeRow);
  const rows = normalized.filter((r): r is DatasetRow => r !== null);
  return { rows, skipped: normalized.length - rows.length };
}

function CreateDataset({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"rows" | "feedback">("rows");
  const [rowsJson, setRowsJson] = useState(
    '[\n  {"instruction": "What is 2+2?", "input": "", "output": "4"}\n]',
  );
  const [uploaded, setUploaded] = useState<{ name: string; rows: DatasetRow[]; skipped: number } | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const toast = useToast();

  useEffect(() => { api.listAgents().then(setAgents).catch(() => {}); }, []);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileErr(null);
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("file is larger than 5 MB");
      const { rows, skipped } = parseDatasetFile(file.name, await file.text());
      if (!rows.length) throw new Error("no usable rows — each row needs an instruction and an output");
      setUploaded({ name: file.name, rows, skipped });
      toast.push(`Loaded ${rows.length} rows from ${file.name}`, "success");
    } catch (err: any) {
      setUploaded(null);
      setFileErr(`Could not read ${file.name}: ${err.message ?? err}`);
    }
  }

  async function save() {
    try {
      const body: any = { name, source };
      if (source === "rows") {
        body.rows = uploaded ? uploaded.rows : JSON.parse(rowsJson);
      } else {
        body.agent_id = agentId || undefined;
      }
      await api.createTrainingDataset(body);
      toast.push("Dataset created", "success"); onClose();
    } catch (e: any) {
      const message = e instanceof SyntaxError ? "Rows must be valid JSON." : e.message;
      toast.push(message, "error");
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New training dataset</DialogTitle>
          <DialogDescription>Upload a file or enter examples by hand; thumbs-up feedback can be turned into rows automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="refunds-sft-v1" />
            <p className="text-[11px] text-muted-foreground">Letters, digits, - and _ (max 64).</p>
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <FilterTabs value={source} onChange={setSource}
              options={[{ id: "rows", label: "Manual rows" }, { id: "feedback", label: "Thumbs-up feedback" }]} />
          </div>
          {source === "rows" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Upload a file</Label>
                  <span className="text-[11px] text-muted-foreground">.json · .jsonl · .csv</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept=".json,.jsonl,.ndjson,.csv,application/json,text/csv"
                    onChange={onFile}
                    className="block w-full cursor-pointer rounded-lg border bg-background text-xs text-muted-foreground file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted/80"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">instruction + output columns; input optional.</p>
                {fileErr && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{fileErr}</div>}
                {uploaded && (
                  <div className="rounded-lg border bg-muted/20 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 font-medium">
                        <FileText className="h-3.5 w-3.5 text-primary" /> {uploaded.name}
                      </span>
                      <span className="text-muted-foreground">
                        {uploaded.rows.length} rows{uploaded.skipped ? ` · ${uploaded.skipped} skipped` : ""}
                      </span>
                      <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => setUploaded(null)}>
                        <X className="h-3 w-3" /> Remove
                      </Button>
                    </div>
                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded border bg-background/60 p-2 text-[10px] leading-relaxed">
                      {JSON.stringify(uploaded.rows.slice(0, 2), null, 1)}{uploaded.rows.length > 2 ? "\n…" : ""}
                    </pre>
                    <button
                      type="button"
                      className="mt-1 text-[11px] text-primary underline-offset-2 hover:underline"
                      onClick={() => { setRowsJson(JSON.stringify(uploaded.rows, null, 1)); setUploaded(null); }}
                    >
                      Edit rows as JSON instead
                    </button>
                  </div>
                )}
              </div>
              {!uploaded && (
                <div className="space-y-1.5">
                  <Label>Or paste rows (alpaca JSON)</Label>
                  <Textarea rows={7} className="font-mono text-xs" value={rowsJson} onChange={(e) => setRowsJson(e.target.value)} />
                  <p className="text-[11px] text-muted-foreground">
                    JSON array of {"{"}instruction, input, output{"}"} objects. question/answer keys are accepted too.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Agent (optional filter)</Label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                <option value="">All agents</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground">Each thumbs-up adds the user message as instruction and the agent reply as output.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || (source === "rows" && !uploaded && !rowsJson.trim())}>Create dataset</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
