"use client";
import { useContext, useState } from "react";
import { AgentContext } from "../../agent-context";
import { ExpandableText, KeyValueTable } from "../ui/KeyValueTable";
import { ResultCards, imageOf, listItems, priceOf } from "./ResultCards";

/**
 * One rendering contract for tool output, whatever the model produced:
 *
 *   { "ui": { "type": "cards", "title": "Matching listings", "items": [...] } }
 *
 * `ui` may hold one spec or an array of specs. A known `type` at the top level is
 * accepted as well. Anything else falls back to inference: a list renders as cards,
 * an object as a table, text as clipped text. Unknown types fall back the same way,
 * so a new or misspelled component never breaks the transcript.
 */
export type UiSpec = Record<string, unknown> & { type: string };

const TYPES: Record<string, string> = {
  cards: "cards", card: "cards", list: "cards", gallery: "cards", grid: "cards", products: "cards", results: "cards",
  table: "table", datatable: "table", rows: "table",
  stats: "stats", kpi: "stats", kpis: "stats", metrics: "stats", metric: "stats", summary: "stats",
  chart: "chart", bar: "chart", bars: "chart", line: "chart", graph: "chart", trend: "chart",
  timeline: "timeline", steps: "timeline", events: "timeline", activity: "timeline",
  status: "status", badges: "status", checks: "status", health: "status",
  form: "form", fields: "form", input: "form",
  detail: "detail", keyvalue: "detail", "key-value": "detail", kv: "detail", properties: "detail", record: "detail",
  alert: "alert", notice: "alert", callout: "alert", banner: "alert",
  actions: "actions", links: "actions", chips: "actions", suggestions: "actions", quick_replies: "actions",
  text: "text", markdown: "text", note: "text",
};

