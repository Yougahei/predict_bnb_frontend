import { getConfig } from "./configStore";
import { placeBet, fetchBalance, fetchCurrentRound, getAddressFromPrivateKey } from "./onchain";
import { logBet, updateBetStatus, listBetLogs, acquireBetLock } from "./betStore";
import { AnyDict } from "./prediction";

const PENDING_TIMEOUTS = new Map<number, NodeJS.Timeout>();
const PROCESSING_EPOCHS = new Set<number>();

export async function runAutoBetLogic(epoch: number, voteSummary: AnyDict | null): Promise<void> {
  // 0. 全局互斥锁：确保同一时间针对同一 epoch 只有一个执行流在运行
  if (PROCESSING_EPOCHS.has(epoch)) return;
  PROCESSING_EPOCHS.add(epoch);

  try {
    const enabled = getConfig("AUTO_BET_ENABLED") === "1";
    if (!enabled || !voteSummary || !epoch) return;

    // 提前释放锁逻辑：如果不需要立即执行下注（例如已下注、或时间未到），必须尽快释放锁
    
    const logs = listBetLogs(10);
    const alreadyBet = logs.some(l => l.epoch === epoch && l.status !== "FAILED");
    if (alreadyBet) {
      if (PENDING_TIMEOUTS.has(epoch)) {
        clearTimeout(PENDING_TIMEOUTS.get(epoch));
        PENDING_TIMEOUTS.delete(epoch);
      }
      return;
    }

    // 2. Check if we have a pending timeout for this epoch
    if (PENDING_TIMEOUTS.has(epoch)) return;

    // 3. Timing logic
    try {
      const roundData = await fetchCurrentRound();
      if (!roundData || roundData.epoch !== epoch) {
        console.log(`[AutoBet] Current round ${roundData?.epoch} doesn't match target epoch ${epoch}, skipping.`);
        return;
      }

      // 双重检查：在发起网络请求获取 Round 数据期间，可能已经有其他线程完成了下注
      const freshLogs = listBetLogs(5);
      if (freshLogs.some(l => l.epoch === epoch && l.status !== "FAILED")) {
          console.log(`[AutoBet] Epoch ${epoch} 已检测到最新下注记录，终止本次尝试`);
          if (PENDING_TIMEOUTS.has(epoch)) {
              clearTimeout(PENDING_TIMEOUTS.get(epoch));
              PENDING_TIMEOUTS.delete(epoch);
          }
          return;
      }

      const lockTs = roundData.lock_ts; // milliseconds
      const now = Date.now();
      const timeLeftMs = lockTs - now;
      const timeLeftSec = timeLeftMs / 1000;

      const TARGET_LEAD_TIME = 28; // Aim for 28 seconds before lock

      // If it's more than the target lead time + buffer, schedule a timeout
      if (timeLeftSec > TARGET_LEAD_TIME + 5) {
        // 用户要求“只发一次请求就算了，不用再安排另外两次请求了”
        // 因此这里不再进行 setTimeout 递归调用，而是直接退出。
        // 依靠外部轮询（每 10 秒或 30 秒）再次触发时，如果时间到了自然会执行。
        console.log(`[AutoBet] Epoch ${epoch} is ${timeLeftSec.toFixed(0)}s away. Too early to bet (Target: ${TARGET_LEAD_TIME}s). Waiting for next poll.`);
        return;
      }

      // If the round is already locked or about to lock in less than 2 seconds, it might be too late
      if (timeLeftSec < 2) {
        console.warn(`[AutoBet] Too late for epoch ${epoch} (${timeLeftSec.toFixed(0)}s left), skipping.`);
        return;
      }

      // 最终保险：在准备私钥和计算金额前，再次确认是否已经下注
      const finalCheckLogs = listBetLogs(5);
      if (finalCheckLogs.some(l => l.epoch === epoch && l.status !== "FAILED")) {
        return;
      }
      
      console.log(`[AutoBet] Executing bet for epoch ${epoch}: ${timeLeftSec.toFixed(0)}s left before lock.`);
    } catch (err) {
      console.error("[AutoBet] Timing/Scheduling error", err);
      return;
    }

    // 只有在确定要立即执行下注时，才解析决策
    const decision = voteSummary.decision as string | null;
    if (!decision || decision === "ABSTAIN") return;
    const side = decision as "UP" | "DOWN";

    // 获取数据库互斥锁
    // 只有第一个成功的会返回 true，后续都会因为主键冲突返回 false
    const locked = acquireBetLock(epoch);
    if (!locked) {
      console.log(`[AutoBet] Failed to acquire lock for epoch ${epoch}, another process is handling it.`);
      return;
    }

    const privateKey = getConfig("WALLET_PRIVATE_KEY") || "";
    const walletAddress = getConfig("WALLET_ADDRESS") || getAddressFromPrivateKey(privateKey) || "";
    
    if (!privateKey || !walletAddress) {
      console.error("[AutoBet] Failed: Wallet credentials or address not configured");
      return;
    }

    const percentageStr = getConfig("BET_PERCENTAGE", "10") || "10";
    const percentage = parseFloat(percentageStr);

    // Calculate amount based on percentage of balance
    let amount = 0;
    try {
      const balance = await fetchBalance(walletAddress);
      if (balance === null) throw new Error("Could not fetch wallet balance");
      
      // Safety margin for gas (keep at least 0.002 BNB)
      const safetyMargin = 0.002;
      const availableBalance = Math.max(0, balance - safetyMargin);
      amount = (availableBalance * percentage) / 100;

      // Minimum bet check (PancakeSwap usually requires some min amount, but 0.001 is a safe floor for logic)
      if (amount < 0.0001) {
        console.warn(`[AutoBet] Calculated amount ${amount} too small, skipping.`);
        return;
      }
      
      // Cap at available balance
      amount = Math.min(amount, availableBalance);
    } catch (err) {
      console.error("[AutoBet] Balance calculation error", err);
      return;
    }

    // Log initial pending bet
    const betId = logBet({
      epoch,
      side,
      amount,
      tx_hash: null,
      status: "PENDING",
      error: null,
      claimed: 0,
      wallet_address: walletAddress,
    });

    try {
      // 再次检查，防止在 logBet 之后有其他进程刚好完成
      const doubleCheck = listBetLogs(5);
      // 这里的检查逻辑要放宽，只要有 SUCCESS 状态的，或者是同一个 epoch 的 PENDING 且 id 不是当前 betId 的，都算重复
      const existingBet = doubleCheck.find(l => 
        l.epoch === epoch && 
        l.id !== betId &&
        (l.status === "SUCCESS" || l.status === "PENDING")
      );

      if (existingBet) {
         console.log(`[AutoBet] Detected existing bet for ${epoch} (ID: ${existingBet.id}, Status: ${existingBet.status}), aborting current bet ${betId}.`);
         // 既然已经有别的记录占坑了，那当前这条记录就没必要发交易了，直接标为 FAILED
         updateBetStatus(betId, "FAILED", undefined, "Duplicate bet prevented (race condition)");
         return;
      }

      console.log(`[AutoBet] Placing bet for epoch ${epoch}, side ${side}, percentage ${percentage}%, calculated amount ${amount.toFixed(6)} BNB`);
      const res = await placeBet(privateKey, epoch, side, amount);
      if (res?.hash) {
        updateBetStatus(betId, "SUCCESS", res.hash);
        console.log(`[AutoBet] Bet placed successfully: ${res.hash}`);
      } else {
        throw new Error("No transaction hash returned");
      }
    } catch (err: any) {
      console.error(`[AutoBet] Bet failed for epoch ${epoch}`, err);
      updateBetStatus(betId, "FAILED", undefined, err.message || String(err));
    }
  } finally {
    // 释放锁
    PROCESSING_EPOCHS.delete(epoch);
  }
}
