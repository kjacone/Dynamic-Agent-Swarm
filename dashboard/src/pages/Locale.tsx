import { useEffect, useMemo, useState } from "react";
import {
  Bot, CheckCircle2, Copy, FileText, Globe2, Languages, Link2, MessageSquareQuote,
  Pencil, Plus, Sparkles, Trash2, Unlink, XCircle,
} from "lucide-react";

import {
  api, type Agent, type LocaleDetail, type LocaleExample, type LocalePreview,
  type LocaleProfile, type LocaleProfileInput, type LocaleProfileRow,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingBlock } from "@/components/common/AsyncState";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatCard } from "@/components/common/StatCard";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const joinList = (xs: string[] | undefined) => (xs ?? []).join(", ");

const BLANK: LocaleProfileInput = {
  name: "", locale_code: "", languages: [], default_language: "",
  register_style: "formal", code_switch_policy: "allowed",
  currency_code: "", currency_symbol: "", currency_position: "before",
  decimal_sep: ".", thousand_sep: ",", date_format: "",
  glossary: [], replacements: [], required_phrases: [], banned_phrases: [],
  sample_cases: [], notes: "", enabled: true,
};

export function Locale({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<LocaleProfileRow[] | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<LocaleDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<{ profile: LocaleProfile; agents: number } | null>(null);
  const toast = useToast();

  async function refreshAll(prefer?: string) {
    try {
      const [p, a] = await Promise.all([api.listLocaleProfiles(tenant), api.listAgents(tenant)]);
      setRows(p); setAgents(a);
      const want = prefer ?? sel;
      setSel(want && p.some((x) => x.id === want) ? want : p[0]?.id ?? null);
    } catch (e: any) {
      toast.push(e.message, "error"); setRows([]);
    }
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
    return { profiles: list.length, attached: attached.size, languages: languages.size };
  }, [rows]);

  return (
    <div>
      <PageHeader
        icon={Languages}
        title="Locale"
        description="Profiles of language, terminology, phrasing and presentation rules. Attaching one injects it into an agent and creates a Locale Specialist delegate; corrections teach it from reviewed answers."
        actions={<Button onClick={() => setCreating(true)}><Plus /> New profile</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard icon={Globe2} label="Profiles" value={stats.profiles} tone="sky" />
        <StatCard icon={Bot} label="Agents localised" value={stats.attached} tone="emerald" hint="Agents with a profile attached" />
        <StatCard icon={MessageSquareQuote} label="Primary languages" value={stats.languages} tone="violet" />
      </div>

      {rows === null ? (
        <LoadingBlock rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Languages}
          title="No locale profiles yet"
          body="Create a profile for any language, locale or house style — the fields are pure data, nothing is hard-coded to English or Kiswahili."
          action={<Button onClick={() => setCreating(true)}><Plus /> New profile</Button>}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between space-y-0 p-3 pb-2">
              <CardTitle className="text-sm">Profiles</CardTitle>
              <Badge variant="secondary">{rows.length}</Badge>
            </CardHeader>
            <div>
              {rows.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSel(p.id)}
                  className={cn(
                    "flex w-full items-start gap-2 border-t px-3 py-2.5 text-left transition-colors first:border-t",
                    sel === p.id ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/60",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", p.enabled ? "bg-emerald-500" : "bg-slate-400")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", sel === p.id ? "font-medium text-foreground" : "")}>{p.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                      {p.locale_code && <span className="font-mono">{p.locale_code}</span>}
                      {p.default_language && <span>· {p.default_language}</span>}
                      {p.attached_agents > 0 && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 text-emerald-700 dark:text-emerald-400">
                          {p.attached_agents} agent{p.attached_agents === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Card>

          {detail ? (
            <ProfileDetail
              detail={detail}
              agents={agents}
              onEdit={() => setEditing(true)}
              onDelete={() => setDeleting({ profile: detail.profile, agents: detail.agents.length })}
              onChanged={changed}
            />
          ) : (
            <EmptyState title="Select a profile" body="Pick a profile on the left to edit it, add corrections or preview the compiled rules." />
          )}
        </div>
      )}

      {creating && (
        <ProfileForm
          tenant={tenant}
          onClose={() => setCreating(false)}
          onSaved={(p) => { setCreating(false); refreshAll(p?.id); toast.push("Profile created", "success"); }}
        />
      )}
      {editing && detail && (
        <ProfileForm
          tenant={tenant}
          initial={detail.profile}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); changed(); toast.push("Profile saved", "success"); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.profile.name}?`}
          description={`${deleting.agents ? `It is attached to ${deleting.agents} agent(s), which will be detached first. ` : ""}Its corrections are removed too. This cannot be undone.`}
          confirmLabel="Delete profile"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteLocaleProfile(deleting.profile.id);
            setDeleting(null);
            setDetail(null);
            await refreshAll();
            toast.push("Profile deleted", "success");
          }}
        />
      )}
    </div>
  );
}

function ProfileDetail({
  detail, agents, onEdit, onDelete, onChanged,
}: {
  detail: LocaleDetail;
  agents: Agent[];
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const p = detail.profile;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{p.name}</CardTitle>
            {p.locale_code && <Badge variant="outline" className="font-mono">{p.locale_code}</Badge>}
            <Badge variant={p.enabled ? "secondary" : "outline"} className={p.enabled ? "text-emerald-700 dark:text-emerald-400" : ""}>
              {p.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {p.default_language || "no default language"} · {p.register_style} register · updated {fmtDate(p.updated_at)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={onEdit}><Pencil /> Edit</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete profile" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <Tabs defaultValue="profile">
          <TabsList className="h-10 rounded-xl p-1">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="corrections">Corrections {detail.examples.length ? `(${detail.examples.length})` : ""}</TabsTrigger>
            <TabsTrigger value="agents">Agents {detail.agents.length ? `(${detail.agents.length})` : ""}</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="mt-4"><ProfileSummary profile={p} /></TabsContent>
          <TabsContent value="corrections" className="mt-4">
            <CorrectionsPanel profile={p} examples={detail.examples} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="agents" className="mt-4">
            <AgentsPanel profile={p} agents={agents} attached={detail.agents} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="preview" className="mt-4"><PreviewPanel profileId={p.id} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Fact({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm", mono && "font-mono text-xs")}>{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function ProfileSummary({ profile: p }: { profile: LocaleProfile }) {
  const money = p.currency_code || p.currency_symbol
    ? `${p.currency_symbol || p.currency_code} ${p.currency_position} the amount`
    : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Default language" value={p.default_language} />
        <Fact label="Languages" value={p.languages.join(", ")} />
        <Fact label="Code-switching" value={p.code_switch_policy} />
        <Fact label="Register" value={p.register_style} />
        <Fact label="Currency" value={money} />
        <Fact label="Separators" value={`${p.thousand_sep} / ${p.decimal_sep}`} mono />
        <Fact label="Date format" value={p.date_format} mono />
        <Fact label="Sample cases" value={p.sample_cases.length ? `${p.sample_cases.length} (eval seeding)` : "—"} />
      </div>

      {p.glossary.length > 0 && (
        <div className="rounded-xl border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Terminology ({p.glossary.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {p.glossary.map((g, i) => (
              <Badge key={i} variant="outline" className="font-normal">
                {g.source} {g.keep ? "· keep" : g.target ? `→ ${g.target}` : ""}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Output replacements ({p.replacements.length})
          </div>
          {p.replacements.length === 0 ? (
            <div className="text-xs text-muted-foreground">None — the model writes the answer itself.</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {p.replacements.map((r, i) => (
                <li key={i} className="truncate"><span className="font-mono">{r.from}</span> <span className="text-muted-foreground">→</span> {r.to}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tone rules</div>
          <div className="space-y-1 text-xs">
            <div><span className="text-muted-foreground">Always include:</span> {p.required_phrases.join("; ") || "—"}</div>
            <div><span className="text-muted-foreground">Never use:</span> {p.banned_phrases.join("; ") || "—"}</div>
            <div><span className="text-muted-foreground">Notes:</span> {p.notes || "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Corrections ─────────────────────────────────────────────────────

function CorrectionsPanel({
  profile, examples, onChanged,
}: {
  profile: LocaleProfile;
  examples: LocaleExample[];
  onChanged: () => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LocaleExample | null>(null);
  const [deleting, setDeleting] = useState<LocaleExample | null>(null);
  const toast = useToast();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs text-muted-foreground">
          Each correction adds a reviewed question/answer pair to the specialist's few-shot block and the
          supervisor's rules. Only enabled rows are compiled.
        </p>
        <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add correction</Button>
      </div>

      {examples.length === 0 ? (
        <EmptyState
          icon={MessageSquareQuote}
          title="No corrections yet"
          body="Record what the agent said and what it should have said — the reviewed answer becomes the pattern it follows."
          action={<Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus /> Add correction</Button>}
        />
      ) : (
        <div className="divide-y rounded-xl border">
          {examples.map((e) => (
            <div key={e.id} className={cn("flex items-start gap-3 p-3", !e.enabled && "opacity-60")}>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-xs text-muted-foreground">Q</div>
                <div className="text-sm">{e.input}</div>
                {e.bad_output && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                    <span className="line-through">{e.bad_output}</span>
                  </div>
                )}
                <div className="flex items-start gap-1.5 text-sm">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{e.corrected_output}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{e.source}</Badge>
                  {!e.enabled && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">disabled</Badge>}
                  {e.note && <span>{e.note}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
                  onClick={async () => {
                    try {
                      await api.patchLocaleExample(e.id, { enabled: !e.enabled });
                      await onChanged();
                      toast.push(e.enabled ? "Correction disabled" : "Correction enabled", "success");
                    } catch (err: any) { toast.push(err.message, "error"); }
                  }}
                >
                  {e.enabled ? "Disable" : "Enable"}
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setEditing(e)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="Delete" onClick={() => setDeleting(e)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <ExampleForm
          profileId={profile.id}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); onChanged(); toast.push("Correction added", "success"); }}
        />
      )}
      {editing && (
        <ExampleForm
          profileId={profile.id}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); toast.push("Correction saved", "success"); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this correction?"
          description="The reviewed answer stops being compiled into the specialist's rules."
          confirmLabel="Delete" destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteLocaleExample(deleting.id);
            setDeleting(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function ExampleForm({
  profileId, initial, onClose, onSaved,
}: {
  profileId: string;
  initial?: LocaleExample;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [input, setInput] = useState(initial?.input ?? "");
  const [bad, setBad] = useState(initial?.bad_output ?? "");
  const [good, setGood] = useState(initial?.corrected_output ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const toast = useToast();

  async function save() {
    try {
      if (initial) {
        await api.patchLocaleExample(initial.id, {
          input, bad_output: bad || null, corrected_output: good, note, enabled,
        });
      } else {
        await api.createLocaleExample(profileId, {
          input, corrected_output: good, bad_output: bad || null, note, source: "manual",
        });
      }
      onSaved();
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit correction" : "Add correction"}</DialogTitle>
          <DialogDescription>
            The reviewed answer becomes a few-shot example: wording, terminology and tone are copied from it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Customer message</Label>
            <Textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder="What did the user ask?" />
          </div>
          <div className="space-y-1.5">
            <Label>Wrong answer (optional)</Label>
            <Textarea rows={2} value={bad} onChange={(e) => setBad(e.target.value)} placeholder="What the agent said that you are correcting" />
          </div>
          <div className="space-y-1.5">
            <Label>Reviewed answer</Label>
            <Textarea rows={3} value={good} onChange={(e) => setGood(e.target.value)} placeholder="The answer the agent should give" />
          </div>
          <div className="space-y-1.5">
            <Label>Reviewer note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this wording — shown to the model" />
          </div>
          {initial && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled (compiled into the rules)
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

// ── Agents ──────────────────────────────────────────────────────────

function AgentsPanel({
  profile, agents, attached, onChanged,
}: {
  profile: LocaleProfile;
  agents: Agent[];
  attached: Array<{ id: string; name: string; model: string }>;
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const attachedIds = useMemo(() => new Set(attached.map((a) => a.id)), [attached]);

  async function toggle(agent: Agent, isAttached: boolean) {
    setBusy(agent.id);
    try {
      if (isAttached) {
        await api.detachLocale(profile.id, agent.id);
        toast.push(`Detached from ${agent.name}`, "success");
      } else {
        const r = await api.attachLocale(profile.id, agent.id);
        toast.push(`Attached — generated specialist ${r.subagent_id.slice(0, 8)}…`, "success");
      }
      await onChanged();
    } catch (e: any) { toast.push(e.message, "error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-xs text-muted-foreground">
        Attaching compiles this profile into a generated <span className="font-medium">Locale Specialist</span> delegate and
        appends the rules to the supervisor and every specialist on the agent. Detaching removes both. Re-attach after
        changing the profile or its corrections to refresh the generated specialist.
      </p>
      {agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents in this tenant" body="Create an agent first, then attach a locale profile to it." />
      ) : (
        <div className="divide-y rounded-xl border">
          {agents.map((a) => {
            const isAttached = attachedIds.has(a.id);
            return (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{a.model}</div>
                </div>
                <div className="flex items-center gap-2">
                  {isAttached && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> attached
                    </span>
                  )}
                  <AsyncButton
                    size="sm"
                    variant={isAttached ? "outline" : "default"}
                    disabled={busy === a.id}
                    onRun={() => toggle(a, isAttached)}
                  >
                    {isAttached ? <><Unlink /> Detach</> : <><Link2 /> Attach</>}
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

// ── Preview ─────────────────────────────────────────────────────────

function PreviewPanel({ profileId }: { profileId: string }) {
  const [preview, setPreview] = useState<LocalePreview | null>(null);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function load() {
    setBusy(true); setErr(null);
    try {
      setPreview(await api.previewLocale(profileId, {
        text: text.trim() || undefined,
        language: language.trim() || undefined,
      }));
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { setPreview(null); setText(""); setLanguage(""); load(); }, [profileId]);

  async function copy() {
    if (!preview) return;
    try { await navigator.clipboard.writeText(preview.rules); toast.push("Rules copied", "success"); }
    catch { toast.push("Clipboard unavailable", "error"); }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label>Sample text to normalise (optional)</Label>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Your balance is TZS 250000.00 on 2026-11-14"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label>This turn's language</Label>
          <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="optional" className="text-xs" />
        </div>
        <Button variant="outline" onClick={load} disabled={busy}>
          <Sparkles /> {busy ? "Compiling…" : "Refresh"}
        </Button>
      </div>

      {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{err}</div>}

      {preview && (
        <>
          <div className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generated specialist</div>
              <Badge variant="outline">{preview.specialist.name}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{preview.specialist.description}</p>
          </div>

          {preview.formatted && (
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {text.trim() ? "Normalised output" : "Sample rewrite"}
              </div>
              <div className="whitespace-pre-wrap text-sm">{preview.formatted}</div>
            </div>
          )}

          <div className="rounded-xl border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compiled rules</div>
              <Button size="sm" variant="ghost" onClick={copy}><Copy /> Copy</Button>
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-[11px] leading-relaxed">{preview.rules}</pre>
          </div>
        </>
      )}
    </div>
  );
}

// ── Profile form ────────────────────────────────────────────────────

function ProfileForm({
  tenant, initial, onClose, onSaved,
}: {
  tenant: string;
  initial?: LocaleProfile;
  onClose: () => void;
  onSaved: (p?: { id: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? BLANK.name);
  const [code, setCode] = useState(initial?.locale_code ?? "");
  const [languages, setLanguages] = useState(joinList(initial?.languages));
  const [defaultLang, setDefaultLang] = useState(initial?.default_language ?? "");
  const [register, setRegister] = useState<LocaleProfileInput["register_style"]>(initial?.register_style ?? "formal");
  const [policy, setPolicy] = useState<LocaleProfileInput["code_switch_policy"]>(initial?.code_switch_policy ?? "allowed");
  const [currencyCode, setCurrencyCode] = useState(initial?.currency_code ?? "");
  const [currencySymbol, setCurrencySymbol] = useState(initial?.currency_symbol ?? "");
  const [position, setPosition] = useState<LocaleProfileInput["currency_position"]>(initial?.currency_position ?? "before");
  const [decimals, setDecimals] = useState(initial?.decimal_sep ?? ".");
  const [thousands, setThousands] = useState(initial?.thousand_sep ?? ",");
  const [dateFormat, setDateFormat] = useState(initial?.date_format ?? "");
  const [glossary, setGlossary] = useState(JSON.stringify(initial?.glossary ?? [], null, 2));
  const [replacements, setReplacements] = useState(JSON.stringify(initial?.replacements ?? [], null, 2));
  const [cases, setCases] = useState(JSON.stringify(initial?.sample_cases ?? [], null, 2));
  const [required, setRequired] = useState(joinList(initial?.required_phrases));
  const [banned, setBanned] = useState(joinList(initial?.banned_phrases));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const toast = useToast();

  function parseJson<T>(raw: string, label: string): T {
    try { return JSON.parse(raw.trim() || "[]"); }
    catch { throw new Error(`${label} is not valid JSON`); }
  }

  async function save() {
    try {
      const body: LocaleProfileInput = {
        name: name.trim(), locale_code: code.trim(), languages: splitList(languages),
        default_language: defaultLang.trim(), register_style: register, code_switch_policy: policy,
        currency_code: currencyCode.trim(), currency_symbol: currencySymbol.trim(), currency_position: position,
        decimal_sep: decimals || ".", thousand_sep: thousands, date_format: dateFormat.trim(),
        glossary: parseJson(glossary, "Terminology"),
        replacements: parseJson(replacements, "Replacements"),
        sample_cases: parseJson(cases, "Sample cases"),
        required_phrases: splitList(required), banned_phrases: splitList(banned),
        notes, enabled,
      };
      if (initial) {
        await api.patchLocaleProfile(initial.id, body);
        onSaved();
      } else {
        const p = await api.createLocaleProfile({ ...body, tenant_id: tenant });
        onSaved(p);
      }
    } catch (e: any) { toast.push(e.message, "error"); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "New locale profile"}</DialogTitle>
          <DialogDescription>
            Everything here is data: languages, terminology, phrasing, currency and date presentation. Nothing is
            specific to one language pair.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kiswahili (Tanzania)" />
            </div>
            <div className="space-y-1.5">
              <Label>Locale code</Label>
              <Input className="font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="sw-TZ" />
            </div>
            <div className="space-y-1.5">
              <Label>Languages (comma-separated)</Label>
              <Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="Kiswahili, English" />
            </div>
            <div className="space-y-1.5">
              <Label>Default language</Label>
              <Input value={defaultLang} onChange={(e) => setDefaultLang(e.target.value)} placeholder="Kiswahili" />
            </div>
            <div className="space-y-1.5">
              <Label>Register</Label>
              <select value={register} onChange={(e) => setRegister(e.target.value as LocaleProfileInput["register_style"])}
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                <option value="formal">formal</option>
                <option value="neutral">neutral</option>
                <option value="casual">casual</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Code-switching</Label>
              <select value={policy} onChange={(e) => setPolicy(e.target.value as LocaleProfileInput["code_switch_policy"])}
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                <option value="off">off — one language only</option>
                <option value="allowed">allowed — mirror the user</option>
                <option value="encouraged">encouraged — natural mixing</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Currency code</Label>
              <Input className="font-mono" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} placeholder="TZS" />
            </div>
            <div className="space-y-1.5">
              <Label>Currency symbol</Label>
              <Input className="font-mono" value={currencySymbol} onChange={(e) => setCurrencySymbol(e.target.value)} placeholder="TZS" />
            </div>
            <div className="space-y-1.5">
              <Label>Symbol position</Label>
              <select value={position} onChange={(e) => setPosition(e.target.value as LocaleProfileInput["currency_position"])}
                className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                <option value="before">before the amount</option>
                <option value="after">after the amount</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Thousands separator</Label>
              <Input className="font-mono" value={thousands} onChange={(e) => setThousands(e.target.value)} placeholder="," />
            </div>
            <div className="space-y-1.5">
              <Label>Decimal separator</Label>
              <Input className="font-mono" value={decimals} onChange={(e) => setDecimals(e.target.value)} placeholder="." />
            </div>
            <div className="space-y-1.5">
              <Label>Date format</Label>
              <Input className="font-mono" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} placeholder="DD/MM/YYYY" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Terminology (JSON)</Label>
              <Textarea rows={5} className="font-mono text-xs" value={glossary} onChange={(e) => setGlossary(e.target.value)}
                placeholder={'[{"source": "Loan", "target": "Mkopo"}]'} />
              <div className="text-[11px] text-muted-foreground">Use <span className="font-mono">{'"keep": true'}</span> for names and brands that stay untranslated.</div>
            </div>
            <div className="space-y-1.5">
              <Label>Output replacements (JSON)</Label>
              <Textarea rows={5} className="font-mono text-xs" value={replacements} onChange={(e) => setReplacements(e.target.value)}
                placeholder={'[{"from": "Hello", "to": "Karibu"}]'} />
              <div className="text-[11px] text-muted-foreground">Exact-text substitutions applied to every reply after policy screening.</div>
            </div>
            <div className="space-y-1.5">
              <Label>Sample cases (JSON — seeds an eval dataset)</Label>
              <Textarea rows={5} className="font-mono text-xs" value={cases} onChange={(e) => setCases(e.target.value)}
                placeholder={'[{"input": "hello", "expected_contains": "Karibu"}]'} />
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Always include (comma-separated)</Label>
                <Input value={required} onChange={(e) => setRequired(e.target.value)} placeholder="Welcome" />
              </div>
              <div className="space-y-1.5">
                <Label>Never use (comma-separated)</Label>
                <Input value={banned} onChange={(e) => setBanned(e.target.value)} placeholder="Hi there" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reviewer notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="House style, audience, anything the model should know." />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled (attachable and active on every attached agent)
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <AsyncButton onRun={save} disabled={!name.trim()}>{initial ? "Save changes" : "Create profile"}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
