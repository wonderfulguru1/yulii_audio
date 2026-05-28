import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// ─── Config ───────────────────────────────────────────────────────────────────
// Vercel Hobby:  max 4.5 MB body, 10s timeout
// Vercel Pro:    max 4.5 MB body, 60s timeout  ← recommended for audio
// Set this in your Vercel dashboard → Project → Settings → Functions
export const maxDuration = 60; // seconds (requires Vercel Pro)

// ─── OpenAI client ────────────────────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ─── Allowed audio MIME types ─────────────────────────────────────────────────
const ALLOWED_TYPES = [
  "audio/mpeg",       // .mp3
  "audio/mp4",        // .m4a
  "audio/wav",        // .wav
  "audio/x-wav",      // .wav (alternate)
  "audio/webm",       // .webm
  "audio/ogg",        // .ogg
  "audio/flac",       // .flac
  "video/mp4",        // .mp4 (Whisper handles video too)
  "video/webm",       // .webm video
];

const MAX_FILE_SIZE_MB = 25; // Whisper API limit
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// ─── Route handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // 1. Validate Content-Type
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      );
    }

    // 2. Parse the form data
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Failed to parse form data" },
        { status: 400 }
      );
    }

    // 3. Extract the audio file (field name: "audio")
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file found. Send the file under the field name "audio".' },
        { status: 400 }
      );
    }

    // 4. Validate file type
    if (!ALLOWED_TYPES.includes(audioFile.type)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${audioFile.type}`,
          supported: ["mp3", "mp4", "m4a", "wav", "webm", "ogg", "flac"],
        },
        { status: 415 }
      );
    }

    // 5. Validate file size
    if (audioFile.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
          receivedMB: (audioFile.size / 1024 / 1024).toFixed(2),
        },
        { status: 413 }
      );
    }

    // 6. Optional: get language hint from form data (e.g. "en", "fr", "yo")
    const language = (formData.get("language") as string | null) || undefined;

    // 7. Optional: get response format (default: "json")
    const responseFormat =
      (formData.get("response_format") as string | null) || "json";

    // 8. Transcribe with Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language,                    // optional ISO-639-1 code
      response_format: responseFormat as "json" | "text" | "srt" | "vtt" | "verbose_json",
    });

    // 9. Return result
    const text =
      typeof transcription === "string"
        ? transcription                // text / srt / vtt format
        : transcription.text;          // json / verbose_json format

    return NextResponse.json(
      {
        success: true,
        text,
        language: language || "auto-detected",
        duration_seconds:
          "duration" in transcription ? transcription.duration : undefined,
        file: {
          name: audioFile.name,
          type: audioFile.type,
          size_bytes: audioFile.size,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    // Handle OpenAI API errors gracefully
    if (err instanceof OpenAI.APIError) {
      console.error("OpenAI API error:", err.status, err.message);
      return NextResponse.json(
        { error: "Transcription failed", detail: err.message },
        { status: err.status || 500 }
      );
    }

    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/transcribe",
    field: "audio",
    max_size_mb: MAX_FILE_SIZE_MB,
    supported_formats: ["mp3", "mp4", "m4a", "wav", "webm", "ogg", "flac"],
  });
}
