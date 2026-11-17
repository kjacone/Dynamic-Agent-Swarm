import { useState } from "react";
import { Boxes, Layers, Network, Wrench, Zap } from "lucide-react";

import { api, type ModelCfg, type Rag, type SubAgent, type Tool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ModelSelect } from "@/components/common/ModelSelect";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { PickList, PromptEditor, Segmented, type Snippet, type Starter } from "./PromptEditor";

const SNIPPETS: Snippet[] = [
  { label: "Task", text: "## Task\nYou handle [one focused job]. Do only this job and nothing else.\n\n" },
  { label: "Inputs", text: "## Inputs\nYou receive a request from the supervisor with [what it contains].\n\n" },
  { label: "Rules", text: "## Rules\n- Use your tools instead of guessing\n- Never make up sources or numbers\n- If the request is outside your task, say so and stop\n\n" },
  { label: "Output format", text: "## Output format\nReturn a short result the supervisor can pass on as is, with no preamble.\n\n" },
  { label: "Done when", text: "## Done when\nYou have a complete answer, or you can explain exactly what is missing.\n\n" },
  { label: "{{variable}}", text: "{{variable}}" },
];

const STARTERS: Starter[] = [
  {
    name: "Researcher",
    hint: "Finds and cites sources",
    prompt:
      "## Task\nYou research a question using your tools and knowledge collections, then report what you found.\n\n## Rules\n- Search before you answer\n- Cite every claim with its source\n- If sources disagree, say so\n\n## Output format\nA short summary, then evidence as a bulleted list with sources.\n",
  },
  {
    name: "Summarizer",
    hint: "Condenses long input",
    prompt:
      "## Task\nYou summarize the text the supervisor gives you.\n\n## Rules\n- Keep every figure, name and date exactly as written\n- Do not add opinions or new facts\n\n## Output format\nThree to five bullets, then a one-line takeaway.\n",
  },
  {
    name: "Classifier",
    hint: "Labels and routes requests",
    prompt:
      "## Task\nYou classify each request into exactly one category and give a confidence level.\n\n## Rules\n- Pick the closest category, even if none is perfect\n- Use low confidence instead of guessing silently\n\n## Output format\nJSON: {\"category\": \"...\", \"confidence\": \"high|medium|low\", \"reason\": \"...\"}\n",
  },
  {
    name: "Extractor",
    hint: "Pulls structured fields",
    prompt:
      "## Task\nYou extract structured fields from the text you are given.\n\n## Rules\n- Only return values that appear in the text\n- Use null for anything missing\n\n## Output format\nA single JSON object with the requested fields.\n",
  },
];

