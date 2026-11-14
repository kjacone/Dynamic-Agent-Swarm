import { useEffect, useState } from "react";
import { ArrowRight, Building2, ClipboardCheck, Eye, EyeOff, Landmark, ScrollText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, setToken, type DemoAccount, type DemoAccounts } from "@/lib/api";

const PERSONA_ICONS: Record<string, typeof ShieldCheck> = {
  admin: ShieldCheck,
  "tenant-admin": Building2,
  approver: ClipboardCheck,
  auditor: ScrollText,
};

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [token, setTok] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [demo, setDemo] = useState<DemoAccounts | null>(null);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

  useEffect(() => {
    api.demoAccounts().then(setDemo).catch(() => setDemo(null));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setToken(token);
    try {
      await api.authCheck();
      onAuthed();
    } catch (e: any) {
      setErr(e.message || "Authentication failed");
      setToken("");
    } finally {
      setBusy(false);
    }
  }

  async function demoSignIn(account: DemoAccount) {
    setDemoBusy(account.id);
    setErr(null);
    try {
      const res = await api.demoLogin(account.id);
      sessionStorage.setItem("nmb_tenant", res.tenant);
      setToken(res.token);
      onAuthed();
    } catch (e: any) {
      setErr(e.message || "Demo sign-in failed");
      setDemoBusy(null);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,hsl(var(--primary)/0.12),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_30rem_at_100%_100%,hsl(var(--primary)/0.06),transparent)]" />

      <div className="relative w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 shadow-xl sm:p-7">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/15 to-primary/[0.02] text-primary shadow-sm">
            <Landmark className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">NMB Marketplace Admin</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Pick a demo account to walk through the console, or sign in with your own token.
          </p>
        </div>

        {demo?.enabled && demo.accounts.length > 0 && (
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <Label>Demo accounts</Label>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">one click</span>
            </div>
            {demo.ready === false ? (
              <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
                Set <code className="rounded bg-background px-1 py-0.5">NMB_JWT_SECRET</code> on the server to
                enable demo sign-in.
              </p>
            ) : (
              <div className="space-y-1.5">
                {demo.accounts.map((a) => {
                  const Icon = PERSONA_ICONS[a.id] ?? ShieldCheck;
                  const active = demoBusy === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={!!demoBusy}
                      onClick={() => demoSignIn(a)}
                      className="group flex w-full items-center gap-3 rounded-xl border border-border/80 p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.04] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{a.name} <span className="text-[11px] font-normal text-muted-foreground">· {a.title}</span></span>
                        <span className="block truncate text-[11px] text-muted-foreground">{a.description}</span>
                      </span>
                      {active
                        ? <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        : <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or use a token <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        <form onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="token">Admin or access token</Label>
            <div className="relative">
              <Input
                id="token"
                type={show ? "text" : "password"}
                value={token}
                onChange={(e) => setTok(e.target.value)}
                autoFocus={!demo?.enabled}
                autoComplete="off"
                placeholder="Bearer token"
                className="pr-10"
              />
              <button
                type="button"
                aria-label={show ? "Hide token" : "Show token"}
                onClick={() => setShow((v) => !v)}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Paste the <code className="rounded bg-muted px-1 py-0.5">ADMIN_TOKEN</code> set on the server,
              your SSO token or a tenant access token. Approvers must use a named account.
            </p>
          </div>

          {err && (
            <div className="mt-3 rounded-lg border border-red-500/35 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-400">
              {err}
            </div>
          )}

          <Button className="mt-4 w-full" disabled={!token || busy}>
            {busy ? "Verifying…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-1.5 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Every sign-in and action is written to the audit trail.
        </div>
      </div>
    </div>
  );
}
