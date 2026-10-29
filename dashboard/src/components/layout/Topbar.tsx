import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearToken } from "@/lib/api";
import { ThemeToggle } from "./ThemeToggle";

export function Topbar({ tenant, onTenant, onLogout }: { tenant: string; onTenant: (t: string) => void; onLogout: () => void }) {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Tenant</span>
        <input
          value={tenant}
          onChange={(e) => onTenant(e.target.value)}
          className="w-40 rounded-md border bg-background px-2 py-1 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />          {/* ← add this */}
        {/* existing: notifications, user menu, etc. */}
      </div>

      <Button
        variant="ghost"
        size="sm"
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