import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  GraduationCap,
  Languages,
  Mic,
  PhoneCall,
  PhoneOff,
  Send,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  API_BASE, api, can, type Agent, type Guardrail, type LocaleProfile, type Me,
  type PolicyDecision, type VoiceStatus,
} from "@/lib/api";
import { PageHeader } from "@/components/common/PageHeader";
import { ProviderKeys } from "@/components/common/ProviderKeys";
import { PhoneFrame } from "@/components/demo/PhoneFrame";
import { Chip, StatusBadge } from "@/components/common/StatusBadge";
import { VoiceStudio } from "@/components/voice/VoiceStudio";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { resolveVoiceCard } from "@/lib/voiceCards";
import { VoiceCall, type VoiceInterrupt } from "@/lib/voiceCall";
import {
  guardrailCard,
  injectionAttempt,
  mnoReply,
  VOICE_GREETING,
  VOICE_LANG_TAG,
  VOICE_SUGGESTIONS,
  type VoiceCard,
  type VoiceContext,
  type VoiceLocale,
  type VoiceTurn,
} from "@/lib/mnoVoice";

type Phase = "idle" | "listening" | "thinking" | "speaking";
type Mode = "agent" | "rehearsal";


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

const STATUS: Record<Phase, string> = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Checking the line…",
  speaking: "Speaking…",
};

let turnSeq = 0;

function greetingTurn(locale: VoiceLocale, override?: string): VoiceTurn {
  return { id: ++turnSeq, role: "agent", text: override?.trim() || VOICE_GREETING[locale] };
}

