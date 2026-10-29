"use client";
import type { ReactNode } from "react";
import { useAgentContext } from "../../agent-context";
import { isHitlRequest } from "../../lib/hitl";
import { GenericInterrupt } from "./GenericInterrupt";
import { HitlReview } from "./HitlReview";

export interface InterruptRenderProps {
  interrupt: { id?: string; value?: unknown };
  value: unknown;
  resume: (value: unknown) => unknown;
}

/**
 * Picks the right UI for what the graph is waiting on:
 * your `render` (return null/undefined to fall through) → HITL review → generic answer box.
 */
export function InterruptView({ interrupts, render }: {
  interrupts: { id?: string; value?: unknown }[];
  render?: (p: InterruptRenderProps) => ReactNode;
}) {
  const agent = useAgentContext();
  if (!interrupts.length) return null;

  const custom = render?.({ interrupt: interrupts[0], value: interrupts[0].value, resume: agent.resume });
  if (custom != null && custom !== false) return <div className="lgk-interrupt">{custom}</div>;

  const hitl = interrupts.filter((i) => isHitlRequest(i.value));
  return (
    <div className="lgk-interrupt">
      {hitl.length ? <HitlReview interrupts={hitl} /> : <GenericInterrupt value={interrupts[0].value} />}
    </div>
  );
}
