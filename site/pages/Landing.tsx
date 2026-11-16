import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BadgeCheck,
  CalendarDays,
  Check,
  Clock,
  Code2,
  Globe2,
  GitBranch,
  Languages,
  Lock,
  MessageCircle,
  MessageSquareText,
  PhoneCall,
  PlayCircle,
  Plug,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { Pill, SiteFooter, SiteHeader } from "@/components/site/Chrome";
import { CONSOLE_URL } from "@/lib/config";
import { CHANNELS, INTEGRATIONS, LOCALES, PACKS, WRAPPER_EXAMPLES } from "@/data/demo";
import { navigate } from "@/lib/nav";

const SELLING_POINTS = [
  {
    icon: Languages,
    title: "Localisation is the product, not a translation file",
    body: "Locale packs carry language, date and amount formats, glossary and tone per market. The same policy answer ships in English, Kiswahili or French — reviewed by a local editor, with a fallback when a term is missing.",
    tag: "localisation",
  },
  {
    icon: Sparkles,
    title: "Answers render as interfaces, not walls of text",
    body: "The agent returns a typed schema — refund card, order tracker, onboarding form — and your wrapper draws it. The same component lands on your existing website, in WhatsApp and in your app, driven by live tool results.",
    tag: "generative ui",
  },
  {
    icon: Plug,
    title: "Connectors to the systems you already run",
    body: "CRM, ERP, ticketing, payments, identity. Tools are bound per agent with read/write scopes, so the agent can look up an order and raise a refund without a bespoke integration project.",
    tag: "integrations",
  },
  {
    icon: MessageSquareText,
    title: "One agent, every channel",
    body: "Web widget, mobile app, WhatsApp, SMS, email and voice share the thread, the locale, the guardrails and the audit trail. A customer can start on WhatsApp and finish on the site.",
    tag: "omnichannel",
  },
  {
    icon: ShieldCheck,
    title: "Guardrails before the model",
    body: "Tenant directives and watch-phrases are injected into every system prompt and re-checked on input, retrieved documents and tool results. Injected instructions are blocked or logged with the rule id.",
    tag: "guardrails",
  },
  {
    icon: BadgeCheck,
    title: "A human on the risky step",
    body: "Refunds above a limit, payouts to new vendors and anything touching money pause as approval items with an owner, due time and decision note — then land in a hash-chained audit trail.",
    tag: "approvals",
  },
];

const PILLARS = [
  "Any industry, any language pack",
  "Web · app · WhatsApp · SMS · voice",
  "Drops into your existing website",
  "Live in weeks, not months",
];

const TOUR_STEPS = [
  { n: "01", title: "Localisation", body: "Switch the same turn between en, sw and fr and watch formats and glossary follow." },
  { n: "02", title: "Wrappers & channels", body: "See the generative-UI card land in a WhatsApp-style thread, then copy the embed snippet." },
  { n: "03", title: "Guardrails", body: "Fire a prompt injection at the shield and watch it block with a rule id." },
  { n: "04", title: "Approvals & audit", body: "Decide a queued refund and see the decision written to the trail." },
];

const WORKFLOW_RUN = {
  key: "customer_onboarding",
  name: "Customer onboarding",
  version: 3,
  runId: "ONB-2411-018",
  steps: [
    { label: "Intake & consent", actor: "Supervisor", kind: "agent", state: "done", timing: "1.2s" },
    { label: "Document completeness", actor: "Document Analyst", kind: "agent", state: "done", timing: "4.8s" },
    { label: "Watchlist screening", actor: "Risk Analyst + connector", kind: "connector", state: "done", timing: "2.1s" },
    { label: "Risk scoring", actor: "Risk Analyst", kind: "agent", state: "done", timing: "1.6s" },
    { label: "Enhanced due diligence", actor: "Human approval", kind: "approval", state: "waiting", timing: "waiting 3h" },
    { label: "Decision & case note", actor: "Case Writer", kind: "agent", state: "queued", timing: "—" },
  ],
} as const;

const WORKFLOW_MOVES = [
  {
    title: "Trigger",
    body: "A voice call, WhatsApp message, web form or schedule starts a run with typed inputs and a run id.",
  },
  {
    title: "Steps execute in order",
    body: "Each step has one owner — a specialist agent, a connector call with read or write scope, or a human approver — and hands a typed output to the next step.",
  },
  {
    title: "A gate pauses durably",
    body: "Approval steps set the run to waiting_approval. It waits hours or days with no model in the loop, then resumes at the paused step when the approver decides.",
  },
  {
    title: "Close out, keep the evidence",
    body: "Every step records its actor, timing, tool and output on the hash-chained trail. The run closes with a case note — the decision is the artifact, not just the reply.",
  },
];

const WRAPPER_SAMPLES: Record<string, { title: string; meta: string; progress: string }> = {
  refund: { title: "TZS 45,000 · refund queued", meta: "3 of 5 working days · notified on WhatsApp", progress: "w-2/3" },
  order: { title: "Order AC-8841 · out for delivery", meta: "Step 4 of 5 · arrives tomorrow, 09:00–12:00", progress: "w-4/5" },
  form: { title: "Onboarding · 3 of 4 fields", meta: "2 documents verified · 1 needs a signature", progress: "w-3/4" },
};

