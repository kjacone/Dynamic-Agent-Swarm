import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import type { TabId } from "@/components/layout/nav";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";
import { Agents } from "@/pages/Agents";
import { Subagents } from "@/pages/Subagents";
import { Prompts } from "@/pages/Prompts";
import { Tools } from "@/pages/Tools";
import { Knowledge } from "@/pages/Knowledge";
import { Models } from "@/pages/Models";
import { Training } from "@/pages/Training";
import { Evaluations } from "@/pages/Evaluations";
import { Observability } from "@/pages/Observability";
import { Settings } from "@/pages/Settings";
import { getToken, api } from "@/lib/api";

const TENANT_KEY = "nmb_tenant";

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  const [tab, setTab] = useState<TabId>("overview");
  const [tenant, setTenant] = useState<string>(() => sessionStorage.getItem(TENANT_KEY) || "default");

  useEffect(() => { sessionStorage.setItem(TENANT_KEY, tenant); }, [tenant]);
  useEffect(() => { if (authed) api.authCheck().catch(() => setAuthed(false)); }, [authed]);

  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

  return (
    <div className="flex h-full">
      <Sidebar active={tab} onSelect={setTab} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar tenant={tenant} onTenant={setTenant} onLogout={() => setAuthed(false)} />
        <main className="flex-1 overflow-auto p-6">
          {tab === "overview" && <Overview tenant={tenant} />}
          {tab === "agents" && <Agents tenant={tenant} />}
          {tab === "subagents" && <Subagents tenant={tenant} />}
          {tab === "prompts" && <Prompts />}
          {tab === "tools" && <Tools tenant={tenant} />}
          {tab === "knowledge" && <Knowledge tenant={tenant} />}
          {tab === "models" && <Models tenant={tenant} />}
          {tab === "training" && <Training />}
          {tab === "evals" && <Evaluations tenant={tenant} />}
          {tab === "observability" && <Observability />}
          {tab === "settings" && <Settings tenant={tenant} />}
        </main>
      </div>
    </div>
  );
}