const WRAPPERS = ["ui", "blocks", "components", "sections", "view"];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function tryJson(text: string): unknown {
  const raw = text.trim().replace(/^```(?:json|JSON)?\s*/, "").replace(/```$/, "").trim();
  if (!raw || !/^[[{"]/.test(raw)) return text;
  try { return JSON.parse(raw); } catch { return text; }
}

function asSpec(v: unknown): UiSpec | null {
  if (typeof v === "string") return asSpec(tryJson(v));
  if (!isObj(v)) return null;
  const raw = String(v.type ?? v.kind ?? v.component ?? v.render ?? "").toLowerCase().replace(/\s+/g, "_");
  const type = TYPES[raw];
  return type ? { ...v, type } : null;
}

/** Specs contained in a tool result, or null when the result is not one. */
export function uiSpecs(value: unknown, depth = 0): UiSpec[] | null {
  if (value == null || depth > 4) return null;
  if (typeof value === "string") {
    const parsed = tryJson(value);
    return parsed === value ? null : uiSpecs(parsed, depth + 1);
  }
  const own = asSpec(value);
  if (own) return [own];
  if (Array.isArray(value)) {
    if (!value.length) return null;
    const specs = value.map((v) => asSpec(v)).filter((s): s is UiSpec => !!s);
    return specs.length === value.length ? specs : null;
  }
  if (!isObj(value)) return null;
  for (const key of WRAPPERS) {
    const inner = value[key];
    if (inner == null) continue;
    const specs = Array.isArray(inner)
      ? inner.map((v) => asSpec(v)).filter((s): s is UiSpec => !!s)
      : (() => { const s = asSpec(inner); return s ? [s] : null; })();
    if (specs && (Array.isArray(inner) ? specs.length === inner.length && inner.length > 0 : true)) return specs;
  }
  for (const key of ["data", "result", "output", "payload"]) {
    if (isObj(value[key]) || Array.isArray(value[key])) {
      const nested = uiSpecs(value[key], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

// ── value helpers ────────────────────────────────────────────────────
const META = ["type", "kind", "component", "render", "ui", "title", "subtitle", "heading", "label", "body"];

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString() : String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return "";
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : str(v);
}

function first(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) { const t = text(o[k]); if (t) return t; }
  return "";
}

function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { const p = tryJson(v); return Array.isArray(p) ? p : []; }
  if (isObj(v)) {
    for (const k of ["items", "data", "rows", "cards", "results", "entries", "list", "values", "options"]) {
      if (Array.isArray(v[k])) return v[k] as unknown[];
    }
  }
  return [];
}

function rec(v: unknown): Record<string, unknown> {
  if (isObj(v)) return v;
  if (typeof v === "string") { const p = tryJson(v); if (isObj(p)) return p; }
  return {};
}

function collect(spec: UiSpec, keys: string[]): unknown[] {
  for (const k of keys) {
    const items = arr(spec[k]);
    if (items.length) return items;
  }
  return [];
}

function cell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(cell).join(", ");
  if (isObj(v)) return first(v, ["label", "name", "title", "value", "text"]) || JSON.stringify(v);
  return String(v);
}

const TONES: Record<string, string> = {
  ok: "ok", success: "ok", done: "ok", pass: "ok", passed: "ok", approved: "ok", positive: "ok", good: "ok",
  warn: "warn", warning: "warn", pending: "warn", review: "warn", attention: "warn", medium: "warn",
  error: "bad", danger: "bad", fail: "bad", failed: "bad", blocked: "bad", rejected: "bad", high: "bad", critical: "bad",
  info: "info", neutral: "info", low: "info",
};

function tone(v: unknown): string {
  return TONES[String(v ?? "").toLowerCase()] ?? "";
}

// ── blocks ───────────────────────────────────────────────────────────
function Head({ title, sub }: { title?: unknown; sub?: unknown }) {
  const t = text(title);
  const s = text(sub);
  return t || s
    ? <div className="lgk-ui-head"><span>{t || "Result"}</span>{s ? <span className="lgk-muted">{s}</span> : null}</div>
    : null;
}

function Cards({ spec }: { spec: UiSpec }) {
  const [open, setOpen] = useState<number | null>(null);
  const items = collect(spec, ["items", "cards", "results", "products", "data", "rows"]);
  const shown = items.slice(0, 30);
  const detail = open != null ? shown[open] : null;
  const detailObj = isObj(detail) ? detail : null;
  return (
    <div className="lgk-ui">
      <Head title={spec.title} sub={spec.subtitle} />
      <div className="lgk-results-cards" aria-label={text(spec.title) || "Cards"}>
        {shown.map((item, i) => {
          const o = rec(item);
          const name = first(o, ["title", "name", "label", "subject", "id"]) || `Item ${i + 1}`;
          const sub = [first(o, ["subtitle"]), first(o, ["brand"]), first(o, ["category", "type"]),
            first(o, ["description", "status"])].filter((v, k, all) => v && all.indexOf(v) === k).join(" · ");
          const img = imageOf(o);
          const price = priceOf(o);
          const badge = first(o, ["badge", "tag"]);
          const clickable = Object.keys(o).length > 0;
          return (
            <button key={i} type="button" className="lgk-r-card" disabled={!clickable} data-open={open === i || undefined}
              onClick={() => clickable && setOpen(open === i ? null : i)} title={name}>
              {img ? <img className="lgk-r-img" src={img} alt="" loading="lazy" /> : null}
              {badge ? <span className="lgk-r-badge">{badge}</span> : null}
              <span className="lgk-r-b">{name}</span>
              {sub ? <span className="lgk-r-s">{sub}</span> : null}
              {price ? <span className="lgk-r-p">{price}</span> : null}
            </button>
          );
        })}
      </div>
      {detailObj ? (
        <div className="lgk-results-detail">
          <div className="lgk-results-detail-head">
            <strong>{first(detailObj, ["title", "name", "label"]) || "Details"}</strong>
            <button type="button" className="lgk-more" onClick={() => setOpen(null)}>Close</button>
          </div>
          <KeyValueTable data={detailObj} />
        </div>
      ) : null}
      {items.length > shown.length ? <p className="lgk-muted">Showing {shown.length} of {items.length}.</p> : null}
    </div>
  );
}

type Col = { key: string; label: string; align?: string };

function columnsOf(spec: UiSpec, rows: unknown[]): Col[] {
  const declared = arr(spec.columns ?? spec.headers).map((c) => {
    if (typeof c === "string") return { key: c, label: c };
    const o = rec(c);
    return { key: text(o.key ?? o.id ?? o.name ?? o.label), label: text(o.label ?? o.title ?? o.name ?? o.key), align: text(o.align) };
  }).filter((c) => c.key);
  if (declared.length) return declared;
  const sample = rows.find(isObj);
  if (sample) {
    return Object.keys(sample).slice(0, 8).map((k) => ({ key: k, label: k.replace(/_/g, " ") }));
  }
  const width = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 1)), 0);
  return Array.from({ length: width }, (_, i) => ({ key: String(i), label: `#${i + 1}` }));
}

function Table({ spec }: { spec: UiSpec }) {
  const rows = collect(spec, ["rows", "items", "data", "records"]);
  const cols = columnsOf(spec, rows);
  if (!rows.length || !cols.length) return <Fallback value={spec} />;
  return (
    <div className="lgk-ui">
      <Head title={spec.title} sub={spec.subtitle ?? `${rows.length} row${rows.length === 1 ? "" : "s"}`} />
      <div className="lgk-table-wrap">
        <table className="lgk-table">
          <thead><tr>{cols.map((c) => <th key={c.key} style={c.align ? { textAlign: c.align as "left" } : undefined}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 40).map((row, i) => (
              <tr key={i}>
                {cols.map((c) => <td key={c.key}>{cell(Array.isArray(row) ? row[Number(c.key)] : rec(row)[c.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 40 ? <p className="lgk-muted">Showing 40 of {rows.length} rows.</p> : null}
    </div>
  );
}

function Stats({ spec }: { spec: UiSpec }) {
  let items = collect(spec, ["items", "metrics", "kpis", "stats", "data"]);
  if (!items.length && isObj(spec.metrics)) items = Object.entries(spec.metrics).map(([label, value]) => ({ label, value }));
  if (!items.length) items = collect(spec, ["values"]);
  const tiles = items.map((m) => {
    const o = rec(m);
    return {
      label: first(o, ["label", "name", "title", "metric"]) || (typeof m === "string" ? m : ""),
      value: str(o.value ?? o.amount ?? o.count ?? (typeof m === "string" ? "" : m)),
      delta: text(o.delta ?? o.change),
      tone: tone(o.tone ?? o.status),
    };
  }).filter((t) => t.label || t.value);
  if (!tiles.length) return <Fallback value={spec} />;
  return (
    <div className="lgk-ui">
      <Head title={spec.title} sub={spec.subtitle} />
      <div className="lgk-stats">
        {tiles.map((t, i) => (
          <div className="lgk-stat" key={i} data-tone={t.tone || undefined}>
            <span>{t.label}</span>
            <b>{t.value}</b>
            {t.delta ? <em>{t.delta}</em> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}

function chartData(spec: UiSpec) {
  const labels = arr(spec.labels ?? spec.categories ?? spec.x).map(cell);
  const seriesRaw = arr(spec.series ?? spec.datasets);
  const series = seriesRaw.map((s) => {
    const o = rec(s);
    return { name: first(o, ["name", "label"]) || "Series", data: arr(o.data ?? o.values).map(num).map((n) => n ?? 0) };
  }).filter((s) => s.data.length);
  if (!series.length) {
    const points = arr(spec.data ?? spec.values ?? spec.points);
    const objs = points.filter(isObj);
    if (objs.length) {
      return {
        labels: labels.length ? labels : objs.map((o) => first(o, ["label", "name", "x", "day", "date"]) || "—"),
        series: [{ name: text(spec.title) || "Value", data: objs.map((o) => num(o.value ?? o.y ?? o.amount ?? o.count) ?? 0) }],
      };
    }
    const values = points.map(num).filter((n): n is number => n != null);
    if (values.length) return { labels, series: [{ name: text(spec.title) || "Value", data: values }] };
    return null;
  }
  return { labels, series };
}

function Chart({ spec }: { spec: UiSpec }) {
  const data = chartData(spec);
  if (!data || !data.series.length) return <Fallback value={spec} />;
  const kind = String(spec.kind ?? spec.chart ?? "").toLowerCase().includes("line") ? "line" : "bar";
  const labels = data.labels;
  const max = Math.max(1, ...data.series.flatMap((s) => s.data));
  return (
    <div className="lgk-ui">
      <Head title={spec.title} sub={spec.subtitle} />
      {kind === "line" ? (
        <div className="lgk-line">
          <svg viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label={text(spec.title) || "Chart"}>
            {data.series.map((s, si) => (
              <polyline key={si} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round"
                opacity={1 - si * 0.28}
                points={s.data.map((v, i) => `${(i / Math.max(1, s.data.length - 1)) * 100},${36 - (v / max) * 32}`).join(" ")} />
            ))}
          </svg>
          {labels.length > 0 && <div className="lgk-axis">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>}
        </div>
      ) : (
        <div className="lgk-bars" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(labels.length || data.series[0].data.length, 1), 14)}, minmax(0, 1fr))` }}>
          {(labels.length ? labels : data.series[0].data.map((_, i) => `#${i + 1}`)).slice(0, 14).map((label, i) => (
            <div className="lgk-bar-col" key={i} title={`${label}: ${data.series.map((s) => str(s.data[i])).join(" / ")}`}>
              <div className="lgk-bar-track">
                {data.series.slice(0, 3).map((s, si) => (
                  <div key={si} className="lgk-bar" style={{ height: `${Math.max(2, ((s.data[i] ?? 0) / max) * 100)}%`, opacity: 1 - si * 0.3 }} />
                ))}
              </div>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
      {data.series.length > 1 && (
        <div className="lgk-legend">{data.series.map((s, i) => <span key={i} style={{ opacity: 1 - i * 0.3 }}>{s.name}</span>)}</div>
      )}
    </div>
  );
}

function Timeline({ spec }: { spec: UiSpec }) {
  const items = collect(spec, ["items", "events", "steps", "data"]);
  if (!items.length) return <Fallback value={spec} />;
  return (
    <div className="lgk-ui">
      <Head title={spec.title} sub={spec.subtitle} />
      <ol className="lgk-tl">
        {items.slice(0, 30).map((it, i) => {
          const o = rec(it);
          const title = first(o, ["title", "label", "name", "step"]) || cell(it);
          const detail = first(o, ["detail", "description", "body", "comment"]);
          const when = first(o, ["time", "timestamp", "ts", "date", "at"]);
          return (
            <li key={i} data-tone={tone(o.tone ?? o.status) || undefined}>
              <span className="lgk-tl-dot" aria-hidden />
              <div>
                <div className="lgk-tl-title">{title}{when ? <span className="lgk-muted"> · {when}</span> : null}</div>
                {detail ? <div className="lgk-tl-detail">{detail}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Status({ spec }: { spec: UiSpec }) {
  let items = collect(spec, ["items", "checks", "rows", "data"]);
  if (!items.length && isObj(spec.checks)) items = Object.entries(spec.checks).map(([label, value]) => ({ label, value }));
  if (!items.length && isObj(spec.data)) items = Object.entries(spec.data).map(([label, value]) => ({ label, value }));
  if (!items.length) return <Fallback value={spec} />;
  return (
    <div className="lgk-ui">
      <Head title={spec.title} sub={spec.subtitle} />
      <div className="lgk-status">
        {items.slice(0, 30).map((it, i) => {
          const o = rec(it);
          const label = first(o, ["label", "name", "title", "check"]) || (isObj(it) ? "" : cell(it));
          const value = first(o, ["value", "state", "status", "detail"]) || (isObj(it) ? "" : "");
          const t = tone(o.tone ?? o.status ?? o.state ?? o.value);
          return <div className="lgk-status-row" key={i}><span className="lgk-dot" data-tone={t || undefined} /><span>{label}</span><b data-tone={t || undefined}>{value || label}</b></div>;
        })}
      </div>
    </div>
  );
}

type Field = { name: string; label: string; type: string; value: string; options: { label: string; value: string }[]; required: boolean; help: string; placeholder: string };

function fieldsOf(spec: UiSpec): Field[] {
  const raw = arr(spec.fields ?? spec.items ?? spec.inputs);
  return raw.map((f, i) => {
    const o = rec(f);
    const options = arr(o.options ?? o.choices ?? o.enum).map((op) => isObj(op)
      ? { label: text(op.label ?? op.name ?? op.value), value: text(op.value ?? op.label ?? op.name) }
      : { label: cell(op), value: cell(op) });
    return {
      name: text(o.name ?? o.key ?? o.id) || `field_${i + 1}`,
      label: text(o.label ?? o.title ?? o.name) || `Field ${i + 1}`,
      type: (text(o.type) || (options.length ? "select" : "text")).toLowerCase(),
      value: str(o.value ?? o.default ?? ""),
      options,
      required: o.required === true || o.required === "true",
      help: text(o.help ?? o.description ?? o.hint),
      placeholder: text(o.placeholder),
    };
  });
}

function Form({ spec }: { spec: UiSpec }) {
  const fields = fieldsOf(spec);
  // Forms render outside a Chat too (e.g. tool previews); submitting needs one.
  const agent = useContext(AgentContext);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.value])));
  if (!fields.length) return <Fallback value={spec} />;
  const title = text(spec.title) || "Form";
  const submitLabel = text(rec(spec.submit).label ?? spec.submit_label ?? spec.submitLabel) || (text(spec.submit) && !isObj(spec.submit) ? text(spec.submit) : "Submit");
  const missing = fields.some((f) => f.required && !(vals[f.name] ?? "").trim());
  return (
    <div className="lgk-ui">
      <Head title={title} sub={spec.subtitle} />
      <form className="lgk-form" onSubmit={(e) => {
        e.preventDefault();
        if (missing || !agent || agent.isLoading) return;
        const body = Object.fromEntries(fields.map((f) => [f.label, vals[f.name] ?? ""]));
        void agent.send(`${title}: ${JSON.stringify(body)}`);
      }}>
        {fields.map((f) => (
          <label key={f.name}>
            <span>{f.label}{f.required ? <b className="lgk-req"> *</b> : null}</span>
            {f.type === "select" || f.options.length ? (
              <select value={vals[f.name] ?? ""} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}>
                <option value="">Choose…</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === "checkbox" || f.type === "boolean" ? (
              <input type="checkbox" checked={vals[f.name] === "true"} onChange={(e) => setVals({ ...vals, [f.name]: String(e.target.checked) })} />
            ) : f.type === "textarea" ? (
              <textarea rows={3} value={vals[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
            ) : (
              <input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={vals[f.name] ?? ""}
                placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
            )}
            {f.help ? <em>{f.help}</em> : null}
          </label>
        ))}
        <div className="lgk-form-foot">
          <button type="submit" className="lgk-primary" disabled={missing || !agent || agent.isLoading}>{submitLabel}</button>
          {missing ? <span className="lgk-muted">Fill the required fields to continue.</span> : null}
        </div>
      </form>
    </div>
  );
}

function Detail({ spec }: { spec: UiSpec }) {
  let data: Record<string, unknown> | unknown[] | null = null;
  const inner = spec.data ?? spec.fields ?? spec.items ?? spec.properties ?? spec.value;
  if (isObj(inner)) data = inner;
  else if (Array.isArray(inner) && inner.every(isObj)) data = inner as Record<string, unknown>[];
  else if (Array.isArray(inner)) data = Object.fromEntries(inner.map((it, i) => {
    const o = rec(it);
    return [first(o, ["label", "name", "key"]) || `#${i + 1}`, o.value ?? o.amount ?? o.text ?? it];
  }));
  const rest = Object.fromEntries(Object.entries(spec).filter(([k]) => !META.includes(k) && !["data", "fields", "items", "properties", "value"].includes(k) && k !== "subtitle"));
  if (!data) data = rec(rest);
  if (!data || (isObj(data) && !Object.keys(data).length)) return <Fallback value={spec} />;
  return (
    <div className="lgk-ui">
      <Head title={spec.title} sub={spec.subtitle} />
      <div className="lgk-detail"><KeyValueTable data={data} /></div>
    </div>
  );
}

function Alert({ spec }: { spec: UiSpec }) {
  const t = tone(spec.tone ?? spec.status ?? spec.level ?? spec.severity) || "info";
  const agent = useContext(AgentContext);
  const actions = arr(spec.actions ?? spec.links);
  return (
    <div className="lgk-alert" data-tone={t}>
      <strong>{text(spec.title) || (t === "bad" ? "Problem" : t === "warn" ? "Attention" : "Note")}</strong>
      <p>{first(spec, ["message", "body", "text", "description", "content"])}</p>
      {actions.length > 0 && (
        <div className="lgk-actions">
          {actions.map((a, i) => <ActionChip key={i} item={a} send={(text) => void agent?.send(text)} disabled={!agent || agent.isLoading} />)}
        </div>
      )}
    </div>
  );
}

function ActionChip({ item, send, disabled }: { item: unknown; send: (text: string) => void; disabled: boolean }) {
  const o = rec(item);
  const label = first(o, ["label", "title", "name", "text"]) || cell(item);
  const prompt = first(o, ["prompt", "message", "value", "text", "query"]);
  const href = first(o, ["href", "url", "link"]);
  return (
    <button type="button" className="lgk-chip" disabled={disabled || (!prompt && !href)}
      onClick={() => href ? window.open(href, "_blank", "noopener") : prompt && send(prompt)}>
      {label}{href ? " ↗" : ""}
    </button>
  );
}

function Actions({ spec }: { spec: UiSpec }) {
  const agent = useContext(AgentContext);
  const items = collect(spec, ["items", "actions", "links", "options", "suggestions", "chips"]);
  if (!items.length) return <Fallback value={spec} />;
  return (
    <div className="lgk-ui">
      <Head title={spec.title} sub={spec.subtitle} />
      <div className="lgk-actions">
        {items.slice(0, 12).map((a, i) => <ActionChip key={i} item={a} send={(text) => void agent?.send(text)} disabled={!agent || agent.isLoading} />)}
      </div>
    </div>
  );
}

function TextBlock({ spec }: { spec: UiSpec }) {
  const body = first(spec, ["body", "text", "content", "markdown", "message", "value"]);
  const title = text(spec.title);
  if (!body && !title) return <Fallback value={spec} />;
  return (
    <div className="lgk-ui">
      {title ? <Head title={title} /> : null}
      {body ? <p className="lgk-ui-text">{body}</p> : null}
    </div>
  );
}

function Fallback({ value }: { value: unknown }) {
  const items = listItems(value);
  if (items?.length) return <ResultCards value={value} />;
  if (isObj(value)) return <KeyValueTable data={value as Record<string, unknown>} />;
  return <ExpandableText text={typeof value === "string" ? value : JSON.stringify(value, null, 2)} />;
}

function Block({ spec }: { spec: UiSpec }) {
  switch (spec.type) {
    case "cards": return <Cards spec={spec} />;
    case "table": return <Table spec={spec} />;
    case "stats": return <Stats spec={spec} />;
    case "chart": return <Chart spec={spec} />;
    case "timeline": return <Timeline spec={spec} />;
    case "status": return <Status spec={spec} />;
    case "form": return <Form spec={spec} />;
    case "detail": return <Detail spec={spec} />;
    case "alert": return <Alert spec={spec} />;
    case "actions": return <Actions spec={spec} />;
    case "text": return <TextBlock spec={spec} />;
    default: return <Fallback value={spec} />;
  }
}

/** Renders every UI spec found in a tool result, in order. */
export function GenUi({ specs }: { specs: UiSpec[] }) {
  if (!specs.length) return null;
  return <div className="lgk-ui-stack">{specs.map((s, i) => <Block key={i} spec={s} />)}</div>;
}
