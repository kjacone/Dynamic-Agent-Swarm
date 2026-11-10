const BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8000").replace(/\/$/, "");
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

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
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
}
export interface EvalRun {
  id: string; dataset_id: string; agent_id: string;
  target: "draft" | "published"; agent_version: number | null;
  status: string; results: Array<Record<string, unknown>>;
  summary: Record<string, unknown>; created_at: string;
}
export interface TrainingJob {
  id: string; name: string; status: string;
  params: Record<string, unknown>;
  created_at: number;
  progress?: { step?: number; total?: number; percentage?: number; loss?: number; epoch?: number };
  loss_series?: { step: number; loss: number }[];
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
export interface WfSummary { key: string; version: number; name: string | null; steps: number; inputs: Record<string, WfInput> }
export interface WfStep {
  id: string; type: string; name?: string; agent?: string; connector?: string; operation?: string; tool?: string;
  roles?: string[]; required_approvals?: number; due_hours?: number | null; if?: string; then?: string; else?: string; next?: string | null;[k: string]: unknown
}
export interface WfSpec { key: string; name: string; version: number; description: string; inputs: Record<string, WfInput>; steps: WfStep[]; start: string | null }
export interface RunView {
  id: string; workflow: string; version: number; status: string; initiator: string; outcome: string | null; error: string | null;
  history: Array<{ step: string; status: string; ts: string; error?: string }>; created_at: string; updated_at: string;
  context?: Record<string, unknown>;
}
export interface AuditEventRow {
  id: string; seq: number; ts: string; actor: string; actor_type: string; action: string; resource_type: string;
  resource_id: string; outcome: string; details: Record<string, unknown>; prev_hash: string; hash: string;
}
export interface Pack {
  id: string; name: string; industry: string; version: string; summary: string; priority: "first" | "later";
  agents: number; workflows: number; frameworks: string[]; kpis: string[];
  parameters: Record<string, { default: unknown; description?: string }>;
  installed: boolean; entitled: boolean; installed_version: string | null;
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
export interface UsageView {
  period: string; usage: Record<string, number>;
  quotas: Record<string, { used: number; limit: number; pct: number | null; exceeded: boolean }>;
}
export interface PolicyDecision {
  action: "allow" | "log" | "redact" | "require_approval" | "block"; rule_ids: string[]; reasons: string[]; text: string | null;
  findings: Array<{ kind: string; start: number; end: number; severity: string; score: number }>;
}

async function download(path: string, filename: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
    "X-Tenant-Id": sessionStorage.getItem("nmb_tenant") || "default"
  };
  const res = await fetch(`${BASE}${path}`, { headers });
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

// ── API ────────────────────────────────────────────────────────────
export const api = {
  // system
  status: (tenant = "default") => request<SystemStatus>(`/system/status?tenant_id=${tenant}`),
  connections: () => request<Record<string, Connection>>("/system/connections"),
  putConnection: (name: string, body: Record<string, unknown>) =>
    request(`/system/connections/${name}`, { method: "PUT", body: JSON.stringify(body) }),
  testConnection: (name: string) =>
    request<ServiceStatus>(`/system/connections/${name}/test`, { method: "POST" }),


    listConnectors: () => request<ConnectorSummary[]>("/enterprise/connectors"),
  getConnector: (name: string) => request<ConnectorDetail>(`/enterprise/connectors/${encodeURIComponent(name)}`),
  saveConnector: (name: string, body: { type: string; config: Record<string, unknown>; enabled?: boolean }) =>
    request(`/enterprise/connectors/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(body) }),
  setConnectorEnabled: (name: string, enabled: boolean) =>
    request(`/enterprise/connectors/${encodeURIComponent(name)}/enabled`, { method: "POST", body: JSON.stringify({ enabled }) }),
  deleteConnector: (name: string) => request(`/enterprise/connectors/${encodeURIComponent(name)}`, { method: "DELETE" }),
  testConnector: (name: string, operation: string, params: Record<string, unknown>) =>
    request<{ ok: boolean; result: unknown; error: string | null }>(
      `/enterprise/connectors/${encodeURIComponent(name)}/test/${encodeURIComponent(operation)}`,
      { method: "POST", body: JSON.stringify(params) }),

      
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
  publishAgent: (id: string, note = "") =>
    request(`/agents/${id}/publish`, { method: "POST", body: JSON.stringify({ note }) }),
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
    const res = await fetch(`${BASE}/rag/${id}/upload`, {
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
    request<{ ok: boolean; latency_ms: number; reply: string }>(`/models/${id}/test`, { method: "POST" }),

  // inference
  listOllama: () =>
    request<Array<{ name: string; size: number; params: string | null; family: string | null }>>(
      "/inference/ollama/models",
    ),
  deleteOllama: (name: string) =>
    request(`/inference/ollama/models/${encodeURIComponent(name)}`, { method: "DELETE" }),
  pullOllama: (name: string) =>
    fetch(`${BASE}/inference/ollama/pull`, {
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
  listTrainingJobs: () =>
    request<{ runner_online: boolean; jobs: TrainingJob[] }>("/training/jobs"),
  createTrainingJob: (body: Record<string, unknown>) =>
    request<TrainingJob>("/training/jobs", { method: "POST", body: JSON.stringify(body) }),
  getTrainingJob: (id: string) => request<TrainingJob>(`/training/jobs/${id}`),
  getTrainingLog: (id: string, lines = 200) =>
    request<{ log: string }>(`/training/jobs/${id}/log?lines=${lines}`),
  cancelTrainingJob: (id: string) =>
    request(`/training/jobs/${id}/cancel`, { method: "POST" }),

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
  me: () => request<Me>("/enterprise/me"),
  listApprovals: (status = "pending") => request<ApprovalItem[]>(`/enterprise/approvals?status=${status}`),
  decideApproval: (id: string, decision: "approve" | "reject", comment = "") =>
    request<{ id: string; status: string }>(`/enterprise/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision, comment }) }),
  sweepApprovals: () => request<{ escalated: number; expired: number }>("/enterprise/approvals/sweep", { method: "POST" }),
  listWorkflows: () => request<WfSummary[]>("/enterprise/workflows"),
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
  listPacks: () => request<Pack[]>("/enterprise/solutions"),
  installPack: (id: string, parameters: Record<string, unknown>) =>
    request<{ solution: string; version: string; created: { agents: Record<string, string>; workflows: Array<{ key: string; version: number }>; connectors: string[] } }>(
      `/enterprise/solutions/${id}/install`, { method: "POST", body: JSON.stringify({ parameters }) }),
  readiness: () => request<Readiness>("/enterprise/compliance/readiness"),
  capabilities: () => request<Record<string, { description: string; status: string }>>("/enterprise/compliance/capabilities"),
  evidence: () => request<Record<string, unknown>>("/enterprise/compliance/evidence"),
  license: () => request<Record<string, unknown>>("/enterprise/license"),
  usage: () => request<UsageView>("/enterprise/usage"),
  exportUsage: () => download("/enterprise/usage/export.csv", "usage.csv"),
  testPolicy: (text: string, direction: string) =>
    request<PolicyDecision>("/enterprise/policies/test", { method: "POST", body: JSON.stringify({ text, direction }) }),
};