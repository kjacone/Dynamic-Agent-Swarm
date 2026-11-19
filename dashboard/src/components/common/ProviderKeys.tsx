import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Eye, EyeOff, KeyRound, ShieldCheck, Trash2 } from "lucide-react";

import { api, type ProviderKey } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AsyncButton } from "@/components/common/AsyncButton";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadingBlock } from "@/components/common/AsyncState";
import { useToast } from "@/components/ui/toast";
import { cn, fmtDate } from "@/lib/utils";

function SourceChip({ source }: { source: ProviderKey["source"] }) {
  return (
    <span className={cn(
      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
      source === "dashboard" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      source === "environment" && "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      !source && "bg-muted text-muted-foreground",
    )}>
      {source === "dashboard" ? "Saved here" : source === "environment" ? "From server env" : "Not set"}
    </span>
  );
}

/** Bring-your-own-key card shared by Models and Training. */
export function ProviderKeys({ page, title = "Bring your own keys", onSaved }: {
  page: "models" | "training" | "knowledge" | "locale" | "voice";
  title?: string;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<{ keys: ProviderKey[]; encrypted: boolean } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProviderKey | null>(null);

  async function refresh() {
    setData(await api.providerKeys());
  }

  useEffect(() => {
    refresh().catch((e: any) => toast.push(e.message, "error"));
  }, [page]);

  const keys = useMemo(
    () => (data?.keys ?? []).filter((k) => k.pages.includes(page)),
    [data, page],
  );

  async function save(k: ProviderKey) {
    const value = (drafts[k.env] ?? "").trim();
    if (!value) return;
    setBusy(k.env);
    try {
      const res = await api.saveProviderKey(k.env, value);
      setData((d) => d && { ...d, keys: d.keys.map((x) => (x.env === k.env ? res.key : x)) });
      setDrafts((d) => ({ ...d, [k.env]: "" }));
      setRevealed((r) => ({ ...r, [k.env]: false }));
      toast.push(`${k.label} key saved`, "success");
      onSaved?.();
    } catch (e: any) {
      toast.push(e.message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function clear(k: ProviderKey) {
    try {
      const res = await api.clearProviderKey(k.env);
      setData((d) => d && { ...d, keys: d.keys.map((x) => (x.env === k.env ? res.key : x)) });
      toast.push(`${k.label} key removed`, "success");
      onSaved?.();
    } catch (e: any) {
      toast.push(e.message, "error");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <KeyRound className="h-3.5 w-3.5" />
          </span>
          {title}
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Use your own provider accounts instead of the server's. A key saved here wins over the environment,
          applies immediately, and is never shown again — only the last four characters.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data === null && <LoadingBlock rows={3} />}
        {keys.map((k) => {
          const draft = drafts[k.env] ?? "";
          const show = !!revealed[k.env];
          return (
            <div key={k.env} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium">{k.label}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{k.env}</code>
                    <SourceChip source={k.source} />
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{k.what}</p>
                </div>
                <div className="flex items-center gap-2">
                  {k.masked && (
                    <span className="font-mono text-[11px] text-muted-foreground">{k.masked}</span>
                  )}
                  {k.docs && (
                    <a href={k.docs} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                      Get a key <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Input
                    type={show ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-8 font-mono text-xs"
                    aria-label={`${k.label} key`}
                    placeholder={k.source === "dashboard" ? "Paste a new value to replace it" : k.source === "environment" ? "Paste a value to override the server key" : `Paste ${k.secret ? "your key" : "the value"}`}
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [k.env]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") save(k); }}
                  />
                  <button
                    type="button"
                    aria-label={show ? "Hide" : "Show"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setRevealed((r) => ({ ...r, [k.env]: !show }))}
                  >
                    {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <AsyncButton onRun={() => save(k)} disabled={!draft.trim() || busy === k.env}>Save</AsyncButton>
                {k.source === "dashboard" && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive"
                    title="Remove saved key" onClick={() => setRemoving(k)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {k.source === "dashboard" && k.updated_at && (
                <div className="mt-1 text-[10px] text-muted-foreground">Saved {fmtDate(k.updated_at)}</div>
              )}
            </div>
          );
        })}
        <div className="flex items-start gap-1.5 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {data?.encrypted
            ? "Keys are encrypted at rest with the server's field key."
            : "No server encryption key is configured — values are stored in a 0600 file on the server. Set NMB_ENCRYPTION_KEY to encrypt them at rest."}
        </div>
      </CardContent>

      {removing && (
        <ConfirmDialog
          title={`Remove the ${removing.label} key?`}
          description="Requests fall back to the server environment, or fail if nothing else is configured."
          confirmLabel="Remove key" destructive
          onClose={() => setRemoving(null)}
          onConfirm={() => clear(removing)}
        />
      )}
    </Card>
  );
}
