"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { gatewayFetch, type GatewayConfig } from "../gateway";

export type PhoneCallMode = "live" | "studio";

export interface PhoneTurn {
  id: string;
  role: "agent" | "caller";
  text: string;
  at: string;
  source?: "greeting" | "speech" | "stt" | "typed";
  /** Recorded caller audio (studio mode). */
  audioUrl?: string;
  /** Set while a recorded turn is being transcribed. */
  pending?: boolean;
}

export interface PhoneCallLocale {
  /** Locale profile id in the console, recorded in the dataset. */
  profileId?: string;
  /** BCP-47 tag used for speech recognition and the browser voice. */
  code?: string;
  name?: string;
  greeting?: string;
}

export interface PhoneCallProps {
  /** NMB gateway the agent is served from (`baseUrl` + publishable key). */
  gateway: GatewayConfig;
  /**
   * `live` — conversation mode: the browser listens, the agent streams a reply and
   * the line speaks it back (SpeechRecognition + gateway SSE).
   * `studio` — turn-by-turn: each caller utterance is recorded as a clip, transcribed
   * by the STT endpoint, answered by the agent, and can be exported as a JSONL dataset.
   */
  mode?: PhoneCallMode;
  locale?: PhoneCallLocale;
  /** POST JSON `{ text, voice_id, profile_id }` → audio bytes (ElevenLabs proxy). */
  ttsEndpoint?: string;
  /** POST multipart `file` → `{ text }` (speech-to-text proxy). */
  sttEndpoint?: string;
  /** ElevenLabs voice id forwarded to `ttsEndpoint`. */
  voiceId?: string;
  /** Agent display name on the call screen. */
  agentName?: string;
  /** Opening line. Falls back to `locale.greeting`. */
  greeting?: string;
  /** Base name for the exported dataset file. */
  datasetName?: string;
  onTurn?: (turn: PhoneTurn) => void;
  /** Rows collected for fine-tuning, in the console's training-pack shape. */
  onDataset?: (rows: Array<Record<string, unknown>>) => void;
  className?: string;
}

type Phase = "idle" | "ready" | "listening" | "recording" | "thinking" | "speaking";

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: { length: number; [i: number]: SpeechResult } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function recorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

type StreamState = { text: string; threadId: string | null; interrupts: Array<{ id?: string; value?: unknown }> };

