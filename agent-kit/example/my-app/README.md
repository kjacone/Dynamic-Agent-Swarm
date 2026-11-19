# Example app

Next.js customer app for `langgraph-kit`. It has three surfaces:

- `/` — chat: lists the agents the publishable key may use, then opens `ChatSidebar` (gateway mode), or the original `Playground` when no gateway is configured.
- `/orders`, `/reports` — pages that register `useAgentReadable` / `useAgentTool` for the copilot.
- `/phone` — the `<PhoneCall>` surface: live voice turn-taking, or turn-by-turn recording that collects a JSONL dataset for the language lab.

## Environment

Create `.env.local` (or `.env`) in this directory:

```bash
# gateway the agent is served from (dashboard → Agents → publish)
NEXT_PUBLIC_GATEWAY_URL=http://localhost:8000
NEXT_PUBLIC_GATEWAY_KEY=pk_test_…
NEXT_PUBLIC_GATEWAY_USER=demo-user

# optional: dialect voice (voice ids are public; the key is not)
NEXT_PUBLIC_ELEVENLABS_VOICE_ID=
```

Server-only, for the phone line's `/api/tts` and `/api/stt` routes:

```bash
ELEVENLABS_API_KEY=
# optional overrides
ELEVENLABS_VOICE_ID=
ELEVENLABS_TTS_MODEL=eleven_multilingual_v2
ELEVENLABS_STT_MODEL=scribe_v1
ELEVENLABS_STT_LANGUAGE=
```

`ELEVENLABS_API_KEY` is read in the route handlers and never sent to the browser. Without it the phone line falls back to the browser voice and typed input, and recorded turns still collect.

## Run

```bash
npm install
npm run build   # in ../.. first, the app imports the built kit
npm run dev
```

Open <http://localhost:3000/phone> for the phone line.
