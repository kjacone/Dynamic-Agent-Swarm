"use client";
import { useEffect, useMemo, useState } from "react";
import {
  PhoneCall,
  listGatewayAgents,
  type GatewayAgent,
  type GatewayConfig,
  type PhoneCallMode,
} from "langgraph-kit";

const baseUrl = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_GATEWAY_KEY ?? "";
const userId = process.env.NEXT_PUBLIC_GATEWAY_USER ?? "demo-user";
const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? "";

const LOCALES = [
  { code: "sw-TZ", name: "Kiswahili · Tanzania", short: "Kiswahili", greeting: "Habari! Ni msaidizi wa huduma kwa wateja. Nikusaidie nini leo?" },
  { code: "en-US", name: "English · US", short: "English", greeting: "Hello, you've reached the service line. How can I help today?" },
  { code: "fr-FR", name: "Français · France", short: "Français", greeting: "Bonjour, vous êtes bien sur la ligne de service. Que puis-je faire pour vous ?" },
];

const MODES: { id: PhoneCallMode; title: string; hint: string }[] = [
  { id: "live", title: "Live call", hint: "Talk naturally" },
  { id: "studio", title: "Turn by turn", hint: "Record a dataset" },
];

const css = `
@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=DM+Sans:wght@400;500;600&display=swap");

.pl-root {
  --ink: #06161d;
  --deep: #0c2b35;
  --sea: #134452;
  --foam: #7ee6c4;
  --foam-dim: rgba(126, 230, 196, 0.16);
  --sand: #eef3ef;
  --mute: #8fb0b5;
  --line: rgba(190, 235, 230, 0.14);
  min-height: 100vh;
  color: var(--sand);
  font-family: "DM Sans", system-ui, sans-serif;
  background:
    radial-gradient(900px 600px at 28% 40%, #0f3a47 0%, transparent 70%),
    radial-gradient(700px 500px at 90% 0%, #123a3a 0%, transparent 65%),
    var(--ink);
  padding: 32px 24px 56px;
}
.pl-wrap { max-width: 1120px; margin: 0 auto; display: grid; gap: 28px; }
.pl-head h1 {
  margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700;
  font-size: clamp(30px, 4vw, 44px); letter-spacing: -0.02em; line-height: 1.05;
}
.pl-head p { margin: 10px 0 0; max-width: 56ch; color: var(--mute); line-height: 1.55; font-size: 15px; }
.pl-back { display: inline-block; margin-bottom: 14px; color: var(--foam); font-size: 14px; text-decoration: none; }
.pl-back:hover { text-decoration: underline; }

.pl-grid { display: grid; gap: 40px; grid-template-columns: minmax(0, 440px) minmax(0, 1fr); align-items: start; }

/* ---------- stage ---------- */
.pl-stage { display: grid; gap: 22px; justify-items: center; }
.pl-modes {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; width: min(100%, 372px);
  border-radius: 999px; background: rgba(255,255,255,0.05); border: 1px solid var(--line);
}
.pl-mode {
  border: 0; cursor: pointer; border-radius: 999px; padding: 9px 12px; text-align: center;
  background: transparent; color: var(--mute); font: inherit; font-size: 14px; font-weight: 500;
  transition: background .2s, color .2s;
}
.pl-mode small { display: block; font-size: 11.5px; font-weight: 400; opacity: .75; }
.pl-mode[aria-pressed="true"] { background: var(--foam); color: #04251c; }
.pl-mode:focus-visible, .pl-chip:focus-visible, .pl-select:focus-visible, .pl-input:focus-visible {
  outline: 2px solid var(--foam); outline-offset: 2px;
}

.pl-phone-zone { position: relative; width: min(100%, 372px); display: grid; place-items: center; }
.pl-ripple {
  position: absolute; left: 50%; top: 50%; width: 420px; height: 420px; margin: -210px 0 0 -210px;
  border-radius: 50%; border: 1px solid var(--foam); opacity: 0; pointer-events: none;
  animation: pl-ripple 6s ease-out infinite;
}
.pl-ripple:nth-child(2) { animation-delay: 2s; }
.pl-ripple:nth-child(3) { animation-delay: 4s; }
@keyframes pl-ripple {
  0% { transform: scale(.55); opacity: .28; }
  100% { transform: scale(1.5); opacity: 0; }
}

.pl-phone {
  position: relative; z-index: 1; width: 100%; height: clamp(620px, 82vh, 760px);
  border-radius: 56px; padding: 11px;
  background: linear-gradient(145deg, #3b4f55 0%, #17262b 40%, #0b171b 60%, #35484e 100%);
  box-shadow:
    0 0 0 1.5px #0a1317,
    inset 0 0 0 1.5px rgba(255,255,255,0.12),
    0 50px 90px -30px rgba(0,0,0,.75),
    0 0 80px -10px rgba(126,230,196,.18);
}
.pl-phone::before, .pl-phone::after {
  content: ""; position: absolute; width: 4px; border-radius: 2px; background: #22353b;
}
.pl-phone::before { left: -3px; top: 150px; height: 56px; box-shadow: 0 78px 0 #22353b; }
.pl-phone::after { right: -3px; top: 190px; height: 92px; }

.pl-screen {
  position: relative; height: 100%; border-radius: 46px; overflow: hidden; background: #f4f8f7;
  color: #0f172a; display: flex; flex-direction: column; isolation: isolate;
}
.pl-island {
  position: absolute; z-index: 5; top: 11px; left: 50%; transform: translateX(-50%);
  width: 104px; height: 30px; border-radius: 20px; background: #05090b;
}
.pl-status {
  position: relative; z-index: 4; flex: none; height: 52px; padding: 16px 30px 0;
  display: flex; justify-content: space-between; align-items: flex-start;
  font-size: 14px; font-weight: 600; color: #0b1f26;
}
.pl-status-icons { display: flex; gap: 6px; align-items: center; }

.pl-callhead {
  flex: none; margin: 0 14px; padding: 14px 16px; border-radius: 22px;
  background: linear-gradient(135deg, #0f3b47, #14586a); color: #eafaf5;
  display: flex; align-items: center; gap: 12px;
}
.pl-avatar {
  flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
  background: var(--foam); color: #04251c; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: 18px;
  box-shadow: 0 0 0 4px rgba(126,230,196,.25);
}
.pl-callmeta { min-width: 0; display: grid; gap: 2px; }
.pl-callname { font-weight: 600; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-calllang { font-size: 12.5px; color: #a9d9ce; }
.pl-badge {
  margin-left: auto; flex: none; font-size: 11.5px; font-weight: 600; padding: 4px 9px; border-radius: 999px;
  background: rgba(126,230,196,.18); color: #bff5e2;
}

.pl-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 14px 34px; scrollbar-width: thin; }
.pl-home {
  position: absolute; z-index: 5; bottom: 9px; left: 50%; transform: translateX(-50%);
  width: 124px; height: 5px; border-radius: 3px; background: #0b1f26; opacity: .85;
}

/* ---------- side panel ---------- */
.pl-side { display: grid; gap: 16px; }
.pl-card {
  border: 1px solid var(--line); border-radius: 20px; padding: 20px; display: grid; gap: 14px;
  background: rgba(255,255,255,0.04); backdrop-filter: blur(6px);
}
.pl-card h2 { margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-size: 18px; font-weight: 500; }
.pl-field { display: grid; gap: 7px; }
.pl-field > span { font-size: 13px; color: var(--mute); }
.pl-select, .pl-input {
  height: 42px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--line);
  background: rgba(3, 14, 18, 0.55); color: var(--sand); font: inherit; font-size: 14px;
}
.pl-select option { color: #0f172a; }
.pl-input::placeholder { color: #5f8187; }
.pl-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.pl-chip {
  cursor: pointer; border-radius: 999px; padding: 8px 14px; font: inherit; font-size: 14px;
  border: 1px solid var(--line); background: transparent; color: var(--sand); transition: background .2s, border-color .2s;
}
.pl-chip:hover { border-color: var(--foam); }
.pl-chip[aria-pressed="true"] { background: var(--foam-dim); border-color: var(--foam); color: var(--foam); }

.pl-how { display: grid; gap: 14px; }
.pl-how div { display: grid; gap: 4px; }
.pl-how strong { font-size: 14px; font-weight: 600; }
.pl-how p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--mute); }
.pl-how code, .pl-note code {
  font-size: 12.5px; padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,.08); color: #cdeee6;
}
.pl-note { margin: 0; font-size: 13px; line-height: 1.55; color: var(--mute); }
.pl-ok {
  margin: 0; padding: 10px 14px; border-radius: 12px; font-size: 13.5px;
  background: var(--foam-dim); color: var(--foam);
}

.pl-err { max-width: 620px; margin: 12vh auto 0; display: grid; gap: 10px; }
.pl-err h1 { margin: 0; font-family: "Bricolage Grotesque", sans-serif; }
.pl-err .bad { margin: 0; color: #ff9a8f; }

@media (max-width: 920px) {
  .pl-grid { grid-template-columns: minmax(0, 1fr); gap: 28px; }
}
@media (max-width: 480px) {
  .pl-root { padding: 20px 12px 40px; }
  .pl-phone { border-radius: 48px; height: clamp(600px, 86vh, 720px); }
  .pl-screen { border-radius: 38px; }
}
@media (prefers-reduced-motion: reduce) {
  .pl-ripple { animation: none; opacity: .08; transform: scale(1); }
}
`;

