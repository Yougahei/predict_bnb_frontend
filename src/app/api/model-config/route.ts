import { NextResponse } from "next/server";
import { getModelConfig, updateModelConfig } from "@/lib/modelConfig";

export async function GET() {
  const config = getModelConfig();
  return NextResponse.json(config);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const updated = updateModelConfig(body);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating model config", error);
    return NextResponse.json(
      { error: "invalid_body" },
      { status: 400 },
    );
  }
}

