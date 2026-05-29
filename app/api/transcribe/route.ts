
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { put } from "@vercel/blob";

export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface DealExtraction {
  deal_name: string | null;
  description: string | null;
  start_time: string | null;
  reward: string | null;
  image_description: string | null; // OPTIONAL now (not trusted)
  image_url: string | null;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error("Missing BLOB_READ_WRITE_TOKEN");
    }

    let text: string;

    try {
      const body = await req.json();
      text = body?.text;
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 }
      );
    }

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: 'Missing required field "text"' },
        { status: 400 }
      );
    }

    // -----------------------------
    // STEP 1: Extract structured data ONLY
    // -----------------------------
    const extractionMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `
You are a strict deal information extractor.

IMPORTANT:
- Return ONLY valid JSON
- No markdown
- No explanations
- No extra fields
- Do NOT invent images

Return:

{
  "deal_name": string | null,
  "description": string | null,
  "start_time": string | null,
  "reward": string | null,
  "image_description": null,
  "image_url": null
}

RULES:
- Extract only what is explicitly in the text
- If missing, return null
- DO NOT generate image descriptions
`,
      },
      {
        role: "user",
        content: `Extract deal info from this text:\n${text}`,
      },
    ];

    const extraction = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: extractionMessages,
    });

    const raw = extraction.choices?.[0]?.message?.content;

    if (!raw) {
      throw new Error("No response from OpenAI");
    }

    const deal: DealExtraction = JSON.parse(raw);

    // -----------------------------
    // STEP 2: Validation
    // -----------------------------
    const missing: string[] = [];

    if (!deal.deal_name) missing.push("deal name");
    if (!deal.start_time) missing.push("start time");
    if (!deal.reward) missing.push("reward");

    if (missing.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing required fields: ${missing.join(", ")}`,
        },
        { status: 422 }
      );
    }

    // -----------------------------
    // STEP 3: IMAGE = DERIVED FROM REWARD ONLY
    // -----------------------------
    const imagePrompt = deal.reward
      ? `Create a high-quality, modern advertising image of: ${deal.reward}.
         Clean background, realistic lighting, premium marketing style, no text overlays.`
      : null;

    let imageUrl: string | null = null;

    if (imagePrompt) {
      const imageResponse = await openai.images.generate({
        model: "gpt-image-1",
        prompt: imagePrompt,
        size: "1024x1024",
        quality: "medium",
        n: 1,
      });

      const b64 = imageResponse.data?.[0]?.b64_json;

      if (b64) {
        const buffer = Buffer.from(b64, "base64");

        const filename = `deals/${Date.now()}-${Math.random()
          .toString(36)
          .substring(2)}.png`;

        const blob = await put(filename, buffer, {
          access: "public",
          contentType: "image/png",
        });

        imageUrl = blob.url;
      }
    }

    // -----------------------------
    // STEP 4: RESPONSE
    // -----------------------------
    return NextResponse.json({
      success: true,
      deal: {
        name: deal.deal_name,
        description: deal.description,
        start_time: deal.start_time,
        reward: deal.reward,
        image_url: imageUrl,
        image_source: "derived_from_reward",
      },
    });
  } catch (err: unknown) {
    if (err instanceof OpenAI.APIError) {
      return NextResponse.json(
        {
          success: false,
          error: "OpenAI API error",
          detail: err.message,
        },
        { status: err.status || 500 }
      );
    }

    console.error(err);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/transcribe",
  });
}
          
            
