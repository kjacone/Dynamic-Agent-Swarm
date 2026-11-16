import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  CalendarDays,
  ClipboardCheck,
  GitBranch,
  Languages,
  LayoutDashboard,
  MessagesSquare,
  ScrollText,
  ShieldCheck,
  Store,
  WalletCards,
} from "lucide-react";
import { navigate } from "@/lib/nav";
import { CONSOLE_URL } from "@/lib/config";
import { Wordmark } from "@/components/site/Chrome";
import { AgentsSection } from "./AgentsSection";
import { ApprovalsSection } from "./ApprovalsSection";
import { AuditSection } from "./AuditSection";
import { ChannelsSection } from "./ChannelsSection";
import { GuardrailsSection } from "./GuardrailsSection";
import { LicenceSection } from "./LicenceSection";
import { LocaleSection } from "./LocaleSection";
import { MarketplaceSection } from "./MarketplaceSection";
import { OverviewSection } from "./OverviewSection";
import { WorkflowsSection } from "./WorkflowsSection";

export type DemoTab =
  | "overview"
  | "approvals"
  | "workflows"
  | "agents"
  | "channels"
  | "locale"
  | "guardrails"
  | "licence"
  | "marketplace"
  | "audit";

const TABS: { id: DemoTab; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck, badge: "3" },
  { id: "workflows", label: "Workflows", icon: GitBranch },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "channels", label: "Channels", icon: MessagesSquare },
  { id: "locale", label: "Localisation", icon: Languages },
  { id: "guardrails", label: "Guardrails", icon: ShieldCheck },
  { id: "licence", label: "Licence", icon: BadgeCheck },
  { id: "marketplace", label: "Marketplace", icon: Store },
  { id: "audit", label: "Audit trail", icon: ScrollText },
];

const TAB_IDS = new Set<string>(TABS.map((item) => item.id));

function tabFromUrl(): DemoTab {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return requested && TAB_IDS.has(requested) ? (requested as DemoTab) : "overview";
}

export function DemoConsole() {
  const [tab, setTab] = useState<DemoTab>(tabFromUrl);
  const [visited, setVisited] = useState<DemoTab[]>(["overview"]);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisited((current) => (current.includes(tab) ? current : [...current, tab]));
    const active = stripRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab]);

  function go(next: DemoTab) {
    setTab(next);
    window.history.replaceState(null, "", next === "overview" ? "/demo/" : `/demo/?tab=${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-[var(--site-bg)]">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-[var(--site-bg)]/92 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-3 sm:px-5">
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/");
            }}
            className="flex items-center gap-2.5"
            aria-label="Back to the Vela Agent Platform site"
          >
            <Wordmark compact />
          </a>
          <span className="hidden h-5 w-px bg-border sm:block" />
          <span className="hidden text-[11px] text-muted-foreground sm:block">Product tour</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-[var(--site-accent)]/30 bg-[var(--site-accent)]/8 px-2.5 py-1 text-[10px] font-medium text-[var(--site-accent)] md:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--site-accent)]" /> Free
            </span>
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                navigate("/");
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Exit demo
            </a>
            <a
              href={CONSOLE_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-[var(--site-accent)]/40 sm:inline-flex"
            >
              Real console <ArrowUpRight className="h-3 w-3" />
            </a>
            <a
              href="/book/"
              onClick={(event) => {
                event.preventDefault();
                navigate("/book/");
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--site-accent)] px-3.5 py-1.5 text-[11px] font-semibold text-[var(--site-on-accent)]"
            >
              <CalendarDays className="h-3 w-3" /> Book a paid session
            </a>
          </span>
        </div>
      </header>

      <div className="border-b border-border/60 bg-[var(--site-surface)]/60">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-5">
          <p className="text-[10.5px] text-muted-foreground">
            Acme Group workspace · Professional plan · free tier
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            tour progress {visited.length}/{TABS.length}
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1440px] gap-5 px-3 py-5 sm:px-5">
        <aside className="hidden w-[210px] shrink-0 lg:block">
          <div className="sticky top-[86px]">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
            <nav className="mt-2 space-y-0.5">
              {TABS.map(({ id, label, icon: Icon, badge }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => go(id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] transition-colors ${
                    tab === id
                      ? "bg-[var(--site-accent)]/10 font-semibold text-[var(--site-accent)]"
                      : "text-muted-foreground hover:bg-[var(--site-bg)] hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                  {label}
                  {badge ? (
                    <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 text-[9.5px] font-medium text-amber-700">{badge}</span>
                  ) : visited.includes(id) ? (
                    <span className="ml-auto h-1 w-1 rounded-full bg-[var(--site-accent)]/40" />
                  ) : null}
                </button>
              ))}
            </nav>

            <div className="mt-5 rounded-xl border border-border/80 bg-card p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tour data</p>
              <p className="mt-1.5 text-[11px] font-medium">Acme Group</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                Licence, approvals and audit events, ready to explore.
              </p>
              <button
                type="button"
                onClick={() => go("overview")}
                className="mt-2.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--site-accent)]"
              >
                Back to overview <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--site-deep)] px-3 py-2.5 text-[#dfe7dc]">
              <WalletCards className="h-4 w-4 shrink-0 text-[var(--site-gold)]" />
              <p className="text-[10px] leading-relaxed">
                Want this mapped to your business? <span className="text-[#f0e6cc]">Book a working session.</span>
              </p>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div ref={stripRef} className="mb-4 flex gap-1 overflow-x-auto rounded-full border border-border bg-card p-1 lg:hidden">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                data-active={tab === id}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] transition-colors ${
                  tab === id ? "bg-[var(--site-accent)] font-semibold text-[var(--site-on-accent)]" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-border/70 bg-[var(--site-bg)] p-4 sm:p-5">
            {tab === "overview" ? <OverviewSection onNavigate={go} /> : null}
            {tab === "approvals" ? <ApprovalsSection /> : null}
            {tab === "workflows" ? <WorkflowsSection /> : null}
            {tab === "agents" ? <AgentsSection /> : null}
            {tab === "channels" ? <ChannelsSection /> : null}
            {tab === "locale" ? <LocaleSection /> : null}
            {tab === "guardrails" ? <GuardrailsSection /> : null}
            {tab === "licence" ? <LicenceSection /> : null}
            {tab === "marketplace" ? <MarketplaceSection /> : null}
            {tab === "audit" ? <AuditSection /> : null}
          </div>

          <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-xl border border-border/80 bg-card px-4 py-3 sm:flex-row sm:items-center">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The operator experience, free to explore. A real deployment runs in your environment,
              against your identity provider and model routes.
            </p>
            <div className="flex shrink-0 gap-2">
              <a
                href="/"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/");
                }}
                className="rounded-full border border-border px-3 py-1.5 text-[11px] font-medium"
              >
                Back to site
              </a>
              <a
                href="/book/"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/book/");
                }}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--site-deep)] px-3 py-1.5 text-[11px] font-semibold text-[#efe9d8]"
              >
                Book a paid consultation <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
