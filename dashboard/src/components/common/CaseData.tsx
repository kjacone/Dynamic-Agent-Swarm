import { useState } from "react";
import { AlertTriangle, Braces, CheckCircle2, MinusCircle, ShieldAlert } from "lucide-react";
import { JsonView } from "./JsonView";
import { cn } from "@/lib/utils";

const HIDDEN = new Set(["_self_ok", "_due_hours", "_escalate_roles"]);
const LABELS: Record<string, string> = {
  kyc: "KYC data",
  kyc_raw: "KYC extraction",
  kyc_extraction: "KYC extraction",
  documents_text: "Documents",
  declared_income: "Declared income",
  customer_name: "Customer",
  beneficiary_country: "Beneficiary country",
  id_number: "ID number",
  id_type: "ID type",
  date_of_birth: "Date of birth",
  full_name: "Full name",
  expiry_date: "Document expiry",
};

/** Keys worth surfacing first, in this order. */
const HIGHLIGHTS = ["customer_name", "full_name", "amount", "currency", "beneficiary_country", "country", "declared_income", "score", "risk", "status", "error"];

const BAD = /error|fail|block|reject|sanction/i;
const WARN = /risk|anomal|flag|warn|expire|mismatch|missing|pending|review/i;

function label(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/^_+/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function decode(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try { return JSON.parse(t); } catch { return v; }
  }
  return v;
}

const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A raw agent step ({name, arguments: {description, subagent_type}}) reads as a short brief, not raw fields. */
function stepOf(v: unknown): { description?: string; subagent?: string; tool?: string } | null {
  if (!isObject(v) || !isObject(v.arguments)) return null;
  const args = v.arguments;
  const description = typeof args.description === "string" ? args.description : undefined;
  const subagent = typeof args.subagent_type === "string" ? args.subagent_type : undefined;
  if (!description && !subagent) return null;
  return { description, subagent, tool: typeof v.name === "string" ? v.name : undefined };
}

function toneOf(key: string, value: unknown): "bad" | "warn" | "ok" | "" {
  const probe = `${key} ${typeof value === "string" ? value.slice(0, 60) : ""}`;
  if (BAD.test(probe)) return "bad";
  if (WARN.test(probe)) return "warn";
  if (/^(ok|approved|clear|passed|verified|true)$/i.test(String(value))) return "ok";
  return "";
}

function long(v: string): boolean {
  return v.length > 160 || v.split("\n").length > 3;
}