const MODES = [
  {
    value: "sync" as const,
    title: "Sync",
    body: "Runs in-process. Fastest, and shares the current runtime.",
    icon: Zap,
    on: "border-emerald-500/50 bg-emerald-500/5",
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  {
    value: "async" as const,
    title: "Async",
    body: "Runs as a graph on the LangGraph server. Good for long jobs.",
    icon: Network,
    on: "border-amber-500/50 bg-amber-500/5",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
];

export function SubagentForm({
  open, onClose, onSaved, tenant, tools, rags, models, initial,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; tenant: string;
  tools: Tool[]; rags: Rag[]; models: ModelCfg[]; initial?: SubAgent;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [prompt, setPrompt] = useState(initial?.system_prompt || "");
  const [mode, setMode] = useState<"sync" | "async">(initial?.mode || "sync");
  const [model, setModel] = useState(initial?.model || "");
  const [graphId, setGraphId] = useState(initial?.graph_id || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [toolIds, setToolIds] = useState<string[]>(initial?.tool_ids || []);
  const [ragIds, setRagIds] = useState<string[]>(initial?.rag_collection_ids || []);
  const [capTab, setCapTab] = useState<"tools" | "rag">("tools");
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();

  const modeMeta = MODES.find((m) => m.value === mode)!;
  const ModeIcon = modeMeta.icon;
  const needsGraph = mode === "async" && !graphId;
  const canSave = !!name && !needsGraph;
  const selectedTools = tools.filter((t) => toolIds.includes(t.id));

  async function save() {
    try {
      const body = {
        name, description, system_prompt: prompt, mode, tenant_id: tenant,
        model: model || null, graph_id: mode === "async" ? graphId || null : null,
        url: url || null,
        tool_ids: toolIds, rag_collection_ids: ragIds,
      };
      if (initial) await api.patchSubagent(initial.id, body);
      else await api.createSubagent(body);
      toast.push("Subagent saved", "success");
      onSaved();
    } catch (e: any) {
      toast.push(e.message, "error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b bg-muted/30 px-6 py-4">
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", modeMeta.chip)}>
            <ModeIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 text-left">
            <DialogTitle className="truncate">{initial ? `Edit ${initial.name}` : "New subagent"}</DialogTitle>
            <DialogDescription>Give the supervisor a focused helper with its own prompt, model and tools.</DialogDescription>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="max-h-[68vh] overflow-auto px-6 py-5">
          <div className={cn("grid gap-6", expanded ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1.7fr),minmax(0,1fr)]")}>
            {/* Left: identity, prompt */}
            <div className="min-w-0 space-y-5">
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="sub-name">Name</Label>
                    <Input id="sub-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. researcher" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sub-desc">Description</Label>
                    <Input id="sub-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it good at?" />
                  </div>
                </div>
                <div className="flex items-start gap-2.5 rounded-lg border border-dashed bg-muted/20 px-3 py-2">
                  <Boxes className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 text-xs">
                    <div className="text-muted-foreground">The supervisor decides when to delegate from this line:</div>
                    <div className="mt-0.5 truncate">
                      <span className="font-mono font-medium">{name || "name"}</span>
                      <span className="text-muted-foreground"> · {description || "Add a description so it gets picked at the right time"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <PromptEditor
                value={prompt}
                onChange={setPrompt}
                title="System prompt"
                subtitle="Instructions this subagent follows each time the supervisor calls it."
                snippets={SNIPPETS}
                starters={STARTERS}
                mentionTools={selectedTools}
                tokenGuide={1200}
                expanded={expanded}
                onExpandedChange={setExpanded}
                onSubmit={() => { if (canSave) save(); }}
                checks={[
                  { key: "task", label: "Task", test: /task|you (handle|are|research|summarize|classify|extract)/i },
                  { key: "rules", label: "Rules", test: /rules?|must|never|always|do not|don't/i },
                  { key: "format", label: "Output format", test: /format|return|respond with|json/i },
                ]}
              />
            </div>

            {/* Right: run settings + capabilities */}
            {!expanded && (
              <aside className="min-w-0 space-y-5 lg:border-l lg:pl-6">
                <div className="space-y-2">
                  <Label className="text-sm">How it runs</Label>
                  <div className="grid gap-2">
                    {MODES.map((m) => {
                      const Icon = m.icon;
                      const active = m.value === mode;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => setMode(m.value)}
                          aria-pressed={active}
                          className={cn(
                            "flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                            active ? m.on : "hover:bg-muted/60",
                          )}
                        >
                          <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", active ? m.chip : "bg-muted text-muted-foreground")}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{m.title}</span>
                            <span className="block text-xs text-muted-foreground">{m.body}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {mode === "async" && (
                    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="sub-graph">Graph id</Label>
                        <Input
                          id="sub-graph" value={graphId} onChange={(e) => setGraphId(e.target.value)}
                          placeholder="researcher" aria-invalid={needsGraph}
                          className={cn(needsGraph && "border-destructive/60")}
                        />
                        {needsGraph && <p className="text-xs text-destructive">Async subagents need a graph id.</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sub-url">Server URL <span className="font-normal text-muted-foreground">(optional)</span></Label>
                        <Input id="sub-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="LangGraph server URL" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Model</Label>
                  <ModelSelect value={model} onChange={setModel} models={models} allowEmpty emptyLabel="Inherit supervisor model" />
                </div>

                <div className="space-y-3">
                  <div>
                    <Label className="text-sm">Capabilities</Label>
                    <p className="text-xs text-muted-foreground">What this subagent can call and read.</p>
                  </div>
                  <Segmented
                    value={capTab}
                    onChange={setCapTab}
                    options={[
                      { value: "tools", label: "Tools", icon: Wrench, badge: toolIds.length },
                      { value: "rag", label: "Knowledge", icon: Layers, badge: ragIds.length },
                    ]}
                  />
                  {capTab === "tools" ? (
                    <PickList
                      items={tools.map((t) => ({ id: t.id, label: t.name }))}
                      selected={toolIds} onChange={setToolIds}
                      empty="No tools yet. Add one on the Tools page."
                    />
                  ) : (
                    <PickList
                      items={rags.map((r) => ({ id: r.id, label: r.name }))}
                      selected={ragIds} onChange={setRagIds}
                      empty="No knowledge collections yet. Create one on the RAG page."
                    />
                  )}
                </div>
              </aside>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="items-center border-t bg-muted/30 px-6 py-3 sm:justify-between">
          <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Badge variant="secondary" className="capitalize">{mode}</Badge>
            <Badge variant="secondary" className="tabular-nums">{toolIds.length} tools</Badge>
            <Badge variant="secondary" className="tabular-nums">{ragIds.length} knowledge</Badge>
            <span className="ml-2">Ctrl or ⌘ + Enter saves from the prompt</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <AsyncButton onRun={save} disabled={!canSave}>Save subagent</AsyncButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}