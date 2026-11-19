import type { ReactNode } from "react";
import { Activity, Bot, Boxes, Cpu, FlaskConical, GraduationCap, KeyRound, LibraryBig, Network, Play, Server, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { TabId } from "@/components/layout/nav";
import { cn } from "@/lib/utils";

export type ModelSection = "registry" | "ollama" | "playground" | "playbook" | "keys";

type Support = "builtin" | "compatible" | "other";

const SUPPORT_LABEL: Record<Support, string> = {
  builtin: "Built in",
  compatible: "OpenAI-compatible",
  other: "Other stacks",
};

function Tag({ state, children }: { state: Support; children: React.ReactNode }) {
  return (
    <span className={cn(
      "rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
      state === "builtin" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      state === "compatible" && "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      state === "other" && "bg-muted text-muted-foreground",
    )}>
      {children}
    </span>
  );
}

function ChipLink({ icon: Icon, children, onClick, title }: {
  icon: LucideIcon;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <Icon className="h-3 w-3" /> {children}
    </button>
  );
}

/** Strip under the header: one registry, many consumers. */
export function ModelConnections({ onOpenTab, onOpenSection }: {
  onOpenTab?: (tab: TabId) => void;
  onOpenSection: (section: ModelSection) => void;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Network className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">One registry, used across the console</div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              Register an endpoint once. Agents and workflows call it, evaluations score it, training produces new ones, and the playground tries it before anything ships.
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 sm:pl-12">
          <ChipLink icon={Bot} onClick={() => onOpenTab?.("agents")} title="Agents that use these models">Agents</ChipLink>
          <ChipLink icon={Workflow} onClick={() => onOpenTab?.("workflows")} title="Workflows whose agent steps run on these models">Workflows</ChipLink>
          <ChipLink icon={FlaskConical} onClick={() => onOpenTab?.("evals")} title="Score a model with evaluation datasets">Evaluations</ChipLink>
          <ChipLink icon={GraduationCap} onClick={() => onOpenTab?.("training")} title="Fine-tune and register a new model">Training</ChipLink>
          <ChipLink icon={LibraryBig} onClick={() => onOpenTab?.("knowledge")} title="Knowledge collections pair an embedding model with retrieval">Knowledge</ChipLink>
          <ChipLink icon={Activity} onClick={() => onOpenTab?.("observability")} title="Latency, tokens and cost by model">Observability</ChipLink>
          <ChipLink icon={Play} onClick={() => onOpenSection("playground")} title="Prompt any registered model">Playground</ChipLink>
          <ChipLink icon={KeyRound} onClick={() => onOpenSection("keys")} title="Bring your own provider keys">API keys</ChipLink>
        </div>
      </CardContent>
    </Card>
  );
}

const SIZE_CLASSES = [
  {
    icon: Cpu,
    title: "Small and fast · 1B–9B",
    models: "Llama 3.2 3B · Qwen 2.5 7B · Gemma 2 9B",
    body: "Runs on a laptop or a free cloud GPU and handles chat, code and retrieval well.",
  },
  {
    icon: Server,
    title: "Medium and reasoning · 14B–32B",
    models: "Qwen 2.5 32B · DeepSeek-R1 distillations",
    body: "Near-frontier reasoning on one mid-range GPU such as an L4 or A10G.",
  },
  {
    icon: Boxes,
    title: "Vision and audio",
    models: "Whisper · YOLO · Flux / Stable Diffusion",
    body: "Small enough to train and host locally, or on low-cost serverless GPUs.",
  },
];

const TRAINING_OPTIONS = [
  {
    name: "Local, free on your GPU",
    note: "LoRA / QLoRA with Unsloth or Axolotl cuts memory use by roughly 70%, so a 7–8B model fits an 8–16GB consumer card.",
    tag: "No API fees",
  },
  {
    name: "Free cloud notebooks",
    note: "Unsloth notebooks run on Google Colab's free T4 or on Kaggle, which includes 30+ GPU hours a week.",
    tag: "Colab · Kaggle",
  },
  {
    name: "Rented GPUs by the second",
    note: "RunPod, Vast.ai or Lambda when a run must finish faster — roughly $0.20–$0.70 per GPU-hour.",
    tag: "On demand",
  },
];

const LOCAL_ENGINES = [
  { name: "Ollama", note: "Pull and serve quantised models with one command; exposes an OpenAI-style API.", state: "builtin" as Support },
  { name: "LM Studio", note: "Desktop app with a local OpenAI-compatible server.", state: "compatible" as Support },
  { name: "llama.cpp", note: "GGUF models on CPU and Apple Silicon, no NVIDIA GPU required.", state: "compatible" as Support },
];

const CLOUD_APIS = [
  { name: "Google AI Studio", note: "Gemini models with a free tier for experimentation.", state: "builtin" as Support },
  { name: "Groq", note: "Very fast inference on open-weights models.", state: "builtin" as Support },
  { name: "Cerebras", note: "Very fast inference through an OpenAI-compatible endpoint.", state: "compatible" as Support },
  { name: "OpenRouter", note: "One API across many models, including free endpoints.", state: "builtin" as Support },
];

const HOSTING = [
  {
    option: "Self-hosted PC or local server",
    tools: "Ollama, vLLM + Cloudflare Tunnel",
    cost: "$0/month plus electricity. Strongest privacy; bounded by your hardware speed and uptime.",
  },
  {
    option: "Serverless GPU",
    tools: "Modal, RunPod Serverless, Replicate",
    cost: "$0 while idle — it scales to zero. Free credits on Modal; expect a cold start on the first request.",
  },
  {
    option: "Dedicated GPU VM",
    tools: "Vast.ai, Hugging Face Inference Endpoints",
    cost: "About $0.20–$1.00+/hour continuously. For steady traffic where cold starts are unacceptable.",
  },
];

type PathStep = { title: string; body: string; action: string; section?: ModelSection; tab?: TabId };

const PATH: PathStep[] = [
  {
    title: "Prototype locally",
    body: "Install Ollama, pull a small model and point a knowledge collection at it — free and private.",
    action: "Open Ollama",
    section: "ollama",
  },
  {
    title: "Fine-tune in the cloud",
    body: "When prompts and retrieval are not enough, fine-tune Qwen 2.5 7B with Unsloth on a free Colab T4.",
    action: "Open Training",
    tab: "training",
  },
  {
    title: "Host cheaply",
    body: "Export to Hugging Face, deploy on Modal or RunPod Serverless, then register the endpoint here.",
    action: "Register a model",
    section: "registry",
  },
];

function OptionList({ items }: { items: { name: string; note: string; state: Support }[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {items.map((item) => (
        <li key={item.name} className="flex items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="text-[13px] font-medium">{item.name}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">{item.note}</div>
          </div>
          <Tag state={item.state}>{SUPPORT_LABEL[item.state]}</Tag>
        </li>
      ))}
    </ul>
  );
}

/** Playbook tab: model families, fine-tuning, inference and hosting choices. */
export function ModelPlaybook({ onOpenTab, onOpenSection }: {
  onOpenTab?: (tab: TabId) => void;
  onOpenSection: (section: ModelSection) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Open-weights models by size</CardTitle>
          <p className="text-xs text-muted-foreground">Pick by where the model has to run, not by parameter count alone.</p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {SIZE_CLASSES.map((c) => (
            <div key={c.title} className="rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <c.icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm font-medium">{c.title}</span>
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">{c.models}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Training and fine-tuning</CardTitle>
          <p className="text-xs text-muted-foreground">Start with prompts and retrieval; fine-tune only what they cannot fix.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y divide-border/60">
            {TRAINING_OPTIONS.map((t) => (
              <li key={t.name} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{t.name}</div>
                  <div className="text-xs leading-relaxed text-muted-foreground">{t.note}</div>
                </div>
                <Tag state="other">{t.tag}</Tag>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => onOpenTab?.("training")}>
              <GraduationCap className="h-3.5 w-3.5" /> Open Training
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Local inference engines</CardTitle>
            <p className="text-xs text-muted-foreground">Free and private — models run on your own machine.</p>
          </CardHeader>
          <CardContent><OptionList items={LOCAL_ENGINES} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cloud inference APIs</CardTitle>
            <p className="text-xs text-muted-foreground">Serverless, pay per token — nothing to operate.</p>
          </CardHeader>
          <CardContent><OptionList items={CLOUD_APIS} /></CardContent>
        </Card>
      </div>
      <div className="-mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          “Built in” providers have a preset in Registry; “OpenAI-compatible” ones are registered with their base URL.
        </p>
        <Button size="sm" variant="outline" onClick={() => onOpenSection("registry")}>
          Register an endpoint
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Hosting for production</CardTitle>
          <p className="text-xs text-muted-foreground">Expose the host as an OpenAI-compatible endpoint, then register it like any other provider.</p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead><TR><TH>Option</TH><TH>Tools</TH><TH>Cost and trade-offs</TH></TR></THead>
            <TBody>
              {HOSTING.map((h) => (
                <TR key={h.option}>
                  <TD className="whitespace-nowrap text-[13px] font-medium">{h.option}</TD>
                  <TD className="text-xs text-muted-foreground">{h.tools}</TD>
                  <TD className="text-xs text-muted-foreground">{h.cost}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Beginner to production</CardTitle>
          <p className="text-xs text-muted-foreground">The shortest path from a laptop to a served model.</p>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-3">
          {PATH.map((p, i) => (
            <div key={p.title} className="flex flex-col rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>
                <span className="text-sm font-medium">{p.title}</span>
              </div>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">{p.body}</p>
              <div className="mt-2">
                <Button size="sm" variant="ghost" className="px-0 text-xs"
                  onClick={() => (p.tab ? onOpenTab?.(p.tab) : onOpenSection(p.section!))}>
                  {p.action} →
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Free tiers and GPU prices change — confirm current limits with each provider before committing.
      </p>
    </div>
  );
}