function Value({ value, compact }: { value: unknown; compact?: boolean }) {
  const v = decode(value);
  if (v == null) return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") {
    return <span className={v ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{v ? "Yes" : "No"}</span>;
  }
  if (typeof v === "number") return <span className="tabular-nums">{v.toLocaleString()}</span>;
  if (typeof v === "string") {
    if (/^https?:\/\//.test(v)) {
      return <a className="break-all text-primary underline-offset-2 hover:underline" href={v} target="_blank" rel="noopener noreferrer">{v}</a>;
    }
    return long(v) ? <LongText text={v} lines={compact ? 2 : 4} /> : <span className="break-words">{v}</span>;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => !isObject(x))) {
      return (
        <span className="flex flex-wrap gap-1">
          {v.map((x, i) => (
            <span key={i} className={cn("rounded-full border px-2 py-0.5 text-[11px]",
              WARN.test(String(x)) ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-background")}>
              {String(decode(x) ?? "—")}
            </span>
          ))}
        </span>
      );
    }
    return (
      <ul className="space-y-1">
        {v.slice(0, compact ? 3 : 8).map((x, i) => (
          <li key={i} className="flex flex-wrap gap-x-2 gap-y-0.5 rounded-md bg-background/60 px-2 py-1">
            {Object.entries(x as Record<string, unknown>).map(([k, inner]) => (
              <span key={k} className="text-xs"><span className="text-muted-foreground">{label(k)}:</span> {String(decode(inner) ?? "—")}</span>
            ))}
          </li>
        ))}
      </ul>
    );
  }
  if (isObject(v)) {
    const step = stepOf(v);
    if (step) return <StepCall step={step} compact={compact} />;
    return (
      <div className="space-y-1">
        {Object.entries(v).filter(([k]) => !HIDDEN.has(k)).map(([k, inner]) => {
          const decoded = decode(inner);
          const t = toneOf(k, decoded);
          return (
            <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md bg-background/60 px-2 py-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label(k)}</span>
              <span className={cn("min-w-0 text-right text-xs",
                t === "bad" ? "font-medium text-red-600 dark:text-red-400"
                  : t === "warn" ? "text-amber-700 dark:text-amber-400"
                    : isEmpty(decoded) ? "text-muted-foreground/70" : "")}>
                {isEmpty(decoded) ? "Not extracted" : <Value value={decoded} compact />}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  return <span>{String(v)}</span>;
}

function StepCall({ step, compact }: { step: { description?: string; subagent?: string; tool?: string }; compact?: boolean }) {
  return (
    <div className="space-y-1.5">
      {step.description && <LongText text={step.description} lines={compact ? 3 : 4} />}
      <div className="flex flex-wrap gap-1.5">
        {step.tool && <span className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">{step.tool}</span>}
        {step.subagent && <span className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">Subagent · {step.subagent}</span>}
      </div>
    </div>
  );
}

function LongText({ text, lines }: { text: string; lines: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className={cn("whitespace-pre-wrap break-words text-xs leading-relaxed", !open && (lines === 2 ? "line-clamp-2" : "line-clamp-4"))}>{text}</p>
      {long(text) && (
        <button type="button" className="mt-0.5 text-[11px] text-primary hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function ToneIcon({ tone }: { tone: "bad" | "warn" | "ok" | "" }) {
  if (tone === "bad") return <ShieldAlert className="h-3.5 w-3.5 text-red-500" />;
  if (tone === "warn") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (tone === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  return null;
}

/**
 * Human-readable view of the case an agent produced for an approval: highlights
 * first, then one card per field. Nested JSON strings are decoded, empty KYC
 * fields are labelled, and the raw payload stays one click away.
 */
export function CaseData({ data, compact = false, className }: {
  data: Record<string, unknown> | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const [raw, setRaw] = useState(false);
  const entries = Object.entries(data ?? {})
    .filter(([k]) => !HIDDEN.has(k))
    .map(([k, v]) => [k, decode(v)] as const);
  if (!entries.length) return null;

  const byKey = new Map(entries);
  const highlights = HIGHLIGHTS.map((k) => [k, byKey.get(k)] as const).filter(([k, v]) => byKey.has(k) && !isEmpty(v));
  const rest = entries.filter(([k]) => !highlights.some(([hk]) => hk === k));
  const wide = rest.filter(([, v]) => isObject(v) || Array.isArray(v) || (typeof v === "string" && long(v)));
  const simple = rest.filter((e) => !wide.includes(e));
  const amount = byKey.get("amount");
  const currency = byKey.get("currency");

  return (
    <div className={cn("space-y-3", className)}>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold"><Braces className="h-3.5 w-3.5 text-primary" /> Case data</span>
          <button type="button" onClick={() => setRaw((r) => !r)}
            className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            {raw ? "Readable view" : "Raw JSON"}
          </button>
        </div>
      )}

      {raw ? <JsonView data={data} /> : (
        <>
          {(highlights.length > 0 || (amount != null && currency != null)) && (
            <div className="flex flex-wrap gap-2">
              {amount != null && currency != null && (
                <Highlight label="Amount" value={`${String(currency)} ${typeof amount === "number" ? amount.toLocaleString() : String(amount)}`} tone="" />
              )}
              {highlights.filter(([k]) => k !== "amount" && k !== "currency").map(([k, v]) => (
                <Highlight key={k} label={label(k)} value={typeof v === "object" ? JSON.stringify(v) : String(v)} tone={toneOf(k, v)} />
              ))}
            </div>
          )}

          {simple.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {simple.map(([k, v]) => {
                const t = toneOf(k, v);
                return (
                  <div key={k} className={cn("rounded-xl border p-2.5",
                    t === "bad" ? "border-red-500/30 bg-red-500/5"
                      : t === "warn" ? "border-amber-500/30 bg-amber-500/5"
                        : "bg-muted/20")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{label(k)}</span>
                      <ToneIcon tone={t} />
                    </div>
                    <div className="mt-1 text-sm font-medium">{isEmpty(v) ? <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><MinusCircle className="h-3 w-3" /> Not provided</span> : <Value value={v} compact={compact} />}</div>
                  </div>
                );
              })}
            </div>
          )}

          {wide.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {wide.map(([k, v]) => {
                const t = toneOf(k, v);
                return (
                  <div key={k} className={cn("rounded-xl border p-2.5",
                    t === "warn" ? "border-amber-500/30 bg-amber-500/5" : "bg-muted/20")}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{label(k)}</span>
                      <ToneIcon tone={t} />
                    </div>
                    <Value value={v} compact={compact} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Highlight({ label: text, value, tone }: { label: string; value: string; tone: "bad" | "warn" | "ok" | "" }) {
  return (
    <span className={cn("inline-flex max-w-full items-baseline gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
      tone === "bad" ? "border-red-500/30 bg-red-500/10"
        : tone === "warn" ? "border-amber-500/30 bg-amber-500/10"
          : tone === "ok" ? "border-emerald-500/30 bg-emerald-500/10"
            : "bg-muted/30")}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{text}</span>
      <b className="truncate font-medium">{value}</b>
    </span>
  );
}
