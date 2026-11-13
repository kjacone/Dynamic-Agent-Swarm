import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearToken } from "@/lib/api";
import { ThemeToggle } from "./ThemeToggle";

export function Topbar({ tenant, onTenant, onLogout, lockedTenant = false, user }: { tenant: string; onTenant: (t: string) => void; onLogout: () => void; lockedTenant?: boolean; user?: string }) {
  return (
    <header className="flex h-14 items-center gap-3 border-b px-6">
      <div className="flex shrink-0 items-center gap-3 text-sm">
        <span className="text-muted-foreground">Tenant</span>
        <input
          value={tenant}
          onChange={(e) => onTenant(e.target.value)}
          disabled={lockedTenant}
          title={lockedTenant ? "Your account is bound to this tenant" : undefined}
          className="w-40 rounded-md border bg-background px-2 py-1 text-sm"
        />
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {user && <span className="truncate text-xs text-muted-foreground">{user}</span>}
        <ThemeToggle />
        {/* existing: notifications, user menu, etc. */}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={() => {
          clearToken();
          onLogout();
        }}
      >
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
      
    </header>
  );
}