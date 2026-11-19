import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Activity, ArrowRight, BookOpen, ChevronDown, CheckCircle2, Cloud, Cpu, Database, Download, ExternalLink, FileText, Globe,
  GraduationCap, Image as ImageIcon, KeyRound, Play, Plus, RotateCcw, Scale, Search, Server, Sparkles, Split, Trash2,
  TrendingDown, Video, Wand2, X,
} from "lucide-react";
import {
  api,
  type ConnectionState,
  type DatasetSource,
  type DatasetSourcePreview,
  type DatasetSourceResult,
  type MediaOptions,
  type MediaResult,
  type PlaygroundPreview,
  type PlaygroundResult,
  type TrainingJob,
  type TrainingProvider,
} from "@/lib/api";
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
import { ProviderKeys } from "@/components/common/ProviderKeys";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";
import type { TabId } from "@/components/layout/nav";

type DatasetUseTarget = "sources" | "jobs" | "knowledge" | "evals";

/* ───────────────────────── Shared building blocks ───────────────────────── */

const Field = ({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) => (
  <div className={cn("space-y-1.5", className)}>
    <Label>{label}</Label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const SELECT = "h-9 w-full rounded-lg border bg-background px-2 text-sm";
const ERR = "rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive";

/** A "how does this work?" panel that stays out of the way until someone wants it. */
function Explainer({ icon: Icon, title, steps, note }: {
  icon: typeof Cpu; title: string; steps: Array<{ title: string; body: string }>; note?: string;
}) {
  return (
    <details className="group rounded-2xl border bg-gradient-to-br from-primary/[0.06] to-transparent">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3.5 text-sm font-medium">
        <Icon className="h-4 w-4 text-primary" /> {title}
        <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
          How it works <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-3 px-3.5 pb-3.5">
        <ol className={cn("grid gap-2 sm:grid-cols-2", steps.length > 3 && "lg:grid-cols-4", steps.length === 3 && "lg:grid-cols-3")}>
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-xl border bg-background/60 p-2.5">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] text-primary">{i + 1}</span>
                {s.title}
              </div>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
        {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
      </div>
    </details>
  );
}

function RangeField({ label, hint, value, onChange, min, max, step, format }: {
  label: string; hint: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className="text-sm font-medium tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input type="range" aria-label={label} className="mt-2 w-full accent-primary" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

const STRENGTHS = [
  { label: "Quick test", epochs: 1, hint: "One pass. Fast, good for checking that everything works." },
  { label: "Balanced", epochs: 3, hint: "Three passes. A sensible starting point." },
  { label: "Thorough", epochs: 6, hint: "Six passes. Learns more, takes longer, can over-memorise." },
];

function StrengthPicker({ epochs, onEpochs }: { epochs: number; onEpochs: (n: number) => void }) {
  const active = STRENGTHS.find((s) => s.epochs === epochs);
  return (
    <div className="space-y-1.5">
      <Label>How much practice?</Label>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
        {STRENGTHS.map((s) => (
          <button key={s.label} type="button" role="radio" aria-checked={epochs === s.epochs} onClick={() => onEpochs(s.epochs)}
            className={cn("rounded-xl border p-2.5 text-left text-sm font-medium transition-colors", epochs === s.epochs ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{active?.hint ?? `Custom: ${epochs} passes over your examples.`}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function Sparkline({ data }: { data: { step: number; loss: number }[] }) {
  const W = 480, H = 90, PAD = 6;
  const xs = data.map((d) => d.step), ys = data.map((d) => d.loss);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = maxX - minX || 1, dy = maxY - minY || 1;
  const pts = data.map((d) => ({
    x: PAD + ((d.step - minX) / dx) * (W - 2 * PAD),
    y: H - PAD - ((d.loss - minY) / dy) * (H - 2 * PAD),
    step: d.step, loss: d.loss,
  }));
  const line = pts.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className="rounded-xl border bg-muted/20 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full text-primary" role="img" aria-label={`Mistakes fell from ${ys[0].toFixed(2)} to ${ys[ys.length - 1].toFixed(2)}`}>
        <polygon points={`${PAD},${H - PAD} ${line} ${last.x},${H - PAD}`} fill="currentColor" opacity="0.08" />
        <polyline fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" points={line} />
        <circle cx={last.x} cy={last.y} r={3.5} fill="currentColor" />
        {pts.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={6} fill="transparent"><title>{`step ${c.step}: loss ${c.loss.toFixed(4)}`}</title></circle>
        ))}
      </svg>
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export function Training({ onOpenTab }: { onOpenTab?: (tab: TabId) => void }) {
  const [tab, setTab] = useState("playground");
  const openTab = (target: DatasetUseTarget) => {
    if (target === "sources" || target === "jobs") setTab(target);
    else onOpenTab?.(target);
  };
  return (
    <div>
      <PageHeader icon={GraduationCap} title="Training"
        description="Teach a model your way of answering. Start with the free practice area, then bring your own examples and train for real." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start rounded-xl p-1">
          <TabsTrigger value="playground">Practice</TabsTrigger>
          <TabsTrigger value="jobs">Training runs</TabsTrigger>
          <TabsTrigger value="datasets">Examples</TabsTrigger>
          <TabsTrigger value="sources">Find data</TabsTrigger>
          <TabsTrigger value="generate">Images and video</TabsTrigger>
          <TabsTrigger value="providers">Services</TabsTrigger>
          <TabsTrigger value="colab">Free GPU</TabsTrigger>
        </TabsList>
        <TabsContent value="playground" className="mt-4"><Playground /></TabsContent>
        <TabsContent value="jobs" className="mt-4"><Jobs /></TabsContent>
        <TabsContent value="datasets" className="mt-4"><Datasets onOpenTab={openTab} /></TabsContent>
        <TabsContent value="sources" className="mt-4"><Sources onOpenDatasets={() => setTab("datasets")} /></TabsContent>
        <TabsContent value="generate" className="mt-4"><Generate /></TabsContent>
        <TabsContent value="providers" className="mt-4"><Providers onOpenTab={setTab} /></TabsContent>
        <TabsContent value="colab" className="mt-4"><ColabPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────────────────────── Practice ───────────────────────── */

const EXPLAINER = [
  { title: "Your examples", body: "A few approved replies. This is what the model studies." },
  { title: "It guesses", body: "A tiny model starts out knowing nothing and guesses the next word." },
  { title: "It checks its mistakes", body: "The more surprised it is by your text, the bigger the mistake score." },
  { title: "It improves", body: "Small adjustments lower the mistake score, round after round." },
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
        setCorpus(info.corpus); setExampleCorpus(info.corpus);
        setEpochs(info.defaults.epochs); setLr(info.defaults.learning_rate);
        setTemperature(info.defaults.temperature); setPrefix(info.defaults.prefix);
      })
      .catch((e: any) => toast.push(e.message, "error"));
  }, []);

  async function run() {
    setErr(null);
    try { setResult(await api.runTrainingPlayground({ corpus, epochs, learning_rate: lr, temperature, prefix })); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-4">
      <Explainer icon={Cpu} title="Watch a model learn, in a split second" steps={EXPLAINER}
        note="Real training repeats this same loop across billions of settings, which is why it needs GPUs. Here it runs on this server in milliseconds with about 5,000 settings, so you can see what training does." />

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">What it studies</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Field label="Example sentences" hint="One per line. The model learns which word tends to follow which. Add your own approved replies to steer it.">
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => setCorpus(exampleCorpus)} disabled={!exampleCorpus || corpus === exampleCorpus}>
                  <RotateCcw className="h-3 w-3" /> Start over
                </Button>
              </div>
              <Textarea rows={8} className="text-sm" value={corpus} onChange={(e) => setCorpus(e.target.value)} />
            </Field>
            <Field label="Guess the word after"><Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="your" /></Field>
            <div className="grid gap-2 sm:grid-cols-3">
              <RangeField label="Practice rounds" hint="Passes over your examples." value={epochs} onChange={setEpochs} min={1} max={80} step={1} />
              <RangeField label="Learning speed" hint="Bigger steps learn faster but can overshoot." value={lr} onChange={setLr} min={0.1} max={5} step={0.1} />
              <RangeField label="Creativity" hint="How adventurous its word choices are." value={temperature} onChange={setTemperature} min={0.1} max={2} step={0.1} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Runs on the server. No GPU, no outside AI.</p>
              <AsyncButton onRun={run} disabled={!corpus.trim()}><Play /> Start practising</AsyncButton>
            </div>
            {err && <div role="alert" className={ERR}>{err}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">What it learned</CardTitle></CardHeader>
          <CardContent>
            {!result ? (
              <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Start practising to see its mistakes shrink and its guesses improve.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Words known" value={result.vocab_size} />
                  <Stat label="Settings" value={result.parameters.toLocaleString()} />
                  <Stat label="Mistake score" value={result.final_loss.toFixed(3)} />
                  <Stat label="Took" value={`${result.elapsed_ms} ms`} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <TrendingDown className="h-4 w-4 text-primary" />
                    Mistakes fell from {result.loss_series[0].loss.toFixed(2)} to {result.final_loss.toFixed(2)}
                  </div>
                  <Sparkline data={result.loss_series} />
                  <p className="text-xs text-muted-foreground">Lower is better. The model is less surprised by your examples each round.</p>
                </div>
                <Predictions title={`Most likely next word after “${result.prefix}”`} before={result.before} after={result.after} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <GenerationBox label="Before practice" text={result.before.generation} muted />
                  <GenerationBox label="After practice" text={result.after.generation} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Predictions({ title, before, after }: { title: string; before: PlaygroundPreview; after: PlaygroundPreview }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      {[{ label: "Before", data: before, tone: "bg-muted-foreground/40" }, { label: "After", data: after, tone: "bg-primary" }].map((row) => (
        <div key={row.label} className="space-y-1">
          <div className="text-xs text-muted-foreground">{row.label}</div>
          <div className="flex flex-wrap gap-1.5">
            {row.data.predictions.map((p) => (
              <div key={p.token} className="min-w-24 flex-1 rounded-lg border p-1.5">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{p.token}</span>
                  <span className="tabular-nums text-muted-foreground">{(p.p * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
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
    <div className={cn("rounded-xl border p-3", muted ? "bg-muted/30" : "border-primary/30 bg-primary/[0.04]")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm leading-relaxed">{text}</p>
    </div>
  );
}

/* ───────────────────────── Free GPU (Colab) ───────────────────────── */

const COLAB_STEPS = [
  { title: "Choose your examples", body: "Pick a set from the Examples tab and a starting model." },
  { title: "Download the notebook", body: "One file with your examples and settings built in." },
  { title: "Open it in Colab", body: "File, Upload notebook, then Runtime, Change runtime type, T4 GPU." },
  { title: "Press Run all", body: "It trains, compares before and after, and gives you the result to download." },
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
        setMode(d.mode); setBaseModel(d.base_model); setEpochs(d.epochs); setLr(d.learning_rate);
        setBs(d.batch_size); setGa(d.grad_accum); setSeq(d.max_seq_length);
      })
      .catch((e: any) => toast.push(e.message, "error"));
    api.listTrainingDatasets()
      .then((list) => { setDatasets(list); if (list.length) setDataset((cur) => cur || list[0].name); })
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
      a.href = url; a.download = `colab-${dataset}-${mode}.ipynb`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast.push("Notebook downloaded. Upload it in Colab and press Run all", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <div className="space-y-4">
      <Explainer icon={Cloud} title="Train on Google's free GPU, no hardware needed" steps={COLAB_STEPS}
        note="The notebook contains your examples and runs in your own Google account, so the examples leave this system. Use made-up or already-approved data only. Free sessions are time-limited and depend on availability." />

      <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Notebook settings</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FilterTabs value={mode} onChange={setMode} options={[{ id: "train", label: "Train a model" }, { id: "infer", label: "Just ask a question" }]} />
            <Field label="Examples to learn from" hint={rows != null ? `${rows} examples will go into the notebook.` : undefined}>
              <select value={dataset} onChange={(e) => setDataset(e.target.value)} className={SELECT}>
                {datasets.length === 0 && <option value="">No example sets yet. Create one in Examples</option>}
                {datasets.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.rows} examples)</option>)}
              </select>
            </Field>
            <Field label="Starting model" hint="Small models (0.5B to 1.5B) fit the free GPU. Bigger ones run out of memory.">
              <Input className="font-mono text-xs" value={baseModel} onChange={(e) => setBaseModel(e.target.value)} />
            </Field>
            <Field label="Test question (optional)" hint={mode === "train" ? "Used to compare the starting model with your trained version." : "The question the notebook will ask the model."}>
              <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Show me phones under 250,000 TZS" />
            </Field>
            {mode === "train" && (
              <>
                <StrengthPicker epochs={epochs} onEpochs={setEpochs} />
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Fine-tune the settings</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Learning speed"><Input type="number" step="0.00005" min={0.000001} max={0.01} value={lr} onChange={(e) => setLr(Number(e.target.value))} /></Field>
                    <Field label="Examples at once"><Input type="number" min={1} max={16} value={bs} onChange={(e) => setBs(Number(e.target.value))} /></Field>
                    <Field label="Steps before updating"><Input type="number" min={1} max={64} value={ga} onChange={(e) => setGa(Number(e.target.value))} /></Field>
                    <Field label="Longest example (tokens)"><Input type="number" min={128} max={4096} step={128} value={seq} onChange={(e) => setSeq(Number(e.target.value))} /></Field>
                  </div>
                </details>
              </>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground">This only makes a file. Nothing is trained or charged here.</p>
              <AsyncButton onRun={download} disabled={!dataset || !baseModel.trim()}><Download /> Download notebook</AsyncButton>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">What to expect</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">A small model learning from a few hundred examples usually finishes in 5 to 15 minutes. The first step installs tools and takes about 2 minutes.</p>
            <p className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">If Colab interrupts the run, upload the notebook again and press Run all.</p>
            <a href="https://colab.research.google.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Open Google Colab <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── Training runs ───────────────────────── */

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

  useEffect(() => {
    if (!data) return;
    if (!data.jobs.some((j) => j.status === "running" || j.status === "queued")) return;
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [data]);

  const counts = useMemo(() => {
    const jobs = data?.jobs ?? [];
    return { running: jobs.filter((j) => j.status === "running" || j.status === "queued").length, done: jobs.filter((j) => j.status === "completed").length };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Server} label="Training machine" value={data ? (data.runner_online ? "Ready" : "Not running") : "-"}
          tone={data?.runner_online ? "emerald" : "red"}
          hint={data && !data.runner_online ? "Start it with: docker compose --profile training up -d trainer" : "GPU is connected"} />
        <StatCard icon={Activity} label="In progress" value={data ? counts.running : "-"} tone="sky" hint="Running or waiting" />
        <StatCard icon={CheckCircle2} label="Finished" value={data ? counts.done : "-"} tone="violet" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Progress updates live while a run is going.</p>
        <Button onClick={() => setCreating(true)}><Plus /> Start a training run</Button>
      </div>

      {data === null ? <LoadingBlock rows={4} />
        : data.jobs.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No training runs yet" body="Pick one of your example sets and start teaching a model."
            action={<Button onClick={() => setCreating(true)}><Plus /> Start a training run</Button>} />
        ) : (
          <Card>
            <Table>
              <THead><TR><TH>Name</TH><TH>Status</TH><TH>Examples</TH><TH className="text-right">Mistake score</TH><TH>Progress</TH><TH className="text-right">Actions</TH></TR></THead>
              <TBody>
                {data.jobs.map((j) => (
                  <TR key={j.id} className="group">
                    <TD className="font-medium">{j.name}</TD>
                    <TD><StatusBadge value={j.status} /></TD>
                    <TD className="font-mono text-xs text-muted-foreground">{String(j.params.dataset || "-")}</TD>
                    <TD className="text-right tabular-nums">{j.progress?.loss?.toFixed(4) ?? "-"}</TD>
                    <TD className="min-w-28">
                      {j.progress?.percentage != null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.min(100, j.progress.percentage)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{j.progress.percentage.toFixed(0)}%</span>
                        </div>
                      ) : "-"}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setViewing(j)}>Details</Button>
                        {(j.status === "running" || j.status === "queued") && (
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelling(j)}>Stop</Button>
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
          title={`Stop ${cancelling.name}?`}
          description="Training is asked to stop. Progress saved so far is kept, but this run will not finish."
          confirmLabel="Stop run" destructive onClose={() => setCancelling(null)}
          onConfirm={async () => { await api.cancelTrainingJob(cancelling.id); toast.push("Stop requested", "success"); refresh(); }}
        />
      )}
    </div>
  );
}

const TEMPLATES = [
  ["qwen", "Qwen"], ["llama3", "Llama 3"], ["mistral", "Mistral"], ["gemma", "Gemma"], ["phi", "Phi"], ["chatml", "ChatML"], ["default", "Other / not sure"],
];

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
      await api.createTrainingJob({ name, dataset, base_model: baseModel, template, epochs, learning_rate: lr, batch_size: bs, grad_accum: ga, cutoff_len: cutoff });
      toast.push("Training run started", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start a training run</DialogTitle>
          <DialogDescription>The defaults suit a single small GPU. Most people only need to pick a name and their examples.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name this run"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="refunds-v1" /></Field>
            <Field label="Examples to learn from">
              <select value={dataset} onChange={(e) => setDataset(e.target.value)} className={SELECT}>
                <option value="">Choose a set…</option>
                {datasets.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.rows} examples)</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starting model"><Input className="font-mono text-xs" value={baseModel} onChange={(e) => setBaseModel(e.target.value)} /></Field>
            <Field label="Model family" hint="Pick the family your starting model belongs to.">
              <select value={template} onChange={(e) => setTemplate(e.target.value)} className={SELECT}>
                {TEMPLATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
          <StrengthPicker epochs={epochs} onEpochs={setEpochs} />
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">Fine-tune the settings</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Learning speed"><Input type="number" step="0.00001" value={lr} onChange={(e) => setLr(Number(e.target.value))} /></Field>
              <Field label="Examples at once"><Input type="number" min={1} value={bs} onChange={(e) => setBs(Number(e.target.value))} /></Field>
              <Field label="Steps before updating"><Input type="number" min={1} value={ga} onChange={(e) => setGa(Number(e.target.value))} /></Field>
              <Field label="Longest example (tokens)"><Input type="number" min={128} value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))} /></Field>
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || !dataset}>Start run</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobView({ job, onClose }: { job: TrainingJob; onClose: () => void }) {
  const [detail, setDetail] = useState<TrainingJob | null>(null);
  const [log, setLog] = useState("");
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
  const pct = detail?.progress?.percentage;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{job.name} <StatusBadge value={detail?.status || job.status} /></DialogTitle>
          <DialogDescription>Updates every few seconds while you watch.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {err && <div role="alert" className={ERR}>{err}</div>}
          <div className="space-y-1">
            <div className="flex justify-between text-sm"><span className="font-medium">Progress</span><span className="tabular-nums text-muted-foreground">{pct != null ? `${pct.toFixed(0)}%` : "Waiting to start"}</span></div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.min(100, pct ?? 0)}%` }} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Step" value={detail?.progress?.step ?? "-"} />
            <Stat label="Out of" value={detail?.progress?.total ?? "-"} />
            <Stat label="Mistake score" value={detail?.progress?.loss?.toFixed(4) ?? "-"} />
            <Stat label="Round" value={detail?.progress?.epoch?.toFixed(2) ?? "-"} />
          </div>
          {series.length > 1 && (
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Mistake score over time (lower is better)</div>
              <Sparkline data={series} />
            </div>
          )}
          <details className="rounded-xl border">
            <summary className="cursor-pointer p-3 text-sm font-medium">Technical log</summary>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t p-3 text-[11px] leading-relaxed">{log || "Nothing yet."}</pre>
          </details>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Examples (datasets) ───────────────────────── */

function Datasets({ onOpenTab }: { onOpenTab: (tab: DatasetUseTarget) => void }) {
  const [rows, setRows] = useState<Array<{ name: string; rows: number; updated_at: number }> | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const toast = useToast();

  const uses: Array<{ icon: typeof Cpu; title: string; body: string; action?: { label: string; onClick: () => void } }> = [
    { icon: Wand2, title: "Teach a model your style", body: "Pairs of question and ideal answer adapt an existing open model to your business.", action: { label: "Start a training run", onClick: () => onOpenTab("jobs") } },
    { icon: BookOpen, title: "Let agents look things up", body: "Turn text into searchable knowledge so agents answer with current facts, no retraining.", action: { label: "Open Knowledge", onClick: () => onOpenTab("knowledge") } },
    { icon: Activity, title: "Test before you launch", body: "Keep some examples aside to measure accuracy and reliability before customers see it.", action: { label: "Open Evaluations", onClick: () => onOpenTab("evals") } },
    { icon: Cpu, title: "Build from big public data", body: "Large public collections help train models from the ground up.", action: { label: "Find data", onClick: () => onOpenTab("sources") } },
    { icon: Sparkles, title: "Clean and organise", body: "Remove duplicates and fix formatting so training data is consistent.", action: { label: "New example set", onClick: () => setCreating(true) } },
    { icon: Scale, title: "Check the licence", body: "Make sure you may use a dataset in a paid product before you rely on it." },
    { icon: Split, title: "Split for fair testing", body: "Let the model learn from most examples, then test it on ones it has never seen." },
  ];

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
      a.href = url; a.download = `${name}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e: any) { toast.push(e.message, "error"); }
    finally { setDownloading(null); }
  }

  return (
    <div className="space-y-4">
      <Explainer icon={Database} title="Example sets: what the model learns from"
        steps={[
          { title: "Add examples", body: "Type questions with ideal answers, or upload a spreadsheet or file of them." },
          { title: "Or reuse feedback", body: "Every thumbs-up conversation becomes an example, optionally for one agent." },
          { title: "Train with them", body: "Pick the set when you start a training run." },
        ]}
        note="Keep answers final and consistent, and leave out customer details, passwords and secrets. A trained model can remember what it studied." />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Your question and answer collections, ready to train with.</p>
        <Button onClick={() => setCreating(true)}><Plus /> New example set</Button>
      </div>

      {rows === null ? <LoadingBlock rows={3} />
        : rows.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No example sets yet" body="Type a few examples, upload a file, or turn thumbs-up feedback into a set."
            action={<Button onClick={() => setCreating(true)}><Plus /> New example set</Button>} />
        ) : (
          <Card>
            <Table>
              <THead><TR><TH>Name</TH><TH className="text-right">Examples</TH><TH>Updated</TH><TH className="text-right">Actions</TH></TR></THead>
              <TBody>
                {rows.map((d) => (
                  <TR key={d.name} className="group">
                    <TD className="font-mono text-sm">{d.name}</TD>
                    <TD className="text-right tabular-nums">{d.rows}</TD>
                    <TD className="text-xs text-muted-foreground">{fmtDate(new Date(d.updated_at * 1000).toISOString())}</TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => download(d.name)} disabled={downloading === d.name}><Download /> {downloading === d.name ? "…" : "Download"}</Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" aria-label={`Delete ${d.name}`} onClick={() => setDeleting(d.name)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}

      <details className="group rounded-2xl border">
        <summary className="flex cursor-pointer list-none items-center justify-between p-3.5 text-sm font-medium">
          What can example sets be used for?
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-2 px-3.5 pb-3.5 sm:grid-cols-2">
          {uses.map(({ icon: Icon, title, body, action }) => (
            <div key={title} className="flex gap-2.5 rounded-xl border bg-muted/20 p-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{title}</div>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{body}</p>
                {action && (
                  <button type="button" onClick={action.onClick} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {action.label} <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>

      {creating && <CreateDataset onClose={() => { setCreating(false); refresh(); }} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting}?`}
          description="The example set is removed. Finished training runs are not affected, but any run that is waiting or running with it must be stopped first."
          confirmLabel="Delete example set" destructive onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.deleteTrainingDataset(deleting); toast.push("Example set deleted", "success"); refresh(); }}
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
  throw new Error("expected a list of examples");
}

function parseCsv(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
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
    raw = text.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => {
      try { return JSON.parse(line); } catch { throw new Error(`line ${i + 1} could not be read`); }
    });
  } else if (ext === "json") {
    raw = rowsFromJson(text);
  } else if (ext === "csv") {
    const grid = parseCsv(text);
    if (grid.length < 2) throw new Error("the spreadsheet needs a header row and at least one example");
    const header = grid[0].map((h) => h.trim().toLowerCase());
    const column = (...names: string[]) => names.map((n) => header.indexOf(n)).find((idx) => idx >= 0) ?? -1;
    const iInstruction = column("instruction", "question", "prompt");
    const iInput = column("input", "context");
    const iOutput = column("output", "answer", "response");
    if (iInstruction < 0 || iOutput < 0) throw new Error("it needs a question column and an answer column");
    raw = grid.slice(1).map((cells) => ({ instruction: cells[iInstruction], input: iInput >= 0 ? cells[iInput] : "", output: cells[iOutput] }));
  } else {
    throw new Error("use a .csv, .json or .jsonl file");
  }
  if (raw.length > MAX_UPLOAD_ROWS) throw new Error(`it has ${raw.length} examples; the limit is ${MAX_UPLOAD_ROWS}`);
  const normalized = raw.map(normalizeRow);
  const rows = normalized.filter((r): r is DatasetRow => r !== null);
  return { rows, skipped: normalized.length - rows.length };
}

const BLANK_ROW: DatasetRow = { instruction: "", input: "", output: "" };

function CreateDataset({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"rows" | "feedback">("rows");
  const [typed, setTyped] = useState<DatasetRow[]>([{ ...BLANK_ROW }]);
  const [uploaded, setUploaded] = useState<{ name: string; rows: DatasetRow[]; skipped: number } | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const toast = useToast();

  useEffect(() => { api.listAgents().then(setAgents).catch(() => {}); }, []);

  const usableTyped = typed.filter((r) => r.instruction.trim() && r.output.trim());
  const setRow = (i: number, p: Partial<DatasetRow>) => setTyped((rows) => rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileErr(null);
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("the file is larger than 5 MB");
      const { rows, skipped } = parseDatasetFile(file.name, await file.text());
      if (!rows.length) throw new Error("no usable examples. Each one needs a question and an answer");
      setUploaded({ name: file.name, rows, skipped });
      toast.push(`Loaded ${rows.length} examples from ${file.name}`, "success");
    } catch (err: any) {
      setUploaded(null);
      setFileErr(`Could not read ${file.name}: ${err.message ?? err}`);
    }
  }

  async function save() {
    try {
      const body: any = { name, source };
      if (source === "rows") body.rows = uploaded ? uploaded.rows : usableTyped.map((r) => ({ instruction: r.instruction.trim(), input: r.input.trim(), output: r.output.trim() }));
      else body.agent_id = agentId || undefined;
      await api.createTrainingDataset(body);
      toast.push("Example set created", "success"); onClose();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New example set</DialogTitle>
          <DialogDescription>Type your examples, upload a file, or turn thumbs-up feedback into examples.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" hint="Letters, numbers, - and _ only (up to 64).">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="refunds-v1" />
          </Field>
          <FilterTabs value={source} onChange={setSource} options={[{ id: "rows", label: "Add examples" }, { id: "feedback", label: "From thumbs-up feedback" }]} />

          {source === "rows" ? (
            <div className="space-y-4">
              <Field label="Upload a file" hint="A spreadsheet (.csv) or .json/.jsonl file with a question column and an answer column.">
                <input type="file" accept=".json,.jsonl,.ndjson,.csv,application/json,text/csv" onChange={onFile}
                  className="block w-full cursor-pointer rounded-lg border bg-background text-xs text-muted-foreground file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted/80" />
              </Field>
              {fileErr && <div role="alert" className={ERR}>{fileErr}</div>}

              {uploaded ? (
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5 font-medium"><FileText className="h-4 w-4 text-primary" /> {uploaded.name}</span>
                    <span className="text-muted-foreground">{uploaded.rows.length} examples{uploaded.skipped ? `, ${uploaded.skipped} skipped` : ""}</span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {uploaded.rows.slice(0, 2).map((r, i) => (
                      <li key={i} className="rounded-lg border bg-background/60 p-2 text-xs"><span className="font-medium">{r.instruction}</span><span className="text-muted-foreground"> {"→"} {r.output}</span></li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setTyped(uploaded.rows.slice(0, 200)); setUploaded(null); }}>Edit them here</Button>
                    <Button size="sm" variant="ghost" onClick={() => setUploaded(null)}><X /> Remove file</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Or type your examples</Label>
                  {typed.map((r, i) => (
                    <div key={i} className="space-y-2 rounded-xl border p-3">
                      <div className="flex items-start gap-2">
                        <div className="grid flex-1 gap-2 sm:grid-cols-2">
                          <Textarea rows={2} dir="auto" value={r.instruction} onChange={(e) => setRow(i, { instruction: e.target.value })} placeholder="What the customer asks" aria-label="Question" />
                          <Textarea rows={2} dir="auto" value={r.output} onChange={(e) => setRow(i, { output: e.target.value })} placeholder="The ideal answer" aria-label="Answer" />
                        </div>
                        {typed.length > 1 && (
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Remove example" onClick={() => setTyped(typed.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">Add background information (optional)</summary>
                        <Input className="mt-2 text-sm" dir="auto" value={r.input} onChange={(e) => setRow(i, { input: e.target.value })} placeholder="Extra context the answer depends on" />
                      </details>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setTyped([...typed, { ...BLANK_ROW }])}><Plus /> Add another</Button>
                    <span className="text-xs text-muted-foreground">{usableTyped.length} ready</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Field label="Which agent?" hint="Each thumbs-up becomes one example: the customer's message and the agent's reply.">
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={SELECT}>
                <option value="">All agents</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name || (source === "rows" && !uploaded && usableTyped.length === 0)}>Create example set</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Shared status pill ───────────────────────── */

const STATE_TONE: Record<string, string> = {
  connected: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  needs_key: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  browse: "border-slate-400/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};
const STATE_DOT: Record<string, string> = { connected: "bg-emerald-500", ready: "bg-emerald-500", needs_key: "bg-amber-500", browse: "bg-slate-400" };

function StatePill({ connection }: { connection: ConnectionState }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", STATE_TONE[connection.state])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", STATE_DOT[connection.state])} />
      {connection.label}
    </span>
  );
}

/* ───────────────────────── Find data ───────────────────────── */

function Sources({ onOpenDatasets }: { onOpenDatasets: () => void }) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<DatasetSource[] | null>(null);
  const [browsing, setBrowsing] = useState<DatasetSource | null>(null);
  const [helping, setHelping] = useState<DatasetSource | null>(null);

  useEffect(() => {
    api.listDatasetSources().then((res) => setCatalog(res.sources)).catch((e: any) => { toast.push(e.message, "error"); setCatalog([]); });
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-gradient-to-br from-primary/[0.06] to-transparent p-3.5">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Database className="h-4 w-4 text-primary" /> Find public data to learn from</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { tone: "connected", title: "Connected", body: "Search, preview and import right here." },
            { tone: "needs_key", title: "Key needed", body: "Add the listed key to unlock search or downloads." },
            { tone: "browse", title: "Browse only", body: "Open the site, download a file, then upload it under Examples." },
          ].map((s) => (
            <div key={s.title} className="rounded-xl border bg-background/60 p-2.5">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", STATE_TONE[s.tone])}>
                <span className={cn("h-1.5 w-1.5 rounded-full", STATE_DOT[s.tone])} /> {s.title}
              </span>
              <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Imported data is copied into your own system. Check the licence and remove personal details first.</p>
      </div>

      {catalog === null ? <LoadingBlock rows={4} /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.map((s) => <SourceCard key={s.id} source={s} onBrowse={() => setBrowsing(s)} onHelp={() => setHelping(s)} />)}
        </div>
      )}
      {browsing && <SourceBrowser source={browsing} onClose={() => setBrowsing(null)} onOpenDatasets={onOpenDatasets} />}
      {helping && <SourceHelp source={helping} onClose={() => setHelping(null)} />}
    </div>
  );
}

function SourceCard({ source, onBrowse, onHelp }: { source: DatasetSource; onBrowse: () => void; onHelp: () => void }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{source.name}</CardTitle>
          <StatePill connection={source.connection} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2.5">
        <p className="text-xs leading-snug text-muted-foreground">{source.about}</p>
        <div className="flex flex-wrap gap-1">
          {source.modalities.map((m) => <span key={m} className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] capitalize text-muted-foreground">{m}</span>)}
        </div>
        <p className="rounded-lg bg-muted/30 p-2 text-xs leading-snug text-muted-foreground">{source.connection.detail}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {source.searchable ? (
            <Button size="sm" onClick={onBrowse}><Search /> Search and import</Button>
          ) : (
            <Button size="sm" variant="outline" asChild><a href={source.url} target="_blank" rel="noreferrer"><Globe /> Open site</a></Button>
          )}
          <Button size="sm" variant="ghost" onClick={onHelp}><BookOpen /> Help</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SourceHelp({ source, onClose }: { source: DatasetSource; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{source.name} <StatePill connection={source.connection} /></DialogTitle>
          <DialogDescription>{source.connection.detail}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground">{source.how.map((step) => <li key={step}>{step}</li>)}</ol>
          {source.needs.length > 0 && (
            <div className="rounded-xl border bg-muted/20 p-3 text-xs">
              <span className="inline-flex items-center gap-1 font-medium"><KeyRound className="h-3.5 w-3.5" /> Keys to add on the server</span>
              <div className="mt-1.5 flex flex-wrap gap-1">{source.needs.map((n) => <code key={n} className="rounded bg-muted px-1.5 py-0.5">{n}</code>)}</div>
            </div>
          )}
          {source.links?.length ? (
            <div className="space-y-1 text-sm">
              {source.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">{l.label} <ExternalLink className="h-3 w-3" /></a>)}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" asChild><a href={source.url} target="_blank" rel="noreferrer">Open {source.name} <ExternalLink /></a></Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sourceName(id: string): string {
  const tail = id.split("/").filter(Boolean).pop() || "dataset";
  return tail.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "dataset";
}

function SourceBrowser({ source, onClose, onOpenDatasets }: { source: DatasetSource; onClose: () => void; onOpenDatasets: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [note, setNote] = useState("");
  const [results, setResults] = useState<DatasetSourceResult[]>([]);
  const [selected, setSelected] = useState<DatasetSourceResult | null>(null);
  const [preview, setPreview] = useState<DatasetSourcePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [output, setOutput] = useState("");
  const [limit, setLimit] = useState(500);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ name: string; rows: number; skipped: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function runSearch(query?: string) {
    const term = (query ?? q).trim();
    setBusy(true); setErr(null); setSelected(null); setPreview(null); setDone(null);
    try {
      const res = await api.searchDatasetSource(source.id, term);
      setResults(res.results); setNote(res.note); setSearched(true);
    } catch (e: any) { setErr(e.message); setResults([]); setSearched(true); setNote(""); }
    finally { setBusy(false); }
  }

  async function pick(r: DatasetSourceResult) {
    setSelected(r); setPreview(null); setDone(null); setErr(null);
    setName(sourceName(r.id));
    if (!source.previewable) return;
    setPreviewing(true);
    try {
      const p = await api.previewDatasetSource(source.id, r.id, 8);
      setPreview(p); setInstruction(p.suggested.instruction); setOutput(p.suggested.output);
    } catch (e: any) { setErr(e.message); }
    finally { setPreviewing(false); }
  }

  async function doImport() {
    if (!selected) return;
    if (!name.trim()) { setErr("Give the example set a name."); return; }
    setImporting(true); setErr(null);
    try {
      const res = await api.importDatasetSource({ source: source.id, dataset: selected.id, name: name.trim(), instruction_field: instruction || undefined, output_field: output || undefined, limit });
      setDone(res);
      toast.push(`Imported ${res.rows} examples from ${source.name}`, "success");
    } catch (e: any) { setErr(e.message); }
    finally { setImporting(false); }
  }

  const empty = (text: string) => <div className="flex h-64 items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{source.name} <StatePill connection={source.connection} /></DialogTitle>
          <DialogDescription>{source.connection.detail} Pick a result, look at a few rows, then import.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder={source.id === "uci" ? "Search the classics (leave empty to see all)" : "Search by topic or name"} />
            <AsyncButton onRun={() => runSearch()}><Search /> Search</AsyncButton>
          </div>
          {source.examples.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Try:
              {source.examples.map((ex) => (
                <button key={ex} type="button" onClick={() => { setQ(ex); runSearch(ex); }} className="rounded-full border px-2.5 py-0.5 transition-colors hover:bg-muted">{ex}</button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="min-h-64 space-y-2">
            {busy ? <LoadingBlock rows={4} /> : !searched ? empty(`Results from ${source.name} appear here.`)
              : results.length === 0 ? empty(`No matches. ${note}`) : (
                <>
                  {note && <p className="text-xs text-muted-foreground">{note}</p>}
                  <div className="max-h-[46vh] space-y-1.5 overflow-auto pr-1">
                    {results.map((r) => (
                      <button key={r.id} type="button" onClick={() => pick(r)}
                        className={cn("w-full rounded-xl border p-2.5 text-left transition-colors hover:bg-muted/40", selected?.id === r.id && "border-primary/50 bg-primary/[0.04]")}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{r.title}</span>
                          {r.flag && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">{r.flag}</span>}
                        </div>
                        {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          {r.meta.map((m) => <span key={m.label}>{m.label}: {m.value}</span>)}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
          </div>

          <div className="min-h-64 space-y-2">
            {err && <div role="alert" className={ERR}>{err}</div>}
            {done ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
                <div className="flex items-center gap-1.5 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Your example set is ready</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-mono">{done.name}</span> has {done.rows} examples{done.skipped ? `, and ${done.skipped} were skipped for missing a column` : ""}.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" onClick={() => { onClose(); onOpenDatasets(); }}>See your examples <ArrowRight /></Button>
                  {selected?.url && <Button size="sm" variant="ghost" asChild><a href={selected.url} target="_blank" rel="noreferrer">Source page <ExternalLink /></a></Button>}
                </div>
              </div>
            ) : !selected ? empty(`Pick a result to look at it${source.previewable ? " and match its columns" : ""}.`)
              : !source.previewable ? (
                <div className="space-y-2 rounded-xl border p-3">
                  <div className="text-sm font-medium">{selected.title}</div>
                  <p className="text-xs leading-snug text-muted-foreground">This source can't be imported directly. {source.how.slice(1).join(", then ")}.</p>
                  <Button size="sm" variant="outline" asChild><a href={selected.url} target="_blank" rel="noreferrer">Open dataset <ExternalLink /></a></Button>
                </div>
              ) : previewing ? <LoadingBlock rows={4} /> : preview ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium">{selected.title}</div>
                    <span className="text-xs text-muted-foreground">{preview.detail}</span>
                  </div>
                  <div className="overflow-auto rounded-xl border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>{preview.fields.slice(0, 4).map((f) => <th key={f} className="whitespace-nowrap px-2 py-1 font-medium">{f}</th>)}</tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, 4).map((row, i) => (
                          <tr key={i} className="border-t">
                            {preview.fields.slice(0, 4).map((f) => <td key={f} className="max-w-40 truncate px-2 py-1 text-muted-foreground">{row[f] || "-"}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">{preview.note}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Column with the question">
                      <select value={instruction} onChange={(e) => setInstruction(e.target.value)} className={SELECT}>
                        <option value="">Choose…</option>
                        {preview.fields.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </Field>
                    <Field label="Column with the answer">
                      <select value={output} onChange={(e) => setOutput(e.target.value)} className={SELECT}>
                        <option value="">Choose…</option>
                        {preview.fields.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </Field>
                    <Field label="Name for your set"><Input className="font-mono text-xs" value={name} onChange={(e) => setName(e.target.value)} /></Field>
                    <Field label="How many examples"><Input type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></Field>
                  </div>
                  <div className="flex justify-end pt-1">
                    <AsyncButton onRun={doImport} disabled={importing || !name.trim() || !instruction || !output || instruction === output}><Download /> Import examples</AsyncButton>
                  </div>
                </div>
              ) : empty(`No preview available. ${source.connection.detail}`)}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Services (providers) ───────────────────────── */

const PROVIDER_ICON: Record<string, typeof Cpu> = { colab: Cloud, kaggle: Database, huggingface: Sparkles, cerebras: Cpu };

function Providers({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<TrainingProvider[] | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, { detail: string; models?: string[] }>>({});

  useEffect(() => {
    api.listTrainingProviders().then((res) => setItems(res.providers)).catch((e: any) => { toast.push(e.message, "error"); setItems([]); });
  }, []);

  async function check(id: string) {
    setChecking(id);
    try {
      const res = await api.checkTrainingProvider(id);
      setChecks((c) => ({ ...c, [id]: { detail: res.detail, models: res.models } }));
      toast.push(res.detail, "success");
    } catch (e: any) { toast.push(e.message, "error"); }
    finally { setChecking(null); }
  }

  return (
    <div className="space-y-4">
      <ProviderKeys page="training" />
      <p className="max-w-3xl text-sm text-muted-foreground">
        Where training and models can run. Colab and Kaggle use the same downloadable notebook, Hugging Face supplies data and starting models, and Cerebras gives fast answers without a GPU.
      </p>

      {items === null ? <LoadingBlock rows={4} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((p) => {
            const Icon = PROVIDER_ICON[p.id] || Server;
            const checked = checks[p.id];
            return (
              <Card key={p.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
                      <div>
                        <CardTitle className="text-sm">{p.name}</CardTitle>
                        <p className="text-xs text-muted-foreground">{p.kind}</p>
                      </div>
                    </div>
                    <StatePill connection={p.connection} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-2.5">
                  <p className="text-sm leading-relaxed text-muted-foreground">{p.summary}</p>
                  <p className="rounded-lg bg-muted/30 p-2 text-xs text-muted-foreground">{p.connection.detail}</p>
                  {p.needs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5" /> Needs:
                      {p.needs.map((n) => <code key={n} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{n}</code>)}
                    </div>
                  )}
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">Setup steps</summary>
                    <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">{p.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  </details>
                  {checked && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-2 text-xs">
                      <span className="inline-flex items-center gap-1 font-medium"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> {checked.detail}</span>
                      {checked.models?.length ? <div className="mt-1 flex flex-wrap gap-1">{checked.models.slice(0, 6).map((m) => <code key={m} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{m}</code>)}</div> : null}
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                    {p.action === "colab" && <Button size="sm" onClick={() => onOpenTab("colab")}>Open free GPU page</Button>}
                    {p.action === "notebook" && <Button size="sm" onClick={() => onOpenTab("colab")}>Get the notebook</Button>}
                    {p.action === "sources" && <Button size="sm" onClick={() => onOpenTab("sources")}>Find data</Button>}
                    {p.action === "check" && <AsyncButton onRun={() => check(p.id)} disabled={checking === p.id || p.connection.state !== "ready"}>Test the connection</AsyncButton>}
                    <Button size="sm" variant="ghost" asChild><a href={p.url} target="_blank" rel="noreferrer">Website <ExternalLink /></a></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Images and video ───────────────────────── */

const IDEAS: Record<"image" | "video", string[]> = {
  image: ["A market stall at golden hour, warm light, photorealistic", "A friendly bank teller helping a customer, flat illustration", "Dhow boats at sunrise off Zanzibar, watercolour"],
  video: ["Waves rolling onto a white sand beach at sunset", "A busy street market, slow pan across colourful fabrics", "A phone screen showing a mobile payment succeeding"],
};

function Generate() {
  const toast = useToast();
  const [options, setOptions] = useState<MediaOptions | null>(null);
  const [kind, setKind] = useState<"image" | "video">("image");
  const [provider, setProvider] = useState("sample");
  const [prompt, setPrompt] = useState(IDEAS.image[0]);
  const [size, setSize] = useState("1024x1024");
  const [duration, setDuration] = useState(4);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MediaResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.getMediaOptions().then(setOptions).catch((e: any) => toast.push(e.message, "error")); }, []);

  const list = (kind === "image" ? options?.image : options?.video) || [];
  const active = list.find((p) => p.id === provider) || list[0];

  useEffect(() => { if (list.length && !list.some((p) => p.id === provider)) setProvider(list[0].id); }, [kind, options]);

  async function run() {
    setErr(null); setBusy(true);
    try { setResult(await api.generateMedia({ kind, provider: active?.id || "sample", prompt, size, duration })); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Describe a picture or a short clip and see it appear. Results are made by AI, so check them before showing customers, and keep personal details out of your description.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">What should we make?</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FilterTabs value={kind} onChange={(v) => { setKind(v); setResult(null); setPrompt(IDEAS[v][0]); }} options={[{ id: "image", label: "Image" }, { id: "video", label: "Video" }]} />
            <Field label="Describe it" hint="Mention the scene, style and lighting.">
              <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A market stall at golden hour…" />
            </Field>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Ideas:</span>
              {IDEAS[kind].map((s) => <button key={s} type="button" onClick={() => setPrompt(s)} className="max-w-full truncate rounded-full border px-2.5 py-0.5 transition-colors hover:bg-muted/50">{s.split(",")[0]}</button>)}
            </div>
            <Field label="Made by" hint={active ? `${active.about} ${active.configured ? "" : `To use the real service, add ${active.needs.join(", ")} on the server.`}${active.id !== "sample" && active.configured ? ` Model: ${active.model}.` : ""}` : undefined}>
              <select value={active?.id || "sample"} onChange={(e) => { setProvider(e.target.value); setResult(null); }} className={SELECT}>
                {list.map((p) => <option key={p.id} value={p.id}>{p.name}, {p.note}</option>)}
              </select>
            </Field>
            {kind === "image" ? (
              <Field label="Size">
                <select value={size} onChange={(e) => setSize(e.target.value)} className={SELECT}>
                  {(options?.sizes || ["1024x1024"]).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Length">
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={SELECT}>
                  {(options?.durations || [4, 6, 8]).map((d) => <option key={d} value={d}>{d} seconds</option>)}
                </select>
              </Field>
            )}
            {err && <div role="alert" className={ERR}>{err}</div>}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground">Nothing is saved. The result appears here.</p>
              <AsyncButton onRun={run} disabled={busy || prompt.trim().length < 3}><Sparkles /> Make the {kind}</AsyncButton>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Result</CardTitle>
              {result && (
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", result.sample ? STATE_TONE.browse : STATE_TONE.connected)}>
                  {result.sample ? "Sample preview" : `Made by ${result.provider}`}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {busy ? (
              <div className="flex min-h-72 items-center justify-center gap-1.5" aria-live="polite" aria-label="Working">
                {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms` }} />)}
              </div>
            ) : !result ? (
              <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                <div className="space-y-2">
                  {kind === "image" ? <ImageIcon className="mx-auto h-6 w-6 opacity-50" /> : <Video className="mx-auto h-6 w-6 opacity-50" />}
                  <p>Your {kind} will appear here.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {result.mime.startsWith("video/") ? (
                  <video controls src={result.data_url} className="w-full rounded-xl border" />
                ) : result.frames.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {result.frames.map((f, i) => (
                      <div key={i} className="relative overflow-hidden rounded-lg border">
                        <img src={f} alt={`Frame ${i + 1}`} className="block w-full" />
                        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white">{i + 1} of 4</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <img src={result.data_url} alt={result.prompt} className="w-full rounded-xl border" />
                )}
                <p className="text-xs leading-snug text-muted-foreground">{result.note}</p>
                <p className="text-xs text-muted-foreground">Made with {result.model} in {result.elapsed_ms} ms.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}