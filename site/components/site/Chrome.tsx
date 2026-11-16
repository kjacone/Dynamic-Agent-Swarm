import { ArrowUpRight, Sailboat } from "lucide-react";
import type { ReactNode } from "react";
import { CONSOLE_URL } from "@/lib/config";
import { navigate } from "@/lib/nav";

export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-8 w-8 rounded-lg" : "h-9 w-9 rounded-xl";
  return (
    <span className={`relative flex ${box} items-center justify-center overflow-hidden bg-[var(--site-deep)] text-[#e9dfc2]`}>
      <span className="absolute inset-x-0 top-0 h-px bg-[var(--site-gold)]/70" />
      <Sailboat className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={1.6} />
    </span>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={compact ? "sm" : "md"} />
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold tracking-[0.02em] text-foreground">Vela Agent Platform</span>
        <span className="block whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Localised · omnichannel
        </span>
      </span>
    </span>
  );
}

export function SiteHeader({ path }: { path: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-[var(--site-bg)]/85 backdrop-blur-md">
      <div className="site-container flex h-16 items-center justify-between gap-4">
        <a
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}
          aria-label="Vela Agent Platform home"
        >
          <Wordmark />
        </a>
        <nav className="hidden items-center gap-5 whitespace-nowrap text-sm text-muted-foreground xl:flex">
          <a
            href="/#platform"
            onClick={(event) => {
              event.preventDefault();
              navigate("/");
              requestAnimationFrame(() => document.getElementById("platform")?.scrollIntoView({ behavior: "smooth" }));
            }}
            className="transition-colors hover:text-foreground"
          >
            Platform
          </a>
          <a
            href="/#localisation"
            onClick={(event) => {
              event.preventDefault();
              navigate("/");
              requestAnimationFrame(() => document.getElementById("localisation")?.scrollIntoView({ behavior: "smooth" }));
            }}
            className="transition-colors hover:text-foreground"
          >
            Localisation
          </a>
          <a
            href="/#channels"
            onClick={(event) => {
              event.preventDefault();
              navigate("/");
              requestAnimationFrame(() => document.getElementById("channels")?.scrollIntoView({ behavior: "smooth" }));
            }}
            className="transition-colors hover:text-foreground"
          >
            Channels
          </a>
          <a
            href="/customer/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/customer/");
            }}
            className={path === "/customer" ? "text-foreground" : "transition-colors hover:text-foreground"}
          >
            Customer tour
          </a>
          <a
            href="/voice/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/voice/");
            }}
            className={path === "/voice" ? "text-foreground" : "transition-colors hover:text-foreground"}
          >
            Voice line
          </a>
          <a
            href="/demo/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/demo/");
            }}
            className={path === "/demo" ? "text-foreground" : "transition-colors hover:text-foreground"}
          >
            Live demo
          </a>
          <a href={CONSOLE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
            Real console <ArrowUpRight className="h-3 w-3" />
          </a>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="/demo/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/demo/");
            }}
            className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:border-[var(--site-accent)]/40 sm:inline-flex"
          >
            View demo
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <a
            href="/book/"
            onClick={(event) => {
              event.preventDefault();
              navigate("/book/");
            }}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--site-accent)] px-3.5 py-2 text-xs font-semibold text-[var(--site-on-accent)] transition-transform hover:-translate-y-0.5 sm:px-4"
          >
            Book<span className="hidden sm:inline"> a session</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-24 border-t border-border/70">
      <div className="site-container grid gap-10 py-12 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <Wordmark compact />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            A pilot-ready agent platform for any industry: localisation packs, generative-UI wrappers, connectors to the
            systems you already run, and the same agent on web, WhatsApp, SMS and voice.
          </p>
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Start free: the product tour, customer tour and console demo need no account. Paid sessions are optional.
          </p>
        </div>
        <div className="text-sm">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Explore</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <a href="/demo/" onClick={(e) => { e.preventDefault(); navigate("/demo/"); }} className="hover:text-foreground">
                Product tour
              </a>
            </li>
            <li>
              <a href="/customer/" onClick={(e) => { e.preventDefault(); navigate("/customer/"); }} className="hover:text-foreground">
                Customer tour
              </a>
            </li>
            <li>
              <a href="/voice/" onClick={(e) => { e.preventDefault(); navigate("/voice/"); }} className="hover:text-foreground">
                MNO voice line
              </a>
            </li>
            <li>
              <a href={CONSOLE_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
                Real console
              </a>
            </li>
            <li>
              <a href="/book/" onClick={(e) => { e.preventDefault(); navigate("/book/"); }} className="hover:text-foreground">
                Book a consultation
              </a>
            </li>
            <li>
              <a href="/#platform" onClick={(e) => { e.preventDefault(); navigate("/"); }} className="hover:text-foreground">
                Platform capabilities
              </a>
            </li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Good to know</p>
          <ul className="space-y-2 text-muted-foreground">
            <li>Start free — no account needed</li>
            <li>Paid sessions are optional</li>
            <li>Deployment is customer-controlled</li>
            <li>Live in weeks, not months</li>
            <li>Any industry, any language pack</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60">
        <div className="site-container flex flex-col gap-2 py-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Vela Agent Platform.</span>
          <span>Free to explore · Paid sessions optional</span>
        </div>
      </div>
      {children}
    </footer>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "blue" | "gold" }) {
  const tones: Record<string, string> = {
    neutral: "border-border bg-[var(--site-surface)] text-muted-foreground",
    green: "border-[var(--site-accent)]/25 bg-[var(--site-accent)]/8 text-[var(--site-accent)]",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    red: "border-red-500/25 bg-red-500/8 text-red-700",
    blue: "border-sky-500/25 bg-sky-500/8 text-sky-700",
    gold: "border-[var(--site-gold)]/35 bg-[var(--site-gold)]/10 text-[#7a5b1c]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
