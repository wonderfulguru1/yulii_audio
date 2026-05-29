import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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
}

export async function POST(req: NextRequest) {
  try {
    let text: string;
    try {
      const body = await req.json();
      text = body?.text;
    } catch {
      return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    }

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: 'Missing required field "text".' },
        { status: 400 }
      );
    }

    // Step 1: Extract structured deal info from text
    const extractionMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are a deal information extractor. Extract deal details from text and return a JSON object with exactly these fields:

- deal_name: string | null — the name or title of the deal
- description: string | null — a description of the deal; if not explicitly mentioned, generate a compelling one from context; set null only if there is not enough context
- start_time: string | null — when the deal starts or is available, preserved exactly as mentioned
- reward: string | null — what the customer receives, the reward or benefit of the deal
- image_description: string | null — if a specific picture/image is described (e.g. "use a burger image", "show a red car"), capture that description; otherwise null

Only set a field to null if it is truly absent and cannot be reasonably inferred.`,
      },
      {
        role: "user",
        content: `Text: "${text}"`,
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

    // Step 2: Validate required fields
    const missing: string[] = [];
    if (!deal.deal_name) missing.push("deal name");
    if (!deal.start_time) missing.push("start time");
    if (!deal.reward) missing.push("reward");

    if (missing.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `The text is missing required information: ${missing.join(", ")}.`,
          missing,
        },
        { status: 422 }
      );
    }

    // Step 3: Generate image
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

    return NextResponse.json(
      {
        success: true,
      //  prompt_sent_to_llm: extractionMessages,
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "POST /api/transcribe",
    body: { text: "string — the deal description text" },
    required_in_text: ["deal name", "start time", "reward"],
    optional_in_text: ["description", "picture description"],
  });
}
