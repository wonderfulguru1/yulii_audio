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
  image_description: string | null;
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

    // STEP 1: Extract structured deal information
    const extractionMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are an advanced AI deal information extractor. Your task is to extract structured deal information from user text.

IMPORTANT RULES:
- Return ONLY valid JSON
- Do NOT return markdown
- Do NOT wrap the response in \`\`\`
- Do NOT include explanations
- Do NOT include extra fields
- Always return every field
- Use null only if information truly cannot be inferred

Return this exact JSON structure:
{
  "deal_name": string | null,
  "description": string | null,
  "start_time": string | null,
  "reward": string | null,
  "image_description": string | null,
  "image_url": string | null
}

FIELD RULES:
deal_name: Extract the title or name of the deal/task
description: Generate a compelling and clean description — short but meaningful
start_time: Preserve exactly how the user mentioned the time
reward: Extract what the user receives after completion
image_description: If the user mentions an image, poster, object, color, or visual style, capture it — otherwise generate a professional promotional image description
image_url: Always return null`,
      },
      {
        role: "user",
        content: `Extract deal information from this text: ${text}`,
      },
    ];

    const extraction = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: extractionMessages,
    });

    // STEP 2: Safely parse AI response
    const rawContent = extraction.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("No content returned from OpenAI");
    }

    let deal: DealExtraction;
    try {
      deal = JSON.parse(rawContent);
    } catch {
      throw new Error("Invalid JSON returned from OpenAI");
    }

    // STEP 3: Validate required fields
    const missing: string[] = [];
    if (!deal.deal_name) missing.push("deal name");
    if (!deal.start_time) missing.push("start time");
    if (!deal.reward) missing.push("reward");

    if (missing.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing required information: ${missing.join(", ")}`,
          missing,
        },
        { status: 422 }
      );
    }

    // STEP 4: Build image prompt
    const imagePrompt = deal.image_description
      ? `${deal.image_description}. High quality promotional advertisement style, vibrant lighting, realistic, modern marketing design, no text overlays.`
      : `Create a professional promotional advertisement image for a deal called "${deal.deal_name}". Reward: ${deal.reward} Description: ${deal.description} Style: modern marketing banner, realistic, eye-catching, high quality, vibrant lighting, no text overlays.`;

    // STEP 5: Generate image
    const imageResponse = await openai.images.generate({
      model: "gpt-image-1",
      prompt: imagePrompt,
      size: "1024x1024",
      quality: "medium",
      n: 1,
    });

    const b64 = imageResponse.data?.[0]?.b64_json;
    let imageUrl: string | null = null;

    // STEP 6: Upload image to Vercel Blob
    if (b64) {
      const buffer = Buffer.from(b64, "base64");
      const filename = `deals/${Date.now()}-${Math.random().toString(36).substring(2)}.png`;
      const blob = await put(filename, buffer, {
        access: "public",
        contentType: "image/png",
      });
      imageUrl = blob.url;
    }

    // STEP 7: Return final response
    return NextResponse.json(
      {
        success: true,
        deal: {
          name: deal.deal_name,
          description: deal.description,
          start_time: deal.start_time,
          reward: deal.reward,
          image_description: deal.image_description,
          image_url: imageUrl,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof OpenAI.APIError) {
      console.error("OpenAI API Error:", err.status, err.message);
      return NextResponse.json(
        { success: false, error: "OpenAI processing failed", detail: err.message },
        { status: err.status || 500 }
      );
    }

    console.error("Unexpected Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/transcribe",
    body: { text: "string" },
    required_fields_in_text: ["deal name", "start time", "reward"],
    optional_fields_in_text: ["description", "image description"],
  });
}