function pick(locale: VoiceLocale, en: string, sw: string) {
  return locale === "sw" ? sw : en;
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

function policyCard(decision: PolicyDecision, locale: VoiceLocale): VoiceCard {
  const rules = decision.rule_ids.length ? decision.rule_ids.join(", ") : "tenant-policy";
  const approval = decision.action === "require_approval";
  const note = decision.reasons.join("; ") || pick(
    locale,
    approval ? "Nothing changes on the line until an approver signs off." : "The call continues. The attempt is answered, not obeyed.",
    approval ? "Hakuna kinachobadilika kwenye laini hadi mtu aidhinishe." : "Simu inaendelea. Jaribio limejibiwa, halikutii.",
  );
  if (approval) {
    return {
      kind: "guardrail",
      title: pick(locale, "Approval required", "Inahitaji idhini"),
      rows: [
        { label: pick(locale, "Rule", "Kanuni"), value: rules },
        { label: pick(locale, "Action", "Hatua"), value: "require_approval" },
        { label: pick(locale, "Source", "Chanzo"), value: "tenant policy" },
      ],
      note,
      tone: "amber",
    };
  }
  return guardrailCard(locale, rules, "tenant policy", note);
}

function failureCard(message: string): VoiceCard {
  return {
    kind: "guardrail",
    title: "Agent line unavailable",
    rows: [
      { label: "Path", value: "gateway → agent runtime" },
      { label: "Error", value: message.length > 150 ? `${message.slice(0, 147)}…` : message },
    ],
    note: "The call stays open. Retry the turn, or switch to Rehearsal for the scripted MNO flow.",
    tone: "amber",
  };
}

export function Voice({
  me,
  tenant,
  onOpenGuardrails,
  onOpenSolutions,
  onOpenLocale,
}: {
  me: Me | null;
  tenant: string;
  onOpenGuardrails?: () => void;
  onOpenSolutions?: () => void;
  onOpenLocale?: () => void;
}) {
  const policyAccess = can(me, "policies:read");

  const [locale, setLocale] = useState<VoiceLocale>("en");
  const [phase, setPhase] = useState<Phase>("idle");
  const [callActive, setCallActive] = useState(false);
  const [turns, setTurns] = useState<VoiceTurn[]>(() => [greetingTurn("en")]);
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [speakReplies, setSpeakReplies] = useState(true);
  const [guardrails, setGuardrails] = useState<Guardrail[] | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("agent");
  const [micSupported] = useState(() => Boolean(recognitionCtor()));
  const [ttsSupported] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window);
  const [dialects, setDialects] = useState<LocaleProfile[] | null>(null);
  const [dialectId, setDialectId] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [streamVoice, setStreamVoice] = useState(true);

  const contextRef = useRef<VoiceContext>({ pendingBundle: null });
  const callActiveRef = useRef(false);
  const speakRef = useRef(true);
  const busyRef = useRef(false);
  const epochRef = useRef(0);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<Agent | null>(null);
  const modeRef = useRef<Mode>("agent");
  const callRef = useRef<VoiceCall | null>(null);
  const keyRef = useRef<{ id: string; key: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const streamRef = useRef(true);

  const dialect = useMemo(
    () => (dialects ?? []).find((d) => d.id === dialectId) ?? null,
    [dialects, dialectId],
  );
  const dialectRef = useRef<LocaleProfile | null>(null);
  const elevenVoice = Boolean(dialect?.speech?.voice_id) || Boolean(voiceStatus?.configured);
  const greetingText = dialect?.speech?.greeting?.trim() || VOICE_GREETING[locale];

  const busy = phase === "thinking" || phase === "speaking";

  useEffect(() => {
    dialectRef.current = dialect;
  }, [dialect]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    streamRef.current = streamVoice;
  }, [streamVoice]);

  useEffect(() => {
    let live = true;
    api.listAgents(tenant)
      .then((rows) => {
        if (!live) return;
        const installed = rows.find((row) => /mno voice care/i.test(row.name))
          ?? rows.find((row) => /voice care/i.test(row.name))
          ?? null;
        agentRef.current = installed;
        setAgent(installed);
        if (!installed) {
          setMode("rehearsal");
          setAgentError("No MNO Voice Care agent is installed for this tenant, so the line runs the scripted rehearsal flow.");
        }
      })
      .catch((error: Error) => {
        if (!live) return;
        setMode("rehearsal");
        setAgentError(`The agent list could not be loaded (${error.message}). The line runs the scripted rehearsal flow.`);
      });
    return () => { live = false; };
  }, [tenant]);

  useEffect(() => {
    let live = true;
    api.listLocaleProfiles(tenant)
      .then((rows) => { if (live) setDialects(rows); })
      .catch(() => { if (live) setDialects([]); });
    api.voiceStatus()
      .then((s) => { if (live) setVoiceStatus(s); })
      .catch(() => { /* the browser voice still works */ });
    return () => { live = false; };
  }, [tenant]);

  // Prefer the dialect attached to the care agent, else one matching the call language.
  useEffect(() => {
    if (!dialects) return;
    setDialectId((current) => {
      if (current && dialects.some((d) => d.id === current)) return current;
      const attached = agent?.locale_profile_id
        ? dialects.find((d) => d.id === agent.locale_profile_id)
        : undefined;
      if (attached) return attached.id;
      const tag = locale === "sw" ? "sw" : "en";
      const matching = dialects.find((d) => (d.locale_code || "").toLowerCase().startsWith(tag));
      return matching?.id ?? dialects[0]?.id ?? null;
    });
  }, [dialects, agent, locale]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, phase]);

  useEffect(() => {
    if (!policyAccess) return;
    let live = true;
    api.guardrails()
      .then((rows) => { if (live) setGuardrails(rows); })
      .catch(() => { if (live) setPolicyError("The tenant guardrail policy could not be loaded; the preset guard is still active."); });
    return () => { live = false; };
  }, [tenant, policyAccess]);

  useEffect(() => {
    return () => {
      epochRef.current += 1;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      stopSpokenAudio();
      const stored = keyRef.current;
      keyRef.current = null;
      callRef.current = null;
      if (stored) api.revokeKey(stored.id).catch(() => {});
    };
  }, []);

  function stopSpokenAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  /** Play an element, resolving once sound starts. A stalled stream gives up so the caller can fall back. */
  async function playSpoken(audio: HTMLAudioElement, objectUrl: string | null, done: () => void): Promise<boolean> {
    stopSpokenAudio();
    audioRef.current = audio;
    audioUrlRef.current = objectUrl;
    const release = () => {
      if (audioRef.current === audio) audioRef.current = null;
      if (objectUrl && audioUrlRef.current === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        audioUrlRef.current = null;
      }
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      release();
      done();
    };
    audio.onended = finish;
    audio.onerror = finish;
    const started = await Promise.race([
      audio.play().then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 15000)),
    ]);
    if (!started) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      release();
    }
    return started;
  }

  async function speak(text: string, language: VoiceLocale, done: () => void) {
    if (!speakRef.current) {
      done();
      return;
    }
    // The dialect's ElevenLabs voice first; the browser voice is the fallback.
    if (voiceStatus?.configured && text.trim()) {
      const speech = dialectRef.current?.speech ?? {};
      const body = {
        text, profile_id: dialectRef.current?.id, voice_id: speech.voice_id,
        model_id: speech.model_id, stability: speech.stability,
        similarity: speech.similarity, style: speech.style, speed: speech.speed,
      };
      if (streamRef.current) {
        // Streaming: audio starts on the first chunks instead of after the whole file.
        try {
          const ticket = await api.voiceTtsTicket(body);
          if (await playSpoken(new Audio(`${API_BASE}${ticket.url}`), null, done)) return;
        } catch {
          // Fall through to whole-file synthesis.
        }
      }
      try {
        const blob = await api.voiceTts(body);
        const url = URL.createObjectURL(blob);
        if (await playSpoken(new Audio(url), url, done)) return;
      } catch {
        stopSpokenAudio();
        // fall through to the browser voice
      }
    }
    if (!("speechSynthesis" in window)) {
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

  async function ensureCall(): Promise<VoiceCall> {
    const installed = agentRef.current;
    if (!installed) throw new Error("No voice agent is installed for this tenant.");
    if (callRef.current) return callRef.current;
    let stored = keyRef.current;
    if (!stored) {
      const created = await api.createKey({
        name: `voice line · ${installed.name}`.slice(0, 80),
        agent_id: installed.id,
        tenant_id: tenant,
        allowed_origins: [window.location.origin],
        rate_limit_per_min: 120,
      });
      if (!created.key) throw new Error("The call key was created but not returned.");
      stored = { id: created.id, key: created.key };
      keyRef.current = stored;
    }
    const call = new VoiceCall(stored.key);
    callRef.current = call;
    return call;
  }

  async function runAgentTurn(call: VoiceCall, text: string, language: VoiceLocale) {
    let replyText = "";
    let card: VoiceCard | undefined;
    let spoken = "";
    let stream = call.say(text, { channel: "voice-console", locale: language });
    for (let hop = 0; hop < 4; hop += 1) {
      const paused: VoiceInterrupt[] = [];
      for await (const event of stream) {
        if (event.type === "token") replyText += event.text;
        else if (event.type === "interrupt") paused.push(...event.interrupts);
        else if (event.type === "error") throw new Error(event.error || "The agent run failed.");
        else if (event.type === "handoff") throw new Error("A care agent is already handling this conversation.");
      }
      if (!paused.length) break;
      const answers: { interruptId: string; callId: string; result: unknown }[] = [];
      for (const item of paused) {
        const tool = item.value?.tool_call ?? item.value?.toolCall;
        if (!item.id || !tool) throw new Error("The agent paused on a tool call the console cannot answer.");
        let result: unknown;
        if (tool.name === "show_voice_card") {
          const resolved = resolveVoiceCard(tool.args?.kind, tool.args?.bundle, language);
          if (resolved.ok) {
            card = resolved.card;
            spoken = resolved.spoken;
            result = resolved.receipt;
          } else {
            result = { shown: false, error: resolved.error };
          }
        } else {
          result = { shown: false, error: `The console has no handler for ${tool.name}.` };
        }
        answers.push({ interruptId: item.id, callId: tool.id, result });
      }
      stream = call.resumeMany(answers);
    }
    return { text: replyText.trim(), card, spoken };
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
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      const epoch = epochRef.current;
      try {
        recRef.current?.stop();
      } catch {
        // Already stopped.
      }
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      stopSpokenAudio();
      setNotice(null);
      setInterim("");
      setTurns((current) => [...current, { id: ++turnSeq, role: "customer", text }]);
      setPhase("thinking");

      let decision: PolicyDecision | null = null;
      if (policyAccess) {
        try {
          decision = await api.testGuardrail(text, "input");
          setPolicyError(null);
        } catch {
          setPolicyError("The tenant policy check did not answer; the preset guard handled this turn.");
        }
      }
      if (epoch !== epochRef.current) return;

      let replyText: string;
      let card: VoiceCard | undefined;

      if (decision && (decision.action === "block" || decision.action === "require_approval")) {
        card = policyCard(decision, locale);
        replyText = decision.action === "require_approval"
          ? pick(
              locale,
              "A care agent has to approve that first. Nothing changes on your line until they do, and the call stays open.",
              "Msaidizi wa huduma anapaswa kuidhinisha kwanza. Hakuna kinachobadilika kwenye laini yako hadi afanye hivyo, na simu inaendelea.",
            )
          : injectionAttempt(text)
            ? pick(
                locale,
                "I can't read out internal instructions or one-time codes. I can still help with your balance, a bundle, a lost SIM or a network problem.",
                "Siwezi kusoma maagizo ya ndani au namba za siri za mara moja. Bado naweza kukusaidia kuhusu salio, pakiti ya data, SIM iliyopotea au tatizo la mtandao.",
              )
            : pick(
                locale,
                "I can't act on that request on this line. I can still help with your balance, a bundle, a lost SIM or a network problem.",
                "Siwezi kushughulikia ombi hilo kwenye laini hii. Bado naweza kukusaidia kuhusu salio, pakiti ya data, SIM iliyopotea au tatizo la mtandao.",
              );
      } else {
        const effective = decision?.text?.trim() ? decision.text : text;
        if (modeRef.current === "agent" && agentRef.current) {
          try {
            const call = await ensureCall();
            const answered = await runAgentTurn(call, effective, locale);
            replyText = answered.card && answered.spoken
              ? answered.spoken
              : answered.text || pick(locale, "I've put that on the screen.", "Nimeweka hilo kwenye skrini.");
            card = answered.card;
            setAgentError(null);
          } catch (error) {
            const message = error instanceof Error ? error.message : "The agent run failed.";
            setAgentError(message);
            setNotice(message);
            callRef.current = null;
            replyText = pick(
              locale,
              "The care-agent line did not answer that turn. The call is still open — try again, or switch to Rehearsal to see the scripted flow.",
              "Laini ya wakala haikujibu zamu hiyo. Simu bado iko wazi — jaribu tena, au badilisha kuwa Mazoezi kuona mtiririko wa mfano.",
            );
            card = failureCard(message);
          }
        } else {
          const result = mnoReply(effective, locale, contextRef.current);
          contextRef.current = result.context;
          replyText = result.reply.text;
          card = result.reply.card?.kind === "guardrail"
            ? guardrailCard(locale, "preset-no-prompt-leak", "preset")
            : result.reply.card;
        }
      }

      await new Promise((resolve) => window.setTimeout(resolve, 420));
      if (epoch !== epochRef.current) return;

      setTurns((current) => [...current, { id: ++turnSeq, role: "agent", text: replyText, card }]);
      // Training capture: a real agent turn is a candidate correction for the dialect.
      const activeDialect = dialectRef.current;
      if (activeDialect?.training?.capture && modeRef.current === "agent") {
        api.createLocaleExample(activeDialect.id, {
          input: text, corrected_output: replyText, source: "conversation",
          note: "Captured from the voice line",
        }).catch(() => { /* capture must never break the call */ });
      }
      setPhase("speaking");
      speak(replyText, locale, () => {
        busyRef.current = false;
        setPhase("idle");
        if (callActiveRef.current) startListening();
      });
    },
    [locale, policyAccess, tenant],
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
        setNotice("Microphone access is blocked. Allow it in the address bar, or type below.");
        callActiveRef.current = false;
        setCallActive(false);
        setPhase("idle");
        return;
      }
      if (event.error === "language-not-supported") {
        setNotice("This browser's speech engine does not support that language yet. Type instead, or switch to English.");
        return;
      }
      setNotice("I couldn't hear that. Try again, or type below.");
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
    if (callActiveRef.current) return;
    callActiveRef.current = true;
    setCallActive(true);
    setNotice(null);
    if (modeRef.current === "agent" && agentRef.current) {
      ensureCall().catch((error) => {
        const message = error instanceof Error ? error.message : "The call key could not be created.";
        setAgentError(message);
        setNotice(message);
      });
    }
    setPhase("speaking");
    speak(greetingText, locale, () => {
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
    stopSpokenAudio();
  }

  function resetConversation(nextLocale: VoiceLocale = locale) {
    epochRef.current += 1;
    busyRef.current = false;
    endCall();
    callRef.current = null;
    contextRef.current = { pendingBundle: null };
    setTurns([greetingTurn(nextLocale, dialectRef.current?.speech?.greeting)]);
    setDraft("");
    setNotice(null);
  }

  function switchMode(next: Mode) {
    if (next === modeRef.current) return;
    if (next === "agent" && !agentRef.current) return;
    modeRef.current = next;
    setMode(next);
    resetConversation();
  }

  function selectDialect(id: string) {
    const next = (dialects ?? []).find((d) => d.id === id) ?? null;
    setDialectId(id);
    dialectRef.current = next;
    epochRef.current += 1;
    busyRef.current = false;
    endCall();
    callRef.current = null;
    contextRef.current = { pendingBundle: null };
    setTurns([greetingTurn(locale, next?.speech?.greeting)]);
    setDraft("");
    setNotice(null);
  }

  function switchLocale(next: VoiceLocale) {
    if (next === locale) return;
    setLocale(next);
    const tag = next === "sw" ? "sw" : "en";
    const match = (dialects ?? []).find((d) => (d.locale_code || "").toLowerCase().startsWith(tag));
    if (match) setDialectId(match.id);
    resetConversation(next);
  }

  function refreshVoice() {
    api.voiceStatus().then(setVoiceStatus).catch(() => { /* keep the last state */ });
    api.listLocaleProfiles(tenant).then(setDialects).catch(() => { /* keep the last state */ });
  }

  /** Point the selected dialect (and so every new call) at a library or cloned voice. */
  async function useVoiceForDialect(voice: { voice_id: string; name: string }) {
    const current = dialectRef.current;
    if (!current) {
      throw new Error("Create a dialect in the language lab first — the voice needs a profile to speak for.");
    }
    const speech = { ...(current.speech ?? {}), provider: "elevenlabs" as const, voice_id: voice.voice_id };
    const updated = await api.patchLocaleProfile(current.id, { speech });
    setDialects((rows) => rows?.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)) ?? rows);
    dialectRef.current = updated;
  }

  function toggleSpeak() {
    const next = !speakReplies;
    speakRef.current = next;
    setSpeakReplies(next);
    if (!next) {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      stopSpokenAudio();
      if (phase === "speaking") {
        busyRef.current = false;
        setPhase("idle");
        if (callActiveRef.current) startListening();
      }
    }
  }

  const active = phase === "listening" || phase === "speaking";
  const listening = phase === "listening";
  const activeRules = (guardrails ?? []).filter((g) => g.enabled);

  return (
    <div>
      <PageHeader
        icon={PhoneCall}
        title="Voice line"
        description="Answer a subscriber call with speech in and spoken replies. Vela runs as the installed MNO Voice Care agent through the gateway: every turn is policy-screened, the agent asks this page for the account card, and SIM swaps and credits stop for a human."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={micSupported ? "pass" : "warn"} label={micSupported ? "Microphone" : "Type to talk"} />
            <StatusBadge
              value={elevenVoice || ttsSupported ? "pass" : "warn"}
              label={elevenVoice ? `Voice · ${dialect?.name ?? "ElevenLabs"}` : ttsSupported ? "Browser voice" : "Captions only"}
            />
            <StatusBadge
              value={agent && !agentError ? "pass" : "warn"}
              label={agent ? (agentError ? "Agent retry" : "Care agent") : "Rehearsal"}
            />
            {policyAccess && (
              <StatusBadge
                value={policyError ? "warn" : guardrails ? "pass" : "pending"}
                label={policyError ? "Preset guard" : "Tenant policy"}
              />
            )}
          </div>
        }
      />

      <VoiceStudio
        status={voiceStatus}
        dialect={dialect}
        greeting={greetingText}
        language={locale}
        stream={streamVoice}
        onStreamChange={setStreamVoice}
        onUseVoice={useVoiceForDialect}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <PhoneFrame
          tone="dark" screenHeight="min-h-[680px]"
          screenClassName="bg-slate-950 text-slate-100"
          caption="Voice · mic in, spoken replies out. Every spoken turn hits the same guarded gateway as chat."
        >
        <section className="flex min-h-0 flex-1 flex-col bg-slate-950 text-slate-100">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
              <PhoneCall className="h-4 w-4 text-amber-300" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Zawadi Mobile · Care line</p>
              <p className="text-[11px] text-slate-400">Amina Juma · +255 754 000 111 · prepaid</p>
            </div>
            <span className="ml-auto flex items-center gap-2 text-[10px] font-medium">
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-300">{callActive ? "on call" : "standby"}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-300">
                {mode === "agent" && agent ? "care agent" : "rehearsal"}
              </span>
              <span className="rounded-full bg-amber-400 px-2 py-0.5 font-semibold text-slate-950">Demo line</span>
              <Chip className="border-white/15 bg-white/5 text-slate-300">{tenant}</Chip>
            </span>
          </div>

          <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
            <span
              className={cn(
                "h-1.5 w-1.5 animate-pulse rounded-full",
                listening ? "bg-emerald-400" : phase === "speaking" ? "bg-amber-300" : "bg-white/30",
              )}
            />
            <p className="text-[11px] font-medium text-slate-200">{STATUS[phase]}</p>
            {interim ? <p className="truncate text-[11px] italic text-slate-400">“{interim}”</p> : null}
            <span className="ml-auto flex items-center gap-2">
              <Waveform active={active} />
              <span className="font-mono text-[10px] text-slate-500">
                {dialect?.locale_code || VOICE_LANG_TAG[locale]} · {elevenVoice
                  ? `ElevenLabs${voiceStatus?.configured && streamVoice ? " · streaming" : ""}`
                  : "browser voice"}
              </span>
            </span>
          </div>

          <div
            ref={scrollRef}
            aria-live="polite"
            className="max-h-[420px] min-h-[290px] space-y-3 overflow-y-auto px-4 py-4"
          >
            {turns.map((turn) => (
              <div key={turn.id} className={cn("flex", turn.role === "customer" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[86%]", turn.role === "customer" && "text-right")}>
                  <p className="mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-500">
                    {turn.role === "customer" ? "Subscriber" : "Vela · agent"}
                  </p>
                  <div
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed",
                      turn.role === "customer"
                        ? "bg-amber-400 text-slate-950"
                        : "border border-white/10 bg-white/[0.06] text-slate-100",
                    )}
                  >
                    {turn.text}
                    {turn.card ? <CardView card={turn.card} /> : null}
                  </div>
                </div>
              </div>
            ))}
            {phase === "thinking" ? (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[12px] text-slate-400">
                  Checking the line…
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/10 px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={callActive ? endCall : startCall}
                aria-label={callActive ? "End call" : "Start voice call"}
                className={cn(
                  "flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-transform hover:-translate-y-0.5",
                  callActive
                    ? "border border-white/20 bg-white/10 text-amber-100"
                    : "bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/25",
                  listening && "ring-4 ring-emerald-400/25",
                )}
              >
                {callActive ? <PhoneOff className="h-5 w-5" /> : <PhoneCall className="h-5 w-5" />}
              </button>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{callActive ? "End call" : "Start voice call"}</p>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {micSupported
                    ? callActive
                      ? "Speak normally. The mic reopens after each answer."
                      : "One click opens the line. Your browser asks for the microphone."
                    : "Voice input needs Chrome or Edge — type below instead."}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <div className="flex rounded-full border border-white/15 p-0.5" role="group" aria-label="Reply mode">
                  {(["agent", "rehearsal"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => switchMode(option)}
                      disabled={option === "agent" && !agent}
                      aria-pressed={mode === option}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        mode === option ? "bg-white/15 text-amber-50" : "text-slate-400 hover:text-slate-100",
                      )}
                    >
                      {option === "agent" ? "Agent" : "Rehearsal"}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-full border border-white/15 p-0.5" role="group" aria-label="Call language">
                  {(["en", "sw"] as const).map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => switchLocale(code)}
                      aria-pressed={locale === code}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                        locale === code ? "bg-white/15 text-amber-50" : "text-slate-400 hover:text-slate-100",
                      )}
                    >
                      {code === "en" ? "EN" : "SW"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleSpeak}
                  aria-pressed={speakReplies}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-slate-300"
                >
                  {speakReplies ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                  Speak replies
                </button>
                <button
                  type="button"
                  onClick={() => resetConversation()}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-100"
                >
                  New call
                </button>
              </div>
            </div>

            {notice ? (
              <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                {notice}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {VOICE_SUGGESTIONS[locale].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => handleTurn(suggestion)}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-white/35 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = draft;
                setDraft("");
                handleTurn(text);
              }}
            >
              <label htmlFor="voice-draft" className="sr-only">Type your question</label>
              <input
                id="voice-draft"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={locale === "sw" ? "Andika swali lako…" : "Type instead — balance, data, a lost SIM…"}
                className="h-10 w-full rounded-full border border-white/15 bg-white/[0.06] px-4 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-950 disabled:opacity-40"
                aria-label="Send typed message"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>

            <p className="mt-3 flex items-center gap-1.5 text-[10px] leading-relaxed text-slate-500">
              <Mic className="h-3 w-3" />
              {elevenVoice
                ? "Speech recognition stays in the browser; replies are spoken by ElevenLabs. Audio is never stored. "
                : "Speech stays in the browser. "}
              Each turn's text is policy-screened, then sent to this tenant's care agent.
              {dialect?.training?.capture ? " Captured turns are saved to the dialect as training candidates." : ""}
            </p>
          </div>
        </section>
        </PhoneFrame>

        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                Dialect and voice
                {dialect && <Chip>{dialect.locale_code || dialect.name}</Chip>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              {dialects === null ? (
                <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
              ) : dialects.length === 0 ? (
                <p>No dialect yet. Create one in the language lab to give this line its own words and voice.</p>
              ) : (
                <select
                  aria-label="Dialect"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm"
                  value={dialectId ?? ""}
                  onChange={(e) => selectDialect(e.target.value)}
                >
                  {dialects.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.speech?.voice_id ? " · voiced" : ""}
                    </option>
                  ))}
                </select>
              )}
              <p className="flex gap-2 rounded-lg bg-muted/40 p-2 text-foreground">
                <AudioLines className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                <span dir="auto">“{greetingText}”</span>
              </p>
              <p>
                {elevenVoice
                  ? <>Spoken by <b>ElevenLabs</b>{voiceStatus?.subscription?.characters_left != null
                    ? ` · ${voiceStatus.subscription.characters_left.toLocaleString()} characters left` : ""}.</>
                  : "Using the browser voice. Add an ElevenLabs key in the language lab for a local accent."}
              </p>
              <p className={cn("flex items-center gap-1.5", dialect?.training?.capture ? "text-emerald-600 dark:text-emerald-400" : "")}>
                <GraduationCap className="h-3 w-3" />
                {dialect?.training?.capture ? "Call turns are captured for training." : "Training capture is off for this dialect."}
              </p>
              {onOpenLocale && (
                <Button variant="outline" size="sm" className="w-full" onClick={onOpenLocale}>
                  Open language lab
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Care agent</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              {agent ? (
                <>
                  <p className="text-sm font-medium text-foreground">{agent.name}</p>
                  <p>Model · <span className="font-mono text-[11px]">{agent.model}</span></p>
                  <p>
                    Installed from the MNO Voice Care pack. Each spoken turn goes through the gateway as this agent;
                    it pauses on <span className="font-mono text-[11px]">show_voice_card</span> so this page can render
                    the authoritative card and speak its line.
                  </p>
                  {agentError && <p className="text-amber-600 dark:text-amber-400">Last turn: {agentError}</p>}
                </>
              ) : (
                <>
                  <p>{agentError ?? "Looking for the MNO Voice Care pack…"}</p>
                  <p>The rehearsal mode below runs the same scripted cards without a model call.</p>
                  {can(me, "solutions:read") && onOpenSolutions && (
                    <Button variant="outline" size="sm" className="w-full" onClick={onOpenSolutions}>
                      Open Solutions
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                Tenant policy
                {guardrails && <Chip>{activeRules.length} active</Chip>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Turns are tested against the policy engine before the line answers.
              </p>
              {!policyAccess ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Your role can use the line but not read the policy. The preset guard still blocks prompt leaks and
                  one-time codes.
                </p>
              ) : policyError && !guardrails ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">{policyError}</p>
              ) : guardrails === null ? (
                <div className="space-y-2">
                  <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
                  <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
                </div>
              ) : guardrails.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No guardrail instructions yet. The preset block still covers prompt leaks. Add tenant rules on the
                  Guardrails page.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {guardrails.slice(0, 5).map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
                      <span className="truncate text-xs">{g.title}</span>
                      <StatusBadge value={g.enabled ? g.action : "disabled"} />
                    </li>
                  ))}
                </ul>
              )}
              {policyAccess && onOpenGuardrails && (
                <Button variant="outline" size="sm" className="w-full" onClick={onOpenGuardrails}>
                  Open Guardrails
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">What this line handles</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 text-xs leading-relaxed text-muted-foreground">
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                Balance, bundle purchase and a line check run in one turn: the agent asks this page for the card, then
                answers with the card's own sentence.
              </p>
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                SIM swaps and credits above the agent limit stop for a human decision; the line stays active.
              </p>
              <p className="flex gap-2">
                <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
                English and Kiswahili packs; replies speak in the selected dialect's voice when ElevenLabs is connected.
              </p>
              <p className="flex gap-2">
                <PhoneCall className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Asking for a person hands the thread to a care agent instead of dropping the call.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Call handling</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <p>· Agent mode runs the installed pack through the gateway; the transcript lives in this tab.</p>
              <p>· Rehearsal mode answers from the scripted pack without calling a model.</p>
              <p>· Blocked turns never reach the agent; SIM-swap and credit cards carry the approval case.</p>
              <p>· New call starts a fresh agent thread and clears the pending bundle.</p>
            </CardContent>
          </Card>

          <ProviderKeys page="voice" title="ElevenLabs key" onSaved={refreshVoice} />
        </aside>
      </div>
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
          className={cn("w-1 rounded-full", active ? "animate-pulse bg-amber-300" : "bg-white/25")}
          style={{ height, animationDelay: `${index * 110}ms` }}
        />
      ))}
    </span>
  );
}

function CardView({ card }: { card: VoiceCard }) {
  const tone =
    card.tone === "green"
      ? "border-emerald-400/35"
      : card.tone === "amber"
        ? "border-amber-400/50"
        : "border-white/15";
  return (
    <div className={cn("mt-2.5 rounded-xl border bg-slate-900/80 px-3.5 py-3 text-left text-slate-100", tone)}>
      <p className="text-[11px] font-semibold">{card.title}</p>
      <dl className="mt-1.5 space-y-1">
        {card.rows.map((row) => (
          <div key={`${row.label}:${row.value}`} className="flex items-baseline justify-between gap-3 text-[11px]">
            <dt className="text-slate-400">{row.label}</dt>
            <dd className="text-right font-medium text-slate-100">{row.value}</dd>
          </div>
        ))}
      </dl>
      {card.note && <p className="mt-2 text-[10.5px] leading-relaxed text-slate-400">{card.note}</p>}
    </div>
  );
}
