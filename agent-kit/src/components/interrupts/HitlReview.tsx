"use client";
import { useState } from "react";
import { useAgentContext } from "../../agent-context";
import {
  allowedFor, buildDecision, initialDraft,
  type ActionRequest, type Decision, type DecisionType, type Draft, type HitlRequest,
} from "../../lib/hitl";
import { useKit } from "../../provider";
import { KeyValueTable } from "../ui/KeyValueTable";

const pretty = (name: string) => { const s = name.replace(/[_-]+/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
const LABEL: Record<DecisionType, string> = { approve: "Approve", edit: "Edit", reject: "Reject" };

type HistoryRow = { who: string; text: string };

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part
        ? String((part as { text?: unknown }).text ?? "") : ""))
      .join(" ");
  }
  return "";
}

/** Reviewer-friendly recap: what the customer asked and what the agent did, without raw state. */
function historyRows(messages: unknown): HistoryRow[] {
  if (!Array.isArray(messages)) return [];
  const rows: HistoryRow[] = [];
  for (const raw of messages) {
    const m = raw as { type?: string; role?: string; name?: string; content?: unknown };
    const type = m?.type ?? m?.role;
    if (type === "tool") {
      rows.push({ who: m.name ? pretty(m.name) : "Step", text: "Completed" });
      continue;
    }
    const text = contentText(m?.content).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const clipped = text.length > 140 ? `${text.slice(0, 137)}…` : text;
    if (type === "human" || type === "user") rows.push({ who: "You", text: clipped });
    else if (type === "ai" || type === "assistant") rows.push({ who: "Agent", text: clipped });
  }
  return rows.slice(-8);
}

function ActionReview({ action, allowed, draft, onChange }: {
  action: ActionRequest; allowed: DecisionType[]; draft: Draft; onChange: (d: Draft) => void;
}) {
  return (
    <fieldset className="lgk-hitl-action">
      <legend>{pretty(action.name)}</legend>
      {action.description && <p className="lgk-muted-block">{action.description}</p>}

      {draft.type === "edit" ? (
        <div className="lgk-hitl-edit">
          {Object.keys(action.args).map((key) => (
            <label key={key}>
              <span>{key}</span>
              <textarea
                rows={Math.min(8, Math.max(1, draft.args[key]?.split("\n").length ?? 1))}
                value={draft.args[key] ?? ""}
                onChange={(e) => onChange({ ...draft, args: { ...draft.args, [key]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      ) : (
        <KeyValueTable data={action.args} />
      )}

      {draft.type === "reject" && (
        <label className="lgk-hitl-reason">
          <span>Reason</span>
          <textarea rows={2} placeholder="Tell the agent why" value={draft.message} onChange={(e) => onChange({ ...draft, message: e.target.value })} />
        </label>
      )}

      <div className="lgk-hitl-choices" role="radiogroup" aria-label={`Decision for ${action.name}`}>
        {allowed.map((t) => (
          <button
            key={t} type="button" role="radio" aria-checked={draft.type === t}
            data-selected={draft.type === t} data-kind={t}
            onClick={() => onChange({ ...draft, type: t })}
          >
            {LABEL[t]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Review UI for LangChain's HumanInTheLoopMiddleware: for every pending action the reviewer
 * approves, edits its arguments, or rejects with a reason. Resumes with `{ decisions }`.
 */
export function HitlReview({ interrupts }: { interrupts: { id?: string; value?: unknown }[] }) {
  const agent = useAgentContext();
  const { notify } = useKit();
  const [active, setActive] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({});

  const current = interrupts[Math.min(active, interrupts.length - 1)];
  const request = current.value as HitlRequest;
  const key = current.id ?? String(active);
  const list = drafts[key] ?? request.action_requests.map((a) => initialDraft(a, allowedFor(request, a)));
  const idForResume = interrupts.length > 1 ? current.id : undefined;

  const send = (decisions: Decision[]) => {
    agent.submitDecisions(decisions, idForResume).then(
      () => undefined,
      (e: unknown) => notify({ kind: "error", title: "Couldn't send your decision", description: e instanceof Error ? e.message : undefined }),
    );
  };

  const submit = () => {
    const decisions: Decision[] = [];
    for (let i = 0; i < request.action_requests.length; i++) {
      const a = request.action_requests[i];
      const { decision, error } = buildDecision(a, allowedFor(request, a), list[i]);
      if (!decision) { notify({ kind: "error", title: "Can't submit yet", description: error }); return; }
      decisions.push(decision);
    }
    send(decisions);
  };

  const allApprovable = request.action_requests.every((a) => allowedFor(request, a).includes("approve"));
  const complete = list.every((d) => d.type);
  const history = historyRows(agent.messages);

  return (
    <div className="lgk-hitl">
      <strong>Review needed</strong>

      {interrupts.length > 1 && (
        <div className="lgk-hitl-tabs" role="tablist">
          {interrupts.map((it, i) => (
            <button key={it.id ?? i} type="button" role="tab" aria-selected={i === active} onClick={() => setActive(i)}>
              {pretty((it.value as HitlRequest).action_requests[0]?.name ?? `Request ${i + 1}`)}
            </button>
          ))}
        </div>
      )}

      {request.action_requests.map((a, i) => (
        <ActionReview
          key={`${key}-${i}`} action={a} allowed={allowedFor(request, a)} draft={list[i]}
          onChange={(d) => setDrafts((p) => ({ ...p, [key]: list.map((x, j) => (j === i ? d : x)) }))}
        />
      ))}

      <div className="lgk-hitl-footer">
        <button type="button" className="lgk-ghost" onClick={() => void agent.resolve()} title="End the run without answering">Mark as resolved</button>
        {request.action_requests.length > 1 && allApprovable && (
          <button type="button" className="lgk-ghost" onClick={() => send(request.action_requests.map(() => ({ type: "approve" as const })))}>Approve all</button>
        )}
        <button type="button" className="lgk-primary" disabled={!complete} onClick={submit}>Submit</button>
      </div>

      <details className="lgk-hitl-state">
        <summary>What has happened so far</summary>
        {history.length > 0 ? (
          <ol className="lgk-hitl-log">
            {history.map((row, i) => (
              <li key={i}><span>{row.who}</span>{row.text}</li>
            ))}
          </ol>
        ) : (
          <p className="lgk-muted-block">No earlier steps are recorded for this request.</p>
        )}
      </details>
    </div>
  );
}
