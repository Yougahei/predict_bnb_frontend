import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/snapshot";

export async function GET() {
  try {
    const data = await buildSnapshot({ autoBet: false });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error building snapshot:", error);
    return NextResponse.json(
      { error: "failed_to_build_snapshot", details: error?.message || String(error) },
      { status: 500 },
    );
  }
}
