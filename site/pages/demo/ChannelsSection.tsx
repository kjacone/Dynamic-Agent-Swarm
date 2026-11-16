import { useState } from "react";
import { ArrowRight, AtSign, Check, Globe2, Mail, MessageCircle, ShieldCheck, Smartphone } from "lucide-react";
import { CHANNELS, WRAPPER_EXAMPLES } from "@/data/demo";
import { Pill } from "@/components/site/Chrome";
import { DemoBadge, Mono, Panel, PanelHeader, SectionHeading } from "./ui";

type ChannelId = "web" | "whatsapp" | "sms";

const CHANNEL_ICONS = {
  web: Globe2,
  whatsapp: MessageCircle,
  sms: Smartphone,
  instagram: AtSign,
  email: Mail,
} as const;

const SNIPPET = `<script src="https://cdn.vela.example/embed.js"
  data-agent="concierge" data-locale="sw-TZ"
  data-channel="web"></script>`;

function RefundCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">refund_card.v2</p>
        <Pill tone="green">approved</Pill>
      </div>
      <p className="mt-2 text-[13px] font-semibold">Refund · TZS 45,000</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Duplicate charge · order AC-8841</p>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--site-accent)] text-[var(--site-on-accent)]">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        <span className="text-[10.5px] text-muted-foreground">Approved by ops · arrives in 3–5 days</span>
      </div>
    </div>
  );
}

