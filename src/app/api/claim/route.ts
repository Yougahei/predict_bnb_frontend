import { NextResponse } from "next/server";
import { listBetLogs, markAsClaimed } from "@/lib/betStore";
import { getConfig } from "@/lib/configStore";
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
    const checkResults = await Promise.all(
      successBets.map(async (bet) => {
        const isClaimable = await checkClaimable(bet.epoch, walletAddress);
        return isClaimable ? bet.epoch : null;
      })
    );

    const claimableEpochs = checkResults.filter((e): e is number => e !== null);

    return NextResponse.json({ claimable_epochs: claimableEpochs });
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
    if (!privateKey) {
      return NextResponse.json({ error: "private_key_missing" }, { status: 400 });
    }

    const result = await claimRewards(privateKey, epochs);
    if (result?.hash) {
      markAsClaimed(epochs);
      return NextResponse.json({ success: true, hash: result.hash });
    } else {
      throw new Error("Claim transaction failed");
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
