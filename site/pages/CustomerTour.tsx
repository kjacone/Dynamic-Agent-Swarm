import { useId, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Code2,
  Globe2,
  Hash,
  HelpCircle,
  Home,
  Languages,
  Lock,
  MapPin,
  MessageCircle,
  Mic,
  MicOff,
  Package,
  PhoneCall,
  PhoneOff,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Volume2,
  Zap,
} from "lucide-react";
import { Pill, Wordmark } from "@/components/site/Chrome";
import { CONSOLE_URL, WRAPPER_DEMO_URL } from "@/lib/config";
import { navigate } from "@/lib/nav";

type Scene = "whatsapp" | "voice" | "website";
type Step = "intro" | "order" | "refund" | "address";
type Page = "home" | "shop" | "orders" | "help";
type Locale = "en" | "sw";

const STEPS: Step[] = ["intro", "order", "refund", "address"];
const PAGES: Page[] = ["home", "shop", "orders", "help"];

const search = () => new URLSearchParams(window.location.search);

function initialScene(): Scene {
  const value = search().get("scene");
  if (value === "website" || value === "voice") return value;
  return "whatsapp";
}

function initialStep(): Step {
  const value = search().get("step");
  return value && STEPS.includes(value as Step) ? (value as Step) : "order";
}

function initialLocale(): Locale {
  return search().get("locale") === "sw" ? "sw" : "en";
}

function initialPage(): Page {
  const value = search().get("page");
  if (value && PAGES.includes(value as Page)) return value as Page;
  return "orders";
}

const THREAD_COPY: Record<Locale, Record<Step, { customer?: string; agent: string }>> = {
  en: {
    intro: {
      agent: "Hi Amina! I'm Acme's assistant. I can track an order, fix a charge or update your delivery details.",
    },
    order: {
      customer: "Hi! Where is my order AC-8841? I need it before the weekend.",
      agent: "Found it — AC-8841 is out for delivery and arrives tomorrow between 09:00 and 12:00.",
    },
    refund: {
      customer: "I was charged twice for order AC-8841. Can you check?",
      agent: "I found two charges of TZS 45,000 on 14 Nov 2026. I've queued a refund of the duplicate — 3 to 5 working days.",
    },
    address: {
      customer: "Please send the delivery to my office instead.",
      agent: "Sure — confirm the new address below and I'll reroute order AC-8841.",
    },
  },
  sw: {
    intro: {
      agent: "Habari Amina! Mimi ni msaidizi wa Acme. Naweza kufuatilia oda, kurekebisha malipo au kubadilisha anwani yako.",
    },
    order: {
      customer: "Habari! Oda yangu AC-8841 iko wapi? Naihitaji kabla ya wikendi.",
      agent: "Nimeipata — AC-8841 iko njiani na itafika kesho kati ya saa 3 na 6 asubuhi.",
    },
    refund: {
      customer: "Nimetozwa mara mbili kwa oda AC-8841. Unaweza kuangalia?",
      agent: "Ninaona malipo mawili ya TZS 45,000 tarehe 14 Novemba 2026. Nimeweka ombi la kurejesha malipo ya ziada — siku 3 hadi 5 za kazi.",
    },
    address: {
      customer: "Nahitaji oda ipelekwe ofisini kwangu badala yake.",
      agent: "Sawa — thibitisha anwani mpya hapa chini nami nitaelekeza oda AC-8841 huko.",
    },
  },
};

const QUICK_REPLIES: Record<Locale, { step: Step; label: string }[]> = {
  en: [
    { step: "order", label: "Where is my order?" },
    { step: "refund", label: "I was charged twice" },
    { step: "address", label: "Change delivery address" },
  ],
  sw: [
    { step: "order", label: "Oda yangu iko wapi?" },
    { step: "refund", label: "Nimetozwa mara mbili" },
    { step: "address", label: "Badilisha anwani" },
  ],
};

const VOICE_THREAD: Record<
  Locale,
  {
    contact: string;
    status: string;
    onCall: string;
    you: string;
    vela: string;
    customerTranscript: string;
    agentTranscript: string;
    cardTitle: string;
    airtime: string;
    data: string;
    dataValue: string;
    sms: string;
    smsValue: string;
    guardrail: string;
  }
> = {
  en: {
    contact: "Zawadi Care",
    status: "secure care line",
    onCall: "on call · 00:42",
    you: "You",
    vela: "Vela · agent",
    customerTranscript: "Can you check my balance and data?",
    agentTranscript: "Your airtime is TZS 4,250 and you have 1.8 GB of data left.",
    cardTitle: "Prepaid balance",
    airtime: "Airtime",
    data: "Data",
    dataValue: "1.8 GB left",
    sms: "SMS",
    smsValue: "12",
    guardrail: "guardrails passed · audit #5128",
  },
  sw: {
    contact: "Zawadi Care",
    status: "laini salama ya huduma",
    onCall: "simu inaendelea · 00:42",
    you: "Wewe",
    vela: "Vela · wakala",
    customerTranscript: "Naweza kuangalia salio langu na data?",
    agentTranscript: "Hewa yako ni TZS 4,250 na umebakiza data ya GB 1.8.",
    cardTitle: "Salio la simu",
    airtime: "Hewa",
    data: "Data",
    dataValue: "GB 1.8 zimebaki",
    sms: "SMS",
    smsValue: "12",
    guardrail: "guardrails zimepita · audit #5128",
  },
};

