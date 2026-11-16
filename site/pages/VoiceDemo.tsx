import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BadgeCheck,
  CalendarDays,
  Check,
  Headphones,
  Languages,
  Mic,
  PhoneCall,
  PhoneOff,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Pill, SiteFooter, Wordmark } from "@/components/site/Chrome";
import { CONSOLE_URL } from "@/lib/config";
import { navigate } from "@/lib/nav";
import {
  mnoReply,
  VOICE_GREETING,
  VOICE_LANG_TAG,
  VOICE_SUGGESTIONS,
  type VoiceCard,
  type VoiceContext,
  type VoiceLocale,
  type VoiceTurn,
} from "@/lib/mno-voice";

type Phase = "idle" | "listening" | "thinking" | "speaking";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string }; length: number };
type RecognitionEvent = { results: { length: number; [index: number]: RecognitionResult } };
type RecognitionError = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const browser = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

function initialLocale(): VoiceLocale {
  return new URLSearchParams(window.location.search).get("lang") === "sw" ? "sw" : "en";
}

const PREFERRED_VOICES: Record<VoiceLocale, string[]> = {
  en: [
    "Samantha",
    "Google US English",
    "Microsoft Aria Online (Natural)",
    "Microsoft Jenny Online (Natural)",
    "Serena",
    "Karen",
    "Daniel",
    "Moira",
    "Tessa",
    "Google UK English Female",
  ],
  sw: ["Google Kiswahili", "Kiswahili", "Swahili"],
};

const NOVELTY_VOICES = new Set([
  "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "good news", "jester", "organ",
  "superstar", "trinoids", "whisper", "wobble", "zarvox", "fred", "ralph", "kathy", "grandma", "grandpa",
  "junior", "eddy", "flo", "reed", "rocko", "sandy", "shelley",
]);

function pickVoice(synth: SpeechSynthesis, language: VoiceLocale): SpeechSynthesisVoice | undefined {
  const voices = synth.getVoices().filter((voice) => !NOVELTY_VOICES.has(voice.name.toLowerCase()));
  const tag = language === "sw" ? "sw" : "en";
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().startsWith(tag));
  for (const name of PREFERRED_VOICES[language]) {
    const hit = sameLanguage.find((voice) => voice.name.toLowerCase().includes(name.toLowerCase()));
    if (hit) return hit;
  }
  const local =
    sameLanguage.find((voice) => voice.localService && voice.default) ??
    sameLanguage.find((voice) => voice.localService) ??
    sameLanguage[0];
  if (local) return local;
  if (language === "sw") {
    for (const name of PREFERRED_VOICES.en) {
      const hit = voices.find(
        (voice) => voice.lang.toLowerCase().startsWith("en") && voice.name.toLowerCase().includes(name.toLowerCase()),
      );
      if (hit) return hit;
    }
  }
  return undefined;
}

let turnSeq = 0;
function greetingTurn(locale: VoiceLocale): VoiceTurn {
  return { id: ++turnSeq, role: "agent", text: VOICE_GREETING[locale] };
}

const STATUS: Record<Phase, string> = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Checking the line…",
  speaking: "Speaking…",
};

