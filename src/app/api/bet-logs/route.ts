import { NextResponse } from "next/server";
import { listBetLogs, getBetStats, updateBetStatus } from "@/lib/betStore";
import { getConfig } from "@/lib/configStore";
import { checkClaimable, fetchBalance, fetchLivePrice } from "@/lib/onchain";

export async function GET() {
  try {
    const walletAddress = getConfig("WALLET_ADDRESS");
    const logs = listBetLogs(50, walletAddress || undefined);
    
    // Check claim status for recent winning bets that are not marked as claimed
    if (walletAddress) {
      const pendingClaims = logs.filter(
        l => l.status === "SUCCESS" && l.claimed === 0 && l.actual_side && l.side === l.actual_side
      );
      
      if (pendingClaims.length > 0) {
        // Run checks in parallel
        await Promise.all(pendingClaims.map(async (log) => {
          try {
            // checkClaimable returns true if rewards are still waiting to be claimed.
            // If it returns false, it means rewards are either 0 or ALREADY CLAIMED.
            // Since we know this was a winning bet (side === actual_side), false means ALREADY CLAIMED.
            const isClaimable = await checkClaimable(log.epoch, walletAddress);
            if (!isClaimable) {
              // Mark as claimed in DB
              // The updateBetStatus function signature is: (id, status, txHash?, error?, claimed?)
              // We pass 'SUCCESS' as status (no change), undefined for txHash/error, and 1 for claimed.
              updateBetStatus(log.id, "SUCCESS", undefined, undefined, 1);
              // Update local log object for immediate response
              log.claimed = 1;
            }
          } catch (e) {
            console.error(`Claim check failed for ${log.epoch}`, e);
          }
        }));
      }
    }

    const stats = getBetStats(walletAddress || undefined);
    
    let balance = 0;
    let bnbPrice = 0;
    
    // Fetch live BNB price for USD conversion
    try {
      const priceData = await fetchLivePrice();
      if (priceData && priceData.price) {
        bnbPrice = priceData.price;
      }
    } catch (e) {
      console.error("fetchLivePrice error", e);
    }

    if (walletAddress) {
      try {
        const bal = await fetchBalance(walletAddress);
        if (bal !== null) balance = bal;
      } catch (e) {
        console.error("fetchBalance error", e);
      }
    }

    return NextResponse.json({ logs, stats, balance, bnbPrice });
  } catch (error: any) {
    console.error("bet-logs error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
