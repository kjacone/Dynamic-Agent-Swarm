import { useEffect, useState } from "react";
import { Sidebar, visibleTabs } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import type { TabId } from "@/components/layout/nav";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";
import { Agents } from "@/pages/Agents";
import { LiveDemo, type DemoRequest } from "@/pages/LiveDemo";
import { Subagents } from "@/pages/Subagents";
import { Prompts } from "@/pages/Prompts";
import { Tools } from "@/pages/Tools";
import { Knowledge } from "@/pages/Knowledge";
import { Models } from "@/pages/Models";
import { Locale } from "@/pages/Locale";
import { Training } from "@/pages/Training";
import { Evaluations } from "@/pages/Evaluations";
import { Observability } from "@/pages/Observability";
import { Settings } from "@/pages/Settings";
import { Approvals } from "@/pages/Approvals";
import { Handoffs } from "@/pages/Handoffs";
import { WhatsApp } from "@/pages/WhatsApp";
import { Voice } from "@/pages/Voice";
import { Workflows } from "@/pages/Workflows";
import { Solutions } from "@/pages/Solutions";
import { Audit } from "@/pages/Audit";
import { Privacy } from "@/pages/Privacy";
import { Governance } from "@/pages/Governance";
import { Guardrails } from "@/pages/Guardrails";
import { Licence } from "@/pages/Licence";
import { getToken, api, can, clearToken, type Me } from "@/lib/api";
import { Connectors } from "@/pages/Connectors";
const TENANT_KEY = "nmb_tenant";

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  const [tab, setTab] = useState<TabId>("overview");
  const [demoRequest, setDemoRequest] = useState<DemoRequest | null>(null);
  const [tenant, setTenant] = useState<string>(() => sessionStorage.getItem(TENANT_KEY) || "default");

  const [me, setMe] = useState<Me | null>(null);
  const [pending, setPending] = useState(0);
  const [waiting, setWaiting] = useState(0);

  useEffect(() => { sessionStorage.setItem(TENANT_KEY, tenant); }, [tenant]);
  useEffect(() => { if (authed) api.authCheck().catch(() => setAuthed(false)); }, [authed]);
  // Who is signed in? Named (JWT/SSO) users are pinned to their token's tenant and see only what their roles allow.
  useEffect(() => {
    if (!authed) { setMe(null); return; }
    api.me().then((m) => {
      setMe(m);
      if (m.auth !== "admin_token") setTenant(m.tenant_id);
    }).catch(() => setMe(null));
  }, [authed]);
  useEffect(() => {
    const v = visibleTabs(me);
    if (me && !v.includes(tab)) setTab(v[0] ?? "overview");
  }, [me]);

  const refreshPending = () => {
    if (!authed || !can(me, "approvals:read")) return;
    api.listApprovals("pending").then((a) => setPending(a.length)).catch(() => {});
  };
  useEffect(() => { refreshPending(); const id = setInterval(refreshPending, 30000); return () => clearInterval(id); }, [authed, me, tenant]);
  useEffect(() => {
    if (!authed || !can(me, "handoffs:read")) return;
    const load = () => api.listHandoffs("requested").then((h) => setWaiting(h.length)).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [authed, me, tenant]);

  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

  return (
    <div className="flex h-full">
      <Sidebar active={tab} onSelect={setTab} me={me} badges={{ approvals: pending, handoffs: waiting }} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar tenant={tenant} onTenant={setTenant} onLogout={() => { clearToken(); setAuthed(false); }} lockedTenant={!!me && me.auth !== "admin_token"} user={me ? `${me.sub} · ${me.roles.join(", ") || "no roles"}` : undefined} />
        <main className="flex-1 overflow-auto p-6">
          {tab === "overview" && <Overview tenant={tenant} onManageLicence={() => setTab("licence")} />}
          {tab === "agents" && (
            <Agents
              tenant={tenant}
              onTest={(agent) => {
                setDemoRequest({ agentId: agent.id, channel: "chat", nonce: Date.now() });
                setTab("demo");
              }}
            />
          )}
          {tab === "demo" && (
            <LiveDemo
              key={`${tenant}:${demoRequest?.nonce ?? 0}`}
              tenant={tenant}
              request={demoRequest}
              onOpenSolutions={() => setTab("solutions")}
              onOpenApprovals={() => setTab("approvals")}
              onOpenWorkflows={() => setTab("workflows")}
              onOpenWhatsApp={() => setTab("whatsapp")}
              onOpenLocale={() => setTab("locale")}
            />
          )}
          {tab === "subagents" && <Subagents tenant={tenant} />}
          {tab === "connectors" && <Connectors key={tenant} me={me} />}
          {tab === "prompts" && <Prompts />}
          {tab === "tools" && <Tools tenant={tenant} />}
          {tab === "knowledge" && <Knowledge tenant={tenant} />}
          {tab === "models" && <Models tenant={tenant} />}
          {tab === "locale" && <Locale tenant={tenant} />}
          {tab === "training" && <Training />}
          {tab === "evals" && <Evaluations tenant={tenant} />}
          {tab === "observability" && <Observability />}
          {tab === "settings" && <Settings tenant={tenant} />}
          {tab === "approvals" && <Approvals key={tenant} me={me} onChanged={refreshPending} />}
          {tab === "handoffs" && <Handoffs key={tenant} me={me} />}
          {tab === "whatsapp" && <WhatsApp key={tenant} me={me} tenant={tenant} />}
          {tab === "voice" && (
            <Voice
              key={tenant}
              me={me}
              tenant={tenant}
              onOpenGuardrails={() => setTab("guardrails")}
              onOpenSolutions={() => setTab("solutions")}
            />
          )}
          {tab === "workflows" && <Workflows key={tenant} me={me} tenant={tenant} />}
          {tab === "solutions" && <Solutions key={tenant} me={me} />}
          {tab === "audit" && <Audit key={tenant} me={me} />}
          {tab === "privacy" && <Privacy key={tenant} me={me} />}
          {tab === "governance" && <Governance key={tenant} me={me} />}
          {tab === "guardrails" && <Guardrails key={tenant} me={me} />}
          {tab === "licence" && <Licence key={tenant} me={me} />}
        </main>
      </div>
    </div>
  );
}