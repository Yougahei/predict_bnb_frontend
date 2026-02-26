import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/snapshot";
import { scheduleLLMPredictions } from "@/lib/llmClient";

export async function POST(req: Request) {
  try {
    const snapshot = await buildSnapshot();
    const { round, price, recent_rounds } = snapshot;
    const epoch = round.epoch;

    if (!epoch) {
      return NextResponse.json({ error: "no_active_round" }, { status: 400 });
    }

    const payload = {
      timestamp: Date.now(),
      price,
      round: {
        epoch,
        lock_price: round.lock_price,
        close_price: round.close_price,
        lock_ts: round.lock_ts,
        close_ts: round.close_ts,
        time_left_sec: round.time_left_sec,
      },
      recent_rounds: recent_rounds.slice(0, 6).map((r) => ({
        epoch: r.epoch,
        result: r.result,
        lock_price: r.lock_price,
        close_price: r.close_price,
        total_amount: r.total_amount,
        bull_amount: r.bull_amount,
        bear_amount: r.bear_amount,
        up_payout: r.up_payout,
        down_payout: r.down_payout,
      })),
    };

    // Use scheduleLLMPredictions which bypasses the auto-predict config check
    // since it's a direct user request.
    await scheduleLLMPredictions(epoch, payload);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("LLM manual analysis error", error);
    return NextResponse.json({ error: error?.message || "failed" }, { status: 500 });
  }
}
