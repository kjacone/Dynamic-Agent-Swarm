import { NextResponse } from "next/server";

/**
 * ElevenLabs text-to-speech proxy. The API key stays on the server; the browser
 * posts `{ text, voice_id?, profile_id?, locale? }` and gets audio bytes back.
 */
const API = "https://api.elevenlabs.io/v1";
const MODEL = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_multilingual_v2";

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on the server." },
      { status: 501 },
    );
  }

  let body: { text?: string; voice_id?: string; stability?: number; similarity?: number; style?: number; speed?: number };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  if (text.length > 1200) return NextResponse.json({ error: "Keep a turn under 1200 characters." }, { status: 413 });

  const voice = body.voice_id || process.env.ELEVENLABS_VOICE_ID;
  if (!voice) {
    return NextResponse.json({ error: "No voice id — pass voice_id or set ELEVENLABS_VOICE_ID." }, { status: 400 });
  }

  const upstream = await fetch(`${API}/text-to-speech/${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: {
        stability: body.stability ?? 0.5,
        similarity_boost: body.similarity ?? 0.75,
        style: body.style ?? 0,
        speed: body.speed ?? 1,
        use_speaker_boost: true,
      },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs answered ${upstream.status}`, detail: detail.slice(0, 300) },
      { status: upstream.status === 401 ? 502 : upstream.status },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