const FAQ = [
  {
    q: "Is the demo free?",
    a: "Yes. The product tour, the customer tour and the real console with its one-click demo login are all free — no account, no card, nothing to install.",
  },
  {
    q: "What can I do on the free tier?",
    a: "Everything in the tour: switch locales, fire a prompt injection at the guardrails, decide a queued refund, browse the marketplace packs and read the audit trail. A paid session is only for teams that want a guided working session on their own use case.",
  },
  {
    q: "Can it really run on WhatsApp?",
    a: "Yes. WhatsApp, SMS and email are channel adapters over the same agent runtime and thread store. The channel changes the transport and the message shape, not the policy, locale or tools.",
  },
  {
    q: "Can it handle voice calls?",
    a: "Yes. The MNO voice line runs in your browser: speech-to-text in, the agent's answer spoken back, and the balance, bundle or SIM-swap card on screen. SIM swaps and credits still pause for a human approval.",
  },
  {
    q: "Do you have an MNO solution?",
    a: "Yes. The MNO Voice Care pack bundles subscriber-care agents, the SIM-swap policy, the bundle catalogue and the English and Kiswahili locale packs. It uses the voice channel and the same audit trail as web and WhatsApp.",
  },
  {
    q: "How do the generative-UI wrappers work?",
    a: "Agents return typed schemas such as refund_card.v2 or order_tracker.v1 alongside the prose. A wrapper maps each schema to a component, so the interface stays consistent across channels and is safe to render.",
  },
  {
    q: "How do workflows differ from an agent chat?",
    a: "A chat is open-ended: the model decides what to do next on each turn. A workflow fixes the sequence — agent step, connector call, approval gate — so a regulated journey runs the same way every time. Each step hands typed output to the next, human approvals pause the run instead of ending it, and every step lands on the audit trail.",
  },
  {
    q: "Will it work with our existing website?",
    a: "Yes. The wrapper is one script tag on the site you run today — React, Next.js, WordPress, Shopify or plain HTML. It keeps the thread across page changes, knows which page the customer is on, and renders the same cards as WhatsApp and the mobile app. No rebuild and no iframe takeover.",
  },
  {
    q: "What does a paid consultation cover?",
    a: "A scoped working session: we map your journey to agents and workflows, walk the console with your team, and leave you with a written deployment outline. Fees are quoted before booking.",
  },
  {
    q: "Can we get a longer session?",
    a: "Yes. Book a 4-hour or 8-hour block, or choose a custom length beyond 8 hours. Multi-day and on-site engagements are quoted separately.",
  },
  {
    q: "How does deployment work?",
    a: "The console and runtime deploy into infrastructure you control, against your identity provider and model endpoints. Your locale packs, connectors and guardrails stay tenant-owned.",
  },
  {
    q: "How long until we are live?",
    a: "Weeks, not months. A pilot channel is typically live in 4–6 weeks: week 1 scopes the journey, locale pack and rules; week 2 wires connectors and the wrapper; week 3 adds approvals and audit; then a small cohort goes live. We publish a dated plan in week one.",
  },
];