async function consumeStream(res: Response, state: StreamState, onToken: (text: string) => void): Promise<void> {
  if (!res.body) throw new Error("The gateway returned no stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf("\n\n");
      while (cut >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(data) as Record<string, unknown>; } catch { continue; }
        if (event.type === "thread" && event.threadId) state.threadId = String(event.threadId);
        else if (event.type === "token" && event.text) {
          state.text += String(event.text);
          onToken(state.text);
        } else if (event.type === "interrupt" && Array.isArray(event.interrupts)) {
          state.interrupts.push(...event.interrupts as Array<{ id?: string; value?: unknown }>);
        } else if (event.type === "error") {
          throw new Error(String(event.error || "The agent failed."));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Streams one turn. A caller on a phone line cannot see generative-UI cards, so
 * when the graph pauses on a frontend tool the line resumes it with a spoken
 * channel note and keeps reading until the agent answers in words.
 */
async function streamReply(
  cfg: GatewayConfig,
  message: string,
  threadId: string | null,
  onToken: (text: string) => void,
  signal: AbortSignal,
): Promise<{ text: string; threadId: string | null }> {
  const state: StreamState = { text: "", threadId, interrupts: [] };
  let res = await gatewayFetch(cfg, "/v1/chat", {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    signal,
    body: JSON.stringify({
      message,
      thread_id: threadId,
      ...(cfg.userId ? { user_id: cfg.userId } : {}),
      ...(cfg.agentId ? { agent_id: cfg.agentId } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(res.status === 429
      ? "The line is busy — try again in a moment."
      : `Gateway error ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await consumeStream(res, state, onToken);
    if (state.interrupts.length === 0 || !state.threadId) break;
    const resume: Record<string, unknown> = {};
    for (const raw of state.interrupts) {
      const value = raw.value as { tool_call?: { id?: string }; toolCall?: { id?: string } } | undefined;
      const callId = value?.tool_call?.id ?? value?.toolCall?.id ?? raw.id;
      if (callId) {
        resume[callId] = {
          status: "acknowledged",
          channel: "voice",
          instruction: "The caller hears speech only. Summarise the result as one short spoken answer; do not show UI cards.",
        };
      }
    }
    state.interrupts = [];
    if (Object.keys(resume).length === 0) break;
    res = await gatewayFetch(cfg, "/v1/chat/resume", {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      signal,
      body: JSON.stringify({
        thread_id: state.threadId,
        resume,
        ...(cfg.userId ? { user_id: cfg.userId } : {}),
      }),
    });
    if (!res.ok) break;
  }
  return { text: state.text, threadId: state.threadId };
}

function download(rows: Array<Record<string, unknown>>, filename: string): void {
  const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([body], { type: "application/x-ndjson" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PhoneCall({
  gateway,
  mode = "live",
  locale,
  ttsEndpoint,
  sttEndpoint,
  voiceId,
  agentName = "Service line",
  greeting,
  datasetName,
  onTurn,
  onDataset,
  className = "",
}: PhoneCallProps) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<PhoneTurn[]>([]);
  const [partial, setPartial] = useState("");
  const [liveText, setLiveText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(mode === "live");
  const [elapsed, setElapsed] = useState(0);
  const [draft, setDraft] = useState("");
  const [micSupported, setMicSupported] = useState(true);

  const activeRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const mutedRef = useRef(false);
  const micDeniedRef = useRef(false);
  const threadIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioDoneRef = useRef<(() => void) | null>(null);
  const speechResolveRef = useRef<(() => void) | null>(null);
  const turnSeq = useRef(0);
  const turnsRef = useRef<PhoneTurn[]>([]);
  const runTurnRef = useRef<(input: { text: string; source: PhoneTurn["source"]; audioUrl?: string; turnId?: string }) => Promise<void>>(async () => {});

  const greetingText = greeting ?? locale?.greeting ?? "";
  const lang = locale?.code || "en-US";

  const setStage = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const keepTurns = useCallback((next: PhoneTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const pushTurn = useCallback((turn: PhoneTurn) => {
    const next = [...turnsRef.current, turn];
    keepTurns(next);
    onTurn?.(turn);
  }, [keepTurns, onTurn]);

  const patchTurn = useCallback((id: string, patch: Partial<PhoneTurn>) => {
    keepTurns(turnsRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, [keepTurns]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    audioDoneRef.current?.();
    audioDoneRef.current = null;
    speechResolveRef.current?.();
    speechResolveRef.current = null;
  }, []);

  const say = useCallback(async (text: string) => {
    if (!text.trim() || mutedRef.current) return;
    if (ttsEndpoint) {
      try {
        const res = await fetch(ttsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            ...(voiceId ? { voice_id: voiceId } : {}),
            ...(locale?.profileId ? { profile_id: locale.profileId } : {}),
            ...(locale?.code ? { locale: locale.code } : {}),
          }),
        });
        if (!res.ok) throw new Error(`Voice service answered ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        await new Promise<void>((resolve) => {
          // Some headless/silent environments never fire `ended`; the call must not hang.
          const watchdog = window.setTimeout(() => resolve(), 15000);
          audioDoneRef.current = () => { window.clearTimeout(watchdog); resolve(); };
          audio.onended = () => { window.clearTimeout(watchdog); resolve(); };
          audio.onerror = () => { window.clearTimeout(watchdog); resolve(); };
          audio.play().catch(() => { window.clearTimeout(watchdog); resolve(); });
        });
        audioDoneRef.current = null;
        audioRef.current = null;
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
        if (mutedRef.current || !activeRef.current) return;
        return;
      } catch {
        // ElevenLabs unavailable — fall back to the browser voice below.
      }
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    await new Promise<void>((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      const watchdog = window.setTimeout(() => {
        speechResolveRef.current = null;
        window.speechSynthesis.cancel();
        resolve();
      }, Math.min(30000, 5000 + text.length * 90));
      speechResolveRef.current = () => { window.clearTimeout(watchdog); resolve(); };
      utter.onend = () => { window.clearTimeout(watchdog); speechResolveRef.current = null; resolve(); };
      utter.onerror = () => { window.clearTimeout(watchdog); speechResolveRef.current = null; resolve(); };
      window.speechSynthesis.speak(utter);
    });
  }, [ttsEndpoint, voiceId, locale?.profileId, locale?.code, lang]);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try { rec.abort(); } catch { /* already stopped */ }
    }
  }, []);

  const listen = useCallback(() => {
    if (!activeRef.current || phaseRef.current === "speaking" || phaseRef.current === "thinking") return;
    if (micDeniedRef.current) {
      setStage("ready");
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setMicSupported(false);
      setStage("ready");
      return;
    }
    if (recognitionRef.current) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += text;
        else interim += text;
      }
      if (interim) setLiveText(interim.trim());
      if (finalText.trim()) {
        recognitionRef.current = null;
        setLiveText("");
        setStage("thinking");
        rec.stop();
        void runTurnRef.current({ text: finalText.trim(), source: "speech" });
      }
    };
    rec.onerror = (event) => {
      recognitionRef.current = null;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        micDeniedRef.current = true;
        setMicSupported(false);
        setError("Microphone access was blocked. Type the caller's line instead.");
        setStage("ready");
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setLiveText("");
      if (activeRef.current && phaseRef.current === "listening") {
        window.setTimeout(() => {
          if (activeRef.current && phaseRef.current === "listening") listen();
        }, 200);
      }
    };
    recognitionRef.current = rec;
    setError(null);
    setStage("listening");
    try { rec.start(); } catch {
      recognitionRef.current = null;
      setStage("ready");
    }
  }, [lang, setStage]);

  const runTurn = useCallback(async ({ text, source, audioUrl, turnId }: { text: string; source: PhoneTurn["source"]; audioUrl?: string; turnId?: string }) => {
    const message = text.trim();
    if (!message) return;
    setError(null);
    turnSeq.current += 1;
    const caller: PhoneTurn = {
      id: turnId ?? `caller-${turnSeq.current}`,
      role: "caller",
      text: message,
      at: new Date().toISOString(),
      source,
      ...(audioUrl ? { audioUrl } : {}),
    };
    if (turnId) {
      const updated: PhoneTurn = { ...caller, pending: false };
      keepTurns(turnsRef.current.map((t) => (t.id === turnId ? { ...t, ...updated } : t)));
      onTurn?.(updated);
    } else pushTurn(caller);

    setStage("thinking");
    setPartial("");
    setLiveText("");
    stopListening();
    if (!abortRef.current) abortRef.current = new AbortController();
    try {
      const reply = await streamReply(gateway, message, threadIdRef.current, setPartial, abortRef.current.signal);
      threadIdRef.current = reply.threadId;
      setPartial("");
      if (reply.text.trim()) {
        turnSeq.current += 1;
        pushTurn({ id: `agent-${turnSeq.current}`, role: "agent", text: reply.text.trim(), at: new Date().toISOString() });
      }
      if (activeRef.current && speakReplies && reply.text.trim()) {
        setStage("speaking");
        await say(reply.text.trim());
      }
    } catch (e) {
      setPartial("");
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "The call dropped.");
      }
    } finally {
      if (activeRef.current) {
        setStage(mode === "live" ? "listening" : "ready");
        if (mode === "live") listen();
      }
    }
  }, [gateway, keepTurns, listen, mode, onTurn, pushTurn, say, speakReplies, stopListening]);

  runTurnRef.current = runTurn;

  const startCall = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    threadIdRef.current = null;
    abortRef.current = new AbortController();
    keepTurns([]);
    setError(null);
    setPartial("");
    setLiveText("");
    setElapsed(0);
    setActive(true);
    setStage("speaking");
    if (greetingText) {
      turnSeq.current += 1;
      const turn: PhoneTurn = { id: `agent-${turnSeq.current}`, role: "agent", text: greetingText, at: new Date().toISOString(), source: "greeting" };
      pushTurn(turn);
      if (speakReplies) await say(greetingText);
    }
    if (!activeRef.current) return;
    setStage("ready");
    if (mode === "live") listen();
  }, [greetingText, keepTurns, listen, mode, pushTurn, say, setStage, speakReplies]);

  const stopRecording = useCallback((keep: boolean) => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      if (!keep) rec.onstop = null;
      rec.stop();
    }
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
  }, []);

  const endCall = useCallback(() => {
    activeRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    stopListening();
    stopRecording(false);
    stopAudio();
    setLiveText("");
    setPartial("");
    setActive(false);
    setStage("idle");
  }, [setStage, stopAudio, stopListening, stopRecording]);

  useEffect(() => () => {
    activeRef.current = false;
    abortRef.current?.abort();
    recognitionRef.current?.abort();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) stopAudio();
  }, [stopAudio]);

  const transcribe = useCallback(async (blob: Blob, turnId: string): Promise<string> => {
    if (!sttEndpoint) return "";
    const form = new FormData();
    form.append("file", blob, "clip.webm");
    const res = await fetch(sttEndpoint, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Transcription failed (${res.status}).`);
    const data = await res.json() as { text?: string };
    const text = (data.text ?? "").trim();
    patchTurn(turnId, { text, pending: false });
    return text;
  }, [patchTurn, sttEndpoint]);

  const startRecording = useCallback(async () => {
    if (!activeRef.current || phaseRef.current !== "ready") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Recording is not available in this browser.");
      return;
    }
    stopAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = recorderMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: BlobPart[] = [];
      recordStreamRef.current = stream;
      rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        turnSeq.current += 1;
        const id = `caller-${turnSeq.current}`;
        keepTurns([...turnsRef.current, {
          id, role: "caller", text: sttEndpoint ? "Transcribing…" : "Recorded turn",
          at: new Date().toISOString(), source: "stt",
          audioUrl: URL.createObjectURL(blob), pending: Boolean(sttEndpoint),
        }]);
        setStage("thinking");
        try {
          const text = await transcribe(blob, id);
          if (!text) {
            if (!sttEndpoint) {
              patchTurn(id, { text: "", pending: false });
              setError("No speech-to-text endpoint set — attach the clip, or type the line below.");
            } else {
              patchTurn(id, { text: "", pending: false });
              setError("Nothing was heard in that clip — record again.");
            }
            if (activeRef.current) setStage("ready");
            return;
          }
          const turn = turnsRef.current.find((t) => t.id === id);
          await runTurnRef.current({ text, source: "stt", audioUrl: turn?.audioUrl, turnId: id });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Transcription failed.");
          if (activeRef.current) setStage("ready");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setError(null);
      setStage("recording");
    } catch {
      setError("Could not open the microphone. Check the browser permission for this site.");
      setStage("ready");
    }
  }, [patchTurn, setStage, sttEndpoint, stopAudio, transcribe]);

  const stopAndSubmit = useCallback(() => {
    if (phaseRef.current !== "recording") return;
    setStage("thinking");
    stopRecording(true);
  }, [setStage, stopRecording]);

  const submitTyped = useCallback((event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !activeRef.current) return;
    setDraft("");
    stopListening();
    stopAudio();
    setStage("thinking");
    void runTurnRef.current({ text, source: "typed" });
  }, [draft, setStage, stopAudio, stopListening]);

  const datasetRows = turns.reduce<Array<Record<string, unknown>>>((rows, turn, index) => {
    if (turn.role !== "caller" || !turn.text.trim() || turn.pending) return rows;
    const reply = turns.slice(index + 1).find((t) => t.role === "agent" && t.source !== "greeting");
    rows.push({
      input: turn.text,
      expected_output: reply?.text ?? "",
      locale_profile_id: locale?.profileId ?? null,
      locale_code: locale?.code ?? null,
      captured_at: turn.at,
      source: turn.source ?? "typed",
      has_audio: Boolean(turn.audioUrl),
      mode,
    });
    return rows;
  }, []);

  const exportDataset = useCallback(() => {
    if (datasetRows.length === 0) return;
    onDataset?.(datasetRows);
    const stamp = new Date().toISOString().slice(0, 10);
    download(datasetRows, `${datasetName || "voice-call"}-${stamp}.jsonl`);
  }, [datasetName, datasetRows, onDataset]);

  const status = phase === "listening"
    ? "Listening…"
    : phase === "recording"
      ? "Recording — tap stop when done"
      : phase === "thinking"
        ? "Thinking…"
        : phase === "speaking"
          ? "Speaking…"
          : active
            ? "Line open"
            : "Ready for a call";

  return (
    <div className={`lgk lgk-phone ${className}`.trim()} data-mode={mode} data-live={active}>
      <div className="lgk-phone-body">
        <header className="lgk-phone-head">
          <div className="lgk-phone-avatar" aria-hidden="true">
            <span>{agentName.slice(0, 1)}</span>
            <i className="lgk-phone-ring" />
          </div>
          <div className="lgk-phone-meta">
            <strong>{agentName}</strong>
            <span className="lgk-phone-sub">
              {locale?.name ?? "Voice line"}{locale?.code ? ` · ${locale.code}` : ""}
            </span>
          </div>
          <div className="lgk-phone-status" role="status" aria-live="polite">
            <span className="lgk-phone-dot" data-on={active ? "true" : "false"} />
            {active ? clock(elapsed) : mode === "studio" ? "Turn-by-turn" : "Live voice"}
          </div>
        </header>

        <div className="lgk-phone-stage">
          {active && (
            <div className="lgk-phone-wave" data-busy={phase !== "ready"} aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => <i key={i} style={{ animationDelay: `${i * 90}ms` }} />)}
            </div>
          )}
          <ul className="lgk-phone-transcript">
            {turns.length === 0 && !partial && (
              <li className="lgk-phone-empty">
                {mode === "studio"
                  ? "Press record to leave a clip for the language lab, or type what the caller says."
                  : "Start the call — the agent picks up and greets the caller in the local language."}
              </li>
            )}
            {turns.map((turn) => (
              <li key={turn.id} className="lgk-phone-turn" data-role={turn.role}>
                <span className="lgk-phone-who">{turn.role === "agent" ? agentName : "Caller"}</span>
                <p className={turn.pending ? "lgk-muted" : undefined}>{turn.text}</p>
                {turn.audioUrl && <audio className="lgk-phone-clip" controls src={turn.audioUrl} preload="none" />}
              </li>
            ))}
            {partial && (
              <li className="lgk-phone-turn" data-role="agent">
                <span className="lgk-phone-who">{agentName}</span>
                <p>{partial}<span className="lgk-phone-caret" aria-hidden="true" /></p>
              </li>
            )}
            {liveText && <li className="lgk-phone-heard">{liveText}</li>}
          </ul>
        </div>

        {error && <p className="lgk-phone-error" role="alert">{error}</p>}
        {!micSupported && !error && active && mode === "live" && (
          <p className="lgk-phone-hint">This browser has no speech recognition — type the caller's line below.</p>
        )}

        <footer className="lgk-phone-controls">
          {!active ? (
            <button type="button" className="lgk-phone-call" onClick={() => { void startCall(); }}>
              {mode === "studio" ? "Start recording session" : "Call the agent"}
            </button>
          ) : (
            <>
              {mode === "studio" ? (
                <button
                  type="button"
                  className="lgk-phone-mic"
                  data-state={phase}
                  onClick={() => { if (phase === "recording") stopAndSubmit(); else void startRecording(); }}
                  disabled={phase === "thinking" || phase === "speaking"}
                >
                  {phase === "recording" ? "Stop" : "Record"}
                </button>
              ) : micSupported ? (
                <button
                  type="button"
                  className="lgk-phone-mic"
                  data-state={phase}
                  onClick={() => {
                    if (phase === "listening") { stopListening(); setStage("ready"); }
                    else { stopAudio(); listen(); }
                  }}
                  disabled={phase === "thinking" || phase === "speaking"}
                >
                  {phase === "listening" ? "Listening" : "Talk"}
                </button>
              ) : null}
              <button type="button" className="lgk-phone-icon" onClick={toggleMute} aria-pressed={muted} title={muted ? "Unmute agent" : "Mute agent"}>
                {muted ? "Unmute" : "Mute"}
              </button>
              {mode === "studio" && (
                <label className="lgk-phone-toggle">
                  <input type="checkbox" checked={speakReplies} onChange={(e) => setSpeakReplies(e.target.checked)} />
                  Speak replies
                </label>
              )}
              <button type="button" className="lgk-phone-hangup" onClick={endCall}>End call</button>
            </>
          )}
        </footer>

        {active && (
          <form className="lgk-phone-type" onSubmit={submitTyped}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={mode === "studio" ? "Type the caller's line (if no audio)…" : "Type instead of speaking…"}
              aria-label="Caller message"
            />
            <button type="submit" disabled={!draft.trim() || phase === "thinking"}>Send</button>
          </form>
        )}

        <p className="lgk-phone-foot">
          {status}
          {mode === "studio" && turns.some((t) => t.role === "caller" && !t.pending) && (
            <>
              {" · "}
              <button type="button" className="lgk-phone-link" onClick={exportDataset}>
                Download dataset ({datasetRows.length})
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
