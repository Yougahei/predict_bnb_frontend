import { NextResponse } from "next/server";
import { listBetLogs, markAsClaimed } from "@/lib/betStore";
import { getConfig, getDb } from "@/lib/configStore";
import { checkClaimable, claimRewards, getAddressFromPrivateKey } from "@/lib/onchain";

export async function GET() {
  try {
    const logs = await listBetLogs(50);
    const successBets = logs.filter(l => l.status === "SUCCESS" && l.claimed === 0);
    
    if (successBets.length === 0) {
      return NextResponse.json({ claimable_epochs: [] });
    }

    const walletAddress = await getConfig("WALLET_ADDRESS");
    if (!walletAddress) {
      return NextResponse.json({ error: "wallet_not_configured" }, { status: 400 });
    }

    // Check on-chain which epochs are actually claimable
    // Also fetch close_ts from round_history to calculate timeout
    const conn = await getDb();
    const claimableEpochs = [];
    
    for (const bet of successBets) {
      const isClaimable = await checkClaimable(bet.epoch, walletAddress);
      if (isClaimable) {
        // Fetch round history
        const res = await conn.query("SELECT close_ts FROM round_history WHERE epoch = $1", [bet.epoch]);
        const row = res.rows[0];
        claimableEpochs.push({
          epoch: bet.epoch,
          close_ts: row?.close_ts ? Number(row.close_ts) / 1000 : Math.floor(Date.now() / 1000)
        });
      }
    }
    
    return NextResponse.json({ 
      claimable_epochs: claimableEpochs.map(e => e.epoch),
      details: claimableEpochs
    });
  } catch (error) {
    console.error("claim check error", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { epochs } = body;

    if (!epochs || !Array.isArray(epochs) || epochs.length === 0) {
      return NextResponse.json({ error: "invalid_epochs" }, { status: 400 });
    }

    const privateKey = await getConfig("WALLET_PRIVATE_KEY");
    if (!privateKey) {
      return NextResponse.json({ error: "wallet_not_configured" }, { status: 400 });
    }

    const res = await claimRewards(privateKey, epochs);
    if (res && res.hash) {
      // Mark as claimed in DB
      await markAsClaimed(epochs);
      return NextResponse.json({ success: true, hash: res.hash });
    } else {
      return NextResponse.json({ error: "claim_failed", details: "Transaction failed or no hash returned" }, { status: 500 });
    }
  } catch (error: any) {
    console.error("Claim error:", error);
    return NextResponse.json({ error: "failed", details: error?.message || String(error) }, { status: 500 });
  }
}
