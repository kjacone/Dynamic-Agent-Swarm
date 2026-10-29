/**
 * Human-in-the-loop request shape emitted by LangChain's HumanInTheLoopMiddleware.
 * The graph pauses with `interrupt(HitlRequest)`; resume with `{ decisions: Decision[] }`,
 * one decision per action request, in order.
 */
export type DecisionType = "approve" | "edit" | "reject";
export interface ActionRequest { name: string; args: Record<string, unknown>; description?: string }
export interface ReviewConfig { action_name: string; allowed_decisions: DecisionType[]; args_schema?: Record<string, unknown> }
export interface HitlRequest { action_requests: ActionRequest[]; review_configs: ReviewConfig[] }
export type Decision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "edit"; edited_action: { name: string; args: Record<string, unknown> } };

/** Takes an interrupt's *value*. */
export function isHitlRequest(value: unknown): value is HitlRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<HitlRequest>;
  if (!Array.isArray(v.action_requests) || !v.action_requests.length) return false;
  if (!Array.isArray(v.review_configs) || !v.review_configs.length) return false;
  return v.action_requests.every((a) => a && typeof a.name === "string" && a.args !== null && typeof a.args === "object")
    && v.review_configs.every((c) => c && typeof c.action_name === "string" && Array.isArray(c.allowed_decisions));
}

export const allowedFor = (req: HitlRequest, action: ActionRequest): DecisionType[] =>
  req.review_configs.find((c) => c.action_name === action.name)?.allowed_decisions ?? ["approve", "reject"];

/** What the reviewer has typed so far for one action. */
export interface Draft { type?: DecisionType; args: Record<string, string>; message: string }

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

export function initialDraft(action: ActionRequest, allowed: DecisionType[]): Draft {
  return {
    type: allowed.length === 1 ? allowed[0] : undefined,
    args: Object.fromEntries(Object.entries(action.args).map(([k, v]) => [k, show(v)])),
    message: "",
  };
}

export function buildDecision(
  action: ActionRequest, allowed: DecisionType[], draft: Draft,
): { decision?: Decision; error?: string } {
  if (!draft.type) return { error: `Choose a decision for "${action.name}".` };
  if (draft.type === "approve") return { decision: { type: "approve" } };
  if (draft.type === "reject") {
    const message = draft.message.trim();
    return message ? { decision: { type: "reject", message } } : { error: `Add a reason for rejecting "${action.name}".` };
  }
  const args: Record<string, unknown> = {};
  let changed = false;
  for (const [key, original] of Object.entries(action.args)) {
    const raw = draft.args[key] ?? "";
    if (raw !== show(original)) changed = true;
    if (typeof original === "string") { args[key] = raw; continue; }
    try { args[key] = JSON.parse(raw); }
    catch { return { error: `"${key}" in "${action.name}" must be valid JSON.` }; }
  }
  // Nothing edited and approving is allowed: send a plain approval.
  if (!changed && allowed.includes("approve")) return { decision: { type: "approve" } };
  return { decision: { type: "edit", edited_action: { name: action.name, args } } };
}
