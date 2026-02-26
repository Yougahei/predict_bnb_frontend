import { NextResponse } from "next/server";
import { getSimState, tickSim } from "@/lib/simStore";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const simId = searchParams.get("simId") || "default";
  
  // Tick simulation on every poll if running
  const state = await tickSim(simId);
  return NextResponse.json(state);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, simId = "default", amount, strategy } = body;
    const state = getSimState(simId);

    if (action === "start") {
      state.running = true;
      state.balance = amount;
      state.start_balance = amount;
      state.started_at = Date.now();
      state.strategy = strategy || "balanced";
      state.history = [];
      state.stats = {
        trades: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
        max_drawdown: 0,
        peak_balance: amount,
      };
      state.status = "已启动";
      state.open_bet = null;
      state.last_attempt_epoch = null;
    } else if (action === "stop") {
      state.running = false;
      state.status = "已停止";
    }

    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: "failed" }, { status: 400 });
  }
}
