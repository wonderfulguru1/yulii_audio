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
        { error: "Missing required field text" },
        { status: 400 }
      );
    }

    // -----------------------------
    // STEP 1: EXTRACT DATA (NO IMAGES HERE)
    // -----------------------------
    const extraction = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
You are a strict deal extractor.

Return ONLY valid JSON:

{
  "deal_name": string | null,
  "description": string | null,
  "start_time": string | null,
  "reward": string | null
}

Rules:
- Extract only what exists in the text
- Do NOT generate images
- Do NOT invent data
- Return null if missing
`,
        },
        {
          role: "user",
          content: `Extract from: ${text}`,
        },
      ],
    });

    const raw = extraction.choices?.[0]?.message?.content;
    if (!raw) throw new Error("No OpenAI response");

    const deal: DealExtraction = JSON.parse(raw);

    // -----------------------------
    // STEP 2: VALIDATION
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
    // STEP 3: DEAL IMAGE
    // -----------------------------
    let dealImageUrl: string | null = null;

    const dealPrompt = `
Create a cinematic image showing the DEAL ACTION.

Deal: ${deal.deal_name}
Description: ${deal.description}

Style:
- realistic
- cinematic lighting
- modern advertisement
- no text
`;

    const dealImage = await openai.images.generate({
      model: "gpt-image-1",
      prompt: dealPrompt,
      size: "1024x1024",
      quality: "medium",
      n: 1,
    });

    const dealB64 = dealImage.data?.[0]?.b64_json;

    if (dealB64) {
      const buffer = Buffer.from(dealB64, "base64");

      const blob = await put(
        `deals/deal-${Date.now()}.png`,
        buffer,
        {
          access: "public",
          contentType: "image/png",
        }
      );

      dealImageUrl = blob.url;
    }

    // -----------------------------
    // STEP 4: REWARD IMAGE
    // -----------------------------
    let rewardImageUrl: string | null = null;

    const rewardPrompt = `
Create a cinematic luxury product image of the REWARD.

Reward: ${deal.reward}

Style:
- high-end product photography
- clean background
- cinematic lighting
- no text
`;

    const rewardImage = await openai.images.generate({
      model: "gpt-image-1",
      prompt: rewardPrompt,
      size: "1024x1024",
      quality: "medium",
      n: 1,
    });

    const rewardB64 = rewardImage.data?.[0]?.b64_json;

    if (rewardB64) {
      const buffer = Buffer.from(rewardB64, "base64");

      const blob = await put(
        `deals/reward-${Date.now()}.png`,
        buffer,
        {
          access: "public",
          contentType: "image/png",
        }
      );

      rewardImageUrl = blob.url;
    }

    // -----------------------------
    // STEP 5: RESPONSE
    // -----------------------------
    return NextResponse.json({
      success: true,
      deal: {
        name: deal.deal_name,
        description: deal.description,
        start_time: deal.start_time,
        reward: deal.reward,

        deal_image_url: dealImageUrl,
        reward_image_url: rewardImageUrl,

        image_source: "split_deal_reward_images",
      },
    });
  } catch (err: unknown) {
    console.error(err);

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

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}

// -----------------------------
// HEALTH CHECK
// -----------------------------
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/transcribe",
  });
}
