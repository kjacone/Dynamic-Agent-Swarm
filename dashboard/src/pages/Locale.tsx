import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, AudioLines, Bot, BrainCircuit, CheckCircle2, Copy, CopyPlus, Cpu,
  Download, Globe2, GraduationCap, Headphones, KeyRound, Languages, Link2,
  MessageSquareQuote, Mic, Pencil, Phone, Play, Plus, RefreshCw, Sparkles,
  Square, Trash2, Unlink, Wand2, X, XCircle,
} from "lucide-react";

import {
  api, type Agent, type LocaleDetail, type LocaleExample, type LocaleInference,
  type LocalePreview, type LocaleProfile, type LocaleProfileInput, type LocaleProfileRow,
  type LocaleSpeech, type LocaleTraining, type LocaleTrainingPack, type ModelCfg,
  type VoiceCatalog, type VoiceStatus,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ProviderKeys } from "@/components/common/ProviderKeys";
import { ModelSelect } from "@/components/common/ModelSelect";
import { StatCard } from "@/components/common/StatCard";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";
import { apiBase } from "@/lib/studio";

/* ───────────────────────── Types & helpers ───────────────────────── */

type Term = { source: string; target?: string; keep?: boolean };
type Swap = { from: string; to: string };
type Case = { input: string; expected_contains: string };
type Form = Omit<LocaleProfileInput, "glossary" | "replacements" | "sample_cases"> & {
  glossary: Term[]; replacements: Swap[]; sample_cases: Case[];
};

const BLANK: Form = {
  name: "", locale_code: "", languages: [], default_language: "",
  register_style: "formal", code_switch_policy: "allowed",
  currency_code: "", currency_symbol: "", currency_position: "before",
  decimal_sep: ".", thousand_sep: ",", date_format: "DD/MM/YYYY",
  glossary: [], replacements: [], required_phrases: [], banned_phrases: [],
  sample_cases: [], understanding: {}, output: {}, speech: {}, inference: {}, training: {},
  notes: "", enabled: true,
};

const REPLY_MODES = [
  { value: "mirror", title: "Same as the customer", hint: "Answer in whatever language each message is written in." },
  { value: "fixed", title: "Always one language", hint: "Answer in the main language, even when asked in another." },
  { value: "bilingual", title: "Two languages", hint: "Answer, then repeat the same answer in a second language." },
] as const;

/** Every profile gets its own colour, derived from its code, so people recognise it at a glance. */
const hueOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

function Monogram({ name, code, size = "md" }: { name: string; code?: string; size?: "sm" | "md" | "lg" }) {
  const key = code || name || "?";
  const h = hueOf(key);
  const label = (code || name || "?").split(/[-_ ]/)[0].slice(0, 3);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-2xl font-semibold tracking-tight",
        size === "sm" && "h-8 w-8 text-[11px]", size === "md" && "h-11 w-11 text-sm", size === "lg" && "h-14 w-14 text-lg",
      )}
      style={{ background: `hsl(${h} 70% 50% / .14)`, color: `hsl(${h} 65% 42%)`, boxShadow: `inset 0 0 0 1px hsl(${h} 70% 50% / .25)` }}
    >
      {label}
    </span>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
function datePattern(p: string, d = new Date()) {
  return (p || "DD/MM/YYYY")
    .replace(/YYYY/g, String(d.getFullYear())).replace(/YY/g, String(d.getFullYear()).slice(-2))
    .replace(/MM/g, pad(d.getMonth() + 1)).replace(/DD/g, pad(d.getDate()));
}
function sampleMoney(p: Partial<LocaleProfileInput>) {
  const [i, f] = (1250000.5).toFixed(2).split(".");
  const n = i.replace(/\B(?=(\d{3})+(?!\d))/g, p.thousand_sep ?? ",") + (p.decimal_sep || ".") + f;
  const sym = p.currency_symbol || p.currency_code || "";
  if (!sym) return n;
  return p.currency_position === "after" ? `${n} ${sym}` : `${sym} ${n}`;
}

const FORMALITY = [
  { value: "formal", title: "Formal", hint: "Respectful, full sentences, titles used." },
  { value: "neutral", title: "Friendly", hint: "Polite and clear, like a good shopkeeper." },
  { value: "casual", title: "Casual", hint: "Relaxed, like chatting with a friend." },
] as const;
const MIXING = [
  { value: "off", title: "One language", hint: "Reply in a single language only." },
  { value: "allowed", title: "Follow the customer", hint: "Mix languages if the customer does." },
  { value: "encouraged", title: "Mix naturally", hint: "Blend languages the way locals talk." },
] as const;
const DATE_CHOICES = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD.MM.YYYY"];

/* ───────────────────────── Dialect starter pack ───────────────────────── */

type Preset = { id: string; blurb: string; hello: string; data: Partial<Form> };
const T = (source: string, target?: string): Term => (target ? { source, target } : { source, keep: true });

const PRESETS: Preset[] = [
  {
    id: "sw-TZ", hello: "Karibu! Habari za leo?", blurb: "Standard Tanzanian Kiswahili for banks, shops and services.",
    data: {
      name: "Kiswahili (Tanzania)", locale_code: "sw-TZ", languages: ["Kiswahili", "English"], default_language: "Kiswahili",
      register_style: "formal", code_switch_policy: "allowed", currency_code: "TZS", currency_symbol: "TZS",
      glossary: [T("Loan", "Mkopo"), T("Balance", "Salio"), T("Account", "Akaunti"), T("Payment", "Malipo"), T("M-Pesa")],
      replacements: [{ from: "Hello", to: "Habari" }], required_phrases: ["Karibu"], banned_phrases: ["Hi there"],
      sample_cases: [{ input: "hello", expected_contains: "Habari" }],
    },
  },
  {
    id: "sw-Unguja", hello: "Salama! Karibu sana.", blurb: "Coastal Kiunguja of Zanzibar: warm, polite, respectful to elders.",
    data: {
      name: "Kiunguja (Zanzibar)", locale_code: "sw-TZ-Unguja", languages: ["Kiswahili", "English", "Arabic"], default_language: "Kiswahili",
      register_style: "formal", code_switch_policy: "allowed", currency_code: "TZS", currency_symbol: "TZS",
      glossary: [T("Thank you", "Asante"), T("Welcome", "Karibu"), T("Sorry", "Pole")],
      required_phrases: ["Karibu"], notes: "Warm coastal Swahili. Greet elders with Shikamoo. Keep Zanzibari place names as they are written locally.",
      sample_cases: [{ input: "hello", expected_contains: "Karibu" }],
    },
  },
  {
    id: "sheng", hello: "Niaje msee, vipi?", blurb: "Nairobi street talk, a playful mix of Swahili and English.",
    data: {
      name: "Sheng (Nairobi)", locale_code: "sw-KE-sheng", languages: ["Sheng", "Kiswahili", "English"], default_language: "Sheng",
      register_style: "casual", code_switch_policy: "encouraged", currency_code: "KES", currency_symbol: "KSh",
      glossary: [T("Hello", "Niaje"), T("Okay", "Poa"), T("Friend", "Msee"), T("M-Pesa")],
      notes: "Keep it light and youthful. Never use Sheng with a customer who is upset or writing formally.",
      sample_cases: [{ input: "hello", expected_contains: "Niaje" }],
    },
  },
  {
    id: "en-KE", hello: "Good afternoon, how may I help you?", blurb: "Polite Kenyan English with British spelling.",
    data: {
      name: "English (Kenya)", locale_code: "en-KE", languages: ["English", "Kiswahili"], default_language: "English",
      register_style: "neutral", code_switch_policy: "allowed", currency_code: "KES", currency_symbol: "KSh",
      glossary: [T("M-Pesa"), T("Paybill"), T("Till number")], notes: "British spelling (colour, organise). Understand Kiswahili words in a message.",
    },
  },
  {
    id: "pcm-NG", hello: "How far! Wetin I fit do for you?", blurb: "Nigerian Pidgin, relaxed and full of life.",
    data: {
      name: "Naija Pidgin", locale_code: "pcm-NG", languages: ["Pidgin", "English"], default_language: "Pidgin",
      register_style: "casual", code_switch_policy: "encouraged", currency_code: "NGN", currency_symbol: "₦",
      glossary: [T("Hello", "How far"), T("How are you", "How you dey"), T("Thank you", "Thank you well well")],
      sample_cases: [{ input: "hello", expected_contains: "How far" }],
    },
  },
  {
    id: "ar-EG", hello: "أهلاً وسهلاً، إزاي أقدر أساعدك؟", blurb: "Egyptian colloquial Arabic rather than formal textbook Arabic.",
    data: {
      name: "Arabic (Egypt)", locale_code: "ar-EG", languages: ["Arabic", "English"], default_language: "Arabic",
      register_style: "neutral", code_switch_policy: "allowed", currency_code: "EGP", currency_symbol: "ج.م", currency_position: "after",
      glossary: [T("Hello", "أهلاً"), T("Thank you", "شكراً"), T("Account", "حساب")],
      notes: "Write right to left. Use everyday Egyptian phrasing, not Modern Standard Arabic.",
    },
  },
  {
    id: "es-MX", hello: "¡Hola! ¿En qué le puedo ayudar?", blurb: "Mexican Spanish that addresses customers as “usted”.",
    data: {
      name: "Español (México)", locale_code: "es-MX", languages: ["Español", "English"], default_language: "Español",
      register_style: "formal", currency_code: "MXN", currency_symbol: "$",
      glossary: [T("Hello", "Hola"), T("Thank you", "Gracias"), T("Account", "Cuenta")],
      banned_phrases: ["vosotros"], notes: "Always use “usted”. Avoid Spain-only words.",
    },
  },
  {
    id: "pt-BR", hello: "Olá! Como posso ajudar?", blurb: "Brazilian Portuguese with comma decimals.",
    data: {
      name: "Português (Brasil)", locale_code: "pt-BR", languages: ["Português", "English"], default_language: "Português",
      register_style: "neutral", currency_code: "BRL", currency_symbol: "R$", thousand_sep: ".", decimal_sep: ",",
      glossary: [T("Hello", "Olá"), T("Thank you", "Obrigado")],
    },
  },
];