const VOICE_CAPTION = {
  title: "The same care agent, answering a normal phone call",
  body: "The subscriber dials the care line and speaks; the agent answers out loud and puts the balance on the call screen. No app and no chat thread — policy, locale and audit match the web line, and the live call runs in your browser.",
  facts: ["channel: voice", "locale: en-TZ", "tool: subscriber.balance", "audit: #5128"],
};


const CAPTIONS: Record<Step, { title: string; body: string; facts: string[] }> = {
  intro: {
    title: "The same agent, in the customer's hands",
    body: "One thread id across WhatsApp, the mobile app and the website. The channel changes the transport — not the locale, the policy or the tools.",
    facts: ["channel: whatsapp", "thread: 8c1f", "locale: v4"],
  },
  order: {
    title: "An order question, answered as a tracker",
    body: "The agent reads the order system and returns order_tracker.v1 alongside its prose. The card is driven by the same tool call that wrote the audit entry.",
    facts: ["tool: orders.read", "schema: order_tracker.v1", "audit: #4821"],
  },
  refund: {
    title: "A refund queued, not promised",
    body: "The duplicate charge is inside policy, so the agent queues it. Amounts and dates follow the locale pack; anything above the limit pauses for a human approval.",
    facts: ["tool: payments.refund", "schema: refund_card.v2", "approval: APR-2040"],
  },
  address: {
    title: "A form instead of a paragraph",
    body: "When the agent needs structured input it returns a form with validated fields. The write goes through the order connector with a scoped permission.",
    facts: ["tool: orders.update", "schema: form.address.v3", "scope: orders:write"],
  },
};

const WEEKS = [
  {
    week: "Week 1",
    title: "Scope, locale pack, guardrails",
    body: "Journey map, glossary and tone for the first market, plus the rules the agent must never break.",
  },
  {
    week: "Week 2",
    title: "Connectors and the wrapper",
    body: "Read tools against your CRM or ERP, and the wrapper dropped onto your existing site with one script tag.",
  },
  {
    week: "Week 3",
    title: "Approvals and audit",
    body: "Limits, approval owners and the hash-chained audit trail wired before anything is allowed to write.",
  },
  {
    week: "Week 4–6",
    title: "Pilot live on a real channel",
    body: "A small cohort on WhatsApp or web, reviewed locales, a dated rollout plan — then expand, without a re-platform.",
  },
];