function SignalIcons() {
  return (
    <span className="pl-status-icons" aria-hidden="true">
      <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
        <rect x="0" y="8" width="3" height="4" rx="1" />
        <rect x="5" y="5" width="3" height="7" rx="1" />
        <rect x="10" y="2.5" width="3" height="9.5" rx="1" />
        <rect x="15" y="0" width="3" height="12" rx="1" />
      </svg>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M1 4.2a10 10 0 0 1 14 0" />
        <path d="M3.6 7a6.4 6.4 0 0 1 8.8 0" />
        <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
      </svg>
      <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
        <rect x=".75" y=".75" width="21" height="10.5" rx="3" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" />
        <rect x="2.5" y="2.5" width="15" height="7" rx="1.6" fill="currentColor" />
        <rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" fillOpacity=".5" />
      </svg>
    </span>
  );
}

export default function PhonePage() {
  const [agents, setAgents] = useState<GatewayAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [mode, setMode] = useState<PhoneCallMode>("live");
  const [localeCode, setLocaleCode] = useState(LOCALES[0].code);
  const [profileId, setProfileId] = useState("");
  const [captured, setCaptured] = useState<{ rows: number; at: string } | null>(null);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!baseUrl || !publishableKey) {
      setError("Set NEXT_PUBLIC_GATEWAY_URL and NEXT_PUBLIC_GATEWAY_KEY in .env.local first.");
      return;
    }
    const controller = new AbortController();
    listGatewayAgents({ baseUrl, publishableKey, userId }, { signal: controller.signal })
      .then((list) => {
        setAgents(list);
        setAgentId(list.find((a) => a.default)?.id ?? list[0]?.id ?? "");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message || "Could not load agents");
      });
    return () => controller.abort();
  }, []);

  const gateway = useMemo<GatewayConfig>(
    () => ({
      baseUrl,
      publishableKey,
      userId,
      ...(agentId ? { agentId } : {}),
    }),
    [agentId],
  );

  const locale = LOCALES.find((l) => l.code === localeCode) ?? LOCALES[0];
  const agentName = agents?.find((a) => a.id === agentId)?.name ?? "Service line";
  const modeTitle = MODES.find((m) => m.id === mode)?.title ?? "";

  if (error) {
    return (
      <div className="pl-root">
        <style>{css}</style>
        <main className="pl-err">
          <h1>Phone line</h1>
          <p className="bad">{error}</p>
          <p className="pl-note">The phone component talks to the gateway with the same publishable key as the chat.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="pl-root">
      <style>{css}</style>
      <main className="pl-wrap">
        <header className="pl-head">
          <a href="/" className="pl-back">← Back to chat</a>
          <h1>Phone line</h1>
          <p>
            Call the same agent by voice. Live mode listens, streams a reply and speaks it back in the dialect voice.
            Turn by turn records each utterance, transcribes it and builds a JSONL dataset for the language lab.
          </p>
        </header>

        <div className="pl-grid">
          <section className="pl-stage" aria-label="Phone">
            <div className="pl-modes" role="group" aria-label="Call mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="pl-mode"
                  aria-pressed={mode === m.id}
                  onClick={() => setMode(m.id)}
                >
                  {m.title}
                  <small>{m.hint}</small>
                </button>
              ))}
            </div>

            <div className="pl-phone-zone">
              <span className="pl-ripple" aria-hidden="true" />
              <span className="pl-ripple" aria-hidden="true" />
              <span className="pl-ripple" aria-hidden="true" />

              <div className="pl-phone">
                <div className="pl-screen">
                  <div className="pl-island" aria-hidden="true" />
                  <div className="pl-status">
                    <span>{clock || "\u00A0"}</span>
                    <SignalIcons />
                  </div>

                  <div className="pl-callhead">
                    <div className="pl-avatar" aria-hidden="true">{agentName.charAt(0).toUpperCase()}</div>
                    <div className="pl-callmeta">
                      <span className="pl-callname">{agentName}</span>
                      <span className="pl-calllang">{locale.short} · {locale.code}</span>
                    </div>
                    <span className="pl-badge">{modeTitle}</span>
                  </div>

                  <div className="pl-body">
                    <PhoneCall
                      key={`${agentId}-${mode}-${locale.code}`}
                      gateway={gateway}
                      mode={mode}
                      locale={{
                        code: locale.code,
                        name: locale.name,
                        greeting: locale.greeting,
                        profileId: profileId || undefined,
                      }}
                      ttsEndpoint="/api/tts"
                      sttEndpoint="/api/stt"
                      voiceId={voiceId || undefined}
                      agentName={agentName}
                      datasetName={`voice-${agentId || "agent"}-${locale.code}`}
                      onDataset={(rows) => setCaptured({ rows: rows.length, at: new Date().toLocaleTimeString() })}
                    />
                  </div>

                  <div className="pl-home" aria-hidden="true" />
                </div>
              </div>
            </div>
          </section>

          <section className="pl-side">
            <div className="pl-card">
              <h2>Call settings</h2>
              <label className="pl-field">
                <span>Agent</span>
                <select className="pl-select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  {(agents ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pl-field" role="group" aria-label="Dialect">
                <span>Dialect</span>
                <div className="pl-chips">
                  {LOCALES.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      className="pl-chip"
                      aria-pressed={localeCode === l.code}
                      onClick={() => setLocaleCode(l.code)}
                    >
                      {l.short}
                    </button>
                  ))}
                </div>
              </div>
              <label className="pl-field">
                <span>Locale profile id (optional, saved in the dataset)</span>
                <input
                  className="pl-input"
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value.trim())}
                  placeholder="From Localisation, open a dialect"
                />
              </label>
            </div>

            <div className="pl-card">
              <h2>Two ways to connect</h2>
              <div className="pl-how">
                <div>
                  <strong>Live call</strong>
                  <p>
                    SpeechRecognition → <code>/v1/chat</code> SSE → <code>/api/tts</code>. The line keeps listening after
                    each reply, so it feels like a real call.
                  </p>
                </div>
                <div>
                  <strong>Turn by turn</strong>
                  <p>
                    MediaRecorder clip → <code>/api/stt</code> (ElevenLabs Scribe) → agent → dataset row{" "}
                    <code>{`{ input, expected_output, locale_profile_id }`}</code>. Download it as JSONL and import it in
                    Training.
                  </p>
                </div>
              </div>
              <p className="pl-note">
                ElevenLabs is called from the server routes only, so <code>ELEVENLABS_API_KEY</code> never reaches the
                browser. Without a key the line falls back to the browser voice and typed input.
              </p>
              {captured && (
                <p className="pl-ok" role="status">
                  Export ready: {captured.rows} row{captured.rows === 1 ? "" : "s"} at {captured.at}.
                </p>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}