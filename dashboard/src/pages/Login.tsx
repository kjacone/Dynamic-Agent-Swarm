import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, setToken } from "@/lib/api";

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [token, setTok] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setToken(token);
    try {
      await api.authCheck();
      onAuthed();
    } catch (e: any) {
      setErr(e.message || "Auth failed");
      setToken("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border bg-background p-6 shadow">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">NMB Marketplace Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste the <code>ADMIN_TOKEN</code> set on the server.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="token">Admin token</Label>
          <Input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setTok(e.target.value)}
            autoFocus
            placeholder="Bearer token"
          />
        </div>
        {err && <div className="mt-3 text-sm text-destructive">{err}</div>}
        <Button className="mt-4 w-full" disabled={!token || busy}>
          {busy ? "Verifying…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}