export function CustomerTour() {
  const capture = search().get("capture") === "1";
  const [scene, setScene] = useState<Scene>(initialScene);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [mobileStep, setMobileStep] = useState<Step>(initialStep);
  const [webStep, setWebStep] = useState<Step>(initialStep);
  const [webOpen, setWebOpen] = useState(search().get("open") !== "0");
  const [page, setPage] = useState<Page>(initialPage);

  function pickMobile(next: Step) {
    setMobileStep(next);
  }

  function pickWeb(next: Step) {
    setWebStep(next);
    if (next === "order" || next === "refund") setPage("orders");
  }

  function handoff() {
    setWebStep(mobileStep === "intro" ? "order" : mobileStep);
    setPage("orders");
    setWebOpen(true);
    setScene("website");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (capture) {
    const caption = scene === "website" ? CAPTIONS[webStep] : scene === "voice" ? VOICE_CAPTION : CAPTIONS[mobileStep];
    return (
      <div className="flex min-h-screen flex-col justify-center bg-[var(--site-bg)] px-6 py-4">
        <div className="mx-auto w-full max-w-[1180px]">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--site-accent)]">
              Customer tour · {scene === "website" ? "existing website" : scene === "voice" ? "voice call" : "WhatsApp"}
            </p>
            <p className="text-[10px] text-muted-foreground">{caption.title}</p>
          </div>
          {scene === "whatsapp" ? (
            <MobileScene locale={locale} step={mobileStep} onPick={pickMobile} onHandoff={handoff} onLocale={setLocale} capture />
          ) : scene === "voice" ? (
            <VoiceScene locale={locale} onLocale={setLocale} capture />
          ) : (
            <WebsiteScene
              locale={locale}
              step={webStep}
              page={page}
              open
              onPick={pickWeb}
              onPage={setPage}
              onToggle={() => setWebOpen((value) => !value)}
              capture
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--site-bg)]">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-[var(--site-bg)]/92 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
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
          <span className="hidden text-[11px] text-muted-foreground sm:block">Customer tour</span>
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
              <ArrowLeft className="h-3 w-3" /> Exit
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
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--site-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--site-on-accent)] sm:px-3.5"
            >
              <CalendarDays className="h-3 w-3" /> Book<span className="hidden sm:inline"> a paid session</span>
            </a>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <Pill tone="gold">
              <Sparkles className="h-3 w-3" /> Customer view
            </Pill>
            <h1 className="font-display mt-4 text-[34px] leading-[1.06] tracking-[-0.02em] sm:text-[44px]">
              This is what your customers see.
            </h1>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
              The same agent in a mobile app, on WhatsApp, on a voice call and inside a website you already run. Ask a
              question, watch the answer arrive as a card or a form, and move between the phone and the site without losing
              the thread.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <Code2 className="h-3 w-3 text-[var(--site-accent)]" /> one script tag
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <Smartphone className="h-3 w-3 text-[var(--site-accent)]" /> app + WhatsApp
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <Zap className="h-3 w-3 text-[var(--site-accent)]" /> live in weeks
            </span>
            <a
              href={WRAPPER_DEMO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--site-accent)]/45 bg-[var(--site-accent)]/8 px-2.5 py-1 font-medium text-[var(--site-accent)] transition-colors hover:border-[var(--site-accent)]"
            >
              <ArrowUpRight className="h-3 w-3" /> try the real wrapper
            </a>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 sm:flex">
          {(
            [
              { id: "whatsapp", label: "Mobile app · WhatsApp", short: "WhatsApp", hint: "thread 8c1f", icon: Smartphone },
              { id: "website", label: "Website wrapper", short: "Website", hint: "on your existing site", icon: Globe2 },
              { id: "voice", label: "Voice conversation", short: "Voice", hint: "phone call · live line", icon: Mic },
            ] as const
          ).map(({ id, label, short, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setScene(id)}
              className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors sm:px-4 ${
                id === "voice" ? "col-span-2 sm:col-span-1" : ""
              } ${
                scene === id
                  ? "border-[var(--site-accent)] bg-[var(--site-accent)]/8"
                  : "border-border/80 bg-card hover:border-[var(--site-accent)]/35"
              }`}
              aria-pressed={scene === id}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                  scene === id ? "bg-[var(--site-accent)] text-[var(--site-on-accent)]" : "bg-[var(--site-bg)] text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[11.5px] font-semibold sm:text-[12px]">
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden truncate sm:block">{label}</span>
                  {id === "voice" ? <Pill tone="green">Active</Pill> : null}
                </span>
                <span className="block truncate font-mono text-[9px] text-muted-foreground sm:text-[9.5px]">{hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-border/70 bg-[var(--site-bg)] p-4 sm:p-5">
          {scene === "whatsapp" ? (
            <MobileScene
              locale={locale}
              step={mobileStep}
              onPick={pickMobile}
              onHandoff={handoff}
              onLocale={setLocale}
              onVoice={() => setScene("voice")}
            />
          ) : scene === "voice" ? (
            <VoiceScene locale={locale} onLocale={setLocale} />
          ) : (
            <WebsiteScene
              locale={locale}
              step={webStep}
              page={page}
              open={webOpen}
              onPick={pickWeb}
              onPage={setPage}
              onToggle={() => setWebOpen((value) => !value)}
            />
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border/80 bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-[11.5px] leading-relaxed text-muted-foreground">
            Same thread, locale, guardrails and audit trail on every surface. The website panel above is the real wrapper
            component — on your site it sits over the page you already have.
          </p>
          <div className="flex shrink-0 gap-2">
            <a
              href="/demo/"
              onClick={(event) => {
                event.preventDefault();
                navigate("/demo/");
              }}
              className="rounded-full border border-border px-3 py-1.5 text-[11px] font-medium"
            >
              Operator tour
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

        <section className="mt-14 grid gap-10 lg:grid-cols-[1fr_0.95fr] lg:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Integration</p>
            <h2 className="font-display mt-3 text-[30px] leading-[1.1] tracking-[-0.015em] sm:text-[38px]">
              It goes on the site you already have.
            </h2>
            <p className="mt-4 max-w-lg text-[14.5px] leading-relaxed text-muted-foreground">
              Paste one script tag into your existing website. The wrapper reads the current route, keeps the conversation
              across page changes and renders typed cards inline — no rebuild, no iframe takeover, no second CMS. React,
              Next.js, WordPress, Shopify or plain HTML.
            </p>
            <ul className="mt-5 space-y-2.5 text-[13px]">
              {[
                { icon: Globe2, text: "Survives navigation: the thread stays open while the customer moves between pages." },
                { icon: Search, text: "Page-aware: the agent knows it is on /orders, /checkout or /help and answers in context." },
                { icon: Sparkles, text: "Generative UI: refund cards, trackers and forms are rendered by the wrapper, not the page." },
                { icon: ShieldCheck, text: "Same guardrails, approvals and audit trail as every other channel." },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex gap-2.5">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-accent)]" />
                  <span className="leading-relaxed text-muted-foreground">{text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
              <span>Works with</span>
              <span className="rounded border border-border bg-card px-1.5 py-0.5 normal-case tracking-normal">React</span>
              <span className="rounded border border-border bg-card px-1.5 py-0.5 normal-case tracking-normal">Next.js</span>
              <span className="rounded border border-border bg-card px-1.5 py-0.5 normal-case tracking-normal">WordPress</span>
              <span className="rounded border border-border bg-card px-1.5 py-0.5 normal-case tracking-normal">Shopify</span>
              <span className="rounded border border-border bg-card px-1.5 py-0.5 normal-case tracking-normal">plain HTML</span>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-[var(--site-deep)] shadow-[0_20px_50px_-30px_rgba(11,42,32,0.6)]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <span className="flex items-center gap-1.5 text-[10px] text-[#c8d2c9]">
                <Code2 className="h-3 w-3" /> embed.html
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[9px] text-[#dfe7dc]">copy · 2 lines</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-[#dfe7dc]">
              <code>{`<script
  src="https://cdn.vela.example/embed.js"
  data-agent="concierge"
  data-locale="en-TZ"
  data-theme="#0f5132"
  data-context="route">
</script>`}</code>
            </pre>
            <div className="border-t border-white/10 px-4 py-3 text-[10.5px] leading-relaxed text-[#a9b7ae]">
              The wrapper mounts over your layout, inherits your theme tokens and calls the same gateway as the app and
              WhatsApp adapter. Existing pages are untouched.
            </div>
          </div>
        </section>

        <section className="mt-16 rounded-2xl border border-border/80 bg-[var(--site-surface)] p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--site-accent)]">Time to value</p>
              <h2 className="font-display mt-3 text-[30px] leading-[1.1] tracking-[-0.015em] sm:text-[36px]">
                We always go live in weeks, not months.
              </h2>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                We publish a dated plan in week one and hold to it. A pilot channel is typically live in 4–6 weeks; the
                rollout follows the pilot instead of starting over.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[var(--site-gold)]/40 bg-[var(--site-gold)]/10 px-3 py-1.5 text-[11px] font-semibold text-[#7a5b1c]">
              <Rocket className="h-3.5 w-3.5" /> Typical pilot: 4–6 weeks
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WEEKS.map((item) => (
              <div key={item.week} className="rounded-xl border border-border/80 bg-card p-4">
                <p className="font-mono text-[10px] text-[var(--site-gold)]">{item.week}</p>
                <p className="mt-1 text-[13px] font-semibold">{item.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 flex flex-col items-start justify-between gap-5 rounded-2xl bg-[var(--site-deep)] p-6 sm:flex-row sm:items-center sm:p-8">
          <div>
            <p className="font-display text-[22px] text-[#f2ead5]">Put this wrapper on your own site.</p>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#c8d2c9]">
              Bring a page and a journey. We will map the connectors, the locale pack and the first channel — and date the
              pilot in the session.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <a
              href="/demo/"
              onClick={(event) => {
                event.preventDefault();
                navigate("/demo/");
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2.5 text-[12px] font-semibold text-[#efe9d8]"
            >
              Open the operator tour <ChevronRight className="h-3.5 w-3.5" />
            </a>
            <a
              href="/book/"
              onClick={(event) => {
                event.preventDefault();
                navigate("/book/");
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--site-gold)] px-4 py-2.5 text-[12px] font-semibold text-[#241a08]"
            >
              <CalendarDays className="h-3.5 w-3.5" /> Book a paid session
            </a>
          </div>
        </section>
      </main>
    </div>
  );
  
}

function MobileScene({
  locale,
  step,
  onPick,
  onHandoff,
  onLocale,
  onVoice = () => navigate("/voice/"),
  capture = false,
}: {
  locale: Locale;
  step: Step;
  onPick: (step: Step) => void;
  onHandoff: () => void;
  onLocale: (locale: Locale) => void;
  onVoice?: () => void;
  capture?: boolean;
}) {
  const copy = THREAD_COPY[locale][step];
  const caption = CAPTIONS[step];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
      <div className="mx-auto w-full max-w-[320px]">
        <div className="rounded-[46px] border-[7px] border-[#12241d] bg-[#0e1b16] p-1.5 shadow-[0_30px_60px_-30px_rgba(8,30,22,0.6)]">
          <div className="relative overflow-hidden rounded-[38px] bg-[#ece5dd]">
            <div className="bg-[#075e54] px-4 pb-1 pt-2 text-[#d7e7e0]">
              <div className="flex items-center justify-between text-[9px]">
                <span>9:41</span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#d7e7e0]/80" />
                  <span className="h-1.5 w-1.5 rounded-full bg-[#d7e7e0]/60" />
                  <span className="rounded-sm border border-[#d7e7e0]/70 px-1 text-[7px]">5G</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 pb-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[11px] font-semibold text-white">
                  A
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[11.5px] font-semibold text-white">Acme Home</p>
                  <p className="text-[8px] text-white/70">business account · online</p>
                </div>
                <span className="ml-auto rounded-full bg-white/15 px-1.5 py-0.5 font-mono text-[8px] text-white/85">
                  {locale === "sw" ? "sw-TZ" : "en-TZ"}
                </span>
              </div>
            </div>

            <div className="h-[336px] space-y-2 overflow-y-auto bg-[#ece5dd] px-2.5 py-2.5">
              <p className="mx-auto w-fit rounded-full bg-[#fdf3d0] px-2 py-0.5 text-[8px] text-[#6b5a20]">
                {locale === "sw" ? "Ujumbe umehamishwa kutoka app ya Acme" : "Handed over from the Acme app"}
              </p>
              {copy.customer ? <Bubble side="right">{copy.customer}</Bubble> : null}
              <Bubble side="left">{copy.agent}</Bubble>
              {step === "order" ? <OrderCard compact /> : null}
              {step === "refund" ? <RefundCard compact /> : null}
              {step === "address" ? <AddressCard compact /> : null}
              <div className="flex items-center gap-1 pl-1 text-[8px] text-muted-foreground">
                <ShieldCheck className="h-2.5 w-2.5" /> guardrails passed · audit #4821
              </div>
            </div>

            <div className="flex flex-wrap gap-1 bg-[#ece5dd] px-2 pb-1.5">
              {QUICK_REPLIES[locale].map((item) => (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => onPick(item.step)}
                  className={`rounded-full border px-2 py-1 text-[8.5px] transition-colors ${
                    step === item.step
                      ? "border-[#075e54] bg-[#075e54] text-white"
                      : "border-[#075e54]/30 bg-white text-[#075e54]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 bg-[#f0f0f0] px-2 py-1.5">
              <span className="flex-1 rounded-full bg-white px-2.5 py-1 text-[9px] text-muted-foreground">
                {locale === "sw" ? "Andika ujumbe" : "Message"}
              </span>
              <button
                type="button"
                onClick={onVoice}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-[#075e54]/85 text-white"
                title={locale === "sw" ? "Tazama mazungumzo ya sauti" : "See the voice conversation"}
                aria-label="See the voice conversation"
              >
                <Mic className="h-3 w-3" />
              </button>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#075e54] text-white">
                <Send className="h-3 w-3" />
              </span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          {locale === "sw" ? "Kwenye app ya Acme au WhatsApp" : "Inside the Acme app or on WhatsApp"}
        </p>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">What you are seeing</p>
            <Pill tone="green">live wrapper</Pill>
          </div>
          <p className="mt-2 text-[14px] font-semibold">{caption.title}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{caption.body}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {caption.facts.map((fact) => (
              <span key={fact} className="rounded-md border border-border bg-[var(--site-bg)] px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                {fact}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Locale pack</p>
            <Languages className="h-3.5 w-3.5 text-[var(--site-accent)]" />
          </div>
          <div className="mt-2 flex gap-1">
            {(
              [
                { id: "en", label: "EN · en-TZ" },
                { id: "sw", label: "SW · sw-TZ" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onLocale(item.id)}
                className={`rounded-full border px-2.5 py-1 text-[10.5px] transition-colors ${
                  locale === item.id
                    ? "border-[var(--site-accent)] bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                    : "border-border text-muted-foreground"
                }`}
                aria-pressed={locale === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            The language, the amount format and the tone follow the pack. The policy answer does not change.
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Voice conversation</p>
            <Pill tone="green">Active</Pill>
          </div>
          <div className="mt-2 flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--site-accent)]/10 text-[var(--site-accent)]">
              <Mic className="h-4 w-4" />
            </span>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Speak to Vela on the MNO voice line in English or Kiswahili. Every turn runs through the same tenant
              policy, locale pack and audit trail — see it as a normal call on the phone.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onVoice}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--site-accent)]/45 bg-[var(--site-accent)]/8 px-3 py-1.5 text-[10.5px] font-semibold text-[var(--site-accent)] transition-colors hover:border-[var(--site-accent)]"
            >
              Open the phone demo <ArrowRight className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/voice/")}
              className="text-[10.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Start the live call
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onHandoff}
          className="w-full rounded-xl bg-[var(--site-deep)] px-4 py-3 text-left text-[#efe9d8] transition-transform hover:-translate-y-0.5"
        >
          <span className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold">Continue on the website</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
          <span className="mt-0.5 block text-[10px] text-[#a9b7ae]">
            Same thread 8c1f · picks up where WhatsApp left off
          </span>
        </button>
      </div>

      {capture ? <span className="sr-only">{caption.facts.join(" · ")}</span> : null}
    </div>
  );
}

function VoiceScene({
  locale,
  onLocale,
  capture = false,
}: {
  locale: Locale;
  onLocale: (locale: Locale) => void;
  capture?: boolean;
}) {
  const thread = VOICE_THREAD[locale];

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full max-w-[320px]">
        <div className="rounded-[46px] border-[7px] border-[#12241d] bg-[#0e1b16] p-1.5 shadow-[0_30px_60px_-30px_rgba(8,30,22,0.6)]">
          <div className="relative overflow-hidden rounded-[38px] bg-[#0b1b36] text-[#e7eee6]">
            <div className="flex items-center justify-between px-5 pb-1 pt-2 text-[9px] text-[#a9b7ae]">
              <span>9:41</span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#a9b7ae]/70" />
                <span className="h-1.5 w-1.5 rounded-full bg-[#a9b7ae]/50" />
                <span className="rounded-sm border border-[#a9b7ae]/60 px-1 text-[7px]">5G</span>
              </span>
            </div>

            <div className="px-4 pt-2 text-center">
              <p className="text-[8.5px] uppercase tracking-[0.18em] text-[#8fa096]">{thread.status}</p>
              <div className="relative mx-auto mt-3 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--site-gold)]/15 text-[var(--site-gold)]">
                <PhoneCall className="h-6 w-6" />
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0b1b36] bg-emerald-400" />
              </div>
              <p className="mt-2 text-[13.5px] font-semibold">{thread.contact}</p>
              <p className="font-mono text-[9.5px] text-[#a9b7ae]">{thread.onCall}</p>
              <span className="mt-2 inline-flex items-end gap-1" aria-hidden="true">
                {[10, 18, 26, 18, 10].map((height, index) => (
                  <span
                    key={index}
                    className="voice-bar w-1 rounded-full bg-[var(--site-gold)]"
                    style={{ height, animationDelay: `${index * 110}ms` }}
                  />
                ))}
              </span>
            </div>

            <div className="mx-3 mt-3 h-[268px] space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-black/25 px-2.5 py-2.5">
              <div className="ml-auto w-fit max-w-[86%] rounded-2xl rounded-tr-sm bg-[var(--site-gold)] px-2.5 py-1.5">
                <p className="text-[7px] font-semibold uppercase tracking-[0.12em] text-[#6b4a12]">{thread.you}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-[#241a08]">{thread.customerTranscript}</p>
              </div>

              <div className="w-fit max-w-[94%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.08] px-2.5 py-1.5">
                <p className="text-[7px] font-semibold uppercase tracking-[0.12em] text-[var(--site-gold)]">{thread.vela}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed">{thread.agentTranscript}</p>
                <div className="mt-1.5 rounded-lg bg-white px-2 py-1.5 text-[var(--site-fg)]">
                  <p className="text-[7.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{thread.cardTitle}</p>
                  <dl className="mt-1 space-y-0.5 text-[9px]">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{thread.airtime}</dt>
                      <dd className="font-medium">TZS 4,250</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{thread.data}</dt>
                      <dd className="font-medium">{thread.dataValue}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{thread.sms}</dt>
                      <dd className="font-medium">{thread.smsValue}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="flex items-center gap-1 pl-0.5 text-[8px] text-[#8fa096]">
                <ShieldCheck className="h-2.5 w-2.5" /> {thread.guardrail}
              </div>
            </div>

            <div aria-hidden="true" className="mt-3 grid grid-cols-3 gap-2 px-5 text-center text-[8px] text-[#8fa096]">
              {[
                { icon: MicOff, label: "mute" },
                { icon: Volume2, label: "speaker" },
                { icon: Hash, label: "keypad" },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="flex flex-col items-center gap-1">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-[#e7eee6]">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  {label}
                </span>
              ))}
            </div>

            <div aria-hidden="true" className="mt-3 flex flex-col items-center gap-1 pb-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white">
                <PhoneOff className="h-5 w-5" />
              </span>
              <span className="text-[8px] text-[#8fa096]">end</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          {locale === "sw" ? "Simu ya kawaida — hakuna app wala chat" : "A normal phone call — no app, no chat thread"}
        </p>
      </div>

      <div className="w-full max-w-[340px] rounded-2xl border border-border/80 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Voice conversation</p>
          <Pill tone="green">Active</Pill>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          The live line is a normal phone call, answered in your browser — mic, speech-to-text and the spoken reply stay on
          the device. SIM swaps and credits still pause for a human approval.
        </p>
        <button
          type="button"
          onClick={() => navigate("/voice/")}
          className="mt-3 flex w-full items-center justify-between gap-2 rounded-full bg-[var(--site-accent)] px-3.5 py-2 text-[11px] font-semibold text-[var(--site-on-accent)] transition-transform hover:-translate-y-0.5"
        >
          Start the live voice line <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Languages className="h-3 w-3 text-[var(--site-accent)]" /> locale pack
          </span>
          <span className="flex gap-1">
            {(
              [
                { id: "en", label: "EN · en-TZ" },
                { id: "sw", label: "SW · sw-TZ" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onLocale(item.id)}
                className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                  locale === item.id
                    ? "border-[var(--site-accent)] bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                    : "border-border text-muted-foreground"
                }`}
                aria-pressed={locale === item.id}
              >
                {item.label}
              </button>
            ))}
          </span>
        </div>
      </div>

      {capture ? <span className="sr-only">{VOICE_CAPTION.facts.join(" · ")}</span> : null}
    </div>
  );
}

function WebsiteScene({
  locale,
  step,
  page,
  open,
  onPick,
  onPage,
  onToggle,
  capture = false,
}: {
  locale: Locale;
  step: Step;
  page: Page;
  open: boolean;
  onPick: (step: Step) => void;
  onPage: (page: Page) => void;
  onToggle: () => void;
  capture?: boolean;
}) {
  const navItems: { id: Page; label: string; icon: typeof Home }[] = [
    { id: "home", label: "Home", icon: Home },
    { id: "shop", label: "Shop", icon: ShoppingBag },
    { id: "orders", label: "Orders", icon: Package },
    { id: "help", label: "Help", icon: HelpCircle },
  ];
  const copy = THREAD_COPY[locale][step];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_260px] lg:items-start">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_22px_50px_-32px_rgba(11,42,32,0.55)]">
        <div className="flex items-center gap-2 border-b border-border/70 bg-[var(--site-bg)] px-3 py-2">
          <span className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-[#e4746b]" />
            <span className="h-2 w-2 rounded-full bg-[#e8bd66]" />
            <span className="h-2 w-2 rounded-full bg-[#7fb886]" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-mono text-[9.5px] text-muted-foreground">
            <Lock className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">acme.example/{page}</span>
          </span>
          <span className="hidden items-center gap-1 rounded-full bg-[var(--site-accent)]/10 px-2 py-0.5 text-[9px] font-medium text-[var(--site-accent)] sm:inline-flex">
            <span className="h-1 w-1 rounded-full bg-[var(--site-accent)]" /> wrapper connected
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2 sm:px-4">
          <span className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.16em]">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--site-deep)] text-[8px] text-[#e9dfc2]">A</span>
            ACME HOME
          </span>
          <nav className="flex gap-0.5">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onPage(id)}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[9.5px] transition-colors sm:px-2.5 ${
                  page === id
                    ? "bg-[var(--site-accent)]/10 font-semibold text-[var(--site-accent)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={page === id}
                aria-label={label}
                title={label}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <ShoppingCart className="h-3.5 w-3.5" /> 2
          </span>
        </div>

        <div className="relative h-[470px] overflow-hidden bg-[var(--site-surface)] p-3.5 sm:p-5">
          <SitePage page={page} />

          <div className="absolute inset-x-3 bottom-3 sm:inset-x-auto sm:right-3 sm:w-[272px]">
            {open ? (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_40px_-18px_rgba(11,42,32,0.45)]">
                <div className="flex items-center gap-2 bg-[var(--site-deep)] px-3 py-2 text-[#efe9d8]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--site-gold)]" />
                  <span className="text-[10.5px] font-semibold">Acme assistant</span>
                  <span className="ml-auto font-mono text-[8px] text-[#a9b7ae]">/v1/chat</span>
                  <button
                    type="button"
                    onClick={onToggle}
                    className="ml-1 rounded p-0.5 text-[#dfe7dc] hover:bg-white/10"
                    aria-label="Close the assistant panel"
                  >
                    ×
                  </button>
                </div>

                <div className="max-h-[300px] space-y-1.5 overflow-y-auto bg-[var(--site-bg)]/40 p-2">
                  <div className="flex items-center justify-between rounded-md border border-border/70 bg-card px-2 py-1 font-mono text-[8.5px] text-muted-foreground">
                    <span>context: /{page} · {locale === "sw" ? "sw-TZ" : "en-TZ"}</span>
                    <span className="text-[var(--site-accent)]">thread 8c1f</span>
                  </div>
                  {copy.customer ? <WidgetBubble side="right">{copy.customer}</WidgetBubble> : null}
                  <WidgetBubble side="left">{copy.agent}</WidgetBubble>
                  {step === "order" ? <OrderCard compact /> : null}
                  {step === "refund" ? <RefundCard compact /> : null}
                  {step === "address" ? <AddressCard compact /> : null}
                </div>

                <div className="flex flex-wrap gap-1 border-t border-border/70 px-1.5 py-1.5">
                  {QUICK_REPLIES.en.map((item) => (
                    <button
                      key={item.step}
                      type="button"
                      onClick={() => onPick(item.step)}
                      className={`rounded-full border px-1.5 py-0.5 text-[8px] transition-colors ${
                        step === item.step
                          ? "border-[var(--site-accent)] bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                          : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 border-t border-border/70 px-2 py-1.5">
                  <span className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-[8.5px] text-muted-foreground">
                    Ask about your order…
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate("/voice/")}
                    className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--site-accent)]/85 text-[var(--site-on-accent)]"
                    title="Talk to the voice line"
                    aria-label="Open the voice conversation"
                  >
                    <Mic className="h-2.5 w-2.5" />
                  </button>
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--site-accent)] text-[var(--site-on-accent)]">
                    <Send className="h-2.5 w-2.5" />
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onToggle}
                className="ml-auto flex items-center gap-2 rounded-full bg-[var(--site-deep)] px-3.5 py-2 text-[10.5px] font-semibold text-[#efe9d8] shadow-lg"
              >
                <MessageCircle className="h-3.5 w-3.5" /> Chat with Acme
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-border/80 bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Existing website</p>
          <p className="mt-1.5 text-[13.5px] font-semibold">Change pages — the wrapper stays.</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            Click Home, Shop, Orders or Help. The conversation survives the navigation, and the agent sees the route it is
            on. That is the whole integration: one script on the site you already run.
          </p>
          <ul className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
            {[
              "No rebuild, no iframe takeover",
              "Themed with your tokens",
              "Cards rendered by the wrapper",
              "Same gateway, guardrails and audit",
            ].map((item) => (
              <li key={item} className="flex gap-1.5">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-[var(--site-accent)]" strokeWidth={3} />
                {item}
              </li>
            ))}
          </ul>
          {capture ? null : (
            <>
              <a
                href={WRAPPER_DEMO_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-3.5 flex items-center justify-between gap-2 rounded-lg bg-[var(--site-deep)] px-3 py-2 text-[11px] font-semibold text-[#efe9d8] transition-transform hover:-translate-y-0.5"
              >
                <span>Try the real wrapper on a live page</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                A real page with the actual embed script, talking to the live agent backend.
              </p>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-border/80 bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Generative UI</p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Try the prompts in the panel. Each answer returns a schema — <span className="font-mono text-[10px]">order_tracker.v1</span>,{" "}
            <span className="font-mono text-[10px]">refund_card.v2</span>, <span className="font-mono text-[10px]">form.address.v3</span> — that the
            wrapper renders as an interface.
          </p>
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            The same schemas land in WhatsApp and in the mobile app above.
          </p>
        </div>
        {capture ? <span className="sr-only">{CAPTIONS[step].facts.join(" · ")}</span> : null}
      </div>
    </div>
  );
}

function SitePage({ page }: { page: Page }) {
  if (page === "shop") {
    return (
      <div className="max-w-[62%]">
        <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Shop · 42 items</p>
        <h3 className="font-display mt-1 text-[22px] leading-tight">Beds, lighting, kitchen.</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { name: "Mwanza bed frame", price: "TZS 1,240,000" },
            { name: "Pendant light", price: "TZS 145,000" },
            { name: "Clay dinner set", price: "TZS 92,000" },
          ].map((item) => (
            <div key={item.name} className="rounded-lg border border-border/80 bg-card p-2">
              <div className="h-12 rounded bg-[var(--site-bg)]" />
              <p className="mt-1.5 text-[9.5px] font-medium leading-snug">{item.name}</p>
              <p className="font-mono text-[8.5px] text-muted-foreground">{item.price}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (page === "orders") {
    return (
      <div className="max-w-[62%]">
        <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Account · Amina Juma</p>
        <h3 className="font-display mt-1 text-[22px] leading-tight">Your orders</h3>
        <div className="mt-3 space-y-2">
          {[
            { id: "AC-8841", status: "Out for delivery", meta: "Arrives tomorrow · 09:00–12:00", tone: "green" as const },
            { id: "AC-8790", status: "Delivered", meta: "12 Nov 2026 · receipt sent by email", tone: "neutral" as const },
          ].map((order) => (
            <div key={order.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-card px-2.5 py-2">
              <div>
                <p className="text-[10px] font-semibold">{order.id}</p>
                <p className="text-[8.5px] text-muted-foreground">{order.meta}</p>
              </div>
              <Pill tone={order.tone}>{order.status}</Pill>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (page === "help") {
    return (
      <div className="max-w-[62%]">
        <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Help centre</p>
        <h3 className="font-display mt-1 text-[22px] leading-tight">How can we help?</h3>
        <div className="mt-3 space-y-1.5">
          {["Delivery times and tracking", "Returns and refunds", "Changing an order"].map((item) => (
            <div key={item} className="flex items-center justify-between rounded-lg border border-border/80 bg-card px-2.5 py-2 text-[9.5px]">
              {item}
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[62%]">
      <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Dar es Salaam · delivery in 24h</p>
      <h3 className="font-display mt-1 text-[24px] leading-tight">Everything for the home.</h3>
      <p className="mt-1.5 max-w-[250px] text-[10.5px] leading-relaxed text-muted-foreground">
        Free delivery over TZS 100,000 · 14-day returns · pay with M-Pesa or card.
      </p>
      <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-[var(--site-accent)] px-3 py-1.5 text-[9.5px] font-semibold text-[var(--site-on-accent)]">
        Shop the collection <ArrowRight className="h-3 w-3" />
      </span>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {["Beds", "Lighting", "Kitchen"].map((item) => (
          <div key={item} className="rounded-lg border border-border/80 bg-card p-2">
            <div className="h-10 rounded bg-[var(--site-bg)]" />
            <p className="mt-1 text-[8.5px] font-medium">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return (
    <div
      className={
        side === "right"
          ? "ml-auto w-fit max-w-[84%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-2.5 py-1.5 text-[10.5px] leading-relaxed shadow-sm"
          : "w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-white px-2.5 py-1.5 text-[10.5px] leading-relaxed shadow-sm"
      }
    >
      {children}
    </div>
  );
}

function WidgetBubble({ side, children }: { side: "left" | "right"; children: ReactNode }) {
  return (
    <div
      className={
        side === "right"
          ? "ml-auto w-fit max-w-[88%] rounded-xl rounded-tr-sm bg-[var(--site-accent)] px-2 py-1 text-[9.5px] leading-relaxed text-[var(--site-on-accent)]"
          : "w-fit max-w-[92%] rounded-xl rounded-tl-sm border border-border/70 bg-card px-2 py-1 text-[9.5px] leading-relaxed"
      }
    >
      {children}
    </div>
  );
}

function OrderCard({ compact = false }: { compact?: boolean }) {
  const labels = ["Ordered", "Packed", "Shipped", "Out for delivery", "Delivered"];
  return (
    <div className="w-full rounded-xl border border-border/80 bg-card p-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">order_tracker.v1</span>
        <Pill tone="green">out for delivery</Pill>
      </div>
      <p className="mt-1 text-[11px] font-semibold">Order AC-8841</p>
      <p className="text-[9px] text-muted-foreground">Arrives tomorrow · 09:00–12:00</p>
      <div className="mt-2 flex gap-1">
        {labels.map((label, index) => (
          <span
            key={label}
            className={`h-1 flex-1 rounded-full ${index <= 3 ? "bg-[var(--site-accent)]" : "bg-border"}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[7.5px] text-muted-foreground">
        <span>Ordered</span>
        <span>Out for delivery</span>
        <span>Delivered</span>
      </div>
      {!compact ? <p className="mt-1.5 text-[8.5px] text-muted-foreground">Courier: Vela Express · Dar es Salaam</p> : null}
    </div>
  );
}

function RefundCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="w-full rounded-xl border border-border/80 bg-card p-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">refund_card.v2</span>
        <Pill tone="amber">queued</Pill>
      </div>
      <p className="mt-1 text-[13px] font-semibold">TZS 45,000</p>
      <p className="text-[9px] text-muted-foreground">Duplicate charge · 14 Nov 2026</p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border/70">
        <div className="h-full w-2/3 rounded-full bg-[var(--site-accent)]" />
      </div>
      <p className="mt-1 text-[8.5px] text-muted-foreground">3–5 working days · confirmation on WhatsApp</p>
      {!compact ? (
        <p className="mt-1.5 flex items-center gap-1 border-t border-border/60 pt-1.5 text-[8.5px] text-muted-foreground">
          <ShieldCheck className="h-2.5 w-2.5" /> Above-limit refunds pause for approval (APR-2040)
        </p>
      ) : null}
    </div>
  );
}

function AddressCard({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const [street, setStreet] = useState("Msasani Road 12");
  const [city, setCity] = useState("Dar es Salaam");
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="w-full rounded-xl border border-border/80 bg-card p-2.5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(true);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">form.address.v3</span>
        <Pill tone="blue">validated</Pill>
      </div>
      <div className="mt-1.5 space-y-1.5">
        <div>
          <label htmlFor={`${id}-street`} className="text-[8px] font-medium text-muted-foreground">
            Street
          </label>
          <input
            id={`${id}-street`}
            value={street}
            onChange={(event) => {
              setStreet(event.target.value);
              setSaved(false);
            }}
            className="mt-0.5 w-full rounded-md border border-border bg-[var(--site-bg)]/60 px-1.5 py-1 text-[9.5px] outline-none focus:border-[var(--site-accent)]/50"
          />
        </div>
        <div>
          <label htmlFor={`${id}-city`} className="text-[8px] font-medium text-muted-foreground">
            City
          </label>
          <input
            id={`${id}-city`}
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              setSaved(false);
            }}
            className="mt-0.5 w-full rounded-md border border-border bg-[var(--site-bg)]/60 px-1.5 py-1 text-[9.5px] outline-none focus:border-[var(--site-accent)]/50"
          />
        </div>
      </div>
      <button
        type="submit"
        className="mt-1.5 w-full rounded-md bg-[var(--site-accent)] py-1 text-[9px] font-semibold text-[var(--site-on-accent)]"
      >
        {saved ? "Saved · courier notified" : "Save address"}
      </button>
      {saved ? (
        <p className="mt-1 flex items-center gap-1 text-[8.5px] text-[var(--site-accent)]">
          <Check className="h-2.5 w-2.5" /> Order AC-8841 rerouted · audit entry written
        </p>
      ) : null}
      {!compact && !saved ? (
        <p className="mt-1 flex items-center gap-1 text-[8px] text-muted-foreground">
          <MapPin className="h-2.5 w-2.5" /> Scoped write: orders.update only
        </p>
      ) : null}
    </form>
  );
}