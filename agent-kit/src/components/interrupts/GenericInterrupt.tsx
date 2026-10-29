"use client";
import { useState } from "react";
import { useAgentContext } from "../../agent-context";
import { ExpandableText, KeyValueTable } from "../ui/KeyValueTable";

/** Any `interrupt(value)`: shows the value and lets the user answer with text or JSON. */
export function GenericInterrupt({ value }: { value: unknown }) {
  const agent = useAgentContext();
  const [text, setText] = useState("");
  const breakpoint = value === undefined;

  const answer = () => {
    let v: unknown = text;
    try { v = JSON.parse(text); } catch { /* plain text answer */ }
    void agent.resume(v);
  };

  return (
    <>
      <strong>{breakpoint ? "The run is paused at a breakpoint" : "The agent is waiting for you"}</strong>
      {!breakpoint && (
        value && typeof value === "object"
          ? <KeyValueTable data={value as Record<string, unknown> | unknown[]} maxRows={Array.isArray(value) ? 5 : undefined} />
          : <ExpandableText text={String(value)} />
      )}
      {breakpoint ? (
        <div className="lgk-interrupt-row">
          <button type="button" className="lgk-primary" onClick={() => void agent.continueRun()}>Continue</button>
        </div>
      ) : (
        <div className="lgk-interrupt-row">
          <input
            value={text} onChange={(e) => setText(e.target.value)} aria-label="Your answer"
            placeholder="Your answer (text or JSON)"
            onKeyDown={(e) => e.key === "Enter" && text && answer()}
          />
          <button type="button" className="lgk-primary" onClick={answer} disabled={!text}>Continue</button>
        </div>
      )}
    </>
  );
}
