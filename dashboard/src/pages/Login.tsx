import { useState } from "react";
import { Eye, EyeOff, Landmark, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, setToken } from "@/lib/api";

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [token, setTok] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);

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

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,hsl(var(--primary)/0.12),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_30rem_at_100%_100%,hsl(var(--primary)/0.06),transparent)]" />

      <form onSubmit={submit} className="relative w-full max-w-sm rounded-2xl border border-border/80 bg-card p-6 shadow-xl sm:p-7">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/15 to-primary/[0.02] text-primary shadow-sm">
            <Landmark className="h-5 w-5" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">NMB Marketplace Admin</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Paste the <code className="rounded bg-muted px-1 py-0.5">ADMIN_TOKEN</code> set on the server, or your SSO / tenant access token.
            Approvers must use a named account.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="token">Admin or access token</Label>
          <div className="relative">
            <Input
              id="token"
              type={show ? "text" : "password"}
              value={token}
              onChange={(e) => setTok(e.target.value)}
              autoFocus
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
        </div>

        {err && (
          <div className="mt-3 rounded-lg border border-red-500/35 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-400">
            {err}
          </div>
        )}

        <Button className="mt-4 w-full" disabled={!token || busy}>
          {busy ? "Verifying…" : "Sign in"}
        </Button>

        <div className="mt-5 flex items-center justify-center gap-1.5 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Every sign-in and action is written to the audit trail.
        </div>
      </form>
    </div>
  );
}
