import { NAV, type TabId } from "./nav";
import { can, type Me } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Which tabs a signed-in principal may see. The server enforces the same rules; this only hides dead ends. */
export function visibleTabs(me: Me | null): TabId[] {
  const admin = !me || can(me, "agents:write") || me.permissions.includes("*");
  return NAV.filter((n) => (n.section === "platform" ? admin : can(me, n.perm))).map((n) => n.id);
}

export function Sidebar({ active, onSelect, me, badges = {} }: {
  active: TabId; onSelect: (id: TabId) => void; me: Me | null; badges?: Partial<Record<TabId, number>>;
}) {
  const show = new Set(visibleTabs(me));
  const sections: Array<["platform" | "enterprise" | "products", string]> = [["products", "Products"],["enterprise", "Operate & govern"], ["platform", "Build"]];
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
      <div className="border-b p-4">
        <div className="text-sm font-semibold">NMB Marketplace</div>
        <div className="text-xs text-muted-foreground">Admin Console</div>
      </div>
      <nav className="flex-1 space-y-3 overflow-auto p-2">
        {sections.map(([sec, title]) => {
          const items = NAV.filter((n) => n.section === sec && show.has(n.id));
          if (!items.length) return null;
          return (
            <div key={sec} className="space-y-1">
              <div className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
              {items.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => onSelect(id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active === id ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{label}</span>
                  {!!badges[id] && (
                    <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">{badges[id]}</span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
