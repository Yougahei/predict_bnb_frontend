import { NextResponse } from "next/server";
import { listLLMProfiles, upsertLLMProfile, deleteLLMProfile } from "@/lib/modelStore";

export async function GET() {
  const profiles = listLLMProfiles(true);
  return NextResponse.json(profiles);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, ...profile } = body;

    if (action === "delete") {
      deleteLLMProfile(profile.name);
      return NextResponse.json({ success: true });
    }

    upsertLLMProfile({
      name: profile.name,
      endpoint: profile.endpoint,
      model: profile.model,
      api_key: profile.api_key,
      enabled: profile.enabled !== false,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error managing LLM profile", error);
    return NextResponse.json({ error: "failed" }, { status: 400 });
  }
}