// Every starter opens a call with its own greeting; the voice picker can change it later.
for (const preset of PRESETS) {
  preset.data.speech = { greeting: preset.hello, ...(preset.data.speech ?? {}) };
}

/* ───────────────────────── Small building blocks ───────────────────────── */

function TagInput({ value, onChange, placeholder, tone = "good" }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; tone?: "good" | "bad";
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().replace(/,$/, "");
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
      {value.map((v) => (
        <span key={v} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
          tone === "bad" ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
        value={draft} placeholder={value.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)} onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
      />
    </div>
  );
}

function Rows<T extends object>({ items, onChange, blank, addLabel, empty, children }: {
  items: T[]; onChange: (x: T[]) => void; blank: T; addLabel: string; empty: string;
  children: (item: T, set: (p: Partial<T>) => void) => React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">{empty}</p>}
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {children(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Remove row"
            onClick={() => onChange(items.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...items, { ...blank }])}><Plus /> {addLabel}</Button>
    </div>
  );
}

function Choice<T extends string>({ value, onChange, options, cols = 3 }: {
  value: T; onChange: (v: T) => void; options: readonly { value: T; title: string; hint: string }[]; cols?: 2 | 3;
}) {
  return (
    <div role="radiogroup" className={cn("grid gap-2", cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {options.map((o) => (
        <button
          type="button" role="radio" aria-checked={value === o.value} key={o.value} onClick={() => onChange(o.value)}
          className={cn("rounded-xl border p-3 text-left transition-colors",
            value === o.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}
        >
          <div className="text-sm font-medium">{o.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export function Locale({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<LocaleProfileRow[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelCfg[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<LocaleDetail | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [seed, setSeed] = useState<Partial<Form> | undefined>();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<{ profile: LocaleProfile; agents: number } | null>(null);
  const toast = useToast();

  async function refreshAll(prefer?: string) {
    try {
      const [p, a, m] = await Promise.all([
        api.listLocaleProfiles(tenant),
        api.listAgents(tenant),
        api.listModels(tenant).catch(() => [] as ModelCfg[]),
      ]);
      setRows(p); setAgents(a); setModels(m);
      const want = prefer ?? sel;
      setSel(want && p.some((x) => x.id === want) ? want : p[0]?.id ?? null);
    } catch (e: any) { toast.push(e.message, "error"); setRows([]); }
  }
  async function reloadDetail() {
    if (!sel) { setDetail(null); return; }
    try { setDetail(await api.getLocaleProfile(sel)); }
    catch (e: any) { toast.push(e.message, "error"); }
  }
  async function changed() { await refreshAll(); await reloadDetail(); }

  useEffect(() => { setRows(null); setDetail(null); setSel(null); refreshAll(); }, [tenant]);
  useEffect(() => { reloadDetail(); }, [sel]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const attached = new Set<string>();
    for (const p of list) p.attached_to.forEach((a) => attached.add(a));
    const languages = new Set<string>();
    for (const p of list) if (p.default_language) languages.add(p.default_language);
    const voiced = list.filter((p) => p.speech?.voice_id || p.speech?.greeting).length;
    return { profiles: list.length, attached: attached.size, languages: languages.size, voiced };
  }, [rows]);

  const startNew = () => setPicking(true);
  const begin = (s?: Partial<Form>) => { setPicking(false); setSeed(s); setCreating(true); };
  function duplicate(p: LocaleProfile) {
    begin({
      name: `${p.name} (copy)`, locale_code: p.locale_code, languages: p.languages, default_language: p.default_language,
      register_style: p.register_style, code_switch_policy: p.code_switch_policy, currency_code: p.currency_code,
      currency_symbol: p.currency_symbol, currency_position: p.currency_position, decimal_sep: p.decimal_sep,
      thousand_sep: p.thousand_sep, date_format: p.date_format, glossary: p.glossary as Term[], replacements: p.replacements as Swap[],
      required_phrases: p.required_phrases, banned_phrases: p.banned_phrases, sample_cases: p.sample_cases as Case[], notes: p.notes,
      speech: { ...p.speech }, inference: { ...p.inference }, training: { ...p.training },
    });
  }

  return (
    <div>
      <PageHeader
        icon={Languages}
        title="The language lab"
        description="Words, tone, money and dates — plus the voice, the model and the training data behind every dialect."
        actions={<Button onClick={startNew}><Plus /> Add a dialect</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Globe2} label="Dialects" value={stats.profiles} tone="sky" />
        <StatCard icon={Bot} label="Agents speaking locally" value={stats.attached} tone="emerald" hint="Agents with a dialect switched on" />
        <StatCard icon={AudioLines} label="Dialects with a voice" value={stats.voiced} tone="violet" hint="Ready for calls in the Voice line and agent kit" />
        <StatCard icon={MessageSquareQuote} label="Main languages" value={stats.languages} tone="amber" />
      </div>

      {rows === null ? (
        <LoadingBlock rows={5} />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border bg-muted/20 p-5">
          <div className="mb-1 text-base font-semibold">Pick a dialect to start</div>
          <p className="mb-4 max-w-xl text-sm text-muted-foreground">
            Each starter comes with sensible words, tone, currency and date style. Change anything you like afterwards.
          </p>
          <PresetGrid onPick={begin} />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0 p-3 pb-2">
              <CardTitle className="text-sm">Your dialects</CardTitle>
              <Badge variant="secondary">{rows.length}</Badge>
            </CardHeader>
            <div>
              {rows.map((p) => (
                <button
                  key={p.id} onClick={() => setSel(p.id)}
                  className={cn("flex w-full items-center gap-3 border-t px-3 py-2.5 text-left transition-colors",
                    sel === p.id ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/60", !p.enabled && "opacity-60")}
                >
                  <Monogram name={p.name} code={p.locale_code} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", sel === p.id && "font-medium text-foreground")}>{p.name}</span>
                    <span className="block truncate text-xs">
                      {p.default_language || "No main language"}
                      {p.attached_agents > 0 ? `, on ${p.attached_agents} agent${p.attached_agents === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                  {!p.enabled && <Badge variant="outline" className="text-[10px]">Off</Badge>}
                </button>
              ))}
            </div>
          </Card>

          {detail ? (
            <ProfileDetail
              detail={detail} agents={agents} models={models}
              onEdit={() => setEditing(true)} onDuplicate={() => duplicate(detail.profile)}
              onDelete={() => setDeleting({ profile: detail.profile, agents: detail.agents.length })}
              onChanged={changed}
            />
          ) : (
            <EmptyState title="Choose a dialect" body="Pick one on the left to see how it sounds, teach it new answers or switch it on for an agent." />
          )}
        </div>
      )}

      {picking && (
        <Dialog open onOpenChange={(v) => !v && setPicking(false)}>
          <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Which dialect are we adding?</DialogTitle>
              <DialogDescription>Start from a ready-made voice, or build your own from scratch.</DialogDescription>
            </DialogHeader>
            <PresetGrid onPick={begin} />
          </DialogContent>
        </Dialog>
      )}
      {creating && (
        <ProfileForm
          tenant={tenant} seed={seed}
          onClose={() => setCreating(false)}
          onSaved={(p) => { setCreating(false); refreshAll(p?.id); toast.push("Dialect added", "success"); }}
        />
      )}
      {editing && detail && (
        <ProfileForm
          tenant={tenant} initial={detail.profile}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); changed(); toast.push("Dialect saved", "success"); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.profile.name}?`}
          description={`${deleting.agents ? `It is switched on for ${deleting.agents} agent(s), which will be switched off first. ` : ""}Its corrections are deleted too. This cannot be undone.`}
          confirmLabel="Delete dialect" destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteLocaleProfile(deleting.profile.id);
            setDeleting(null); setDetail(null); await refreshAll();
            toast.push("Dialect deleted", "success");
          }}
        />
      )}
    </div>
  );
}

function PresetGrid({ onPick }: { onPick: (s?: Partial<Form>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PRESETS.map((p) => (
        <button
          key={p.id} type="button" onClick={() => onPick(p.data)}
          className="group flex items-start gap-3 rounded-2xl border bg-background p-3.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
        >
          <Monogram name={p.data.name ?? ""} code={p.data.locale_code} size="lg" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{p.data.name}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{p.blurb}</span>
            <span className="mt-2 block rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs italic" dir="auto">“{p.hello}”</span>
          </span>
        </button>
      ))}
      <button
        type="button" onClick={() => onPick(undefined)}
        className="flex items-center gap-3 rounded-2xl border border-dashed p-3.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5"
      >
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted"><Wand2 className="h-5 w-5" /></span>
        <span>
          <span className="block text-sm font-medium">Something else</span>
          <span className="block text-xs text-muted-foreground">Any language, dialect, slang or company house style.</span>
        </span>
      </button>
    </div>
  );
}

/* ───────────────────────── Detail ───────────────────────── */

function ProfileDetail({ detail, agents, models, onEdit, onDuplicate, onDelete, onChanged }: {
  detail: LocaleDetail; agents: Agent[]; models: ModelCfg[]; onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const p = detail.profile;
  const formality = FORMALITY.find((f) => f.value === p.register_style)?.title ?? p.register_style;
  const voiceOn = Boolean(p.speech?.voice_id || p.speech?.greeting);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Monogram name={p.name} code={p.locale_code} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">{p.name}</CardTitle>
              <Badge variant={p.enabled ? "secondary" : "outline"} className={p.enabled ? "text-emerald-700 dark:text-emerald-400" : ""}>
                {p.enabled ? "On" : "Off"}
              </Badge>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Speaks {p.default_language || "no language yet"} in a {formality.toLowerCase()} tone. Updated {fmtDate(p.updated_at)}.
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                voiceOn ? "bg-violet-500/10 text-violet-700 dark:text-violet-400" : "bg-muted text-muted-foreground")}>
                <AudioLines className="h-3 w-3" />{voiceOn ? "Voice set" : "No voice yet"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-700 dark:text-sky-400">
                <Cpu className="h-3 w-3" />{p.inference?.model ? p.inference.model.split(":").slice(-1)[0] : "Inherits agent model"}
              </span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                p.training?.capture ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                <GraduationCap className="h-3 w-3" />{p.training?.capture ? "Capturing training turns" : "Training capture off"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit</Button>
          <Button size="sm" variant="ghost" onClick={onDuplicate}><CopyPlus /> Duplicate</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete dialect" aria-label="Delete dialect" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <Tabs defaultValue="profile">
          <TabsList className="h-auto min-h-10 flex-wrap justify-start rounded-xl p-1">
            <TabsTrigger value="profile">Overview</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="model">Model</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="corrections">Corrections {detail.examples.length ? `(${detail.examples.length})` : ""}</TabsTrigger>
            <TabsTrigger value="agents">Agents {detail.agents.length ? `(${detail.agents.length})` : ""}</TabsTrigger>
            <TabsTrigger value="preview">Try it</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="mt-4"><ProfileSummary profile={p} /></TabsContent>
          <TabsContent value="voice" className="mt-4"><VoicePanel profile={p} onChanged={onChanged} /></TabsContent>
          <TabsContent value="model" className="mt-4"><InferencePanel profile={p} models={models} onChanged={onChanged} /></TabsContent>
          <TabsContent value="training" className="mt-4"><TrainingPanel profile={p} examples={detail.examples} onChanged={onChanged} /></TabsContent>
          <TabsContent value="corrections" className="mt-4"><CorrectionsPanel profile={p} examples={detail.examples} onChanged={onChanged} /></TabsContent>
          <TabsContent value="agents" className="mt-4"><AgentsPanel profile={p} agents={agents} attached={detail.agents} onChanged={onChanged} /></TabsContent>
          <TabsContent value="preview" className="mt-4"><PreviewPanel profileId={p.id} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border p-3.5", className)}>
      <div className="mb-2 text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

function ProfileSummary({ profile: p }: { profile: LocaleProfile }) {
  const mixing = MIXING.find((m) => m.value === p.code_switch_policy)?.title ?? p.code_switch_policy;
  const none = <span className="text-xs text-muted-foreground">Nothing yet.</span>;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Languages">
          <div className="flex flex-wrap gap-1.5">
            {p.languages.length ? p.languages.map((l) => (
              <Badge key={l} variant={l === p.default_language ? "default" : "outline"} className="font-normal">{l}</Badge>
            )) : none}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Language mixing: {mixing}.</p>
        </Section>
        <Section title="What customers will see">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Money</dt><dd className="font-mono text-xs leading-5">{sampleMoney(p)}</dd>
            <dt className="text-muted-foreground">Today</dt><dd className="font-mono text-xs leading-5">{datePattern(p.date_format)}</dd>
          </dl>
        </Section>
      </div>

      <Section title={`Word list (${p.glossary.length})`}>
        {p.glossary.length === 0 ? none : (
          <div className="flex flex-wrap gap-1.5">
            {p.glossary.map((g, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
                {g.source}
                {g.keep ? <span className="text-muted-foreground">stays as is</span> : g.target ? <><ArrowRight className="h-3 w-3 text-muted-foreground" /><span className="font-medium">{g.target}</span></> : null}
              </span>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Always say it this way">
          {p.replacements.length === 0 ? <span className="text-xs text-muted-foreground">No fixed wording. The agent writes its own answer.</span> : (
            <ul className="space-y-1 text-sm">
              {p.replacements.map((r, i) => (
                <li key={i} className="flex items-center gap-2"><span className="truncate text-muted-foreground">{r.from}</span><ArrowRight className="h-3 w-3 shrink-0" /><span className="truncate font-medium">{r.to}</span></li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Tone rules">
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Include</span>
              {p.required_phrases.length ? p.required_phrases.map((x) => <span key={x} className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">{x}</span>) : <span>-</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Avoid</span>
              {p.banned_phrases.length ? p.banned_phrases.map((x) => <span key={x} className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-700 dark:text-red-400">{x}</span>) : <span>-</span>}
            </div>
            {p.notes && <p className="rounded-lg bg-muted/40 p-2 text-muted-foreground">{p.notes}</p>}
          </div>
        </Section>
      </div>
      {p.sample_cases.length > 0 && (
        <p className="text-xs text-muted-foreground">{p.sample_cases.length} test phrase{p.sample_cases.length === 1 ? "" : "s"} saved for checking the agent.</p>
      )}
    </div>
  );
}

/* ───────────────────────── Voice lab ───────────────────────── */

function langTag(code: string) {
  return (code || "").split("-").slice(0, 2).join("-") || navigator.language || "en";
}

function browserSpeak(text: string, code: string) {
  if (!("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langTag(code);
  utterance.rate = 0.98;
  synth.speak(utterance);
  return true;
}

/** Plays an audio blob and cleans up its object URL; one clip at a time. */
function useClipPlayer() {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);

  function stop() {
    elRef.current?.pause();
    elRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPlaying(false);
  }

  useEffect(() => stop, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function play(blob: Blob) {
    stop();
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const audio = new Audio(url);
    elRef.current = audio;
    audio.onended = stop;
    audio.onerror = stop;
    setPlaying(true);
    await audio.play();
  }

  return { playing, play, stop };
}

function Range({ label, value, onChange, min = 0, max = 1, step = 0.05 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-primary"
      />
    </div>
  );
}

function VoicePanel({ profile, onChanged }: { profile: LocaleProfile; onChanged: () => Promise<unknown> }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [draft, setDraft] = useState<LocaleSpeech>(() => ({ ...profile.speech }));
  const [sample, setSample] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const player = useClipPlayer();
  const toast = useToast();

  const greeting = draft.greeting?.trim() || `${profile.default_language || "Hello"} — ${profile.name}`;
  const set = (p: Partial<LocaleSpeech>) => setDraft((s) => ({ ...s, ...p }));

  useEffect(() => { setDraft({ ...profile.speech }); }, [profile.id, profile.updated_at]);
  useEffect(() => { setSample(draft.greeting?.trim() || ""); }, [profile.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshStatus() {
    try { const s = await api.voiceStatus(); setStatus(s); if (!s.configured) setShowKeys(true); }
    catch { /* status is a nicety; the panels below still work */ }
  }
  async function loadVoices(refresh = false) {
    setLoadingVoices(true); setVoiceErr(null);
    try { setCatalog(await api.voiceVoices(refresh)); }
    catch (e: any) { setVoiceErr(String(e.message ?? e).replace(/^\d+\s/, "")); }
    finally { setLoadingVoices(false); }
  }
  useEffect(() => { refreshStatus(); loadVoices(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      await api.patchLocaleProfile(profile.id, { speech: draft });
      await onChanged();
      toast.push("Sound settings saved", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
    finally { setSaving(false); }
  }

  async function playText(text: string) {
    if (!text.trim()) { toast.push("Type what the agent should say first", "error"); return; }
    setNotice(null);
    try {
      const blob = await api.voiceTts({
        text: text.trim(), profile_id: profile.id, voice_id: draft.voice_id || undefined,
        model_id: draft.model_id, stability: draft.stability, similarity: draft.similarity,
        style: draft.style, speed: draft.speed,
      });
      await player.play(blob);
    } catch (e: any) {
      const message = String(e.message ?? e).replace(/^\d+\s/, "");
      setNotice(message);
      if (Number(e.status) === 424) setShowKeys(true);
    }
  }

  const voices = catalog?.voices ?? [];
  const voiceModels = catalog?.models ?? status?.models ?? [];
  const currency = status?.subscription?.characters_left;

  return (
    <div className="space-y-3">
      {/* Hero: hear the dialect */}
      <div className="overflow-hidden rounded-2xl border bg-gradient-to-br from-violet-500/10 via-background to-sky-500/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">How {profile.name} sounds</div>
            <p className="mt-1 max-w-xl text-base" dir="auto">“{greeting}”</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {status?.configured ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />ElevenLabs{currency != null ? ` · ${currency.toLocaleString()} characters left` : ""}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">
                  <KeyRound className="h-3 w-3" />Add the ElevenLabs key to hear real voices
                </span>
              )}
              <span>{voices.length ? `${voices.length} voices available` : "Browser voice available meanwhile"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {player.playing ? (
              <Button size="sm" variant="outline" onClick={player.stop}><Square /> Stop</Button>
            ) : (
              <Button size="sm" onClick={() => playText(greeting)}><Play /> Hear the greeting</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => {
              if (!browserSpeak(greeting, profile.locale_code)) toast.push("This browser has no speech voice", "error");
            }}><VolumeFallbackIcon /> Browser voice</Button>
          </div>
        </div>
        {(notice || voiceErr) && (
          <div role="alert" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
            {notice || voiceErr}
          </div>
        )}
      </div>

      {showKeys && (
        <div className="space-y-2">
          <ProviderKeys page="voice" title="ElevenLabs key" onSaved={() => { refreshStatus(); loadVoices(true); }} />
          <p className="text-[11px] text-muted-foreground">
            Voices, the Voice line and the agent-kit phone component all use this key. It is stored on the server and never sent to the browser.
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Section title="The voice">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pick a voice" hint={loadingVoices ? "Loading voices…" : "Match the gender, age and accent your customers expect."}>
                <div className="flex gap-2">
                  <select
                    aria-label="Voice"
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                    value={draft.voice_id ?? ""}
                    onChange={(e) => set({ voice_id: e.target.value })}
                  >
                    <option value="">Voice default (first available)</option>
                    {draft.voice_id && !voices.some((v) => v.voice_id === draft.voice_id) && (
                      <option value={draft.voice_id}>{draft.voice_id} · current</option>
                    )}
                    {voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}{v.accent ? ` · ${v.accent}` : ""}{v.gender ? ` · ${v.gender}` : ""}
                      </option>
                    ))}
                  </select>
                  <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" title="Refresh voices" aria-label="Refresh voices"
                    onClick={() => loadVoices(true)} disabled={loadingVoices}><RefreshCw className={cn("h-4 w-4", loadingVoices && "animate-spin")} /></Button>
                </div>
              </Field>
              <Field label="Speech model" hint={voiceModels.find((m) => m.id === (draft.model_id || voiceModels[0]?.id))?.detail}>
                <select
                  aria-label="Speech model"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm"
                  value={draft.model_id ?? voiceModels[0]?.id ?? "eleven_multilingual_v2"}
                  onChange={(e) => set({ model_id: e.target.value })}
                >
                  {voiceModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Opening line on a call" hint="Read out before the customer says anything.">
              <Input value={draft.greeting ?? ""} onChange={(e) => set({ greeting: e.target.value })} placeholder="Karibu! Habari za leo?" dir="auto" />
            </Field>
            <Field label="Spoken delivery" hint="Read by the agent and the phone component, e.g. “short sentences, read amounts slowly”.">
              <Textarea rows={2} value={draft.delivery ?? ""} onChange={(e) => set({ delivery: e.target.value })}
                placeholder="Short sentences. Say amounts digit by digit. Never sound rushed." />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Range label="Stability" value={draft.stability ?? 0.5} onChange={(v) => set({ stability: v })} />
              <Range label="Similarity" value={draft.similarity ?? 0.75} onChange={(v) => set({ similarity: v })} />
              <Range label="Style" value={draft.style ?? 0} onChange={(v) => set({ style: v })} />
              <Range label="Speed" value={draft.speed ?? 1} min={0.7} max={1.2} step={0.05} onChange={(v) => set({ speed: v })} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-[11px] text-muted-foreground">Stability low = more expressive; high = steadier. Speed below 1 helps with numbers.</p>
              <AsyncButton size="sm" onRun={save} disabled={saving}>Save sound settings</AsyncButton>
            </div>
          </div>
        </Section>

        <Section title="Say something">
          <div className="space-y-2">
            <Textarea rows={3} value={sample} onChange={(e) => setSample(e.target.value)}
              placeholder="Your balance is TZS 250,000.00." dir="auto" />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => playText(sample || greeting)} disabled={player.playing}>
                <Play /> Speak
              </Button>
              <Button size="sm" variant="outline" onClick={() => browserSpeak(sample || greeting, profile.locale_code)}>
                <Mic />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Uses the saved voice. Amounts and dates are formatted by the dialect rules before they are spoken.
            </p>
          </div>
        </Section>
      </div>

      <Section title="Accent bench">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Note how the same dialect changes by town or audience. Each row is written into the spoken-delivery instructions.
          </p>
          <Rows<{ label: string; note?: string }>
            items={draft.accents ?? []} onChange={(accents) => set({ accents })}
            blank={{ label: "", note: "" }} addLabel="Add an accent" empty="No accents noted yet."
          >
            {(a, upd) => (
              <>
                <Input value={a.label} onChange={(e) => upd({ label: e.target.value })} placeholder="Dar es Salaam" aria-label="Accent" />
                <Input value={a.note ?? ""} onChange={(e) => upd({ note: e.target.value })} placeholder="Faster, more English mixed in" aria-label="Accent note" />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" title="Hear it"
                  aria-label={`Hear ${a.label || "accent"}`}
                  onClick={() => playText(`${draft.greeting || greeting} ${a.note ?? ""}`.trim())}>
                  <Play className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </Rows>
        </div>
      </Section>

      <Section title="Where this voice is used">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Headphones className="h-4 w-4" /> Voice line</div>
            <p className="mt-1 text-xs text-muted-foreground">
              The phone console in <b>Voice</b> speaks replies with this voice and saves call turns as corrections when training capture is on.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Phone className="h-4 w-4" /> Agent-kit phone component</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Drop <code className="rounded bg-background px-1">&lt;PhoneCall /&gt;</code> into any React app. Same dialect, same voice, real calls.
            </p>
            <CopySnippet
              label="PhoneCall"
              code={`<PhoneCall
  gateway={{ baseUrl: "${apiBase()}", publishableKey: "pk_…" }}
  agentId="your-agent-id"
  locale={{ profileId: "${profile.id}" }}
  mode="live"
  ttsEndpoint="/api/tts"
/>`}
            />
          </div>
        </div>
      </Section>
    </div>
  );
}

function VolumeFallbackIcon() {
  return <AudioLines className="h-4 w-4" />;
}

function CopySnippet({ label, code }: { label: string; code: string }) {
  const toast = useToast();
  return (
    <div className="mt-2">
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
        onClick={async () => {
          try { await navigator.clipboard.writeText(code); toast.push(`${label} snippet copied`, "success"); }
          catch { toast.push("Copy is not available in this browser", "error"); }
        }}>
        <Copy /> Copy snippet
      </Button>
      <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">{code}</pre>
    </div>
  );
}

/* ───────────────────────── Model lab ───────────────────────── */

const REASONING = [
  { value: "off", title: "Quick", hint: "One pass. Cheapest and fastest for short replies." },
  { value: "light", title: "Balanced", hint: "A little checking before answering. Good default." },
  { value: "deep", title: "Careful", hint: "Checks terminology and tone before replying. Slower." },
] as const;

function InferencePanel({ profile, models, onChanged }: {
  profile: LocaleProfile; models: ModelCfg[]; onChanged: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<LocaleInference>(() => ({ ...profile.inference }));
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const set = (p: Partial<LocaleInference>) => setDraft((s) => ({ ...s, ...p }));

  useEffect(() => { setDraft({ ...profile.inference }); }, [profile.id, profile.updated_at]);

  async function save() {
    setSaving(true);
    try {
      const res = await api.patchLocaleProfile(profile.id, { inference: draft });
      await onChanged();
      toast.push(res.agents_refreshed ? `Model saved · ${res.agents_refreshed} specialist(s) refreshed` : "Model saved", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
    finally { setSaving(false); }
  }

  const model = draft.model || "";
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-gradient-to-br from-sky-500/10 via-background to-indigo-500/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium"><BrainCircuit className="h-4 w-4" /> The brain behind this dialect</div>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          The Locale Specialist that translates, applies your word list and fixes money and dates runs on this model.
          Leave it empty and it borrows the speaking agent&apos;s model.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Specialist model">
          <Field label="Model" hint={model ? "Used by every agent with this dialect attached." : "Inherits the model of whichever agent is speaking."}>
            <ModelSelect value={model} onChange={(v) => set({ model: v })} models={models} allowEmpty
              emptyLabel="Inherit the agent's model" />
          </Field>
          <div className="mt-3">
            <Field label="Fallback model" hint="Tried when the first model is unavailable or rate-limited.">
              <ModelSelect value={draft.fallback_model ?? ""} onChange={(v) => set({ fallback_model: v })} models={models} allowEmpty
                emptyLabel="No fallback" />
            </Field>
          </div>
        </Section>

        <Section title="How hard it thinks">
          <Field label="Effort" hint="Cheaper dialects handle greetings; careful ones handle balances and contracts.">
            <Choice value={(draft.reasoning ?? "light") as "off" | "light" | "deep"}
              onChange={(v) => set({ reasoning: v })} options={REASONING} />
          </Field>
          <div className="mt-3">
            <Range label="Temperature (lower = more consistent wording)" value={draft.temperature ?? 0.3}
              min={0} max={1} step={0.05} onChange={(v) => set({ temperature: v })} />
          </div>
        </Section>
      </div>

      <Section title="Instructions for the specialist">
        <Textarea rows={2} value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value })}
          placeholder="Prefer short sentences. When a term is missing from the word list, ask the supervisor subagent." />
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">Saving refreshes the Locale Specialist on every agent that uses this dialect.</p>
        <AsyncButton onRun={save} disabled={saving}><Cpu /> Save model settings</AsyncButton>
      </div>
    </div>
  );
}

/* ───────────────────────── Training lab ───────────────────────── */

const PACK_FORMATS = [
  { value: "chat", title: "Chat pairs", hint: "User message → ideal reply. Works with most fine-tune APIs." },
  { value: "preference", title: "Chosen vs rejected", hint: "Only corrections with the wrong answer kept: teaches the difference." },
  { value: "plain", title: "Plain prompt", hint: "Simple prompt → completion pairs for classic trainers." },
] as const;

function TrainingPanel({ profile, examples, onChanged }: {
  profile: LocaleProfile; examples: LocaleExample[]; onChanged: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<LocaleTraining>(() => ({ ...profile.training }));
  const [pack, setPack] = useState<LocaleTrainingPack | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const set = (p: Partial<LocaleTraining>) => setDraft((s) => ({ ...s, ...p }));

  async function loadPack() {
    try { setPack(await api.localeTrainingPack(profile.id)); } catch { setPack(null); }
  }
  useEffect(() => { setDraft({ ...profile.training }); loadPack(); }, [profile.id, profile.updated_at]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      await api.patchLocaleProfile(profile.id, { training: draft });
      await onChanged(); await loadPack();
      toast.push("Training settings saved", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
    finally { setSaving(false); }
  }

  async function download() {
    try {
      await api.downloadLocaleTrainingPack(profile.id, `locale-${(profile.locale_code || profile.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jsonl`);
      toast.push("Training pack downloaded", "success");
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  const corrections = examples.filter((e) => e.input && e.corrected_output);
  const withReject = corrections.filter((e) => e.bad_output);
  const count = pack?.count ?? corrections.length + profile.sample_cases.filter((c) => c.input && c.expected_contains).length;
  const ready = pack?.ready ?? count >= (draft.min_pairs ?? 20);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-gradient-to-br from-emerald-500/10 via-background to-amber-500/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium"><GraduationCap className="h-4 w-4" /> Turn this dialect into training data</div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Corrections and captured call turns are already paired examples. Export them as JSONL, fine-tune in
              <b> Training</b>, then attach the tuned model above and measure it with the locale eval.
            </p>
          </div>
          <Badge variant={ready ? "secondary" : "outline"} className={ready ? "text-emerald-700 dark:text-emerald-400" : ""}>
            {count} / {draft.min_pairs ?? 20} pairs {ready ? "· ready" : "· keep teaching"}
          </Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={count === 0} onClick={download}><Download /> Download .jsonl</Button>
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
            {corrections.length} corrections · {withReject.length} with a wrong answer · {profile.sample_cases.length} test phrases
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Collect">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Capture call turns</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                When the Voice line runs this dialect, each turn is offered as a correction so a reviewer can approve it.
              </p>
            </div>
            <Switch checked={!!draft.capture} onCheckedChange={(v) => set({ capture: v })} aria-label="Capture call turns" />
          </div>
          <div className="mt-3">
            <Field label="Ready after how many pairs">
              <Input type="number" min={2} max={500} className="w-28 font-mono text-xs"
                value={draft.min_pairs ?? 20}
                onChange={(e) => set({ min_pairs: Math.max(2, Number(e.target.value) || 2) })} />
            </Field>
          </div>
        </Section>

        <Section title="Shape">
          <Field label="Training format">
            <Choice cols={3} value={(draft.format ?? "chat") as "chat" | "plain" | "preference"}
              onChange={(v) => set({ format: v })} options={PACK_FORMATS} />
          </Field>
          <div className="mt-3">
            <Field label="Training job tag" hint="Optional. The name you will use in Training → New job.">
              <Input value={draft.target_job ?? ""} onChange={(e) => set({ target_job: e.target.value })}
                placeholder="sw-tz-v2" className="font-mono text-xs" />
            </Field>
          </div>
        </Section>
      </div>

      <Section title="Preview">
        {pack && pack.rows.length > 0 ? (
          <pre className="max-h-56 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">
            {JSON.stringify(pack.rows.slice(0, 3), null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing to export yet. Add corrections below, or record calls in the Voice line with capture switched on.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5">1. Collect</span>
          <span className="rounded-full bg-muted px-2 py-0.5">2. Export JSONL</span>
          <span className="rounded-full bg-muted px-2 py-0.5">3. Fine-tune in Training</span>
          <span className="rounded-full bg-muted px-2 py-0.5">4. Set the model above</span>
          <span className="rounded-full bg-muted px-2 py-0.5">5. Run the locale eval</span>
        </div>
      </Section>

      <div className="flex justify-end">
        <AsyncButton onRun={save} disabled={saving}><GraduationCap /> Save training settings</AsyncButton>
      </div>
    </div>
  );
}

/* ───────────────────────── Corrections ───────────────────────── */

function CorrectionsPanel({ profile, examples, onChanged }: {
  profile: LocaleProfile; examples: LocaleExample[]; onChanged: () => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LocaleExample | null>(null);
  const [deleting, setDeleting] = useState<LocaleExample | null>(null);
  const toast = useToast();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-muted-foreground">
          Show the agent what a customer asked and how it should have answered. It copies the wording, vocabulary and tone.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add correction</Button>
      </div>

      {examples.length === 0 ? (
        <EmptyState
          icon={MessageSquareQuote} title="Nothing taught yet"
          body="Add a question and the perfect answer. One good example teaches more than a page of rules."
          action={<Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus /> Add correction</Button>}
        />
      ) : (
        <div className="space-y-2.5">
          {examples.map((e) => (
            <div key={e.id} className={cn("rounded-xl border p-3", !e.enabled && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-muted px-3 py-1.5 text-sm" dir="auto">{e.input}</div>
                  {e.bad_output && (
                    <div className="flex w-fit max-w-[90%] items-start gap-1.5 rounded-2xl rounded-bl-sm border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs text-muted-foreground" dir="auto">
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-500" /><span className="line-through">{e.bad_output}</span>
                    </div>
                  )}
                  <div className="flex w-fit max-w-[90%] items-start gap-1.5 rounded-2xl rounded-bl-sm border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-sm" dir="auto">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><span>{e.corrected_output}</span>
                  </div>
                  {(e.note || !e.enabled) && (
                    <div className="text-[11px] text-muted-foreground">{!e.enabled && "Switched off. "}{e.note}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={async () => {
                      try {
                        await api.patchLocaleExample(e.id, { enabled: !e.enabled });
                        await onChanged();
                        toast.push(e.enabled ? "Correction switched off" : "Correction switched on", "success");
                      } catch (err: any) { toast.push(err.message, "error"); }
                    }}
                  >{e.enabled ? "Switch off" : "Switch on"}</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" aria-label="Edit correction" onClick={() => setEditing(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete" aria-label="Delete correction" onClick={() => setDeleting(e)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && <ExampleForm profileId={profile.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); toast.push("Correction added", "success"); }} />}
      {editing && <ExampleForm profileId={profile.id} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); toast.push("Correction saved", "success"); }} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this correction?" description="The agent will stop learning from this example."
          confirmLabel="Delete" destructive onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.deleteLocaleExample(deleting.id); setDeleting(null); await onChanged(); }}
        />
      )}
    </div>
  );
}

function ExampleForm({ profileId, initial, onClose, onSaved }: {
  profileId: string; initial?: LocaleExample; onClose: () => void; onSaved: () => void;
}) {
  const [input, setInput] = useState(initial?.input ?? "");
  const [bad, setBad] = useState(initial?.bad_output ?? "");
  const [good, setGood] = useState(initial?.corrected_output ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const toast = useToast();

  async function save() {
    try {
      if (initial) await api.patchLocaleExample(initial.id, { input, bad_output: bad || null, corrected_output: good, note, enabled });
      else await api.createLocaleExample(profileId, { input, corrected_output: good, bad_output: bad || null, note, source: "manual" });
      onSaved();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit correction" : "Add correction"}</DialogTitle>
          <DialogDescription>The agent copies the wording, words and tone of the answer you write here.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="What the customer wrote"><Textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste or type the customer's message" /></Field>
          <Field label="What the agent said wrongly (optional)"><Textarea rows={2} value={bad} onChange={(e) => setBad(e.target.value)} placeholder="The answer that needs fixing" /></Field>
          <Field label="The answer it should give"><Textarea rows={3} value={good} onChange={(e) => setGood(e.target.value)} placeholder="Write it exactly how you want it said" /></Field>
          <Field label="Why this wording (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: we never say “Hi there” to elders" /></Field>
          {initial && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Keep this correction switched on
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!input.trim() || !good.trim()}>{initial ? "Save changes" : "Add correction"}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Agents ───────────────────────── */

function AgentsPanel({ profile, agents, attached, onChanged }: {
  profile: LocaleProfile; agents: Agent[]; attached: Array<{ id: string; name: string; model: string }>;
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const attachedIds = useMemo(() => new Set(attached.map((a) => a.id)), [attached]);

  async function toggle(agent: Agent, isAttached: boolean) {
    setBusy(agent.id);
    try {
      if (isAttached) { await api.detachLocale(profile.id, agent.id); toast.push(`Switched off for ${agent.name}`, "success"); }
      else { await api.attachLocale(profile.id, agent.id); toast.push(`${agent.name} now speaks ${profile.name}`, "success"); }
      await onChanged();
    } catch (e: any) { toast.push(e.message, "error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Switch this dialect on for an agent and it adds a Locale Specialist that handles wording for the whole team. After you change the dialect or its
        corrections, switch it off and on again to refresh the specialist.
      </p>
      {agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents yet" body="Create an agent first, then come back to give it a dialect." />
      ) : (
        <div className="divide-y rounded-xl border">
          {agents.map((a) => {
            const on = attachedIds.has(a.id);
            return (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{a.model}</div>
                </div>
                <div className="flex items-center gap-2">
                  {on && <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Speaking {profile.default_language || "this dialect"}</span>}
                  <AsyncButton size="sm" variant={on ? "outline" : "default"} disabled={busy === a.id} onRun={() => toggle(a, on)}>
                    {on ? <><Unlink /> Switch off</> : <><Link2 /> Switch on</>}
                  </AsyncButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Try it ───────────────────────── */

function PreviewPanel({ profileId }: { profileId: string }) {
  const [preview, setPreview] = useState<LocalePreview | null>(null);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const toast = useToast();

  async function load() {
    setBusy(true); setErr(null);
    try { setPreview(await api.previewLocale(profileId, { text: text.trim() || undefined, language: language.trim() || undefined })); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { setPreview(null); setText(""); setLanguage(""); load(); }, [profileId]);

  async function copy() {
    if (!preview) return;
    try { await navigator.clipboard.writeText(preview.rules); toast.push("Rules copied", "success"); }
    catch { toast.push("Copy is not available in this browser", "error"); }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Field label="Type a sentence with an amount or date">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Your balance is TZS 250000.00 on 2026-11-14" className="text-sm" />
        </Field>
        <Field label="Language of the reply">
          <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Optional" className="text-sm" />
        </Field>
        <Button variant="outline" onClick={load} disabled={busy}><Sparkles /> {busy ? "Working…" : "Try it"}</Button>
      </div>

      {err && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{err}</div>}

      {preview && (
        <>
          {preview.formatted && (
            <div className="rounded-xl border bg-muted/20 p-3.5">
              <div className="mb-1 text-sm font-medium">{text.trim() ? "How it will read" : "Example"}</div>
              <div className="whitespace-pre-wrap text-base" dir="auto">{preview.formatted}</div>
            </div>
          )}
          <div className="rounded-xl border p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">Specialist created for agents</div>
              <Badge variant="outline">{preview.specialist.name}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{preview.specialist.description}</p>
          </div>
          <div className="rounded-xl border">
            <div className="flex items-center justify-between px-3 py-2">
              <button type="button" className="text-sm font-medium underline-offset-4 hover:underline" onClick={() => setShowRules((v) => !v)}>
                {showRules ? "Hide the written rules" : "Show the written rules"}
              </button>
              {showRules && <Button size="sm" variant="ghost" onClick={copy}><Copy /> Copy</Button>}
            </div>
            {showRules && <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t p-3 text-[11px] leading-relaxed">{preview.rules}</pre>}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Form ───────────────────────── */

function ProfileForm({ tenant, initial, seed, onClose, onSaved }: {
  tenant: string; initial?: LocaleProfile; seed?: Partial<Form>; onClose: () => void; onSaved: (p?: { id: string }) => void;
}) {
  const [f, setF] = useState<Form>(() => ({ ...BLANK, ...((initial ?? seed ?? {}) as Partial<Form>) }));
  const set = (p: Partial<Form>) => setF((s) => ({ ...s, ...p }));
  const und = f.understanding ?? {};
  const out = f.output ?? {};
  const toast = useToast();

  async function save() {
    try {
      const body = {
        ...f,
        name: f.name.trim(), locale_code: f.locale_code.trim(), default_language: f.default_language.trim(),
        currency_code: f.currency_code.trim(), currency_symbol: f.currency_symbol.trim(), date_format: f.date_format.trim(),
        decimal_sep: f.decimal_sep || ".",
        glossary: f.glossary.filter((g) => g.source.trim() && (g.keep || g.target?.trim())).map((g) => (g.keep ? { source: g.source.trim(), keep: true } : { source: g.source.trim(), target: g.target!.trim() })),
        replacements: f.replacements.filter((r) => r.from.trim() && r.to.trim()),
        sample_cases: f.sample_cases.filter((c) => c.input.trim() && c.expected_contains.trim()),
      } as unknown as LocaleProfileInput;
      if (initial) { await api.patchLocaleProfile(initial.id, body); onSaved(); }
      else { const p = await api.createLocaleProfile({ ...body, tenant_id: tenant }); onSaved(p); }
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  const input = "text-sm";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "Set up your dialect"}</DialogTitle>
          <DialogDescription>Answer in plain words. Nothing here needs any technical knowledge.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-2xl border bg-muted/20 p-3">
          <Monogram name={f.name} code={f.locale_code} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{f.name || "Unnamed dialect"}</div>
            <div className="truncate text-xs text-muted-foreground">{f.default_language || "Pick a main language"}</div>
          </div>
          <div className="text-right font-mono text-xs leading-5 text-muted-foreground">
            <div>{sampleMoney(f)}</div><div>{datePattern(f.date_format)}</div>
          </div>
        </div>

        <Tabs defaultValue="voice">
          <TabsList className="h-10 rounded-xl p-1">
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="direction">In and out</TabsTrigger>
            <TabsTrigger value="words">Words</TabsTrigger>
            <TabsTrigger value="numbers">Money and dates</TabsTrigger>
            <TabsTrigger value="checks">Test phrases</TabsTrigger>
          </TabsList>

          <TabsContent value="voice" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" className="sm:col-span-2"><Input className={input} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Kiswahili (Tanzania)" /></Field>
              <Field label="Short code" hint="For example sw-TZ"><Input className="font-mono text-xs" value={f.locale_code} onChange={(e) => set({ locale_code: e.target.value })} placeholder="sw-TZ" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Languages spoken" hint="Press Enter after each one"><TagInput value={f.languages} onChange={(v) => set({ languages: v })} placeholder="Kiswahili, English" /></Field>
              <Field label="Main language">
                <Input className={input} list="locale-langs" value={f.default_language} onChange={(e) => set({ default_language: e.target.value })} placeholder="Kiswahili" />
                <datalist id="locale-langs">{f.languages.map((l) => <option key={l} value={l} />)}</datalist>
              </Field>
            </div>
            <Field label="How formal should it sound?">
              <Choice value={f.register_style} onChange={(v) => set({ register_style: v })} options={FORMALITY} />
            </Field>
            <Field label="When customers mix languages">
              <Choice value={f.code_switch_policy} onChange={(v) => set({ code_switch_policy: v })} options={MIXING} />
            </Field>
            <Field label="Anything else the agent should know" hint="Audience, house style, topics to handle with care.">
              <Textarea rows={2} className={input} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Our customers are mostly traders. Keep answers short." />
            </Field>
          </TabsContent>

          <TabsContent value="direction" className="mt-4 space-y-4">
            <div className="space-y-3 rounded-xl border p-3.5">
              <div>
                <div className="text-sm font-medium">Understanding localised input</div>
                <p className="text-xs text-muted-foreground">Customers write in their own language, often mixing two. Tell the agent what to expect.</p>
              </div>
              <Field label="Languages customers write in" hint="Leave empty to use the languages from the Voice tab.">
                <TagInput value={und.languages ?? []} onChange={(v) => set({ understanding: { ...und, languages: v } })} placeholder="Kiswahili, English, Sheng" />
              </Field>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={!!und.auto_detect}
                  onChange={(e) => set({ understanding: { ...und, auto_detect: e.target.checked } })} />
                <span>
                  <span className="font-medium">Work out the language automatically</span>
                  <span className="block text-xs text-muted-foreground">Reads each message in whatever language it is written, and follows the customer if they switch.</span>
                </span>
              </label>
              <Field label="Translate it internally to" hint="Optional. The agent can think in this language without telling the customer.">
                <Input className={input} value={und.translate_to ?? ""} onChange={(e) => set({ understanding: { ...und, translate_to: e.target.value } })} placeholder="English" />
              </Field>
              <Field label="What to watch for">
                <Textarea rows={2} className={input} value={und.notes ?? ""} onChange={(e) => set({ understanding: { ...und, notes: e.target.value } })} placeholder="Amounts may be written in words; customers may use Sheng or misspell words." />
              </Field>
            </div>

            <div className="space-y-3 rounded-xl border p-3.5">
              <div>
                <div className="text-sm font-medium">Localised replies</div>
                <p className="text-xs text-muted-foreground">Finished answers are written in the customer's language by default.</p>
              </div>
              <Field label="How the agent should answer">
                <Choice value={(out.mode ?? "mirror") as "mirror" | "fixed" | "bilingual"} options={REPLY_MODES}
                  onChange={(v) => set({ output: { ...out, mode: v } })} />
              </Field>
              {out.mode && out.mode !== "mirror" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Answer language">
                    <Input className={input} list="locale-langs" value={out.language ?? ""} onChange={(e) => set({ output: { ...out, language: e.target.value } })} placeholder={f.default_language || "Kiswahili"} />
                  </Field>
                  {out.mode === "bilingual" && (
                    <Field label="Second language">
                      <Input className={input} list="locale-langs" value={out.second_language ?? ""} onChange={(e) => set({ output: { ...out, second_language: e.target.value } })} placeholder="English" />
                    </Field>
                  )}
                </div>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={!!out.localise_tools}
                  onChange={(e) => set({ output: { ...out, localise_tools: e.target.checked } })} />
                <span>
                  <span className="font-medium">Localise tool results</span>
                  <span className="block text-xs text-muted-foreground">Translate names and statuses from tools, keeping amounts, codes and identifiers exactly as returned.</span>
                </span>
              </label>
            </div>

            <div className="rounded-xl border bg-muted/20 p-3.5 text-sm">
              <div className="font-medium">What a customer will see</div>
              <p className="mt-1 text-muted-foreground">
                {(out.mode ?? "mirror") === "mirror"
                  ? `Replies follow the language each customer writes in${und.auto_detect ? ", including when they switch mid-conversation" : ""}.`
                  : (out.mode === "bilingual")
                    ? `Replies are written in ${out.language || f.default_language || "the main language"}, then repeated in ${out.second_language || "a second language"}.`
                    : `Every reply is written in ${out.language || f.default_language || "the main language"}, even when the customer writes in another language.`}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="words" className="mt-4 space-y-5">
            <Field label="Word list" hint="Tell the agent which word to use for each English term, or which names must never be translated.">
              <Rows<Term> items={f.glossary} onChange={(glossary) => set({ glossary })} blank={{ source: "", target: "" }}
                addLabel="Add a word" empty="No words yet. Add the terms your customers use every day.">
                {(g, upd) => (
                  <>
                    <Input className={input} value={g.source} onChange={(e) => upd({ source: e.target.value })} placeholder="Loan" aria-label="Original word" />
                    {g.keep ? <span className="flex-1 text-xs text-muted-foreground">stays exactly as written</span> : (
                      <>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <Input className={input} value={g.target ?? ""} onChange={(e) => upd({ target: e.target.value })} placeholder="Mkopo" aria-label="Word to use" dir="auto" />
                      </>
                    )}
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={!!g.keep} onChange={(e) => upd({ keep: e.target.checked })} /> Keep
                    </label>
                  </>
                )}
              </Rows>
            </Field>
            <Field label="Always say it this way" hint="Whenever the agent writes the left phrase, it is swapped for the right one in every reply.">
              <Rows<Swap> items={f.replacements} onChange={(replacements) => set({ replacements })} blank={{ from: "", to: "" }}
                addLabel="Add a swap" empty="No swaps. The agent chooses its own wording.">
                {(r, upd) => (
                  <>
                    <Input className={input} value={r.from} onChange={(e) => upd({ from: e.target.value })} placeholder="Hello" aria-label="When it says" />
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Input className={input} value={r.to} onChange={(e) => upd({ to: e.target.value })} placeholder="Karibu" aria-label="Say this instead" dir="auto" />
                  </>
                )}
              </Rows>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Always include"><TagInput value={f.required_phrases} onChange={(v) => set({ required_phrases: v })} placeholder="Karibu" /></Field>
              <Field label="Never say"><TagInput tone="bad" value={f.banned_phrases} onChange={(v) => set({ banned_phrases: v })} placeholder="Hi there" /></Field>
            </div>
          </TabsContent>

          <TabsContent value="numbers" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Currency name"><Input className="font-mono text-xs" value={f.currency_code} onChange={(e) => set({ currency_code: e.target.value })} placeholder="TZS" /></Field>
              <Field label="Currency symbol"><Input className="font-mono text-xs" value={f.currency_symbol} onChange={(e) => set({ currency_symbol: e.target.value })} placeholder="TZS" /></Field>
              <Field label="Symbol goes">
                <Choice cols={2} value={f.currency_position} onChange={(v) => set({ currency_position: v })}
                  options={[{ value: "before", title: "Before", hint: "TZS 500" }, { value: "after", title: "After", hint: "500 TZS" }]} />
              </Field>
              <Field label="Between thousands"><Input className="font-mono text-xs" value={f.thousand_sep} onChange={(e) => set({ thousand_sep: e.target.value })} placeholder="," /></Field>
              <Field label="Before cents"><Input className="font-mono text-xs" value={f.decimal_sep} onChange={(e) => set({ decimal_sep: e.target.value })} placeholder="." /></Field>
            </div>
            <Field label="How dates are written">
              <div className="flex flex-wrap gap-2">
                {DATE_CHOICES.map((d) => (
                  <button key={d} type="button" onClick={() => set({ date_format: d })}
                    className={cn("rounded-lg border px-3 py-1.5 text-left text-xs transition-colors", f.date_format === d ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
                    <div className="font-mono">{d}</div><div className="text-muted-foreground">{datePattern(d)}</div>
                  </button>
                ))}
              </div>
              <Input className="mt-2 max-w-xs font-mono text-xs" value={f.date_format} onChange={(e) => set({ date_format: e.target.value })} placeholder="Or type your own, like DD-MM-YY" />
            </Field>
            <div className="rounded-xl border bg-muted/20 p-3.5">
              <div className="text-sm font-medium">Preview</div>
              <p className="mt-1 text-base">Your balance is <span className="font-mono">{sampleMoney(f)}</span> as of <span className="font-mono">{datePattern(f.date_format)}</span>.</p>
            </div>
          </TabsContent>

          <TabsContent value="checks" className="mt-4">
            <Field label="Test phrases" hint="Later we test the agent with these and check that its reply contains what you expect.">
              <Rows<Case> items={f.sample_cases} onChange={(sample_cases) => set({ sample_cases })} blank={{ input: "", expected_contains: "" }}
                addLabel="Add a test" empty="No tests yet. Add a greeting the agent should always get right.">
                {(c, upd) => (
                  <>
                    <Input className={input} value={c.input} onChange={(e) => upd({ input: e.target.value })} placeholder="Customer says: hello" aria-label="Customer says" />
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Input className={input} value={c.expected_contains} onChange={(e) => upd({ expected_contains: e.target.value })} placeholder="Reply has: Karibu" aria-label="Reply should contain" dir="auto" />
                  </>
                )}
              </Rows>
            </Field>
          </TabsContent>
        </Tabs>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Switched on (agents using this dialect follow it)
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!f.name.trim()}>{initial ? "Save changes" : "Create dialect"}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}