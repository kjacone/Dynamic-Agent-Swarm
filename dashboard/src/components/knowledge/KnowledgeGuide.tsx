import { useState } from "react";
import { ArrowRight, BookOpen, Check, Database, Play, Plus, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Rag } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TopicId = "kb" | "embed" | "store";

type Concept = {
  id: TopicId;
  icon: LucideIcon;
  title: string;
  line: string;
  detail: string;
  facts: string[];
};

const CONCEPTS: Concept[] = [
  {
    id: "kb",
    icon: BookOpen,
    title: "Knowledge base",
    line: "Your documents, split into searchable passages.",
    detail: "Upload PDFs, Markdown or text. Each file is split into overlapping chunks that keep their source, so an agent can quote the exact passage instead of guessing.",
    facts: [
      "PDF, Markdown and plain-text uploads",
      "~800-character chunks, 120 overlap here",
      "Source stays attached for citations",
    ],
  },
  {
    id: "embed",
    icon: Sparkles,
    title: "Embeddings",
    line: "Meaning turned into numbers, so search works by idea.",
    detail: "An embedding model converts every chunk into a vector. Passages with similar meaning land close together, so a question finds the right passage even when it shares no keywords with it.",
    facts: [
      "Free and local with Ollama (nomic-embed-text, bge-m3)",
      "Or any OpenAI-compatible embedding endpoint",
      "One model per collection — mixing them breaks distances",
    ],
  },
  {
    id: "store",
    icon: Database,
    title: "Vector database",
    line: "The index that returns the closest passages in milliseconds.",
    detail: "The index stores each vector next to its chunk. At question time it compares the question's vector with every chunk and returns the nearest few — the top-K that go into the model's context.",
    facts: [
      "This console writes one FAISS index per collection",
      "Retrieval runs locally and is scoped to the tenant",
      "Top-K defaults to 4; 3–5 suits most Q&A",
    ],
  },
];

const PIPELINE = ["Upload", "Chunk", "Embed", "Index", "Retrieve top-K", "Answer"];

type Support = "here" | "endpoint" | "other";

const EMBEDDING_OPTIONS: { name: string; tag: string; note: string; code?: string; state: Support }[] = [
  {
    name: "Ollama · nomic-embed-text",
    tag: "Local library",
    note: "Runs on your machine, no API fees, documents never leave it.",
    code: "ollama:nomic-embed-text",
    state: "here",
  },
  {
    name: "Ollama · BAAI/bge-m3",
    tag: "Local library",
    note: "Free multilingual model; strong on mixed-language documents.",
    code: "ollama:bge-m3",
    state: "here",
  },
  {
    name: "sentence-transformers",
    tag: "Local library",
    note: "all-MiniLM-L6-v2 and similar — small and fast. Serve it behind an OpenAI-compatible endpoint and it works here.",
    state: "endpoint",
  },
  {
    name: "OpenAI · text-embedding-3-small",
    tag: "Usage-based",
    note: "Low cost per million tokens, accurate, and wired in out of the box.",
    code: "openai:text-embedding-3-small",
    state: "here",
  },
  {
    name: "Google Gemini embeddings",
    tag: "Free tier",
    note: "Embed thousands of pages through Google AI Studio; not wired into this console.",
    state: "other",
  },
  {
    name: "Cohere embed",
    tag: "Usage-based",
    note: "Multilingual search embeddings; commonly paired with Cohere rerank.",
    state: "other",
  },
];

const STORE_OPTIONS: { name: string; tag: string; note: string; state: Support }[] = [
  {
    name: "FAISS",
    tag: "Local library",
    note: "In-process index; what this console writes for every collection.",
    state: "here",
  },
  {
    name: "ChromaDB",
    tag: "Local or server",
    note: "pip install chromadb — simple metadata filters and persistence.",
    state: "other",
  },
  {
    name: "Qdrant",
    tag: "Self-host / free cloud",
    note: "Fast filtered search; easy Docker deployment and a free cloud tier.",
    state: "other",
  },
  {
    name: "Weaviate",
    tag: "Self-host / free cloud",
    note: "Built-in hybrid keyword + vector search.",
    state: "other",
  },
  {
    name: "Pinecone",
    tag: "Free starter index",
    note: "Managed serverless search with nothing to operate.",
    state: "other",
  },
  {
    name: "Supabase (pgvector)",
    tag: "Free tier",
    note: "Vectors stored inside an ordinary PostgreSQL database.",
    state: "other",
  },
];

