import { useEffect, useMemo, useState } from "react";
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow,
  type Edge, type Node, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  Bot, CheckCircle2, Clock, Flag, GitBranch, Loader2, Plug, ShieldCheck, SlidersHorizontal, Split, Wrench, XCircle,
} from "lucide-react";
import type { Agent, WfSpec, WfStep } from "@/lib/api";
import { STEP_TONE, agentRole, branchesOf, describeStep, nextOf } from "@/lib/workflows";
import { cn, truncate } from "@/lib/utils";

export type WorkflowStepStatus = "ok" | "error" | "active" | "waiting";

type StepData = {
  step: WfStep;
  index?: number;
  branch?: boolean;
  start?: boolean;
  status?: WorkflowStepStatus;
  agentName?: string;
  [key: string]: unknown;
};

type StepNode = Node<StepData, "step">;

const NODE_W = 236;
const BRANCH_W = 208;
const NODE_H = 88;

const TYPE_META: Record<string, { icon: typeof Bot; tile: string; hex: string }> = {
  agent: { icon: Bot, tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400", hex: "#8b5cf6" },
  approval: { icon: ShieldCheck, tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400", hex: "#f59e0b" },
  connector: { icon: Plug, tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400", hex: "#0ea5e9" },
  tool: { icon: Wrench, tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400", hex: "#0ea5e9" },
  condition: { icon: Split, tile: "bg-slate-500/10 text-slate-600 dark:text-slate-400", hex: "#94a3b8" },
  parallel: { icon: GitBranch, tile: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", hex: "#6366f1" },
  set: { icon: SlidersHorizontal, tile: "bg-slate-500/10 text-slate-600 dark:text-slate-400", hex: "#64748b" },
  end: { icon: Flag, tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", hex: "#10b981" },
};

const EDGE_TONE = {
  default: { className: "wf-edge", color: "#94a3b8" },
  branch: { className: "wf-edge-branch", color: "#818cf8" },
  error: { className: "wf-edge-error", color: "#f59e0b" },
  reject: { className: "wf-edge-reject", color: "#ef4444" },
} as const;

function StepNodeCard({ data, selected }: NodeProps<StepNode>) {
  const { step, index, branch, status, start, agentName } = data;
  const meta = TYPE_META[step.type] ?? TYPE_META.set;
  const Icon = meta.icon;
  const subtitle = describeStep(step, agentName);
  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-3 py-2.5 text-left shadow-sm transition-shadow",
        branch ? "border-dashed bg-muted/30" : "border-border",
        selected && "ring-2 ring-primary/40",
        status === "ok" && "border-emerald-500/60",
        status === "error" && "border-red-500/60",
        status === "active" && "border-sky-500/70 ring-2 ring-sky-500/20",
        status === "waiting" && "border-amber-500/70 ring-2 ring-amber-500/20",
      )}
      style={{ width: branch ? BRANCH_W : NODE_W, height: NODE_H }}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50" />
      <div className="flex items-start gap-2">
        <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", meta.tile)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {index != null && <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">#{index}</span>}
            {branch && <span className="text-[10px] text-muted-foreground">↳</span>}
            <span className="truncate text-[13px] font-medium leading-tight" title={step.name || step.id}>
              {step.name || step.id}
            </span>
            {status === "ok" && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-500" />}
            {status === "error" && <XCircle className="ml-auto h-3.5 w-3.5 shrink-0 text-red-500" />}
            {status === "active" && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />}
            {status === "waiting" && <Clock className="ml-auto h-3.5 w-3.5 shrink-0 animate-pulse text-amber-500" />}
            {!status && start && (
              <span className="ml-auto shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                start
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STEP_TONE[step.type] ?? "bg-slate-400")} />
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{step.type}</span>
            {subtitle && (
              <span className="truncate text-[11px] text-muted-foreground" title={subtitle}>
                {truncate(subtitle, 34)}
              </span>
            )}
          </div>
          {step.type === "approval" && !step.on_reject && (
            <div className="mt-1 text-[10px] text-amber-600/80 dark:text-amber-400/80">rejection ends the run</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50" />
    </div>
  );
}

const nodeTypes = { step: StepNodeCard };

function layout(nodes: StepNode[], edges: Edge[]): StepNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 72, marginx: 24, marginy: 16 });
  for (const n of nodes) g.setNode(n.id, { width: n.width ?? NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const w = n.width ?? NODE_W;
    return { ...n, position: { x: p.x - w / 2, y: p.y - NODE_H / 2 } };
  });
}

/** Edge ids traversed by the run, expanding parallel fan-out/fan-in between recorded steps. */
function edgesOnTrail(edges: Edge[], trail: string[]): Set<string> {
  const adj = new Map<string, Array<{ to: string; id: string }>>();
  for (const e of edges) {
    const list = adj.get(e.source);
    if (list) list.push({ to: e.target, id: e.id });
    else adj.set(e.source, [{ to: e.target, id: e.id }]);
  }
  const marked = new Set<string>();
  for (let i = 0; i < trail.length - 1; i++) {
    const from = trail[i], to = trail[i + 1];
    if (from === to) continue;
    const prev = new Map<string, { node: string; edge: string }>();
    const seen = new Set([from]);
    const queue = [from];
    let found = false;
    while (queue.length && !found) {
      const cur = queue.shift() as string;
      for (const step of adj.get(cur) ?? []) {
        if (seen.has(step.to)) continue;
        seen.add(step.to);
        prev.set(step.to, { node: cur, edge: step.id });
        if (step.to === to) { found = true; break; }
        queue.push(step.to);
      }
    }
    if (!found) continue;
    for (let cur = to; cur !== from;) {
      const hop = prev.get(cur);
      if (!hop) break;
      marked.add(hop.edge);
      cur = hop.node;
    }
  }
  return marked;
}

function buildGraph(spec: WfSpec, agents: Agent[], statuses: Record<string, WorkflowStepStatus>, trail: string[]) {
  const nodes: StepNode[] = [];
  const edges: Edge[] = [];
  const agentById = new Map(agents.map((a) => [a.id, a.name]));
  const ids = new Set(spec.steps.map((s) => s.id));
  const exists = (id?: string | null): string | null => (id && ids.has(id) ? id : null);
  const edgeSeen = new Set<string>();

  const link = (
    source: string,
    target: string | null,
    label?: string,
    tone: keyof typeof EDGE_TONE = "default",
  ) => {
    if (!target || source === target) return;
    const key = `${source}->${target}:${label ?? ""}:${tone}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    const { className, color } = EDGE_TONE[tone];
    edges.push({
      id: key,
      source,
      target,
      label,
      type: "smoothstep",
      className,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
      labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 500 },
    });
  };

  spec.steps.forEach((s, i) => {
    nodes.push({
      id: s.id,
      type: "step",
      width: NODE_W,
      height: NODE_H,
      position: { x: 0, y: 0 },
      data: {
        step: s,
        index: i + 1,
        start: spec.start ? spec.start === s.id : i === 0,
        status: statuses[s.id],
        agentName: s.agent ? agentRole(agentById.get(s.agent) ?? "") : undefined,
      },
    });
  });

  for (const s of spec.steps) {
    const nxt = exists(nextOf(spec, s));

    if (s.type === "condition") {
      const yes = exists(s.then) ?? nxt;
      const no = exists(s.else) ?? nxt;
      if (yes && no && yes === no) link(s.id, yes, "yes / no");
      else {
        link(s.id, yes, "yes");
        link(s.id, no, "no");
      }
    } else if (s.type === "approval") {
      link(s.id, nxt, "approved");
      link(s.id, exists(s.on_reject as string | null | undefined), "rejected", "reject");
    } else if (s.type === "parallel") {
      const branches = branchesOf(s);
      for (const b of branches) {
        const bid = `b:${s.id}:${b.id}`;
        nodes.push({
          id: bid,
          type: "step",
          width: BRANCH_W,
          height: NODE_H,
          position: { x: 0, y: 0 },
          data: {
            step: b,
            branch: true,
            status: statuses[b.id],
            agentName: b.agent ? agentRole(agentById.get(b.agent) ?? "") : undefined,
          },
        });
        link(s.id, bid, undefined, "branch");
        link(bid, nxt, undefined, "branch");
      }
      if (branches.length === 0) link(s.id, nxt);
    } else if (s.type !== "end") {
      link(s.id, nxt);
    }

    if (s.on_error === "goto") link(s.id, exists(s.error_goto as string | null), "on error", "error");
  }

  if (trail.length > 1) {
    const marked = edgesOnTrail(edges, trail);
    if (marked.size) {
      for (const e of edges) {
        e.className = `${e.className ?? ""} ${marked.has(e.id) ? "wf-edge-trail" : "wf-edge-faded"}`.trim();
      }
      // Steps inside a parallel branch never hit run history; mark them done when their
      // incoming edge was on the route.
      for (const n of nodes) {
        if (!n.id.startsWith("b:") || n.data.status) continue;
        if (edges.some((e) => e.target === n.id && marked.has(e.id))) {
          n.data = { ...n.data, status: "ok" };
        }
      }
    }
  }

  return { nodes: layout(nodes, edges), edges };
}

export function WorkflowGraph({
  spec, agents = [], statuses = {}, height = 380, minimap = true, focusStep, trail = [], className,
}: {
  spec: WfSpec;
  agents?: Agent[];
  statuses?: Record<string, WorkflowStepStatus>;
  height?: number;
  minimap?: boolean;
  focusStep?: string | null;
  trail?: string[];
  className?: string;
}) {
  const graph = useMemo(() => buildGraph(spec, agents, statuses, trail), [spec, agents, statuses, trail]);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);

  useEffect(() => {
    if (!instance || !focusStep) return;
    const n = graph.nodes.find((x) => x.id === focusStep);
    if (!n) return;
    instance.setCenter(n.position.x + (n.width ?? NODE_W) / 2, n.position.y + NODE_H / 2,
      { zoom: 0.95, duration: 400 });
  }, [instance, focusStep]);

  const usedTypes = useMemo(
    () => [...new Set(spec.steps.map((s) => s.type))],
    [spec],
  );

  if (spec.steps.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">This workflow has no steps.</div>;
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-muted/20", className)}>
      <div style={{ height }}>
        <ReactFlow
          key={`${spec.key}@${spec.version}`}
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onInit={setInstance}
          nodesConnectable={false}
          nodesDraggable={false}
          fitView={graph.nodes.length <= 4}
          fitViewOptions={{ padding: 0.16 }}
          defaultViewport={{ x: 24, y: 24, zoom: 0.8 }}
          panOnScroll
          minZoom={0.1}
          maxZoom={1.5}
        >
          <Background color="#94a3b8" gap={18} size={1} />
          <Controls showInteractive={false} />
          {minimap && (
            <MiniMap
              pannable
              zoomable
              className="!bg-card"
              maskColor="rgba(100,116,139,0.08)"
              nodeColor={(n) => TYPE_META[(n.data as StepData).step.type]?.hex ?? "#94a3b8"}
              nodeStrokeWidth={2}
            />
          )}
        </ReactFlow>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card/60 px-3 py-1.5">
        {usedTypes.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", STEP_TONE[t] ?? "bg-slate-400")} />
            {t}
          </span>
        ))}
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">scroll to pan · zoom with controls</span>
      </div>
    </div>
  );
}
