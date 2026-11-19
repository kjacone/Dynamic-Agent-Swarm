import { NextResponse } from "next/server";

/**
 * ElevenLabs speech-to-text proxy (Scribe). Accepts multipart `file` (and an
 * optional `language_code`) and returns `{ text, language_code, language_probability }`.
 */
const API = "https://api.elevenlabs.io/v1";
const MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v1";

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on the server." },
      { status: 501 },
    );
  }

  const incoming = await request.formData();
  const file = incoming.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach the recorded clip as `file`." }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Clips must be under 25 MB." }, { status: 413 });
  }

  const language = String(incoming.get("language_code") ?? process.env.ELEVENLABS_STT_LANGUAGE ?? "").trim();
  const form = new FormData();
  form.append("file", file, file.name || "clip.webm");
  form.append("model_id", MODEL);
  if (language) form.append("language_code", language);

  const upstream = await fetch(`${API}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `ElevenLabs answered ${upstream.status}`, detail: detail.slice(0, 300) },
      { status: upstream.status === 401 ? 502 : upstream.status },
    );
  }

  const data = await upstream.json() as {
    text?: string;
    language_code?: string;
    language_probability?: number;
  };

  return NextResponse.json({
    text: (data.text ?? "").trim(),
    language_code: data.language_code ?? language ?? null,
    language_probability: data.language_probability ?? null,
  });
}