export function Landing() {
  const [workflowMode, setWorkflowMode] = useState<"chat" | "workflow">("workflow");

  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader path="/" />
      <main>
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[var(--site-accent)]/8 blur-3xl" />
          <div className="site-container grid gap-14 pb-16 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-24 lg:pt-20">
            <div>
              <Pill tone="gold">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--site-gold)]" />
                Localisation-first · any industry · live in weeks, not months
              </Pill>
              <h1 className="font-display mt-6 text-balance text-[42px] leading-[1.04] tracking-[-0.02em] text-foreground sm:text-[56px] lg:text-[62px]">
                Agents that speak the market's language, on the channel customers already use.
              </h1>
              <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                Vela localises the whole agent — language, formats, tone and glossary — then renders the answer as a real
                interface: a refund card, an order tracker, a form. Connect your CRM, ERP and ticketing, drop the wrapper
                onto the website you already run, and ship the same agent to web, mobile, WhatsApp, SMS, email and voice.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={CONSOLE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-6 py-3.5 text-sm font-semibold text-[var(--site-on-accent)] shadow-[0_10px_30px_-12px_rgba(15,81,50,0.55)] transition-transform hover:-translate-y-0.5"
                >
                  <TerminalSquare className="h-4 w-4" />
                  Try the real console
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="/customer/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/customer/");
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-6 py-3.5 text-sm font-semibold text-foreground transition-colors hover:border-[var(--site-accent)]/40"
                >
                  Customer tour · WhatsApp + website
                  <ArrowRight className="h-4 w-4 text-[var(--site-accent)]" />
                </a>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <a
                  href="/demo/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/demo/");
                  }}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--site-accent)]"
                >
                  Or explore the hosted operator tour <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
                <a
                  href="/voice/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/voice/");
                  }}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--site-accent)]"
                >
                  <PhoneCall className="h-3.5 w-3.5" /> Hear the MNO voice line
                </a>
              </div>
              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Free tier · no account needed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe2 className="h-3.5 w-3.5" /> 3 locale packs live
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Pilots live in weeks, not months
                </span>
              </p>
            </div>

            <HeroChat />
          </div>

          <div className="border-y border-border/70 bg-[var(--site-surface)]/60">
            <div className="site-container grid gap-4 py-5 sm:grid-cols-2 lg:grid-cols-4">
              {PILLARS.map((pillar) => (
                <div key={pillar} className="flex items-center gap-2.5 text-[13px] font-medium text-muted-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--site-accent)]/10">
                    <Check className="h-3 w-3 text-[var(--site-accent)]" strokeWidth={3} />
                  </span>
                  {pillar}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="platform" className="site-container scroll-mt-24 py-20">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Why teams pick Vela</p>
            <h2 className="font-display mt-3 text-[34px] leading-[1.1] tracking-[-0.015em] sm:text-[42px]">
              Launch in the market, not just in English.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              Localisation, interface wrappers, connectors and channels are the four things that decide whether an agent
              is usable — so they are built into the platform rather than bolted on per project. The controls that make it
              safe ship with them.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {SELLING_POINTS.map(({ icon: Icon, title, body, tag }) => (
              <article
                key={title}
                className="group flex flex-col rounded-2xl border border-border/80 bg-[var(--site-surface)] p-6 transition-all hover:-translate-y-0.5 hover:border-[var(--site-accent)]/30 hover:shadow-[0_18px_40px_-28px_rgba(15,81,50,0.45)]"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--site-accent)]/8 text-[var(--site-accent)]">
                    <Icon className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">{tag}</span>
                </div>
                <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="localisation" className="scroll-mt-24 border-y border-border/70 bg-[var(--site-surface)]/50">
          <div className="site-container py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Localisation</p>
                <h2 className="font-display mt-3 text-[32px] leading-[1.1] sm:text-[40px]">One agent, every market voice.</h2>
                <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
                  The same turn, three locales. Amounts, dates, phone formats and glossary follow the pack; policy wording
                  stays reviewed, not machine-guessed.
                </p>
              </div>
              <a
                href="/demo/?tab=locale"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--site-accent)]"
              >
                Open the locale tab <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {LOCALES.map((locale) => (
                <article key={locale.id} className="flex flex-col rounded-2xl border border-border/80 bg-card p-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--site-accent)]/10 font-mono text-[10px] text-[var(--site-accent)]">
                        {locale.id.toUpperCase()}
                      </span>
                      {locale.label}
                    </span>
                    <Pill tone="green">live</Pill>
                  </div>
                  <p className="mt-1 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{locale.market}</p>
                  <p className="mt-4 rounded-xl rounded-tl-sm border border-border/70 bg-[var(--site-bg)]/60 px-3 py-2 text-[12px] leading-relaxed">
                    {locale.reply}
                  </p>
                  <dl className="mt-4 space-y-1 border-t border-border/60 pt-3 text-[11px]">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Amount</dt>
                      <dd className="font-mono">{locale.formatted.amount}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Date</dt>
                      <dd className="font-mono">{locale.formatted.date}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">{locale.note}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-container py-20">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Generative UI</p>
              <h2 className="font-display mt-3 text-[32px] leading-[1.1] sm:text-[40px]">
                The answer arrives as a component.
              </h2>
              <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
                The model returns a typed schema next to its prose. Your wrapper maps the schema to a component, so a
                refund looks like a refund card on every channel — and the card is driven by the same tool call that wrote
                the audit entry.
              </p>
              <ol className="mt-6 space-y-2.5 text-[13px]">
                {[
                  "Agent calls a bound tool (refund.create, orders.read).",
                  "Response carries prose plus a schema id and payload.",
                  "Wrapper renders the matching component, themed to your brand.",
                  "The user acts; the action re-enters the same thread and trace.",
                ].map((step, index) => (
                  <li key={step} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--site-accent)]/10 font-mono text-[10px] text-[var(--site-accent)]">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {WRAPPER_EXAMPLES.map((wrapper, index) => (
                <div
                  key={wrapper.id}
                  className={`rounded-2xl border border-border/80 bg-card p-4 ${index === 0 ? "sm:col-span-2" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] font-semibold">{wrapper.label}</p>
                    <span className="rounded-md bg-[var(--site-bg)] px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                      {wrapper.schema}
                    </span>
                  </div>
                  <div className="mt-3 rounded-xl border border-border/70 bg-[var(--site-bg)]/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {wrapper.schema.split(".")[0]}
                      </span>
                      <Pill tone="green">rendered</Pill>
                    </div>
                    <p className="mt-2 text-[13px] font-medium">{WRAPPER_SAMPLES[wrapper.id].title}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70">
                      <div className={`h-full rounded-full bg-[var(--site-accent)] ${WRAPPER_SAMPLES[wrapper.id].progress}`} />
                    </div>
                    <p className="mt-2 text-[10.5px] text-muted-foreground">{WRAPPER_SAMPLES[wrapper.id].meta}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="customer" className="deep-panel scroll-mt-24 border-y border-border/70 text-[#e7eee6]">
          <div className="site-container py-20">
            <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-gold)]">Customer view</p>
                <h2 className="font-display mt-3 text-[32px] leading-[1.08] tracking-[-0.015em] sm:text-[40px]">
                  The customer never opens a console.
                </h2>
                <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-[#b9c6bd]">
                  A phone on WhatsApp, the same thread in your app, and a working wrapper on the website you already run.
                  The customer asks a question and gets an interface back — a tracker, a refund card, a form — on the page
                  they were already on.
                </p>
                <ul className="mt-6 space-y-2.5 text-[13px] text-[#d5dfd7]">
                  {[
                    { icon: Smartphone, text: "Mobile app and WhatsApp share one thread, locale and audit trail." },
                    { icon: Globe2, text: "The wrapper survives page changes and knows which page it is on." },
                    { icon: Code2, text: "One script tag on your existing site — React, WordPress, Shopify or plain HTML." },
                  ].map(({ icon: Icon, text }) => (
                    <li key={text} className="flex gap-2.5">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-gold)]" />
                      <span className="leading-relaxed">{text}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="/customer/"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate("/customer/");
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--site-gold)] px-5 py-3 text-sm font-semibold text-[#241a08] transition-transform hover:-translate-y-0.5"
                  >
                    Open the customer tour <ArrowRight className="h-4 w-4" />
                  </a>
                  <a
                    href="/demo/"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate("/demo/");
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-[#efe9d8] transition-colors hover:border-white/40"
                  >
                    Operator tour <ArrowUpRight className="h-4 w-4" />
                  </a>
                </div>
              </div>

              <figure className="overflow-hidden rounded-2xl border border-white/15 bg-white/5 shadow-[0_24px_60px_-36px_rgba(0,0,0,0.65)]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                  <span className="text-xs font-semibold text-[#f0e6cc]">Customer tour</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-[#c8d2c9]">Free</span>
                </div>
                <img
                  src="/customer-tour.gif"
                  alt="Animated customer tour: an order tracker in WhatsApp, a Kiswahili refund card, and the agent wrapper on an existing website."
                  className="block w-full"
                  loading="lazy"
                />
                <figcaption className="border-t border-white/10 px-4 py-2.5 text-[11px] text-[#a9b7ae]">
                  WhatsApp, the app and the website wrapper — one thread, one agent.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section id="solutions" className="site-container scroll-mt-24 py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_0.95fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">
                Solutions · Mobile network operators
              </p>
              <h2 className="font-display mt-3 text-[32px] leading-[1.1] tracking-[-0.015em] sm:text-[40px]">
                The MNO care line, answered by voice.
              </h2>
              <p className="mt-4 max-w-lg text-[14.5px] leading-relaxed text-muted-foreground">
                Subscribers call. Vela answers on the line — speech to text, the same localised agent and policy, then a
                spoken answer with the balance, bundle or SIM-swap card on screen. SIM swaps and credits wait for a human;
                bundle purchases settle instantly.
              </p>
              <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
                {[
                  { icon: AudioLines, text: "Voice in, spoken answer out — the same runtime as web and WhatsApp." },
                  { icon: ShieldCheck, text: "SIM swaps and line moves need identity checks and a human approval." },
                  { icon: BadgeCheck, text: "Bundle offers quoted in the subscriber's locale and settled in one turn." },
                  { icon: ScrollText, text: "Every turn, tool call and approval on the hash-chained trail." },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex gap-2.5 rounded-xl border border-border/80 bg-[var(--site-surface)] px-3.5 py-2.5">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-accent)]" />
                    <span className="text-[11.5px] leading-relaxed text-muted-foreground">{text}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <a
                  href="/voice/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/voice/");
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)] transition-transform hover:-translate-y-0.5"
                >
                  <PhoneCall className="h-4 w-4" /> Try the voice line
                </a>
                <a
                  href="/demo/?tab=marketplace"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/demo/?tab=marketplace");
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold"
                >
                  See the MNO pack <ArrowUpRight className="h-4 w-4 text-[var(--site-accent)]" />
                </a>
              </div>
            </div>

            <figure className="overflow-hidden rounded-2xl border border-white/10 bg-[var(--site-deep)] p-5 text-[#e7eee6] shadow-[0_24px_60px_-36px_rgba(11,27,54,0.6)]">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                  <PhoneCall className="h-4 w-4 text-[var(--site-gold)]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold">Zawadi Mobile · Care line</p>
                  <p className="text-[10.5px] text-[#a9b7ae]">Amina Juma · +255 754 000 111</p>
                </div>
                <span className="ml-auto flex items-end gap-1" aria-hidden="true">
                  {[10, 18, 26, 18, 10].map((height, index) => (
                    <span
                      key={index}
                      className="voice-bar w-1 rounded-full bg-[var(--site-gold)]"
                      style={{ height, animationDelay: `${index * 110}ms` }}
                    />
                  ))}
                </span>
              </div>
              <div className="mt-4 space-y-2.5">
                <div className="max-w-[88%] rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2 text-[11.5px] leading-relaxed">
                  Your airtime is TZS 4,250 and 1.8 GB of data is left.
                  <div className="mt-2 rounded-lg bg-white px-3 py-2 text-[var(--site-fg)]">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Prepaid balance</p>
                    <div className="mt-1.5 space-y-0.5 text-[10.5px]">
                      <p className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Airtime</span>
                        <span className="font-medium">TZS 4,250</span>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Data</span>
                        <span className="font-medium">1.8 GB left</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="ml-auto max-w-[80%] rounded-2xl bg-[var(--site-gold)] px-3 py-2 text-[11.5px] leading-relaxed text-[#241a08]">
                  My data is not working.
                </div>
                <div className="max-w-[88%] rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2 text-[11.5px] leading-relaxed">
                  No outage on your line. I've reset the data session — restart the phone and try again.
                </div>
              </div>
              <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 font-mono text-[9.5px] text-[#8fa096]">
                <span>voice · en-US · thread 2f91</span>
                <span>audit #5128</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <section id="workflows" className="site-container scroll-mt-24 py-20">
          <div className="grid gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:items-start">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">
                Workflows · governed processes
              </p>
              <h2 className="font-display mt-3 text-[32px] leading-[1.1] tracking-[-0.015em] sm:text-[40px]">
                Agents answer. Workflows finish.
              </h2>
              <p className="mt-4 max-w-lg text-[14.5px] leading-relaxed text-muted-foreground">
                A chat turn is open-ended by design. A workflow is the opposite: a versioned graph of agent steps, connector
                calls and human approvals. The agent still does the reading, writing and judgment at each step — the graph
                decides what runs next, what waits, and what gets recorded.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2" role="tablist" aria-label="Compare an agent chat and a workflow">
                <button
                  type="button"
                  role="tab"
                  aria-selected={workflowMode === "chat"}
                  aria-controls="workflow-example-panel"
                  onClick={() => setWorkflowMode("chat")}
                  className={`rounded-xl border px-4 py-3.5 text-left transition-colors ${
                    workflowMode === "chat"
                      ? "border-[var(--site-accent)]/45 bg-[var(--site-accent)]/6"
                      : "border-border/80 bg-[var(--site-surface)] hover:border-[var(--site-accent)]/30"
                  }`}
                >
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                    <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" /> Agent chat
                    <span className="ml-auto font-mono text-[9px] font-normal text-muted-foreground">see example</span>
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    One question, one answer. The model picks tools per turn, so it handles the unexpected — but the path is
                    decided at runtime, turn by turn.
                  </p>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={workflowMode === "workflow"}
                  aria-controls="workflow-example-panel"
                  onClick={() => setWorkflowMode("workflow")}
                  className={`rounded-xl border px-4 py-3.5 text-left transition-colors ${
                    workflowMode === "workflow"
                      ? "border-[var(--site-accent)]/35 bg-[var(--site-accent)]/6"
                      : "border-border/80 bg-[var(--site-surface)] hover:border-[var(--site-accent)]/30"
                  }`}
                >
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                    <GitBranch className="h-3.5 w-3.5 text-[var(--site-accent)]" /> Workflow
                    <span className="ml-auto font-mono text-[9px] font-normal text-muted-foreground">see example</span>
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    A fixed, versioned sequence with typed hand-offs. Approvals sit at named steps, and the run resumes
                    exactly where it paused — days later, if needed.
                  </p>
                </button>
              </div>

              <ol className="mt-7 space-y-4">
                {WORKFLOW_MOVES.map((move, index) => (
                  <li key={move.title} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--site-accent)]/10 font-mono text-[10.5px] text-[var(--site-accent)]">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-[13px] font-semibold">{move.title}</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{move.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-3" role="tabpanel" id="workflow-example-panel">
              {workflowMode === "workflow" ? (
                <>
              <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold">{WORKFLOW_RUN.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground">
                      {WORKFLOW_RUN.key} · v{WORKFLOW_RUN.version} · {WORKFLOW_RUN.runId}
                    </p>
                  </div>
                  <Pill tone="amber">waiting approval</Pill>
                </div>
                <ol className="px-4 py-4">
                  {WORKFLOW_RUN.steps.map((step, index) => (
                    <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                      {index < WORKFLOW_RUN.steps.length - 1 ? (
                        <span
                          className={`absolute left-[11px] top-6 h-[calc(100%-12px)] w-px ${
                            step.state === "done" ? "bg-[var(--site-accent)]/30" : "bg-border"
                          }`}
                        />
                      ) : null}
                      <span
                        className={`relative z-10 mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border text-[9px] ${
                          step.state === "done"
                            ? "border-[var(--site-accent)] bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                            : step.state === "waiting"
                              ? "border-[var(--site-gold)] bg-[var(--site-gold)]/15 text-[#7a5b1c]"
                              : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        {step.state === "done" ? (
                          <Check className="h-3 w-3" strokeWidth={3} />
                        ) : step.state === "waiting" ? (
                          <Clock className="h-3 w-3" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-1">
                          <p className="text-[12.5px] font-medium">{step.label}</p>
                          <span className="font-mono text-[9.5px] text-muted-foreground">{step.timing}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {step.actor} · <span className="font-mono">{step.kind}</span>
                        </p>
                        {step.state === "waiting" ? (
                          <p className="mt-1.5 rounded-md border border-[var(--site-gold)]/35 bg-[var(--site-gold)]/8 px-2 py-1.5 text-[10px] leading-relaxed text-[#7a5b1c]">
                            Paused on approval APR-2041. The run resumes at this step once an operations reviewer decides — no
                            restart and no re-run.
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/70 bg-[var(--site-bg)]/60 px-4 py-2.5 font-mono text-[9.5px] text-muted-foreground">
                  <span>6 steps</span>
                  <span>·</span>
                  <span>1 approval gate</span>
                  <span>·</span>
                  <span>risk 82</span>
                  <span className="ml-auto">audit #4822</span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/80 bg-card p-4">
                  <div className="flex items-center gap-2">
                    <PlayCircle className="h-4 w-4 text-[var(--site-accent)]" />
                    <p className="text-[12px] font-semibold">Shadow replay</p>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    Before v4 ships, replay recent runs against it on the same inputs and compare outcomes step by step —
                    agreement and drift, with no writes to the ERP.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/80 bg-card p-4">
                  <div className="flex items-center gap-2">
                    <ScrollText className="h-4 w-4 text-[var(--site-accent)]" />
                    <p className="text-[12px] font-semibold">Rules from decisions</p>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    A reviewed approval can become a rule — <span className="font-mono text-[10px]">when</span> condition{" "}
                    <span className="font-mono text-[10px]">→</span> route or block. Known cases skip the queue, and the rule
                    keeps its own audit history.
                  </p>
                </div>
              </div>
                </>
              ) : (
                <>
                  <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold">Agent chat</p>
                        <p className="mt-0.5 truncate font-mono text-[9.5px] text-muted-foreground">
                          thread 8c1f · Amina · WhatsApp (en-TZ)
                        </p>
                      </div>
                      <Pill tone="neutral">turn by turn</Pill>
                    </div>
                    <div className="space-y-2.5 px-4 py-4">
                      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[var(--site-accent)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--site-on-accent)]">
                        My data isn't working and I need a 4 GB bundle. Also, can you move my line to this new SIM?
                      </div>
                      <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-border/70 bg-[var(--site-bg)] px-3 py-2 text-[11.5px] leading-relaxed">
                        Your line is fine — I reset the data session. 4 GB is active for TZS 7,500. A SIM swap needs an
                        identity check, so I've queued SIM-7741 for a care agent.
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-1 font-mono text-[9px] text-muted-foreground">
                        <span className="rounded border border-border/70 px-1.5 py-0.5">line.check → ok</span>
                        <span className="rounded border border-border/70 px-1.5 py-0.5">bundle.add → paid</span>
                        <span className="rounded border border-[var(--site-gold)]/45 bg-[var(--site-gold)]/8 px-1.5 py-0.5 text-[#7a5b1c]">
                          sim.swap → approval
                        </span>
                      </div>
                      <p className="rounded-md border border-border/70 bg-[var(--site-bg)]/70 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                        The model chose these tools as the turn unfolded. Nothing here was guaranteed in advance — which is
                        why money and SIM moves still route to a human.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/70 bg-[var(--site-bg)]/60 px-4 py-2.5 font-mono text-[9.5px] text-muted-foreground">
                      <span>4 tool calls</span>
                      <span>·</span>
                      <span>6.2s</span>
                      <span>·</span>
                      <span>path decided at runtime</span>
                      <span className="ml-auto">audit #4823</span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border/80 bg-card p-4">
                      <div className="flex items-center gap-2">
                        <MessageSquareText className="h-4 w-4 text-[var(--site-accent)]" />
                        <p className="text-[12px] font-semibold">Good at the unexpected</p>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        Mixed asks, follow-ups and language switches land in one thread. The agent decides which tool to call
                        next from what the customer just said.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/80 bg-card p-4">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-[var(--site-accent)]" />
                        <p className="text-[12px] font-semibold">Hand off when the path matters</p>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        The same thread can open a workflow: the SIM swap becomes a named step with its own approval, evidence
                        and audit entry instead of a one-off tool call.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="/demo/?tab=workflows"
              onClick={(e) => {
                e.preventDefault();
                navigate("/demo/?tab=workflows");
              }}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)] transition-transform hover:-translate-y-0.5"
            >
              Walk a live run <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href={CONSOLE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold"
            >
              Workflows in the console <ArrowUpRight className="h-4 w-4 text-[var(--site-accent)]" />
            </a>
          </div>
        </section>

        <section className="border-y border-border/70 bg-[var(--site-surface)]/50">
          <div className="site-container grid gap-12 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Integrations</p>
              <h2 className="font-display mt-3 text-[32px] leading-[1.1] sm:text-[40px]">
                Agents that act inside your stack.
              </h2>
              <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
                Bind tools per agent with read or write scope. Write actions that move money or change a customer record
                route through an approval, not a prompt. On the front end, one script tag puts the wrapper on the website
                you already run — no rebuild.
              </p>
              <div className="mt-6 overflow-hidden rounded-xl border border-border/80 bg-card">
                {INTEGRATIONS.map((integration) => (
                  <div key={integration.id} className="flex items-start gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--site-accent)]/8 font-mono text-[9px] font-semibold text-[var(--site-accent)]">
                      {integration.group.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium">{integration.name}</p>
                      <p className="text-[10.5px] leading-relaxed text-muted-foreground">{integration.detail}</p>
                    </div>
                    <Pill tone={integration.status === "connected" ? "green" : "neutral"}>{integration.status}</Pill>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Omnichannel</p>
              <h2 className="font-display mt-3 text-[32px] leading-[1.1] sm:text-[40px]">
                The same thread, every channel.
              </h2>
              <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
                A channel adapter changes the transport, not the agent. History, locale, guardrail verdicts and the audit
                trace follow the customer from voice to WhatsApp to the site.
              </p>
              <div className="mt-6 overflow-hidden rounded-xl border border-border/80 bg-card">
                {CHANNELS.map((channel) => (
                  <div key={channel.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0">
                    <MessageCircle className="h-4 w-4 shrink-0 text-[var(--site-accent)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium">{channel.name}</p>
                      <p className="text-[10.5px] leading-relaxed text-muted-foreground">{channel.detail}</p>
                    </div>
                    <div className="text-right">
                      <Pill tone={channel.status === "live" ? "green" : "neutral"}>{channel.status}</Pill>
                      <p className="mt-1 font-mono text-[9.5px] text-muted-foreground">{channel.volume}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="channels" className="site-container scroll-mt-24 py-20">
          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Real console</p>
              <h2 className="font-display mt-3 text-[34px] leading-[1.1] tracking-[-0.015em] sm:text-[42px]">
                Not a recording. The console itself.
              </h2>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                The hosted tour is for a quick look. When you want to click through the actual operator console — agents,
                workflows, guardrails, approvals, locale packs and audit — open the real one. It runs with a one-click
                demo login, free.
              </p>
              <div className="mt-6 space-y-3">
                {[
                  { icon: TerminalSquare, title: "Open the console", body: "Same build as the deployment, not a screenshot reel." },
                  { icon: Lock, title: "One-click demo login", body: "Pick admin, tenant admin, approver or auditor and walk in." },
                  { icon: Clock, title: "Availability", body: "It is a dev machine — if it is asleep, book a session and we will run it live." },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex gap-3 rounded-xl border border-border/80 bg-[var(--site-surface)] px-4 py-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-accent)]" />
                    <div>
                      <p className="text-[12.5px] font-medium">{title}</p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a
                  href={CONSOLE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--site-deep)] px-5 py-3 text-sm font-semibold text-[#efe9d8] transition-transform hover:-translate-y-0.5"
                >
                  Open the real console <ArrowUpRight className="h-4 w-4" />
                </a>
                <a
                  href="/book/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/book/");
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold"
                >
                  <CalendarDays className="h-4 w-4 text-[var(--site-accent)]" /> Book a live walkthrough
                </a>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Console URL: <span className="font-mono">{CONSOLE_URL}</span> · demo accounts are on the login page, one click each.
              </p>
            </div>

            <figure className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-36px_rgba(11,42,32,0.5)]">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
                <span className="text-xs font-semibold">Console tour</span>
                <span className="rounded-full bg-[var(--site-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--site-accent)]">Free</span>
              </div>
              <img
                src="/tour.gif"
                alt="Animated walkthrough of the Vela console: overview, localisation, wrappers and approvals."
                className="block w-full"
                loading="lazy"
              />
              <figcaption className="border-t border-border/70 px-4 py-2.5 text-[11px] text-muted-foreground">
                A short loop of the tour tabs. The real console is one click away.
              </figcaption>
            </figure>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TOUR_STEPS.map((step) => (
              <div key={step.n} className="rounded-xl border border-border/80 bg-[var(--site-surface)] p-4">
                <span className="font-mono text-[10px] text-[var(--site-gold)]">{step.n}</span>
                <p className="mt-1 text-sm font-semibold">{step.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
          <a
            href="/demo/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/demo/");
            }}
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--site-accent)]"
          >
            Open the hosted tour <ArrowUpRight className="h-4 w-4" />
          </a>
        </section>

        <section className="border-y border-border/70 bg-[var(--site-surface)]/50">
          <div className="site-container py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Marketplace</p>
                <h2 className="font-display mt-3 text-[30px] leading-[1.12] sm:text-[36px]">
                  Start with a pack, not a blank page.
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
                  Industry blueprints bundle agents, workflows, locale packs and policy presets. Swap the pack, keep the
                  runtime.
                </p>
              </div>
              <a
                href="/demo/?tab=marketplace"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--site-accent)]"
              >
                Browse the catalogue <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PACKS.map((pack) => (
                <div
                  key={pack.id}
                  className="flex flex-col justify-between rounded-xl border border-border/80 bg-[var(--site-surface)] p-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{pack.industry}</span>
                      {pack.installed ? <Pill tone="green">Installed</Pill> : null}
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-snug">{pack.name}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{pack.summary}</p>
                  </div>
                  <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                    v{pack.version} · {pack.agents} agents · {pack.workflows} workflows
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="speed" className="site-container scroll-mt-24 py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Time to value</p>
              <h2 className="font-display mt-3 text-[34px] leading-[1.1] tracking-[-0.015em] sm:text-[42px]">
                We always go live in weeks, not months.
              </h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
                No six-month platform programme. We publish a dated plan in week one, keep the locale packs and connectors
                small enough to ship, and put a real channel in front of real customers while the rollout continues.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[var(--site-gold)]/40 bg-[var(--site-gold)]/10 px-3.5 py-1.5 text-[11.5px] font-semibold text-[#7a5b1c]">
              <Clock className="h-3.5 w-3.5" /> Typical pilot: 4–6 weeks
            </div>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { week: "Week 1", title: "Scope, locale pack, rules", body: "Journey map, glossary and tone for the first market, plus the rules the agent must never break." },
              { week: "Week 2", title: "Connectors and your site", body: "Read tools against your CRM or ERP, and the wrapper dropped onto your existing website with one script tag." },
              { week: "Week 3", title: "Approvals and audit", body: "Limits, approval owners and the hash-chained audit trail wired before anything is allowed to write." },
              { week: "Week 4–6", title: "Pilot live", body: "A small cohort on WhatsApp or web, reviewed locales and a dated rollout plan for the next markets." },
            ].map((item) => (
              <div key={item.week} className="rounded-xl border border-border/80 bg-[var(--site-surface)] p-5">
                <span className="font-mono text-[10px] text-[var(--site-gold)]">{item.week}</span>
                <p className="mt-1.5 text-[14px] font-semibold">{item.title}</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="consulting" className="scroll-mt-24 bg-[var(--site-bg)]">
          <div className="site-container py-20">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
              <div>
                <Pill tone="green">
                  <BadgeCheck className="h-3 w-3" /> Free tier first
                </Pill>
                <h2 className="font-display mt-4 text-[34px] leading-[1.1] tracking-[-0.015em] sm:text-[42px]">
                  A working session on your use case.
                </h2>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                  Bring a journey — onboarding, service, claims, procurement, internal ops. On the free tier you can walk
                  the whole console yourself. When you want our team in the room, a paid session maps the agents, locale
                  packs and connectors and leaves you with a written deployment outline.
                </p>
                <div className="mt-6 rounded-xl border border-[var(--site-accent)]/40 bg-[var(--site-accent)]/6 p-4">
                  <p className="text-sm font-semibold">Everything on this site is free to try.</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    Product tour, customer tour and the real console with a one-click demo login. No account, no card.
                    Paid sessions are the only thing we charge for, and the fee is quoted before the session.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-[var(--site-accent)]/45 bg-[var(--site-surface)] p-5 shadow-[0_16px_40px_-30px_rgba(15,81,50,0.5)] sm:col-span-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Free tier</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">Do all of this without paying</p>
                    </div>
                    <Pill tone="green">Free</Pill>
                  </div>
                  <p className="font-display mt-3 text-xl">USD 0</p>
                  <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
                    {[
                      "Product tour — every tab, no sign-up",
                      "Customer tour on WhatsApp and the web",
                      "Real console with one-click demo login",
                      "Marketplace packs and blueprints",
                      "Guardrails, approvals and audit trail",
                      "Every locale pack, switched in place",
                    ].map((item) => (
                      <li key={item} className="flex gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-[var(--site-accent)]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <a
                      href={CONSOLE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--site-accent)] px-4 py-2 text-[11.5px] font-semibold text-[var(--site-on-accent)]"
                    >
                      Start free in the console <ArrowUpRight className="h-3 w-3" />
                    </a>
                    <a
                      href="/demo/"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate("/demo/");
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-[11.5px] font-semibold"
                    >
                      Open the product tour <ArrowRight className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <SlotCard
                  title="Half day"
                  hours="4 hours"
                  price="USD 175"
                  items={["Use-case discovery", "Console walkthrough", "Deployment outline"]}
                />
                <SlotCard
                  title="Full day"
                  hours="8 hours"
                  price="USD 320"
                  featured
                  items={["Everything in 4h", "Workflow design session", "Locale and channel plan", "Written summary"]}
                />
                <SlotCard
                  title="Custom"
                  hours="9h+"
                  price="Quoted"
                  items={["Multi-team sessions", "On-site option", "Additional hours quoted"]}
                />
              </div>
            </div>
            <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-2xl bg-[var(--site-deep)] p-6 sm:flex-row sm:items-center sm:p-8">
              <div>
                <p className="font-display text-xl text-[#f2ead5]">Check open slots on the calendar.</p>
                <p className="mt-1 text-[13px] text-[#c8d2c9]">Choose a 4-hour or 8-hour block, or add custom hours.</p>
              </div>
              <a
                href="/book/"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/book/");
                }}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--site-gold)] px-5 py-3 text-sm font-semibold text-[#241a08] transition-transform hover:-translate-y-0.5"
              >
                Request a booking
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>

        <section className="site-container py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Before you book</p>
              <h2 className="font-display mt-3 text-[30px] leading-[1.12] sm:text-[36px]">Straight answers.</h2>
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                Start free, then book a session if you want the team with you.
              </p>
            </div>
            <div className="divide-y divide-border/80 border-y border-border/80">
              {FAQ.map((item) => (
                <details key={item.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                    {item.q}
                    <span className="text-[var(--site-accent)] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function HeroChat() {
  const [index, setIndex] = useState(1);
  const locale = LOCALES[index];

  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-[28px] bg-[var(--site-accent)]/5" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-40px_rgba(11,42,32,0.55)]">
        <div className="flex items-center justify-between border-b border-border/70 bg-[var(--site-bg)]/70 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5 text-[var(--site-accent)]" /> whatsapp · thread:8c1f
          </span>
          <div className="flex gap-1">
            {LOCALES.map((item, itemIndex) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setIndex(itemIndex)}
                className={`rounded-full px-2 py-0.5 text-[9.5px] transition-colors ${
                  index === itemIndex
                    ? "bg-[var(--site-accent)] font-semibold text-[var(--site-on-accent)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.id.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2.5 bg-[var(--site-bg)]/40 p-4">
          <p className="mx-auto w-fit rounded-full bg-card px-2.5 py-0.5 text-[9.5px] text-muted-foreground">
            {locale.market} · locale pack v4
          </p>
          <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-[var(--site-accent)] px-3.5 py-2 text-[12px] leading-relaxed text-[var(--site-on-accent)]">
            {locale.customer}
          </div>
          <div className="w-fit max-w-[92%] rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2 text-[12px] leading-relaxed">
            {locale.reply}
          </div>

          <div className="w-fit max-w-[92%] rounded-xl border border-border/80 bg-card p-3">
            <div className="flex items-center justify-between gap-6">
              <span className="text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">refund_card.v2</span>
              <Pill tone="green">queued</Pill>
            </div>
            <p className="mt-1.5 text-[13px] font-semibold">{locale.formatted.amount}</p>
            <p className="text-[10.5px] text-muted-foreground">{locale.formatted.date} · duplicate charge</p>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--site-accent)]" />
              <span className="text-[10px] text-muted-foreground">3 of 5 working days · notified on WhatsApp</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 pl-1 text-[9.5px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> guardrails passed · audit #4821 · approved by policy
          </div>
        </div>

        <div className="border-t border-border/70 px-4 py-2.5 font-mono text-[9.5px] text-muted-foreground">
          &lt;script src="https://cdn.vela.example/embed.js" data-agent="concierge" data-locale="{locale.code}"&gt;
        </div>
      </div>

      <div className="mt-3 hidden w-fit rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-lg sm:flex sm:items-center sm:gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--site-accent)]/10">
          <Languages className="h-3.5 w-3.5 text-[var(--site-accent)]" />
        </span>
        <div>
          <p className="text-[11px] font-semibold">Same turn, {LOCALES.length} locales</p>
          <p className="text-[10px] text-muted-foreground">Switch the pack above</p>
        </div>
      </div>
    </div>
  );
}

function SlotCard({
  title,
  hours,
  price,
  items,
  featured = false,
}: {
  title: string;
  hours: string;
  price: string;
  items: string[];
  featured?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-xl border p-5 ${
        featured
          ? "border-[var(--site-accent)]/45 bg-[var(--site-surface)] shadow-[0_16px_40px_-30px_rgba(15,81,50,0.5)]"
          : "border-border/80 bg-[var(--site-surface)]/70"
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        {featured && <Pill tone="green">Popular</Pill>}
      </div>
      <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{hours}</p>
      <p className="font-display mt-3 text-xl">{price}</p>
      <ul className="mt-4 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-[var(--site-accent)]" />
            {item}
          </li>
        ))}
      </ul>
      <a
        href="/book/"
        onClick={(e) => {
          e.preventDefault();
          navigate("/book/");
        }}
        className="mt-5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--site-accent)]"
      >
        Check availability <ArrowRight className="h-3 w-3" />
      </a>
    </div>
  );
}
