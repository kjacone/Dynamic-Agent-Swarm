import type { WfSpec, WfStep } from "@/lib/api";

export const STEP_TONE: Record<string, string> = {
  agent: "bg-violet-500", approval: "bg-amber-500", connector: "bg-sky-500",
  tool: "bg-sky-500", condition: "bg-slate-400", parallel: "bg-indigo-500", set: "bg-slate-400", end: "bg-emerald-500",
};

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function branchesOf(step: WfStep): WfStep[] {
  const branches = (step as { branches?: unknown }).branches;
  return Array.isArray(branches) ? (branches as WfStep[]) : [];
}

/** Top-level steps plus any nested parallel branches, flattened in order. */
export function flattenSteps(steps: WfStep[]): WfStep[] {
  const out: WfStep[] = [];
  for (const s of steps) {
    out.push(s);
    out.push(...flattenSteps(branchesOf(s)));
  }
  return out;
}

export function agentIdsIn(steps: WfStep[]): string[] {
  return [...new Set(
    flattenSteps(steps)
      .filter((s) => s.type === "agent" && s.agent)
      .map((s) => s.agent as string),
  )];
}

// Installed pack agents are named "Pack title · Role"; the role is what matters in lists.
export function agentRole(name: string): string {
  const parts = name.split(" · ");
  return parts.length > 1 ? parts[parts.length - 1] : name;
}

export function agentPack(name: string): string {
  const parts = name.split(" · ");
  return parts.length > 1 ? parts.slice(0, -1).join(" · ") : "";
}

export function describeStep(s: WfStep, agentName?: string): string {
  switch (s.type) {
    case "agent": return agentName || "AI agent";
    case "approval": return `${plural(s.required_approvals ?? 1, "approver")} · ${(s.roles || []).join(", ")}${s.due_hours ? ` · ${s.due_hours}h SLA` : ""}`;
    case "connector": return `${s.connector}.${s.operation}`;
    case "tool": return String(s.tool);
    case "condition": return `if ${s.if}`;
    case "end": return String(s.outcome ?? "");
    case "parallel": return plural(branchesOf(s).length, "branch", "branches");
    default: return "";
  }
}

/** The step that follows `step` when nothing else overrides it. */
export function nextOf(spec: WfSpec, step: WfStep): string | null {
  if (step.next) return step.next;
  const i = spec.steps.findIndex((s) => s.id === step.id);
  return i >= 0 && i + 1 < spec.steps.length ? spec.steps[i + 1].id : null;
}
