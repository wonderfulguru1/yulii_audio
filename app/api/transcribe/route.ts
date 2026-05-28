import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ALLOWED_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "video/webm",
];

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface DealExtraction {
  deal_name: string | null;
  description: string | null;
  start_time: string | null;
  reward: string | null;
  image_description: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Failed to parse form data" },
        { status: 400 }
      );
    }

    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file found. Send the file under the field name "audio".' },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(audioFile.type)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${audioFile.type}`,
          supported: ["mp3", "mp4", "m4a", "wav", "webm", "ogg", "flac"],
        },
        { status: 415 }
      );
    }

    if (audioFile.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
          receivedMB: (audioFile.size / 1024 / 1024).toFixed(2),
        },
        { status: 413 }
      );
    }

    // Step 1: Transcribe audio
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "text",
    });
    const transcript = transcription as unknown as string;

    // Step 2: Extract structured deal info from transcript
    const extractionMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are a deal information extractor. Extract deal details from audio transcripts and return a JSON object with exactly these fields:

- deal_name: string | null — the name or title of the deal
- description: string | null — a description of the deal; if not explicitly mentioned, generate a compelling one from context; set null only if there is not enough context
- start_time: string | null — when the deal starts or is available, preserved exactly as mentioned by the speaker
- reward: string | null — what the customer receives, the reward or benefit of the deal
- image_description: string | null — if the speaker described or mentioned a specific picture/image they want (e.g. "use a burger image", "show a red car"), capture that description; otherwise null

Only set a field to null if it is truly absent and cannot be reasonably inferred.`,
      },
      {
        role: "user",
        content: `Transcript: "${transcript}"`,
      },
    ];

    const extraction = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: extractionMessages,
    });

    const deal = JSON.parse(
      extraction.choices[0].message.content!
    ) as DealExtraction;

    // Step 3: Validate required fields
    const missing: string[] = [];
    if (!deal.deal_name) missing.push("deal name");
    if (!deal.start_time) missing.push("start time");
    if (!deal.reward) missing.push("reward");

    if (missing.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `The audio is missing required information: ${missing.join(", ")}.`,
          missing,
          transcript,
        },
        { status: 422 }
      );
    }

    // Step 4: Generate image with DALL-E 3
    const imagePrompt = deal.image_description
      ? deal.image_description
      : `A vibrant, eye-catching promotional marketing image for a deal called "${deal.deal_name}". ${deal.description}. Professional advertising style, no text overlays.`;

    const imageResponse = await openai.images.generate({
      model: "gpt-image-1",
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
    });

    const b64 = imageResponse.data?.[0]?.b64_json ?? null;
    const imageUrl = b64 ? `data:image/png;base64,${b64}` : null;

    // Step 5: Return structured deal
    return NextResponse.json(
      {
        success: true,
        transcript,
        prompt_sent_to_llm: extractionMessages,
        deal: {
          name: deal.deal_name,
          description: deal.description,
          start_time: deal.start_time,
          reward: deal.reward,
          image_data: imageUrl,
          image_source: deal.image_description ? "user_described" : "auto_generated",
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof OpenAI.APIError) {
      console.error("OpenAI API error:", err.status, err.message);
      return NextResponse.json(
        { error: "Processing failed", detail: err.message },
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

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/transcribe",
    field: "audio",
    max_size_mb: MAX_FILE_SIZE_MB,
    supported_formats: ["mp3", "mp4", "m4a", "wav", "webm", "ogg", "flac"],
    required_in_audio: ["deal name", "start time", "reward"],
    optional_in_audio: ["description", "picture description"],
  });
}