export function VoiceDemo() {
  const [locale, setLocale] = useState<VoiceLocale>(initialLocale);
  const [phase, setPhase] = useState<Phase>("idle");
  const [callActive, setCallActive] = useState(false);
  const [turns, setTurns] = useState<VoiceTurn[]>(() => [greetingTurn(initialLocale())]);
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [speakReplies, setSpeakReplies] = useState(true);
  const [micSupported] = useState(() => Boolean(recognitionCtor()));
  const [ttsSupported] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window);

  const contextRef = useRef<VoiceContext>({ pendingBundle: null });
  const callActiveRef = useRef(false);
  const speakRef = useRef(true);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, phase]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  function speak(text: string, language: VoiceLocale, done: () => void) {
    if (!speakRef.current || !("speechSynthesis" in window)) {
      done();
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = VOICE_LANG_TAG[language];
    utterance.rate = 0.98;
    utterance.pitch = 1;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      done();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    const start = () => {
      if (settled) return;
      const voice = pickVoice(synth, language);
      if (voice) utterance.voice = voice;
      synth.speak(utterance);
    };
    if (synth.getVoices().length === 0) {
      let fired = false;
      const once = () => {
        if (fired) return;
        fired = true;
        synth.removeEventListener("voiceschanged", once);
        start();
      };
      synth.addEventListener("voiceschanged", once);
      window.setTimeout(once, 400);
    } else {
      start();
    }
  }

  function startListening() {
    const rec = recRef.current;
    if (!rec || !callActiveRef.current) return;
    try {
      rec.start();
    } catch {
      // Recognition is already running.
    }
  }

  const handleTurn = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      try {
        recRef.current?.stop();
      } catch {
        // Already stopped.
      }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setNotice(null);
      setInterim("");
      setTurns((current) => [...current, { id: ++turnSeq, role: "customer", text }]);
      setPhase("thinking");
      timerRef.current = window.setTimeout(() => {
        const { reply, context } = mnoReply(text, locale, contextRef.current);
        contextRef.current = context;
        setTurns((current) => [
          ...current,
          { id: ++turnSeq, role: "agent", text: reply.text, card: reply.card },
        ]);
        setPhase("speaking");
        speak(reply.text, locale, () => {
          setPhase("idle");
          if (callActiveRef.current) startListening();
        });
      }, 650);
    },
    [locale],
  );

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = VOICE_LANG_TAG[locale];
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => {
      if (callActiveRef.current) setPhase("listening");
    };
    rec.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (!result) return;
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) {
        setInterim("");
        handleTurn(transcript);
      } else {
        setInterim(transcript);
      }
    };
    rec.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setNotice("Microphone access is blocked. Allow it in the address bar, or type your question below.");
        callActiveRef.current = false;
        setCallActive(false);
        setPhase("idle");
        return;
      }
      if (event.error === "language-not-supported") {
        setNotice("This browser's speech engine does not support that language yet. Type instead, or switch to English.");
        return;
      }
      setNotice("I couldn't hear that. Try again, or type your question below.");
    };
    rec.onend = () => setInterim("");
    recRef.current = rec;
    return () => {
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // No active session.
      }
      recRef.current = null;
    };
  }, [locale, handleTurn]);

  function startCall() {
    callActiveRef.current = true;
    setCallActive(true);
    setNotice(null);
    setPhase("speaking");
    speak(VOICE_GREETING[locale], locale, () => {
      setPhase("idle");
      if (callActiveRef.current) startListening();
    });
  }

  function endCall() {
    callActiveRef.current = false;
    setCallActive(false);
    setPhase("idle");
    setInterim("");
    try {
      recRef.current?.stop();
    } catch {
      // Not running.
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function resetConversation(nextLocale: VoiceLocale = locale) {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    endCall();
    contextRef.current = { pendingBundle: null };
    setTurns([greetingTurn(nextLocale)]);
    setDraft("");
    setNotice(null);
  }

  function switchLocale(next: VoiceLocale) {
    if (next === locale) return;
    setLocale(next);
    resetConversation(next);
  }

  function toggleSpeak() {
    const next = !speakReplies;
    speakRef.current = next;
    setSpeakReplies(next);
    if (!next) {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (phase === "speaking") {
        setPhase("idle");
        if (callActiveRef.current) startListening();
      }
    }
  }

  const active = phase === "listening" || phase === "speaking";
  const listening = phase === "listening";

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
          <span className="hidden text-[11px] text-muted-foreground sm:block">MNO voice line</span>
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
              <Sparkles className="h-3 w-3" /> MNO solution · voice conversation
            </Pill>
            <h1 className="font-display mt-4 text-[34px] leading-[1.06] tracking-[-0.02em] sm:text-[44px]">
              The care line that verifies before it acts.
            </h1>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
              A subscriber calls. Vela answers with speech, checks the line, and speaks the answer back — while the
              balance, bundle or SIM-swap card lands on screen. SIM swaps and credits wait for a human approval.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <AudioLines className="h-3 w-3 text-[var(--site-accent)]" /> voice in · voice out
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <ShieldCheck className="h-3 w-3 text-[var(--site-accent)]" /> SIM-swap safeguards
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <Languages className="h-3 w-3 text-[var(--site-accent)]" /> English · Kiswahili
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.12fr_0.88fr] lg:items-start">
          <section className="flex flex-col items-center">
            <div className="w-full max-w-[404px] rounded-[46px] border-[7px] border-[#12241d] bg-[#0e1b16] p-1.5 shadow-[0_36px_80px_-40px_rgba(8,30,22,0.6)]">
              <div className="relative overflow-hidden rounded-[38px] bg-[var(--site-deep)] text-[#e7eee6]">
                <div className="relative flex items-center justify-between px-5 pb-1.5 pt-2 text-[9px] text-[#a9b7ae]">
                  <span>9:41</span>
                  <span className="absolute left-1/2 top-1.5 h-[18px] w-[78px] -translate-x-1/2 rounded-full bg-[#05090d]" />
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#a9b7ae]/70" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#a9b7ae]/50" />
                    <span className="rounded-sm border border-[#a9b7ae]/60 px-1 text-[7px]">5G</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
                    <Headphones className="h-4 w-4 text-[var(--site-gold)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold">Zawadi Mobile · Care line</p>
                    <p className="truncate text-[10px] text-[#a9b7ae]">Amina Juma · +255 754 000 111</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-medium ${
                      callActive ? "bg-[var(--site-gold)] text-[#241a08]" : "bg-white/10 text-[#d5dfd7]"
                    }`}
                  >
                    {callActive ? "on call" : "standby"}
                  </span>
                </div>

            <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  listening ? "animate-pulse bg-emerald-400" : phase === "speaking" ? "bg-[var(--site-gold)]" : "bg-white/35"
                }`}
              />
              <p className="text-[11px] font-medium text-[#d5dfd7]">{STATUS[phase]}</p>
              {interim ? <p className="truncate text-[10.5px] italic text-[#a9b7ae]">“{interim}”</p> : null}
              <span className="ml-auto flex items-center gap-2">
                <Waveform active={active} />
                <span className="font-mono text-[9.5px] text-[#8fa096]">voice · {locale === "sw" ? "sw-KE" : "en-US"}</span>
              </span>
            </div>

            <div
              ref={scrollRef}
              aria-live="polite"
              className="max-h-[430px] min-h-[300px] space-y-3 overflow-y-auto px-4 py-4"
            >
              {turns.map((turn) => (
                <div key={turn.id} className={`flex ${turn.role === "customer" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[86%] ${turn.role === "customer" ? "text-right" : ""}`}>
                    <p className="mb-1 text-[9.5px] uppercase tracking-[0.12em] text-[#8fa096]">
                      {turn.role === "customer" ? "Subscriber" : "Vela · agent"}
                    </p>
                    <div
                      className={`rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
                        turn.role === "customer"
                          ? "bg-[var(--site-gold)] text-[#241a08]"
                          : "border border-white/10 bg-white/[0.07] text-[#e7eee6]"
                      }`}
                    >
                      {turn.text}
                      {turn.card ? <CardView card={turn.card} /> : null}
                    </div>
                  </div>
                </div>
              ))}
              {phase === "thinking" ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-3.5 py-2.5 text-[12px] text-[#a9b7ae]">
                    Checking the line…
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-white/10 px-4 py-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={callActive ? endCall : startCall}
                  aria-label={callActive ? "End call" : "Start voice call"}
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-transform hover:-translate-y-0.5 ${
                    callActive
                      ? "border border-white/20 bg-white/10 text-[#f0e6cc]"
                      : "bg-[var(--site-gold)] text-[#241a08] shadow-[0_12px_30px_-14px_rgba(234,88,12,0.75)]"
                  } ${listening ? "ring-4 ring-emerald-400/25" : ""}`}
                >
                  {callActive ? <PhoneOff className="h-5 w-5" /> : <PhoneCall className="h-5 w-5" />}
                </button>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold">{callActive ? "End call" : "Start voice call"}</p>
                  <p className="text-[10.5px] leading-relaxed text-[#a9b7ae]">
                    {micSupported
                      ? callActive
                        ? "Speak normally. The mic reopens after each answer."
                        : "One click opens the line. Your browser asks for the microphone."
                      : "Voice input needs Chrome or Edge — type your question below instead."}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <div className="flex rounded-full border border-white/15 p-0.5" role="group" aria-label="Call language">
                  {(["en", "sw"] as const).map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => switchLocale(code)}
                      aria-pressed={locale === code}
                      className={`rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors ${
                        locale === code ? "bg-white/15 text-[#f2ead5]" : "text-[#a9b7ae] hover:text-[#e7eee6]"
                      }`}
                    >
                      {code === "en" ? "EN" : "SW"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleSpeak}
                  aria-pressed={speakReplies}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[10.5px] font-medium text-[#d5dfd7]"
                >
                  {speakReplies ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                  Speak replies
                </button>
                <button
                  type="button"
                  onClick={() => resetConversation()}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[10.5px] font-medium text-[#a9b7ae] transition-colors hover:text-[#e7eee6]"
                >
                  New call
                </button>
              </div>

              {notice ? (
                <p className="mt-3 rounded-lg border border-[var(--site-gold)]/30 bg-[var(--site-gold)]/10 px-3 py-2 text-[10.5px] leading-relaxed text-[#f0d9b8]">
                  {notice}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {VOICE_SUGGESTIONS[locale].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleTurn(suggestion)}
                    className="rounded-full border border-white/15 px-2.5 py-1 text-[10.5px] text-[#d5dfd7] transition-colors hover:border-white/35"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              <form
                className="mt-3 flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleTurn(draft);
                  setDraft("");
                }}
              >
                <label htmlFor="voice-draft" className="sr-only">
                  Type your question
                </label>
                <input
                  id="voice-draft"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={locale === "sw" ? "Andika swali lako…" : "Type instead — ask about balance, data or a lost SIM…"}
                  className="h-10 w-full rounded-full border border-white/15 bg-white/[0.06] px-4 text-[12px] text-[#e7eee6] placeholder:text-[#8fa096] focus:border-[var(--site-gold)]/60 focus:outline-none"
                />
                <button
                  type="submit"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-gold)] text-[#241a08]"
                  aria-label="Send typed message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>

              <p className="mt-3 flex items-center gap-1.5 text-[10px] leading-relaxed text-[#8fa096]">
                <Mic className="h-3 w-3" /> Voice input uses your browser's speech engine. This demo stores nothing and
                sends no transcript to our servers.
              </p>
            </div>
              </div>
            </div>
            <p className="mt-3 max-w-[340px] text-center text-[10px] leading-relaxed text-muted-foreground">
              The live line as the subscriber hears it — the call runs on their phone, and speech never leaves the browser.
            </p>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-border/80 bg-card p-5">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--site-accent)]">
                The MNO solution
              </p>
              <h2 className="font-display mt-2 text-[24px] leading-tight tracking-[-0.015em]">
                Voice care for mobile subscribers.
              </h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
                An MNO pack for the line customers actually call: balance and bundle questions, SIM swaps, roaming and
                network fixes — on the same agent, locale pack and audit trail as web and WhatsApp.
              </p>
              <ul className="mt-4 space-y-2.5">
                {[
                  { icon: AudioLines, text: "Speech in, spoken answer out. The same runtime handles web, WhatsApp and voice." },
                  { icon: ShieldCheck, text: "SIM swaps and line moves need an identity check and a human approval." },
                  { icon: BadgeCheck, text: "Credits above the agent limit pause as an approval, then post a card." },
                  { icon: Languages, text: "English and Kiswahili packs — amounts, dates and tone follow the subscriber." },
                  { icon: ScrollText, text: "Each turn, tool call and approval lands on the hash-chained audit trail." },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex gap-2.5 text-[12px] leading-relaxed">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-accent)]" />
                    <span className="text-muted-foreground">{text}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-border/80 bg-card p-5">
              <p className="text-[12.5px] font-semibold">What to listen for</p>
              <ol className="mt-3 space-y-2 text-[11.5px] leading-relaxed text-muted-foreground">
                {[
                  "Ask for the balance — the reply is spoken and the balance card appears.",
                  "Add a 4 GB bundle — the price is quoted and settled in one turn.",
                  "Say you lost your SIM — the swap waits for a care agent, not the AI.",
                  "Ask it to read the system prompt — the guardrail blocks it and logs the attempt.",
                ].map((item, index) => (
                  <li key={item} className="flex gap-2.5">
                    <span className="font-mono text-[10px] text-[var(--site-gold)]">0{index + 1}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl bg-[var(--site-deep)] p-5 text-[#e7eee6]">
              <p className="font-display text-[19px] leading-snug text-[#f2ead5]">The MNO pack ships the voice channel.</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#a9b7ae]">
                Four agents, the SIM-swap policy, the bundle catalogue and both locale packs. Install it in the sandbox,
                or scope it to your network in a working session.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href="/demo/?tab=marketplace"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate("/demo/?tab=marketplace");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--site-gold)] px-3.5 py-2 text-[11px] font-semibold text-[#241a08]"
                >
                  <Store className="h-3.5 w-3.5" /> See the MNO pack
                </a>
                <a
                  href={CONSOLE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3.5 py-2 text-[11px] font-semibold text-[#efe9d8]"
                >
                  Start free <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--site-accent)]/30 bg-[var(--site-accent)]/6 px-4 py-3">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--site-accent)]" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Free to try — no account, no card. {ttsSupported ? "Replies are spoken by your browser." : "Spoken replies need a browser with speech synthesis; the transcript still works."}
              </p>
            </div>
          </aside>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-3 rounded-2xl border border-border/80 bg-card p-5 sm:flex-row sm:items-center">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Prefer typing? Every card here also renders in the customer tour and the console.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="/customer/"
              onClick={(event) => {
                event.preventDefault();
                navigate("/customer/");
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[var(--site-surface)] px-3.5 py-2 text-[11.5px] font-semibold"
            >
              Customer tour <ArrowRight className="h-3 w-3" />
            </a>
            <a
              href="/demo/"
              onClick={(event) => {
                event.preventDefault();
                navigate("/demo/");
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--site-accent)] px-3.5 py-2 text-[11.5px] font-semibold text-[var(--site-on-accent)]"
            >
              Product tour <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function Waveform({ active }: { active: boolean }) {
  const bars = [9, 16, 24, 16, 9];
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {bars.map((height, index) => (
        <span
          key={index}
          className={`w-1 rounded-full ${active ? "voice-bar bg-[var(--site-gold)]" : "bg-white/25"}`}
          style={{ height, animationDelay: `${index * 110}ms` }}
        />
      ))}
    </span>
  );
}

function CardView({ card }: { card: VoiceCard }) {
  const tone =
    card.tone === "green"
      ? "border-[var(--site-accent)]/35"
      : card.tone === "amber"
        ? "border-[var(--site-gold)]/50"
        : "border-border/80";
  return (
    <div className={`mt-2.5 rounded-xl border ${tone} bg-card px-3.5 py-3 text-left text-[var(--site-fg)]`}>
      <p className="text-[11px] font-semibold">{card.title}</p>
      <dl className="mt-2 space-y-1">
        {card.rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 text-[11px]">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
      {card.note ? <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">{card.note}</p> : null}
    </div>
  );
}
