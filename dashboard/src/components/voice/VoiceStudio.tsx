import { useCallback, useEffect, useRef, useState } from "react";
import {
  Gauge, Library, Loader2, Mic, Play, Search, Sparkles, Square, Upload, Volume2,
} from "lucide-react";

import {
  API_BASE, ApiError, api,
  type LocaleProfile, type VoiceInfo, type VoiceLibraryPage, type VoiceStatus,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Tab = "stream" | "browse" | "clone";

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message.replace(/^\d+\s*/, "");
  return error instanceof Error ? error.message : "Something went wrong.";
}

function playError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "The browser blocked playback. Press Speak it again — audio needs a direct tap on the page.";
  }
  return message(error);
}

function chips(voice: VoiceInfo): string[] {
  return [voice.accent, voice.gender, voice.use_case || voice.category].filter(Boolean);
}

export function VoiceStudio({
  status, dialect, greeting, language, stream, onStreamChange, onUseVoice,
}: {
  status: VoiceStatus | null;
  dialect: LocaleProfile | null;
  greeting: string;
  language: "en" | "sw";
  stream: boolean;
  onStreamChange: (next: boolean) => void;
  onUseVoice: (voice: { voice_id: string; name: string }) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("stream");
  const configured = Boolean(status?.configured);

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">ElevenLabs voice studio</p>
          <p className="text-[11px] text-muted-foreground">
            {status?.subscription?.characters_left != null
              ? `${status.subscription.characters_left.toLocaleString()} characters left on ${status.subscription.tier || "your plan"}`
              : "Stream replies, browse the shared voice library, or clone a voice from a short recording."}
          </p>
        </div>
        <div className="ml-auto flex rounded-full border p-0.5" role="tablist" aria-label="Voice studio">
          {([
            ["stream", "Stream audio", Gauge],
            ["browse", "Browse voices", Library],
            ["clone", "Clone a voice", Mic],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                tab === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <CardContent className="pt-4">
        {tab === "stream" && (
          <StreamPanel status={status} dialect={dialect} greeting={greeting} language={language}
            stream={stream} onStreamChange={onStreamChange} />
        )}
        {tab === "browse" && <BrowsePanel dialect={dialect} configured={configured} onUseVoice={onUseVoice} />}
        {tab === "clone" && <ClonePanel dialect={dialect} configured={configured} onUseVoice={onUseVoice} />}
      </CardContent>
    </Card>
  );
}

// ── Stream ─────────────────────────────────────────────────────────

function StreamPanel({
  status, dialect, greeting, language, stream, onStreamChange,
}: {
  status: VoiceStatus | null;
  dialect: LocaleProfile | null;
  greeting: string;
  language: "en" | "sw";
  stream: boolean;
  onStreamChange: (next: boolean) => void;
}) {
  const [text, setText] = useState(greeting);
  const [model, setModel] = useState(dialect?.speech?.model_id || "eleven_multilingual_v2");
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [timing, setTiming] = useState<{ first: number; total: number | null; mode: "stream" | "file" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectRef = useRef<string | null>(null);
  const stopAt = useRef<number>(0);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectRef.current) {
      URL.revokeObjectURL(objectRef.current);
      objectRef.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    setText(greeting);
    setModel(dialect?.speech?.model_id || "eleven_multilingual_v2");
    setTiming(null);
    setError(null);
  }, [dialect?.id, greeting, dialect?.speech?.model_id]);

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  async function play() {
    if (!text.trim()) return;
    if (!status?.configured) {
      setError("Add an ElevenLabs key (Bring your own keys card on this page) to hear the voice.");
      return;
    }
    stop();
    setError(null);
    setTiming(null);
    setWaiting(true);
    setPlaying(false);
    const started = performance.now();
    try {
      const speech = dialect?.speech ?? {};
      const body = {
        text: text.trim(), profile_id: dialect?.id, model_id: model, voice_id: speech.voice_id,
        stability: speech.stability, similarity: speech.similarity, style: speech.style, speed: speech.speed,
      };
      let audio: HTMLAudioElement;
      if (stream) {
        const ticket = await api.voiceTtsTicket(body);
        audio = new Audio(`${API_BASE}${ticket.url}`);
      } else {
        const blob = await api.voiceTts(body);
        objectRef.current = URL.createObjectURL(blob);
        audio = new Audio(objectRef.current);
      }
      audioRef.current = audio;
      stopAt.current = 0;
      audio.onplaying = () => {
        setWaiting(false);
        setPlaying(true);
        setTiming((current) => current ?? {
          first: (performance.now() - started) / 1000, total: null, mode: stream ? "stream" : "file",
        });
      };
      audio.onended = () => {
        setPlaying(false);
        setWaiting(false);
        setTiming((current) => current && { ...current, total: (performance.now() - started) / 1000 });
        if (objectRef.current) {
          URL.revokeObjectURL(objectRef.current);
          objectRef.current = null;
        }
      };
      audio.onerror = () => {
        setPlaying(false);
        setWaiting(false);
        setError("The audio could not be played. Try again, or turn streaming off.");
      };
      await audio.play();
    } catch (err) {
      setWaiting(false);
      setError(playError(err));
    }
  }

  function halt() {
    stop();
    setPlaying(false);
    setWaiting(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="studio-say" className="sr-only">Text to speak</label>
          <select
            aria-label="Model"
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {(status?.models ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
            {!status?.models?.length && <option value="eleven_multilingual_v2">Multilingual v2</option>}
          </select>
          <span className="text-[11px] text-muted-foreground">
            {dialect ? `Speaks as ${dialect.name}` : "No dialect selected"}
            {dialect?.speech?.voice_id ? "" : " · default voice"}
          </span>
        </div>
        <Textarea
          id="studio-say"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          className="text-sm"
          placeholder={language === "sw" ? "Andika kitu cha kusikika…" : "Type something to hear the voice…"}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={play} disabled={waiting || !text.trim()}>
            {waiting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            {waiting ? (stream ? "Streaming…" : "Synthesising…") : "Speak it"}
          </Button>
          {(playing || waiting) && (
            <Button size="sm" variant="outline" onClick={halt}>
              <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
            </Button>
          )}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
            <button
              type="button"
              role="switch"
              aria-checked={stream}
              onClick={() => onStreamChange(!stream)}
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                stream ? "bg-emerald-500" : "bg-muted-foreground/30",
              )}
            >
              <span className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                stream ? "left-[18px]" : "left-0.5",
              )} />
            </button>
            Stream as it generates
          </label>
        </div>
        {error ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            {error}
          </p>
        ) : timing ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
              First sound {timing.first.toFixed(2)} s
            </span>
            {timing.total != null && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                Full line {timing.total.toFixed(2)} s
              </span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              {timing.mode === "stream" ? "streamed · plays before the file finishes" : "whole file first"}
            </span>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Streaming starts playback on the first syllables; with it off the browser waits for the complete file.
            Use <b>Flash v2.5</b> or <b>Turbo v2.5</b> for the quickest first sound.
          </p>
        )}
      </div>
      <div className="space-y-2 rounded-xl border bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Volume2 className="h-3.5 w-3.5" /> How it reaches a call
        </p>
        <p>
          The call line speaks each agent reply through this same path. With streaming on, the subscriber hears the
          first words while the rest of the sentence is still being generated.
        </p>
        <p>
          {wordCount} word{wordCount === 1 ? "" : "s"} · about {Math.max(1, Math.round(wordCount / 2.6))} s of speech.
          Every character counts against your ElevenLabs plan.
        </p>
      </div>
    </div>
  );
}

// ── Browse ─────────────────────────────────────────────────────────

function BrowsePanel({
  dialect, configured, onUseVoice,
}: {
  dialect: LocaleProfile | null;
  configured: boolean;
  onUseVoice: (voice: { voice_id: string; name: string }) => Promise<void>;
}) {
  const [source, setSource] = useState<"library" | "mine">("library");
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("");
  const [page, setPage] = useState<VoiceLibraryPage | null>(null);
  const [mine, setMine] = useState<VoiceInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  const [used, setUsed] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadLibrary = useCallback(async (nextPage: number, search: string, genderValue: string, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.voiceLibrary({ search, page: nextPage, pageSize: 24, gender: genderValue });
      setPage((current) => (append && current
        ? { ...result, voices: [...current.voices, ...result.voices] }
        : result));
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMine((await api.voiceVoices(true)).voices);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    if (source === "mine") {
      void loadMine();
      return;
    }
    const timer = window.setTimeout(() => {
      void loadLibrary(0, query.trim(), gender, false);
    }, query || gender ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [configured, source, query, gender, loadLibrary, loadMine]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  function preview(voice: VoiceInfo) {
    if (!voice.preview_url) return;
    audioRef.current?.pause();
    if (playingId === voice.voice_id) {
      setPlayingId(null);
      return;
    }
    const audio = new Audio(voice.preview_url);
    audioRef.current = audio;
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    setPlayingId(voice.voice_id);
    audio.play().catch(() => setPlayingId(null));
  }

  async function use(voice: VoiceInfo) {
    if (!dialect) {
      setError("Create a dialect in the language lab first — the voice needs a profile to speak for.");
      return;
    }
    setUsingId(voice.voice_id);
    setError(null);
    try {
      let voiceId = voice.voice_id;
      if (source === "library") {
        const added = await api.voiceLibraryAdd({
          public_owner_id: voice.public_owner_id || "", voice_id: voice.voice_id, name: voice.name,
        });
        voiceId = added.voice_id;
      }
      await onUseVoice({ voice_id: voiceId, name: voice.name });
      setUsed(voice.name);
      setMine(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setUsingId(null);
    }
  }

  const visible = source === "library"
    ? page?.voices ?? []
    : (mine ?? []).filter((voice) => {
        const needle = query.trim().toLowerCase();
        if (!needle) return true;
        return `${voice.name} ${voice.accent} ${voice.gender} ${voice.language}`.toLowerCase().includes(needle);
      });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search accents, names, use cases — e.g. “Swahili narration”"
            className="h-9 pl-8 text-sm"
            aria-label="Search voices"
          />
        </div>
        {source === "library" && (
          <select
            aria-label="Voice gender"
            className="h-9 rounded-md border bg-background px-2 text-xs"
            value={gender}
            onChange={(event) => setGender(event.target.value)}
          >
            <option value="">Any voice</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="neutral">Neutral</option>
          </select>
        )}
        <div className="flex rounded-full border p-0.5" role="group" aria-label="Voice source">
          {(["library", "mine"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setSource(value); setError(null); }}
              aria-pressed={source === value}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                source === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "library" ? "Shared library" : "My voices"}
            </button>
          ))}
        </div>
      </div>

      {!configured ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Add an ElevenLabs key below to browse the shared library. Your saved voices load after that.
        </p>
      ) : error ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {error}
        </p>
      ) : null}

      {used ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          “{used}” is now the voice for {dialect?.name ?? "the selected dialect"}. New calls use it immediately.
        </p>
      ) : null}

      {loading && visible.length === 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />)}
        </div>
      ) : configured && visible.length === 0 && !error ? (
        <p className="rounded-lg border px-3 py-6 text-center text-xs text-muted-foreground">
          {source === "library" ? "No voices match that search." : "No saved voices yet — add one from the shared library."}
        </p>
      ) : (
        <div className="grid max-h-[340px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {visible.map((voice) => {
            const busy = usingId === voice.voice_id;
            return (
              <div key={`${voice.voice_id}:${voice.public_owner_id ?? ""}`} className="flex items-start gap-2.5 rounded-xl border p-2.5">
                <button
                  type="button"
                  onClick={() => preview(voice)}
                  disabled={!voice.preview_url}
                  aria-label={`Preview ${voice.name}`}
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40",
                    playingId === voice.voice_id ? "border-emerald-500 bg-emerald-500/10 text-emerald-600" : "hover:bg-muted",
                  )}
                >
                  {playingId === voice.voice_id ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{voice.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {chips(voice).map((chip) => (
                      <span key={chip} className="rounded-full bg-muted px-1.5 py-0.5 text-[9.5px] text-muted-foreground">
                        {chip}
                      </span>
                    ))}
                  </div>
                  {voice.description ? (
                    <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">{voice.description}</p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2 text-[11px]"
                  disabled={busy || !dialect}
                  onClick={() => use(voice)}
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Use"}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {source === "library" && page?.has_more && (
        <div className="flex items-center justify-between">
          <p className="text-[10.5px] text-muted-foreground">
            {page.total != null ? `${page.total.toLocaleString()} voices in the library` : "More voices in the library"}
          </p>
          <Button size="sm" variant="outline" disabled={loading}
            onClick={() => loadLibrary(page.page + 1, query.trim(), gender, true)}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Clone ──────────────────────────────────────────────────────────

function ClonePanel({
  dialect, configured, onUseVoice,
}: {
  dialect: LocaleProfile | null;
  configured: boolean;
  onUseVoice: (voice: { voice_id: string; name: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState<{ blob: Blob; seconds: number } | null>(null);
  const [recState, setRecState] = useState<"idle" | "recording">("idle");
  const [recSeconds, setRecSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ voice_id: string; name: string; assigned: boolean } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const secondsRef = useRef(0);
  const tickRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => {
    window.clearInterval(tickRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (value) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(value),
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setRecording({ blob, seconds: secondsRef.current });
        stream.getTracks().forEach((track) => track.stop());
        window.clearInterval(tickRef.current);
        setRecState("idle");
      };
      recorderRef.current = recorder;
      recorder.start();
      secondsRef.current = 0;
      setRecSeconds(0);
      setRecording(null);
      setRecState("recording");
      tickRef.current = window.setInterval(() => {
        secondsRef.current += 1;
        setRecSeconds(secondsRef.current);
        if (secondsRef.current >= 30) stopRecording();
      }, 1000);
    } catch {
      setError("The microphone is blocked. Allow it in the address bar, or upload a recording instead.");
    }
  }

  function stopRecording() {
    window.clearInterval(tickRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const total = next.reduce((sum, file) => sum + file.size, 0) + (recording?.blob.size ?? 0);
    if (total > 10 * 1024 * 1024) {
      setError("Keep the samples under 10 MB in total — 10–30 seconds is plenty.");
      return;
    }
    setFiles(next);
    setError(null);
  }

  async function submit() {
    setError(null);
    if (!configured) {
      setError("Add an ElevenLabs key below before cloning.");
      return;
    }
    if (!name.trim()) {
      setError("Give the voice a name.");
      return;
    }
    if (!consent) {
      setError("Confirm that you have the speaker's consent to clone this voice.");
      return;
    }
    if (!files.length && !recording) {
      setError("Record or upload at least one short sample.");
      return;
    }
    const form = new FormData();
    form.append("name", name.trim());
    form.append("description", description.trim());
    form.append("consent", "true");
    files.forEach((file) => form.append("files", file, file.name));
    if (recording) form.append("files", recording.blob, "recorded-sample.webm");
    setBusy(true);
    try {
      const created = await api.voiceClone(form);
      let assigned = false;
      if (dialect) {
        try {
          await onUseVoice({ voice_id: created.voice_id, name: created.name });
          assigned = true;
        } catch {
          assigned = false;
        }
      }
      setDone({ ...created, assigned });
      setName("");
      setDescription("");
      setConsent(false);
      setFiles([]);
      setRecording(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="space-y-2.5">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="clone-name" className="text-[11px] font-medium">Voice name</label>
            <Input id="clone-name" value={name} onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Zawadi Kiswahili host" className="mt-1 h-9 text-sm" />
          </div>
          <div>
            <label htmlFor="clone-desc" className="text-[11px] font-medium">Description (optional)</label>
            <Input id="clone-desc" value={description} onChange={(event) => setDescription(event.target.value)}
              placeholder="Calm, warm, clear" className="mt-1 h-9 text-sm" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {recState === "recording" ? (
            <Button size="sm" variant="outline" onClick={stopRecording}>
              <Square className="mr-1.5 h-3.5 w-3.5" /> Stop · {recSeconds}s
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={startRecording}>
              <Mic className="mr-1.5 h-3.5 w-3.5" /> Record a sample
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload audio
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(event) => addFiles(event.target.files)}
          />
          <span className="text-[11px] text-muted-foreground">10–30 seconds of clean speech is enough.</span>
        </div>

        {recording ? (
          <p className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-700 dark:text-emerald-400">
            <Mic className="h-3 w-3" /> Recorded {recording.seconds}s
            <button type="button" className="underline" onClick={() => setRecording(null)}>remove</button>
          </p>
        ) : null}
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {files.map((file, index) => (
              <span key={`${file.name}:${index}`} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-[10.5px]">
                {file.name}
                <button type="button" className="text-muted-foreground hover:text-foreground"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>×</button>
              </span>
            ))}
          </div>
        ) : null}

        <label className="flex items-start gap-2 text-[11px] leading-relaxed">
          <input type="checkbox" className="mt-0.5" checked={consent}
            onChange={(event) => setConsent(event.target.checked)} />
          <span>
            I have the speaker's permission to create a synthetic copy of this voice. Cloned voices are stored in
            your ElevenLabs account and every call that uses them bills against your plan.
          </span>
        </label>

        {error ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
            “{done.name}” was cloned{done.assigned ? ` and assigned to ${dialect?.name ?? "the selected dialect"}` : ""}.
            Voice id <code className="font-mono">{done.voice_id}</code>
          </p>
        ) : null}

        <Button size="sm" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          {busy ? "Cloning…" : "Clone this voice"}
        </Button>
      </div>
      <div className="space-y-2 rounded-xl border bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <Mic className="h-3.5 w-3.5" /> What makes a good sample
        </p>
        <p>One speaker, no music, no other voices. A quiet room and a steady pace beat a long noisy file.</p>
        <p>A single 20-second clip is usually enough for instant cloning; add a second only if the first sounds thin.</p>
        <p>After cloning, the voice is assigned to {dialect ? dialect.name : "a dialect"} so the care line speaks in it.</p>
      </div>
    </div>
  );
}