function OrderTracker() {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">order_tracker.v1</p>
        <Mono>AC-8841</Mono>
      </div>
      <div className="mt-2.5 flex items-center gap-1">
        {["Packed", "Picked", "In transit", "Out for delivery"].map((step, index) => (
          <div key={step} className="flex flex-1 flex-col items-center gap-1">
            <span
              className={`h-1.5 w-full rounded-full ${index < 3 ? "bg-[var(--site-accent)]" : "bg-border"}`}
            />
            <span className={`text-[8.5px] ${index < 3 ? "text-foreground" : "text-muted-foreground"}`}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnboardingForm() {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">form.onboarding.v3</p>
        <Mono>2 of 3</Mono>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="rounded-md border border-border bg-[var(--site-bg)]/60 px-2 py-1.5 text-[11px]">Jina kamili · Full name</div>
        <div className="rounded-md border border-[var(--site-accent)]/40 bg-[var(--site-bg)]/60 px-2 py-1.5 text-[11px]">
          Namba ya simu · Phone number
        </div>
        <div className="rounded-md bg-[var(--site-accent)] px-2 py-1.5 text-center text-[11px] font-semibold text-[var(--site-on-accent)]">
          Endelea · Continue
        </div>
      </div>
    </div>
  );
}

const CARDS = { refund: RefundCard, order: OrderTracker, form: OnboardingForm } as const;

export function ChannelsSection() {
  const [channel, setChannel] = useState<ChannelId>("whatsapp");
  const [example, setExample] = useState<(typeof WRAPPER_EXAMPLES)[number]["id"]>("refund");
  const Card = CARDS[example];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Wrappers & channels"
          description="The same agent, guardrails and audit trail answer on the web widget, WhatsApp and SMS. Wrappers render generative UI — cards, trackers and forms — instead of walls of text."
        />
        <DemoBadge />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Live wrapper preview"
            meta={<Mono>agent: concierge · locale: sw-TZ</Mono>}
            action={
              <div className="flex gap-1">
                {(["web", "whatsapp", "sms"] as ChannelId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChannel(id)}
                    className={`rounded-full px-2.5 py-1 text-[10.5px] capitalize transition-colors ${
                      channel === id
                        ? "bg-[var(--site-accent)] font-semibold text-[var(--site-on-accent)]"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {id === "sms" ? "SMS" : id === "web" ? "Web" : "WhatsApp"}
                  </button>
                ))}
              </div>
            }
          />

          <div className={`px-4 py-4 ${channel === "whatsapp" ? "bg-[#e7e0d2]" : channel === "sms" ? "bg-[var(--site-bg)]" : "bg-[var(--site-bg)]/50"}`}>
            <div className={`mx-auto max-w-sm overflow-hidden rounded-xl border shadow-sm ${channel === "whatsapp" ? "border-[#c9c2b2] bg-[#efe7d9]" : "border-border bg-card"}`}>
              <div className={`flex items-center gap-2 px-3 py-2 ${channel === "whatsapp" ? "bg-[#075e54] text-white" : "border-b border-border/70"}`}>
                <span className={`flex h-6 w-6 items-center justify-center rounded-full ${channel === "whatsapp" ? "bg-white/20" : "bg-[var(--site-accent)]/10"}`}>
                  <MessageCircle className={`h-3.5 w-3.5 ${channel === "whatsapp" ? "" : "text-[var(--site-accent)]"}`} />
                </span>
                <div className="leading-tight">
                  <p className="text-[11px] font-semibold">{channel === "whatsapp" ? "Acme Care · WhatsApp" : channel === "sms" ? "Acme Care · SMS" : "Acme support"}</p>
                  <p className={`text-[9.5px] ${channel === "whatsapp" ? "text-white/70" : "text-muted-foreground"}`}>
                    {channel === "whatsapp" ? "online · +255 754 000 111" : "agent: concierge"}
                  </p>
                </div>
              </div>

              <div className={`space-y-2 px-3 py-3 ${channel === "sms" ? "font-mono" : ""}`}>
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-[#dcf8c6] px-3 py-1.5 text-[11.5px] leading-snug text-[#1f2a1f]">
                  Nimetozwa mara mbili kwa oda AC-8841. Unaweza kuangalia?
                  <span className="mt-0.5 block text-right text-[8.5px] text-[#5b6b5b]">09:41 ✓✓</span>
                </div>
                <div className={`w-fit max-w-[92%] rounded-2xl rounded-tl-sm px-3 py-1.5 text-[11.5px] leading-snug ${channel === "whatsapp" ? "bg-white text-[#1f2a1f]" : "border border-border bg-card"}`}>
                  Nimeona malipo mawili ya TZS 45,000 tarehe 14 Novemba. Nimeweka ombi la kurejesha malipo ya ziada.
                  <span className="mt-0.5 block text-[8.5px] opacity-60">09:41</span>
                </div>
                <div className="w-fit max-w-[92%]">
                  <Card />
                </div>
                <div className={`w-fit max-w-[92%] rounded-2xl rounded-tl-sm px-3 py-1.5 text-[11.5px] ${channel === "whatsapp" ? "bg-white" : "border border-border bg-card"}`}>
                  Nitakuthibitishia hapa baada ya kukamilika. Kuna kingine?
                  <span className="mt-0.5 block text-[8.5px] opacity-60">09:42</span>
                </div>
              </div>

              <div className={`flex items-center gap-2 border-t px-3 py-2 ${channel === "whatsapp" ? "border-[#d8d0c0] bg-white/70" : "border-border/70"}`}>
                <span className="flex-1 rounded-full border border-border/70 bg-white/60 px-2.5 py-1 text-[10px] text-muted-foreground">
                  {channel === "sms" ? "Reply with 1 to confirm" : "Andika ujumbe…"}
                </span>
                <span className="rounded-full bg-[var(--site-accent)] px-2 py-1 text-[9px] font-semibold text-[var(--site-on-accent)]">
                  Send
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-border/70 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Generative UI schema</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {WRAPPER_EXAMPLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setExample(item.id)}
                  className={`rounded-full border px-2.5 py-1 text-[10.5px] transition-colors ${
                    example === item.id
                      ? "border-[var(--site-accent)]/45 bg-[var(--site-accent)]/8 text-[var(--site-accent)]"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
              {WRAPPER_EXAMPLES.find((item) => item.id === example)?.detail}
            </p>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Connected channels" meta={<Pill tone="green">3 live</Pill>} />
            <div className="divide-y divide-border/70">
              {CHANNELS.map((item) => {
                const Icon = CHANNEL_ICONS[item.id as keyof typeof CHANNEL_ICONS] ?? Globe2;
                return (
                  <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--site-accent)]/8 text-[var(--site-accent)]">
                      <Icon className="h-4 w-4" strokeWidth={1.7} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12px] font-medium">{item.name}</p>
                        <Pill tone={item.status === "live" ? "green" : "neutral"}>{item.status}</Pill>
                      </div>
                      <p className="text-[10.5px] leading-snug text-muted-foreground">{item.detail}</p>
                      <p className="mt-0.5 font-mono text-[9.5px] text-muted-foreground">{item.volume}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="border-t border-border/70 px-4 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              One thread per customer. Channel switches keep the history, the guardrail verdicts and the trace id.
            </p>
          </Panel>

          <Panel>
            <PanelHeader title="Web wrapper" meta={<Mono>embed.js</Mono>} />
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{SNIPPET}</pre>
            <div className="flex items-start gap-2 border-t border-border/70 px-4 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The wrapper never holds model keys. Every turn is screened, traced and billed to the tenant.
            </div>
          </Panel>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/demo/?tab=locale";
            }}
            className="flex w-full items-center justify-between rounded-xl border border-border/80 bg-[var(--site-bg)]/60 px-4 py-3 text-left"
          >
            <span>
              <span className="block text-[12px] font-medium">See the same conversation in Kiswahili</span>
              <span className="block text-[10.5px] text-muted-foreground">Localisation packs, formats and review workflow.</span>
            </span>
            <ArrowRight className="h-4 w-4 text-[var(--site-accent)]" />
          </button>
        </div>
      </div>
    </div>
  );
}
