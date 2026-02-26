import { NextResponse } from "next/server";
import { listBetLogs, markAsClaimed } from "@/lib/betStore";
import { getConfig, getDb } from "@/lib/configStore";
import { checkClaimable, claimRewards } from "@/lib/onchain";
import { Wallet } from "ethers";

export async function GET() {
  try {
    const logs = listBetLogs(50);
    const successBets = logs.filter(l => l.status === "SUCCESS" && l.claimed === 0);
    
    if (successBets.length === 0) {
      return NextResponse.json({ claimable_epochs: [] });
    }

    const walletAddress = getConfig("WALLET_ADDRESS");
    if (!walletAddress) {
      return NextResponse.json({ error: "wallet_not_configured" }, { status: 400 });
    }

    // Check on-chain which epochs are actually claimable
    // Also fetch close_ts from round_history to calculate timeout
    const conn = getDb();
    const claimableEpochs = [];
    
    for (const bet of successBets) {
      const isClaimable = await checkClaimable(bet.epoch, walletAddress);
      if (isClaimable) {
        // Fetch round history
        const row = conn.prepare("SELECT close_ts FROM round_history WHERE epoch = ?").get(bet.epoch) as { close_ts: number } | undefined;
        claimableEpochs.push({
          epoch: bet.epoch,
          close_ts: row?.close_ts ? row.close_ts / 1000 : Math.floor(Date.now() / 1000) // Convert to seconds if needed, usually stored as ms in round_history? Check historyStore.
        });
      }
    }
    // round_history stores close_ts as ms (from onchain.ts fetchRound: close_ts * 1000). 
    // Wait, onchain.ts fetchRound multiplies by 1000. So DB stores ms.
    // Let's verify storage format in historyStore.ts or configStore.ts.
    // configStore.ts: close_ts INTEGER.
    // historyStore.ts: upsertRounds passes data.close_ts directly.
    // onchain.ts: fetchRound returns close_ts * 1000.
    // So DB has ms.
    
    // We return seconds to frontend for consistency with other timestamps if needed, or ms.
    // Let's return ms to be safe and let frontend handle it, or seconds.
    // Actually, onchain.ts returns ms.
    
    return NextResponse.json({ 
      claimable_epochs: claimableEpochs.map(e => e.epoch),
      claimable_details: claimableEpochs // New field with details
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { epochs } = await req.json();
    if (!epochs || !Array.isArray(epochs) || epochs.length === 0) {
      return NextResponse.json({ error: "invalid_epochs" }, { status: 400 });
    }

    const privateKey = getConfig("WALLET_PRIVATE_KEY");
    const walletAddress = getConfig("WALLET_ADDRESS");
    if (!privateKey) {
      return NextResponse.json({ error: "private_key_missing" }, { status: 400 });
    }
    if (!walletAddress) {
      return NextResponse.json({ error: "wallet_not_configured" }, { status: 400 });
    }

    // Double-check on-chain eligibility to avoid reverts
    const checks = await Promise.all(
      epochs.map(async (e: number) => {
        try {
          const ok = await checkClaimable(e, walletAddress);
          return ok ? e : null;
        } catch {
          return null;
        }
      })
    );
    const toClaim = checks.filter((e): e is number => e !== null);
    if (toClaim.length === 0) {
      return NextResponse.json({ error: "no_eligible_epochs" }, { status: 400 });
    }

    const result = await claimRewards(privateKey, toClaim);
    if (result?.hash) {
      markAsClaimed(toClaim);
      return NextResponse.json({ success: true, hash: result.hash });
    } else {
      throw new Error("Claim transaction failed");
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