const STEPS = [
  {
    title: "Load and chunk",
    body: "Upload the files. The splitter cuts each one into overlapping passages — this console uses ~800 characters with 120 overlap, roughly a paragraph, so an answer can quote it whole.",
  },
  {
    title: "Generate embeddings",
    body: "Every passage is sent to the collection's embedding model and stored as a vector. Smaller chunks sharpen retrieval; larger ones keep more context.",
  },
  {
    title: "Store in a vector database",
    body: "Vectors and their text go into the index — FAISS here, Chroma, Qdrant or Supabase elsewhere. Each collection keeps its own index.",
  },
  {
    title: "Query and answer",
    body: "A question is embedded the same way, the closest 3–5 passages come back, and the agent's model writes the answer with them in context and their sources attached.",
  },
];

const SUPPORT_LABEL: Record<Support, string> = {
  here: "Runs here",
  endpoint: "Via endpoint",
  other: "Other stacks",
};

function Tag({ state, children }: { state: Support; children: React.ReactNode }) {
  return (
    <span className={cn(
      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
      state === "here" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      state === "endpoint" && "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      state === "other" && "bg-muted text-muted-foreground",
    )}>
      {children}
    </span>
  );
}

function OptionRows({ items }: { items: { name: string; tag: string; note: string; code?: string; state: Support }[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {items.map((item) => (
        <li key={item.name} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{item.name}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">{item.note}</div>
            {item.code && (
              <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{item.code}</code>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Tag state={item.state}>{SUPPORT_LABEL[item.state]}</Tag>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.tag}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Plain-language explainer plus the option catalogue on the Knowledge page. */
export function KnowledgeGuide({ rows, onNewCollection, onTryRetrieval }: {
  rows: Rag[] | null;
  onNewCollection?: () => void;
  onTryRetrieval?: (rag: Rag) => void;
}) {
  const [topic, setTopic] = useState<TopicId>("kb");
  const active = CONCEPTS.find((c) => c.id === topic) ?? CONCEPTS[0];
  const ready = rows?.find((r) => r.status === "ready") ?? null;

  return (
    <>
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">How knowledge works</CardTitle>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Upload documents once and agents answer from them, quoting the passage they used rather than improvising.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {PIPELINE.map((step, i) => (
              <span key={step} className="flex items-center gap-1.5">
                <span className="rounded-full border bg-muted/40 px-2 py-0.5">{step}</span>
                {i < PIPELINE.length - 1 && <ArrowRight className="h-3 w-3" />}
              </span>
            ))}
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {CONCEPTS.map((c) => {
              const selected = c.id === topic;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTopic(c.id)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    selected ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-lg",
                      selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}>
                      <c.icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-sm font-medium">{c.title}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{c.line}</p>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-sm leading-relaxed">{active.detail}</p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-3">
              {active.facts.map((f) => (
                <li key={f} className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" /> {f}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="mb-1 grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Embedding models</CardTitle>
            <p className="text-xs text-muted-foreground">Free and low-cost ways to turn text into vectors.</p>
          </CardHeader>
          <CardContent>
            <OptionRows items={EMBEDDING_OPTIONS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Vector databases</CardTitle>
            <p className="text-xs text-muted-foreground">Where the vectors live. This console ships with FAISS.</p>
          </CardHeader>
          <CardContent>
            <OptionRows items={STORE_OPTIONS} />
          </CardContent>
        </Card>
      </div>
      <p className="mb-4 text-[11px] text-muted-foreground">
        Free tiers and per-token prices change — confirm the current limits with each provider before committing.
      </p>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Build one in four steps</CardTitle>
          <p className="text-xs text-muted-foreground">The same path every stack follows — only the embedding model and store change.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="grid gap-2 md:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-2.5 rounded-xl border p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-medium">{s.title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <span className="text-xs text-muted-foreground">
              {ready
                ? `Retrieval preview runs against “${ready.name}” — no model is called.`
                : rows && rows.length > 0
                  ? "No collection is ready yet — upload a document to one, then try retrieval."
                  : "Create a collection and upload a document to try retrieval."}
            </span>
            <div className="flex gap-2">
              {onNewCollection && (
                <Button variant="outline" size="sm" onClick={onNewCollection}>
                  <Plus className="h-3.5 w-3.5" /> New collection
                </Button>
              )}
              <Button size="sm" disabled={!ready || !onTryRetrieval}
                title={ready ? "Preview what retrieval returns" : "No ready collection yet"}
                onClick={() => ready && onTryRetrieval?.(ready)}>
                <Play className="h-3.5 w-3.5" /> Try retrieval
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
