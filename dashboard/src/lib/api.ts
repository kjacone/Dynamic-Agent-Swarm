export const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "nmb_admin_token";


export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string) {
  sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const tok = getToken();
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  // Enterprise routes are tenant-scoped; for named (JWT/SSO) users the server uses the token's tenant instead.
  if (path.startsWith("/enterprise")) headers.set("X-Tenant-Id", sessionStorage.getItem("nmb_tenant") || "default");

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (body && (body as any).detail) || res.statusText;
    throw new ApiError(res.status, `${res.status} ${msg}`, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

// ── Types ──────────────────────────────────────────────────────────
export interface ServiceStatus {
  id: string; name: string; url: string;
  configured: boolean; ok: boolean; detail: string; latency_ms: number | null;
}
export interface SystemStatus {
  services: ServiceStatus[];
  counts: Record<string, number>;
}
export interface Agent {
  id: string; name: string; model: string; system_prompt: string;
  tool_ids: string[]; rag_collection_ids: string[]; subagent_ids: string[];
  tenant_id: string; created_at?: string;
}
export interface SubAgent {
  id: string; name: string; description: string; system_prompt: string;
  mode: "sync" | "async"; tool_ids: string[]; rag_collection_ids: string[];
  model: string | null; graph_id: string | null; url: string | null;
  tenant_id: string;
}
export interface Tool {
  id: string; name: string; type: string; description: string;
  config: Record<string, unknown>; tenant_id: string;
}
export interface Rag {
  id: string; name: string; embedding_model: string; vector_store: string;
  top_k: number; status: string; index_path: string; tenant_id: string;
}
export interface ModelCfg {
  id: string; name: string; provider: string; model_name: string;
  base_url: string | null; api_key_env: string | null;
  params: Record<string, unknown>; tenant_id: string;
}
export interface ApiKey {
  id: string; name: string; prefix: string; kind: string;
  agent_id: string; tenant_id: string;
  allowed_origins: string[]; rate_limit_per_min: number;
  revoked: boolean; created_at: string; key?: string;
}
export interface EvalDataset {
  id: string; name: string; agent_id: string; tenant_id: string; cases: number;
}
export interface EvalCase {
  id: string; dataset_id: string; input: string;
  expected_contains: string | null; criteria: string | null;
  expect_delegations: string[] | null;
}

export interface EvalSummary {
  cases?: number;
  scored?: number;
  avg?: number | null;
  pass_rate?: number | null;
  errors?: number;
  orchestration_checked?: number;
  orchestration_passed?: number;
  orchestration_rate?: number | null;
  langfuse?: string;
}
export interface EvalRun {
  id: string; dataset_id: string; agent_id: string;
  target: "draft" | "published"; agent_version: number | null;
  status: string; results: Array<Record<string, unknown>>;
  summary: EvalSummary; created_at: string;
}


export interface LocaleProfile {
  id: string; name: string; locale_code: string; languages: string[]; default_language: string;
  register_style: "formal" | "neutral" | "casual";
  code_switch_policy: "off" | "allowed" | "encouraged";
  currency_code: string; currency_symbol: string; currency_position: "before" | "after";
  decimal_sep: string; thousand_sep: string; date_format: string;
  glossary: Array<{ source: string; target?: string; keep?: boolean }>;
  replacements: Array<{ from: string; to: string }>;
  required_phrases: string[]; banned_phrases: string[];
  sample_cases: Array<{ input: string; expected_contains?: string; criteria?: string }>;
  notes: string; enabled: boolean; tenant_id: string; created_at: string; updated_at: string;
}
export type LocaleProfileInput = Omit<LocaleProfile, "id" | "tenant_id" | "created_at" | "updated_at">;
export interface LocaleProfileRow extends LocaleProfile { attached_agents: number; attached_to: string[] }
export interface LocaleExample {
  id: string; profile_id: string; tenant_id: string; agent_id: string | null;
  input: string; bad_output: string | null; corrected_output: string; note: string;
  source: "manual" | "conversation" | "feedback"; feedback_id: string | null;
  enabled: boolean; created_at: string;
}
export interface LocaleDetail {
  profile: LocaleProfile;
  examples: LocaleExample[];
  agents: Array<{ id: string; name: string; model: string }>;
}
export interface LocalePreview {
  specialist: { name: string; description: string; system_prompt: string };
  rules: string;
  formatted: string | null;
}

export interface TrainingJob {  id: string; name: string; status: string;
  params: Record<string, unknown>;
  created_at: number;
  progress?: { step?: number; total?: number; percentage?: number; loss?: number; epoch?: number };
  loss_series?: { step: number; loss: number }[];
}

export interface PlaygroundPreview {
  generation: string;
  predictions: Array<{ token: string; p: number }>;
}
export interface PlaygroundResult {
  vocab_size: number;
  parameters: number;
  sentences: number;
  tokens: number;
  steps: number;
  elapsed_ms: number;
  loss_series: Array<{ step: number; loss: number }>;
  final_loss: number;
  prefix: string;
  before: PlaygroundPreview;
  after: PlaygroundPreview;
}
export interface PlaygroundInfo {
  corpus: string;
  defaults: { epochs: number; learning_rate: number; temperature: number; prefix: string };
}
export interface ColabInfo {
  modes: Array<"train" | "infer">;
  defaults: {
    mode: "train" | "infer";
    base_model: string;
    epochs: number;
    learning_rate: number;
    batch_size: number;
    grad_accum: number;
    max_seq_length: number;
    prompt: string;
  };
}
export interface Connection {
  host?: string; public_url?: string; public_key?: string; secret_key?: string;
  url?: string; api_key?: string;
  [k: string]: string | boolean | undefined;
}

// ── Enterprise types ───────────────────────────────────────────────
export interface Me {
  sub: string; tenant_id: string; roles: string[]; auth: "admin_token" | "jwt" | "oidc";
  permissions: string[]; license: { edition: string; state: string; modules: string[] };
}
/** Mirrors the server's wildcard rules ("*", "res:*", exact). The server is still the authority. */
export function can(me: Me | null, perm: string): boolean {
  if (!me) return false;
  const res = perm.split(":")[0];
  return me.permissions.some((p) => p === "*" || p === perm || p === `${res}:*`);
}
export interface ApprovalDecision { by: string; decision: "approve" | "reject"; comment: string; ts: string }
export interface ApprovalItem {
  id: string; run_id: string; step_id: string; title: string; summary: string; requester: string;
  required_approvals: number; allowed_roles: string[]; status: "pending" | "approved" | "rejected" | "expired";
  decisions: ApprovalDecision[]; due_at: string | null; escalated: boolean;
  created_at: string; decided_at: string | null; context: Record<string, unknown>;
}
export interface WfInput { required: boolean; type: string; description: string }
export interface HandoffItem {
  id: string; agent_id: string; thread_id: string; status: "requested" | "active" | "resolved";
  reason: string; requested_by: string; user_id: string | null; customer_id: string | null;
  assigned_to: string | null; created_at: string; updated_at: string; resolved_at: string | null;
  message_count?: number; forward_count?: number;
}
export interface HandoffMessage {
  id: string; handoff_id: string; role: "customer" | "staff"; author: string; text: string; created_at: string;
}
export interface HandoffForward {
  ts: string; actor: string; outcome: "success" | "error" | "denied";
  channel: "connector" | "email" | "copy"; connector: string; operation: string;
  recipient: string; subject: string; messages: number | null;
  compressed: boolean; summary_chars: number | null;
}
export interface HandoffDetail extends HandoffItem { messages: HandoffMessage[]; forwards?: HandoffForward[] }
export interface HandoffSummary {
  summary: string; method: string; message_count: number;
  chars_before: number; chars_after: number; compression: number;
}
export interface HandoffForwardResult {
  ok: boolean; channel: "connector" | "email" | "copy"; connector: string; operation: string;
  subject: string; recipient: string; result: unknown;
}
export interface RetentionSettings {
  threads_days: number | null; citations_days: number | null; feedback_days: number | null;
  handoff_days: number | null; langfuse_days: number | null;
}
export interface RetentionPolicy {
  settings: RetentionSettings; configured: Partial<RetentionSettings>;
  updated_by: string; updated_at: string;
}
export interface LegalHold {
  id: string; scope: "tenant" | "customer" | "user" | "thread"; scope_id: string; reason: string;
  active: boolean; created_by: string; created_at: string;
  released_by: string | null; released_at: string | null;
}
export interface PrivacyStoreResult { status: string; [k: string]: unknown }
export interface EraseResult {
  status: string; request_id: string; message?: string;
  subject: { customer_id: string | null; user_id: string | null; thread_ids: string[]; unknown_thread_ids: string[] };
  stores: Record<string, PrivacyStoreResult>;
  holds?: LegalHold[]; note?: string;
}
export interface PrivacyRequestItem {
  id: string; kind: string; subject_type: string; subject_id: string; thread_ids: string[];
  reason: string; status: string; result: EraseResult | Record<string, unknown>;
  requested_by: string; created_at: string; completed_at: string | null;
}
export interface WfSummary { key: string; version: number; name: string | null; steps: number; inputs: Record<string, WfInput> }
export interface WfStep {
  id: string; type: string; name?: string; agent?: string; connector?: string; operation?: string; tool?: string;
  roles?: string[]; required_approvals?: number; due_hours?: number | null; if?: string; then?: string; else?: string; next?: string | null;[k: string]: unknown
}
export interface WfSpec { key: string; name: string; version: number; description: string; inputs: Record<string, WfInput>; steps: WfStep[]; start: string | null }
export interface RunView {
  id: string; workflow: string; version: number; status: string; initiator: string; outcome: string | null; error: string | null;
  current_step?: string | null;
  history: Array<{ step: string; status: string; ts: string; error?: string }>; created_at: string; updated_at: string;
  context?: Record<string, unknown>;
    delegations?: Array<{ delegate: string; task: string; n: number }>;
}
export interface AuditEventRow {
  id: string; seq: number; ts: string; actor: string; actor_type: string; action: string; resource_type: string;
  resource_id: string; outcome: string; details: Record<string, unknown>; prev_hash: string; hash: string;
}
export interface PackAssets {
  agents: number; supervisor: boolean; workflows: number; connectors: number;
  knowledge_docs: number; training_rows: number; eval_cases: number;
  samples: number; models: number;
}
export interface PackModel { role: string; tier: string; recommended: string; notes?: string }
export interface PackWidget {
  agent?: string; title: string; greeting: string;
  suggested_prompts: string[]; frontend_tools?: string[]; readable_state?: string[];
}
export interface PackSample { id: string; title: string; expect?: string }

export interface ConformanceCaseResult {
  id: string;
  passed: boolean;
  expected: string[];
  actual: string[];
  notes: string[];
}

export interface ConformanceReport {
  passed?: number;
  total?: number;
  cases?: ConformanceCaseResult[];
  error?: string;
}

export interface Pack {
  id: string;
  name: string;
  industry: string;
  version: string;
  summary: string;
  priority: "first" | "later";
  delivery: "workflow" | "agent_kit" | "both";
  audience: string[];
  assets: PackAssets;
  frameworks: string[];
  kpis: string[];
  parameters: Record<string, { default: unknown; description?: string }>;
  models: PackModel[];
  widget: PackWidget | null;
  samples: PackSample[];
  installed: boolean;
  entitled: boolean;
  installed_version: string | null;
  conformance: ConformanceReport | null;   // ← new
  upgrade_available?: boolean;
  installed_at?: string | null;
  installed_by?: string | null;
  parameter_changes?: { changed: string[]; added: string[]; removed: string[] };
  upgraded_at?: string | null;
  upgrade_history?: Array<{ from_version: string; to_version: string; at: string; by: string }>;
  rollback_versions?: Array<{ version: string; created_at: string; created_by: string }>;
}
export interface MarketplaceCatalog {
  license: {
    customer: string; edition: string; state: string;
    entitled_solutions: string[]; expires_at: number | null;
  };
  counts: { total: number; installed: number; upgrades: number; entitled: number };
  packs: Pack[];
}
export interface MarketplacePackDetail {
  id: string; name: string; industry: string; version: string; summary: string;
  priority: string; delivery: Pack["delivery"]; audience: string[]; frameworks: string[];
  kpis: Array<{ name: string; description?: string; formula?: string }>;
  parameters: Pack["parameters"]; models: PackModel[]; widget: PackWidget | null;
  samples: PackSample[];
  agents: Array<{ key: string; name: string; tools: string[] }>;
  supervisor: { key: string; name: string; delegates: string[]; limits: Record<string, unknown> } | null;
  workflows: Array<{ key: string; name: string; description?: string | null }>;
  knowledge: Array<{ collection: string; description?: string | null; documents: number; attach_to: string[] }>;
  connectors: Array<{ name: string; type: string }>;
  evals: Array<{ name: string; agent?: string | null; cases: number }>;
  training: Array<{ name?: string | null; task?: string | null; rows: number }>;
  policy: { rules: number; tool_rules: number };
  installed: boolean; entitled: boolean; installed_version: string | null;
  installed_at?: string | null; installed_by?: string | null; upgrade_available?: boolean;
  parameter_changes?: { changed: string[]; added: string[]; removed: string[] };
  conformance: ConformanceReport | null;
  upgraded_at?: string | null;
  upgrade_history?: Array<{ from_version: string; to_version: string; at: string; by: string }>;
  rollback_versions?: Array<{ version: string; created_at: string; created_by: string }>;
}
export interface PostureCheck { id: string; title: string; status: "pass" | "warn" | "fail"; detail: string; remediation: string }
export interface Readiness {
  tenant_id: string; disclaimer: string;
  posture: { checks: PostureCheck[]; score_pct: number };
  frameworks: Record<string, {
    name: string; coverage_pct: number;
    controls: Array<{ id: string; title: string; supported: boolean; gaps: string[]; roadmap: string[] }>
  }>;
}
export interface WhatsAppConfig {
  graph_configured: boolean; simulator: boolean;
  app_secret_set: boolean; verify_token_set: boolean; unsigned_webhooks_allowed: boolean;
  webhook_path: string; bound_numbers: number;
}
export interface WhatsAppAccount {
  id: string; tenant_id: string; agent_id: string; phone_number_id: string;
  display_phone: string; enabled: boolean; created_at: string;
}
export interface WhatsAppContact {
  id: string; tenant_id: string; account_id: string; wa_id: string; user_id: string;
  thread_id: string; display_name: string; created_at: string; last_seen_at: string;
  message_count?: number;
}
export interface WhatsAppMessage {
  id: string; direction: "in" | "out"; kind: string; status: string;
  body: string; created_at: string; error: string | null;
}
export interface WhatsAppTranscript { contact: WhatsAppContact; messages: WhatsAppMessage[] }
export interface WhatsAppSimResult {
  ok: boolean; reply?: string; thread_id?: string; reason?: string;
  duplicate?: boolean; contact_id?: string;
}
export interface WhatsAppSendResult { id: string; status: string; attempts: number; error: string | null }
export interface CostPerCase {
  workflow: string;
  cases: number;
  total_usd: number;
  avg_usd: number;
  total_calls: number;
  total_tokens: number;
}

export interface UsageView {
  period: string; usage: Record<string, number>;
  quotas: Record<string, { used: number; limit: number; pct: number | null; exceeded: boolean }>;
}
export interface PolicyDecision {
  action: "allow" | "log" | "redact" | "require_approval" | "block"; rule_ids: string[]; reasons: string[]; text: string | null;
  findings: Array<{ kind: string; start: number; end: number; severity: string; score: number }>;
}

export interface Guardrail {
  id: string; title: string; instruction: string; watch_phrases: string[];
  action: "block" | "log"; enabled: boolean; created_at: string; updated_at: string;
}
export interface GuardrailInput {
  title: string; instruction: string; watch_phrases: string[];
  action: "block" | "log"; enabled?: boolean;
}
export interface LicenceFeature { id: string; label: string; description: string }
export interface LicencePlan {
  id: string; tenant_id: string; customer: string; edition: string; features: string[];
  seats: number; expires_on: string | null; note: string; updated_by: string;
  updated_at: string | null; derived: boolean;
}
export interface LicenceView {
  plan: LicencePlan;
  license: {
    customer: string; edition: string; state: string; modules: string[]; solutions: string[];
    max_tenants: number; max_seats: number; deployment: string;
    quotas: Record<string, number>; exp: number | null; grace_days: number;
  };
  features: LicenceFeature[];
  editions: string[];
}
export interface LicenceUpgradeRequest {
  id: string; tenant_id: string; current_edition: string; target_edition: string;
  add_features: string[]; message: string; status: string; requested_by: string; created_at: string;
}
export interface DemoAccount { id: string; name: string; title: string; description: string; roles: string[] }
export interface DemoAccounts { enabled: boolean; ready?: boolean; tenant?: string; accounts: DemoAccount[] }

async function download(path: string, filename: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    "X-Tenant-Id": sessionStorage.getItem("nmb_tenant") || "default"
  };
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${await res.text()}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export interface ConnectorSummary { name: string; type: string; enabled: boolean; needs_setup: boolean; operations: string[] }
export interface ConnectorDetail {
  name: string; type: string; enabled: boolean; needs_setup: boolean;
  config: Record<string, any>; egress_allowed_hosts: string[]
}

export interface ToEvalCaseRequest {
  dataset_id: string;
  input?: string | null;
  criteria?: string | null;
  expect_delegations?: string[] | null;
}
export interface ShadowReport {
  workflow: string;
  version: number;
  window_days: number;
  total: number;
  matched: number;
  agreement: number | null;
  matrix: Record<string, Record<string, number>>;
  results: Array<{
    original_id: string; original_shape: string;
    shadow_shape: string; matches: boolean; error: string | null;
  }>;
}

export interface WorkflowRule {
  id: string;
  tenant_id: string;
  workflow_key: string;
  name: string;
  when_expr: string;
  action: "route_to" | "block";
  target_step: string | null;
  enabled: boolean;
  created_by: string;
  created_from_approval_id: string | null;
  created_at: string;
  fired_count: number;
  last_fired_at: string | null;
}
export interface WorkflowRuleInput {
  name?: string;
  when_expr: string;
  action?: "route_to" | "block";
  target_step?: string | null;
  enabled?: boolean;
  created_from_approval_id?: string | null;
}

// ── API ────────────────────────────────────────────────────────────
export const api = {
   
  runSample: (solution: string, caseId: string) =>
    request<RunView & { expect?: string }>(
      `/enterprise/solutions/${encodeURIComponent(solution)}/samples/${encodeURIComponent(caseId)}/run`,
      { method: "POST" },
    ),
  solutionEmbed: (solution: string) =>
    request<{ agent_id: string; widget: Record<string, unknown>; script: string; steps: string[] }>(
      `/enterprise/solutions/${encodeURIComponent(solution)}/embed`,
    ),

  // system
  status: (tenant = "default") => request<SystemStatus>(`/system/status?tenant_id=${tenant}`),
  connections: () => request<Record<string, Connection>>("/system/connections"),
  putConnection: (name: string, body: Record<string, unknown>) =>
    request(`/system/connections/${name}`, { method: "PUT", body: JSON.stringify(body) }),
  testConnection: (name: string) =>
    request<ServiceStatus>(`/system/connections/${name}/test`, { method: "POST" }),
  governanceCost: (days = 30) =>
    request<CostPerCase[]>(`/enterprise/governance/cost?days=${days}`),

  listConnectors: () => request<ConnectorSummary[]>("/enterprise/connectors"),
  getConnector: (name: string) => request<ConnectorDetail>(`/enterprise/connectors/${encodeURIComponent(name)}`),
  connectorEgress: () => request<{ egress_allowed_hosts: string[] }>("/enterprise/connectors/egress"),
  saveConnector: (name: string, body: { type: string; config: Record<string, unknown>; enabled?: boolean }) =>
    request(`/enterprise/connectors/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(body) }),
  setConnectorEnabled: (name: string, enabled: boolean) =>
    request(`/enterprise/connectors/${encodeURIComponent(name)}/enabled`, { method: "POST", body: JSON.stringify({ enabled }) }),
  deleteConnector: (name: string) => request(`/enterprise/connectors/${encodeURIComponent(name)}`, { method: "DELETE" }),
  testConnector: (name: string, operation: string, params: Record<string, unknown>) =>
    request<{ ok: boolean; result: unknown; error: string | null }>(
      `/enterprise/connectors/${encodeURIComponent(name)}/test/${encodeURIComponent(operation)}`,
      { method: "POST", body: JSON.stringify(params) }),



  approvalToEvalCase: (approvalId: string, body: ToEvalCaseRequest) =>
    request<{ case_id: string; dataset_id: string; decision: string; input: string; criteria: string }>(
      `/enterprise/approvals/${approvalId}/to-eval-case`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  workflowShadow: (key: string, body: { days?: number; limit?: number } = {}) =>
    request<ShadowReport>(
      `/enterprise/workflows/${encodeURIComponent(key)}/shadow`,
      { method: "POST", body: JSON.stringify(body) },
    ),   
  // Admin token (legacy) or a named SSO/JWT user: either is a valid console login.
  authCheck: async () => {
    try { return await request<{ ok: boolean }>("/auth/check"); }
    catch { await request("/enterprise/me"); return { ok: true }; }
  },

  

  // agents
  listAgents: (tenant = "default") => request<Agent[]>(`/agents?tenant_id=${tenant}`),
  getAgent: (id: string) => request<Agent>(`/agents/${id}`),
  createAgent: (body: Partial<Agent>) =>
    request<Agent>("/agents", { method: "POST", body: JSON.stringify(body) }),
  patchAgent: (id: string, body: Partial<Agent>) =>
    request<Agent>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAgent: (id: string) => request(`/agents/${id}`, { method: "DELETE" }),
  publishAgent: (id: string, note = "", override_reason = "") =>
    request<{
      agent_id: string;
      version: number;
      published: boolean;
      conformance: { passed: number; total: number; override: true } | null;
      eval: {
        pass_rate: number | null;
        threshold: number | null;
        failures: Array<{ dimension: string; pass_rate: number | null; threshold: number }>;
        override: true;
      } | null;
      provenance: Record<string, unknown>;
    }>(`/agents/${id}/publish`, {
      method: "POST",
      body: JSON.stringify({ note, override_reason }),
    }),
  listVersions: (id: string) => request<Array<Record<string, unknown>>>(`/agents/${id}/versions`),
  rollback: (id: string, version: number, restore = false) =>
    request(`/agents/${id}/versions/${version}/rollback?restore_draft=${restore}`, { method: "POST" }),
  testAgent: (body: { agent_id: string; message: string; tenant_id?: string; use_draft?: boolean }) =>
    request(`/runs/invoke`, { method: "POST", body: JSON.stringify(body) }),

  // subagents
  listSubagents: (t = "default") => request<SubAgent[]>(`/subagents?tenant_id=${t}`),
  createSubagent: (body: Partial<SubAgent>) =>
    request<SubAgent>("/subagents", { method: "POST", body: JSON.stringify(body) }),
  patchSubagent: (id: string, body: Partial<SubAgent>) =>
    request<SubAgent>(`/subagents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSubagent: (id: string) => request(`/subagents/${id}`, { method: "DELETE" }),
  testSubagent: (id: string, message: string, tenant = "default") =>
    request<{ output: string; trace: unknown[] }>(`/subagents/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ message, tenant_id: tenant }),
    }),

  // prompts
  listPrompts: () => request<{ data: unknown[] }>("/prompts"),
  getPrompt: (name: string, label = "latest") =>
    request<Record<string, unknown>>(`/prompts/${encodeURIComponent(name)}?label=${label}`),
  getPromptVersion: (name: string, version: number) =>
    request<Record<string, unknown>>(`/prompts/${encodeURIComponent(name)}/versions/${version}`),
  createPrompt: (body: Record<string, unknown>) =>
    request("/prompts", { method: "POST", body: JSON.stringify(body) }),
  setPromptLabels: (name: string, version: number, labels: string[]) =>
    request(`/prompts/${encodeURIComponent(name)}/versions/${version}/labels`, {
      method: "PATCH",
      body: JSON.stringify({ labels }),
    }),
  testPrompt: (body: Record<string, unknown>) =>
    request<{ messages: unknown[]; results: Array<Record<string, unknown>> }>("/prompts/test", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // tools
  listTools: (t = "default") => request<Tool[]>(`/tools?tenant_id=${t}`),
  createTool: (body: Partial<Tool>) =>
    request<Tool>("/tools", { method: "POST", body: JSON.stringify(body) }),
  deleteTool: (id: string) => request(`/tools/${id}`, { method: "DELETE" }),
  testTool: (id: string, input: string) =>
    request<{ ok: boolean; result: string }>(`/tools/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ input }),
    }),

  // rag
  listRag: (t = "default") => request<Rag[]>(`/rag?tenant_id=${t}`),
  createRag: (body: Partial<Rag>) =>
    request<Rag>("/rag", { method: "POST", body: JSON.stringify(body) }),
  deleteRag: (id: string) => request(`/rag/${id}`, { method: "DELETE" }),
  uploadRag: async (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const res = await fetch(`${API_BASE}/rag/${id}/upload`, {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  },
  queryRag: (id: string, query: string, top_k?: number) =>
    request<{ results: { content: string; metadata: Record<string, unknown> }[] }>(
      `/rag/${id}/query`,
      { method: "POST", body: JSON.stringify({ query, top_k }) },
    ),

  // models
  listModels: (t = "default") => request<ModelCfg[]>(`/models?tenant_id=${t}`),
  createModel: (body: Partial<ModelCfg>) =>
    request<ModelCfg>("/models", { method: "POST", body: JSON.stringify(body) }),
  patchModel: (id: string, body: Partial<ModelCfg>) =>
    request<ModelCfg>(`/models/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteModel: (id: string) => request(`/models/${id}`, { method: "DELETE" }),
  testModel: (id: string) =>
    request<{
      ok: boolean; latency_ms: number; reply: string;
      tool_calls?: { ok: boolean; name?: string; args?: Record<string, unknown>; error?: string; skipped?: string; latency_ms?: number };
    }>(`/models/${id}/test`, { method: "POST" }),
  listProviders: () =>
    request<Array<{
      id: string; label: string; base_url: string | null;
      api_key_env: string | null; local: boolean; hint: string;
    }>>("/models/providers"),

  // inference
  listOllama: () =>
    request<Array<{ name: string; size: number; params: string | null; family: string | null }>>(
      "/inference/ollama/models",
    ),
  deleteOllama: (name: string) =>
    request(`/inference/ollama/models/${encodeURIComponent(name)}`, { method: "DELETE" }),
  pullOllama: (name: string) =>
    fetch(`${API_BASE}/inference/ollama/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ name }),
    }),
  catalog: () =>
    request<Array<{ runtime: string; model_name: string; provider: string; base_url: string }>>(
      "/inference/catalog",
    ),
  chat: (body: { model: string; messages: Array<{ role: string; content: string }>; params?: Record<string, unknown>; tenant_id?: string }) =>
    request<{ output: string; latency_ms: number; usage: Record<string, number> }>("/inference/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // training
  listTrainingDatasets: () =>
    request<Array<{ name: string; rows: number; updated_at: number }>>("/training/datasets"),
  createTrainingDataset: (body: { name: string; source?: string; rows?: unknown[]; agent_id?: string }) =>
    request("/training/datasets", { method: "POST", body: JSON.stringify(body) }),
  deleteTrainingDataset: (name: string) =>
    request<{ ok: boolean }>(`/training/datasets/${encodeURIComponent(name)}`, { method: "DELETE" }),
  downloadTrainingDataset: async (name: string) => {
    const res = await fetch(`${API_BASE}/training/datasets/${encodeURIComponent(name)}/download`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json())?.detail ?? detail; } catch { /* not JSON */ }
      throw new ApiError(res.status, `${res.status} ${detail}`);
    }
    return res.blob();
  },
  listTrainingJobs: () =>
    request<{ runner_online: boolean; jobs: TrainingJob[] }>("/training/jobs"),
  createTrainingJob: (body: Record<string, unknown>) =>
    request<TrainingJob>("/training/jobs", { method: "POST", body: JSON.stringify(body) }),
  getTrainingJob: (id: string) => request<TrainingJob>(`/training/jobs/${id}`),
  getTrainingLog: (id: string, lines = 200) =>
    request<{ log: string }>(`/training/jobs/${id}/log?lines=${lines}`),
  cancelTrainingJob: (id: string) =>
    request(`/training/jobs/${id}/cancel`, { method: "POST" }),
  getTrainingPlayground: () => request<PlaygroundInfo>("/training/playground"),
  runTrainingPlayground: (body: { corpus: string; epochs: number; learning_rate: number; temperature: number; prefix: string }) =>
    request<PlaygroundResult>("/training/playground/train", { method: "POST", body: JSON.stringify(body) }),
  trainingColab: () => request<ColabInfo>("/training/colab"),
  downloadColabNotebook: async (body: {
    mode: string; dataset: string; base_model: string; epochs: number; learning_rate: number;
    batch_size: number; grad_accum: number; max_seq_length: number; prompt: string;
  }) => {
    const res = await fetch(`${API_BASE}/training/colab`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json())?.detail ?? detail; } catch { /* not JSON */ }
      throw new ApiError(res.status, `${res.status} ${detail}`);
    }
    return res.blob();
  },

  // evals
  listEvalDatasets: (t = "default") => request<EvalDataset[]>(`/evals/datasets?tenant_id=${t}`),
  createEvalDataset: (body: { name: string; agent_id: string; tenant_id?: string }) =>
    request<EvalDataset>("/evals/datasets", { method: "POST", body: JSON.stringify(body) }),
  deleteEvalDataset: (id: string) => request(`/evals/datasets/${id}`, { method: "DELETE" }),
  listEvalCases: (dsId: string) => request<EvalCase[]>(`/evals/datasets/${dsId}/cases`),
  addEvalCase: (dsId: string, body: Partial<EvalCase>) =>
    request<EvalCase>(`/evals/datasets/${dsId}/cases`, { method: "POST", body: JSON.stringify(body) }),
  deleteEvalCase: (id: string) => request(`/evals/cases/${id}`, { method: "DELETE" }),
  runEval: (dsId: string, target: "draft" | "published" = "published") =>
    request<EvalRun>(`/evals/datasets/${dsId}/run`, { method: "POST", body: JSON.stringify({ target }) }),
  listEvalRuns: (dsId: string) => request<EvalRun[]>(`/evals/runs?dataset_id=${dsId}`),

  // locale
  listLocaleProfiles: (t = "default") =>
    request<LocaleProfileRow[]>(`/locale/profiles?tenant_id=${t}`),
  createLocaleProfile: (body: LocaleProfileInput & { tenant_id?: string }) =>
    request<LocaleProfile>("/locale/profiles", { method: "POST", body: JSON.stringify(body) }),
  getLocaleProfile: (id: string) => request<LocaleDetail>(`/locale/profiles/${id}`),
  patchLocaleProfile: (id: string, body: Partial<LocaleProfileInput>) =>
    request<LocaleProfile & { agents_refreshed: number }>(`/locale/profiles/${id}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  deleteLocaleProfile: (id: string) =>
    request<{ deleted: string; agents_detached: number }>(`/locale/profiles/${id}`, { method: "DELETE" }),
  listLocaleExamples: (pid: string) => request<LocaleExample[]>(`/locale/profiles/${pid}/examples`),
  createLocaleExample: (
    pid: string,
    body: { input: string; corrected_output: string; bad_output?: string | null; note?: string; source?: string },
  ) => request<LocaleExample & { agents_refreshed: number }>(`/locale/profiles/${pid}/examples`, {
    method: "POST", body: JSON.stringify(body),
  }),
  patchLocaleExample: (id: string, body: Partial<Pick<LocaleExample, "input" | "corrected_output" | "bad_output" | "note" | "enabled">>) =>
    request<LocaleExample & { agents_refreshed: number }>(`/locale/examples/${id}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  deleteLocaleExample: (id: string) =>
    request<{ deleted: string; agents_refreshed: number }>(`/locale/examples/${id}`, { method: "DELETE" }),
  attachLocale: (pid: string, agent_id: string) =>
    request<{ agent_id: string; profile_id: string; subagent_id: string; subagent_ids: string[]; examples?: number }>(
      `/locale/profiles/${pid}/attach`, { method: "POST", body: JSON.stringify({ agent_id }) },
    ),
  detachLocale: (pid: string, agent_id: string) =>
    request<{ agent_id: string; profile_id: string; subagent_id: string; subagent_ids: string[] }>(
      `/locale/profiles/${pid}/detach`, { method: "POST", body: JSON.stringify({ agent_id }) },
    ),
  previewLocale: (pid: string, body: { text?: string; language?: string } = {}) =>
    request<LocalePreview>(`/locale/profiles/${pid}/preview`, { method: "POST", body: JSON.stringify(body) }),

  // observability
  listTraces: (params: Record<string, string | number> = {}) =>
    request<{ data: Array<Record<string, unknown>> }>(
      `/observability/traces?${new URLSearchParams(params as Record<string, string>)}`,
    ),
  getTrace: (id: string) => request<Record<string, unknown>>(`/observability/traces/${id}`),
  dailyMetrics: (days = 14) =>
    request<{ data: Array<Record<string, unknown>> }>(`/observability/metrics/daily?days=${days}`),
  obsLink: (kind = "traces") =>
    request<{ url: string }>(`/observability/link?kind=${kind}`),

  // keys
  listKeys: (t = "default") => request<ApiKey[]>(`/keys?tenant_id=${t}`),
  createKey: (body: {
    name: string; agent_id: string; tenant_id?: string; kind?: string;
    allowed_origins?: string[]; rate_limit_per_min?: number;
  }) => request<ApiKey>("/keys", { method: "POST", body: JSON.stringify(body) }),
  revokeKey: (id: string) => request(`/keys/${id}`, { method: "DELETE" }),
  // ── enterprise ──

   listWorkflowRules: (key: string) =>
    request<WorkflowRule[]>(`/enterprise/workflows/${encodeURIComponent(key)}/rules`),
  createWorkflowRule: (key: string, body: WorkflowRuleInput) =>
    request<WorkflowRule>(`/enterprise/workflows/${encodeURIComponent(key)}/rules`, {
      method: "POST", body: JSON.stringify(body),
    }),
  patchWorkflowRule: (key: string, id: string, body: Partial<WorkflowRuleInput>) =>
    request<WorkflowRule>(`/enterprise/workflows/${encodeURIComponent(key)}/rules/${id}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  deleteWorkflowRule: (key: string, id: string) =>
    request<{ deleted: string }>(`/enterprise/workflows/${encodeURIComponent(key)}/rules/${id}`, {
      method: "DELETE",
    }),
    
  me: () => request<Me>("/enterprise/me"),
  listApprovals: (status = "pending") => request<ApprovalItem[]>(`/enterprise/approvals?status=${status}`),
  decideApproval: (id: string, decision: "approve" | "reject", comment = "") =>
    request<{ id: string; status: string }>(`/enterprise/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision, comment }) }),
  sweepApprovals: () => request<{ escalated: number; expired: number }>("/enterprise/approvals/sweep", { method: "POST" }),
  listHandoffs: (status?: string) => request<HandoffItem[]>(`/enterprise/handoffs${status ? `?status=${status}` : ""}`),
  getHandoff: (id: string) => request<HandoffDetail>(`/enterprise/handoffs/${id}`),
  claimHandoff: (id: string) => request<HandoffItem>(`/enterprise/handoffs/${id}/claim`, { method: "POST" }),
  replyHandoff: (id: string, text: string) =>
    request<{ handoff: HandoffItem; message: HandoffMessage }>(`/enterprise/handoffs/${id}/reply`, {
      method: "POST", body: JSON.stringify({ text }),
    }),
  resolveHandoff: (id: string, note = "") =>
    request<HandoffItem>(`/enterprise/handoffs/${id}/resolve`, {
      method: "POST", body: JSON.stringify({ note }),
    }),
  summariseHandoff: (id: string, max_chars = 1200) =>
    request<HandoffSummary>(`/enterprise/handoffs/${id}/summary`, {
      method: "POST", body: JSON.stringify({ max_chars }),
    }),
  forwardHandoff: (id: string, body: {
    channel?: "connector" | "email" | "copy"; connector?: string; operation?: string;
    subject?: string; note?: string; recipient?: string; summary?: string; compress?: boolean;
  }) =>
    request<HandoffForwardResult>(`/enterprise/handoffs/${id}/forward`, {
      method: "POST", body: JSON.stringify(body),
    }),
  getRetention: () => request<RetentionPolicy>("/enterprise/privacy/retention"),
  putRetention: (settings: Partial<RetentionSettings>) =>
    request<RetentionPolicy>("/enterprise/privacy/retention", {
      method: "PUT", body: JSON.stringify({ settings }),
    }),
  listHolds: (active = true) => request<{ holds: LegalHold[] }>(`/enterprise/privacy/holds?active=${active}`),
  createHold: (scope: string, scope_id: string, reason: string) =>
    request<{ hold: LegalHold }>("/enterprise/privacy/holds", {
      method: "POST", body: JSON.stringify({ scope, scope_id, reason }),
    }),
  releaseHold: (id: string) =>
    request<{ hold: LegalHold }>(`/enterprise/privacy/holds/${id}/release`, { method: "POST" }),
  eraseSubject: (body: { customer_id?: string; user_id?: string; thread_ids?: string[]; reason?: string }) =>
    request<EraseResult>("/enterprise/privacy/erase", { method: "POST", body: JSON.stringify(body) }),
  listPrivacyRequests: (limit = 50) =>
    request<{ requests: PrivacyRequestItem[] }>(`/enterprise/privacy/requests?limit=${limit}`),
  exportSubject: (customer_id: string, user_id: string, include_transcript = false) => {
    const q = new URLSearchParams();
    if (customer_id) q.set("customer_id", customer_id);
    if (user_id) q.set("user_id", user_id);
    if (include_transcript) q.set("include_transcript", "true");
    return request<Record<string, unknown>>(`/enterprise/privacy/subject?${q.toString()}`);
  },
  listWorkflows: () => request<WfSummary[]>("/enterprise/workflows"),
  saveWorkflow: (spec: {
    key: string; name?: string; description?: string; inputs?: Record<string, WfInput>;
    steps: WfStep[]; start?: string | null;
  }) => request<{ key: string; version: number }>("/enterprise/workflows", {
    method: "POST", body: JSON.stringify(spec),
  }),
  getWorkflow: (key: string, version?: number) =>
    request<WfSpec>(`/enterprise/workflows/${encodeURIComponent(key)}${version ? `?version=${version}` : ""}`),
  runWorkflow: (key: string, inputs: Record<string, unknown>, wait = false) =>
    request<RunView>(`/enterprise/workflows/${encodeURIComponent(key)}/runs`, { method: "POST", body: JSON.stringify({ inputs, wait }) }),
  listRuns: (status?: string) => request<RunView[]>(`/enterprise/runs${status ? `?status=${status}` : ""}`),
  getRun: (id: string) => request<RunView>(`/enterprise/runs/${id}`),
  cancelRun: (id: string) => request<RunView>(`/enterprise/runs/${id}/cancel`, { method: "POST" }),
  queryAudit: (p: { action?: string; actor?: string; resource_id?: string; limit?: number } = {}) => {
    const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return request<AuditEventRow[]>(`/enterprise/audit?${q}`);
  },
  verifyAudit: () => request<{ ok: boolean; checked: number; first_bad_seq: number | null; reason: string }>("/enterprise/audit/verify"),
  auditCheckpoint: () => request<Record<string, unknown>>("/enterprise/audit/checkpoint"),
  exportAudit: () => download("/enterprise/audit/export", "audit-export.jsonl"),
  marketplace: () => request<MarketplaceCatalog>("/enterprise/marketplace"),
  marketplacePack: (id: string) =>
    request<MarketplacePackDetail>(`/enterprise/marketplace/${encodeURIComponent(id)}`),
  upgradePack: (id: string) =>
    request<{
      solution: string;
      from_version: string;
      to_version: string;
      parameters: Record<string, unknown>;
      parameter_changes: { changed: string[]; added: string[]; removed: string[] };
      created: Record<string, unknown>;
    }>(`/enterprise/marketplace/${encodeURIComponent(id)}/upgrade`, { method: "POST" }),
  rollbackPack: (id: string, version: string) =>
    request<{
      solution: string;
      from_version: string;
      to_version: string;
      parameters: Record<string, unknown>;
      created: Record<string, unknown>;
    }>(`/enterprise/marketplace/${encodeURIComponent(id)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  installPack: (id: string, parameters: Record<string, unknown>) =>
    request<{
      solution: string;
      version: string;
      created: {
        agents: Record<string, string>;
        workflows: Array<{ key: string; version: number }>;
        connectors: string[];
        supervisor?: string;
        knowledge?: Array<{
          collection: string;
          name: string;
          docs: number;
          attach_to: string[];
          attached_to: string[];
          status: string;
        }>;
        training?: Array<{ name: string; rows: number; task?: string }>;
        models?: PackModel[];
        samples?: PackSample[];
        widget?: PackWidget | null;
        conformance?: ConformanceReport | null;   // ← new
      };
    }>(`/enterprise/solutions/${id}/install`, {
      method: "POST",
      body: JSON.stringify({ parameters }),
    }),
  readiness: () => request<Readiness>("/enterprise/compliance/readiness"),
  capabilities: () => request<Record<string, { description: string; status: string }>>("/enterprise/compliance/capabilities"),
  evidence: () => request<Record<string, unknown>>("/enterprise/compliance/evidence"),
  license: () => request<Record<string, unknown>>("/enterprise/license"),
  usage: () => request<UsageView>("/enterprise/usage"),
  exportUsage: () => download("/enterprise/usage/export.csv", "usage.csv"),
  testPolicy: (text: string, direction: string) =>
    request<PolicyDecision>("/enterprise/policies/test", { method: "POST", body: JSON.stringify({ text, direction }) }),

  // guardrails / injection shield
  guardrails: () => request<Guardrail[]>("/enterprise/guardrails"),
  createGuardrail: (body: GuardrailInput) =>
    request<Guardrail>("/enterprise/guardrails", { method: "POST", body: JSON.stringify(body) }),
  patchGuardrail: (id: string, body: Partial<GuardrailInput>) =>
    request<Guardrail>(`/enterprise/guardrails/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteGuardrail: (id: string) =>
    request(`/enterprise/guardrails/${id}`, { method: "DELETE" }),
  guardrailPresets: () =>
    request<{ added: number; instructions: Guardrail[] }>("/enterprise/guardrails/presets", { method: "POST" }),
  testGuardrail: (text: string, direction = "input") =>
    request<PolicyDecision>("/enterprise/guardrails/test", { method: "POST", body: JSON.stringify({ text, direction }) }),

  // licence plan + upgrade requests
  licencePlan: () => request<LicenceView>("/enterprise/licence/plan"),
  saveLicencePlan: (body: {
    customer: string; edition: string; features: string[]; seats: number;
    expires_on: string | null; note: string;
  }) => request<{ plan: LicencePlan; features: LicenceFeature[]; editions: string[] }>(
    "/enterprise/licence/plan", { method: "PUT", body: JSON.stringify(body) }),
  licenceRequests: () => request<LicenceUpgradeRequest[]>("/enterprise/licence/upgrade-requests"),
  requestLicenceUpgrade: (body: { target_edition: string; add_features: string[]; message: string }) =>
    request<LicenceUpgradeRequest>("/enterprise/licence/upgrade-requests", {
      method: "POST", body: JSON.stringify(body),
    }),

  // WhatsApp channel
  whatsappConfig: () => request<WhatsAppConfig>("/enterprise/whatsapp/config"),
  whatsappAccounts: () => request<WhatsAppAccount[]>("/enterprise/whatsapp/accounts"),
  saveWhatsAppAccount: (body: {
    phone_number_id: string; agent_id: string; display_phone: string; enabled: boolean;
  }) => request<WhatsAppAccount>("/enterprise/whatsapp/accounts", { method: "POST", body: JSON.stringify(body) }),
  deleteWhatsAppAccount: (id: string) =>
    request<{ deleted: string }>(`/enterprise/whatsapp/accounts/${id}`, { method: "DELETE" }),
  whatsappContacts: () => request<WhatsAppContact[]>("/enterprise/whatsapp/contacts"),
  whatsappTranscript: (waId: string, limit = 100) =>
    request<WhatsAppTranscript>(`/enterprise/whatsapp/contacts/${encodeURIComponent(waId)}/messages?limit=${limit}`),
  simulateWhatsApp: (body: { wa_id: string; text: string; display_name?: string }) =>
    request<WhatsAppSimResult>("/enterprise/whatsapp/simulate", { method: "POST", body: JSON.stringify(body) }),
  notifyWhatsApp: (body: { wa_id: string; text: string; subject?: string }) =>
    request<WhatsAppSendResult>("/enterprise/whatsapp/notify", { method: "POST", body: JSON.stringify(body) }),
  runWhatsAppTask: (body: {
    wa_id: string; workflow_key: string; inputs: Record<string, unknown>; wait: boolean;
  }) => request<RunView & { wa_id: string; initiator: string }>("/enterprise/whatsapp/tasks", {
    method: "POST", body: JSON.stringify(body),
  }),
  dispatchNotifications: () =>
    request<Record<string, number>>("/enterprise/notifications/dispatch", { method: "POST" }),

  // demo sign-in (disabled outside demo deployments)
  demoAccounts: () => request<DemoAccounts>("/auth/demo/accounts"),
  demoLogin: (account: string) =>
    request<{ token: string; account: DemoAccount; tenant: string; expires_in: number }>(
      "/auth/demo/login", { method: "POST", body: JSON.stringify({ account }) }),

  
};
