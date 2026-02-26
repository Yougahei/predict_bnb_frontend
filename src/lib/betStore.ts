import { getDb } from "./configStore";

export interface BetLog {
  id: number;
  epoch: number;
  side: "UP" | "DOWN";
  amount: number;
  tx_hash: string | null;
  status: "PENDING" | "SUCCESS" | "FAILED";
  error: string | null;
  claimed: number;
  wallet_address: string | null;
  created_at: number;
}

export function logBet(bet: Omit<BetLog, "id" | "created_at">): number {
  const conn = getDb();
  const now = Math.floor(Date.now() / 1000);
  const res = conn
    .prepare(
      `INSERT INTO bet_logs (epoch, side, amount, tx_hash, status, error, claimed, wallet_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(bet.epoch, bet.side, bet.amount, bet.tx_hash, bet.status, bet.error, bet.claimed, bet.wallet_address, now);
  return Number(res.lastInsertRowid);
}

export function acquireBetLock(epoch: number): boolean {
  const conn = getDb();
  const now = Math.floor(Date.now() / 1000);
  try {
    // 尝试插入，如果 epoch 已存在（主键冲突）则抛出错误
    conn.prepare("INSERT INTO bet_locks (epoch, created_at) VALUES (?, ?)").run(epoch, now);
    return true;
  } catch (err: any) {
    // 如果是唯一约束冲突，说明锁已被占用
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err.message?.includes('UNIQUE constraint failed')) {
      return false;
    }
    // 其他错误则打印并视为获取失败
    console.error("acquireBetLock error", err);
    return false;
  }
}

export function updateBetStatus(
  id: number, 
  status: string, 
  txHash?: string, 
  error?: string, 
  claimed?: number
): void {
  const conn = getDb();
  if (claimed !== undefined) {
    conn.prepare("UPDATE bet_logs SET claimed = ? WHERE id = ?").run(claimed, id);
  }

  if (txHash && error) {
    conn.prepare("UPDATE bet_logs SET status = ?, tx_hash = ?, error = ? WHERE id = ?").run(status, txHash, error, id);
  } else if (txHash) {
    conn.prepare("UPDATE bet_logs SET status = ?, tx_hash = ? WHERE id = ?").run(status, txHash, id);
  } else if (error) {
    conn.prepare("UPDATE bet_logs SET status = ?, error = ? WHERE id = ?").run(status, error, id);
  } else {
    conn.prepare("UPDATE bet_logs SET status = ? WHERE id = ?").run(status, id);
  }
}

export function markAsClaimed(epochs: number[]): void {
  const conn = getDb();
  if (epochs.length === 0) return;
  const placeholders = epochs.map(() => "?").join(",");
  conn.prepare(`UPDATE bet_logs SET claimed = 1 WHERE epoch IN (${placeholders})`).run(...epochs);
}

export function getBetStats(walletAddress?: string) {
  const conn = getDb();
  let sql = `
    SELECT 
      b.epoch, b.side, b.amount, b.status, b.claimed,
      p.correct, p.actual_direction,
      r.oracle_called, r.close_price, r.lock_price
    FROM bet_logs b
    LEFT JOIN model_predictions p ON b.epoch = p.epoch AND p.model_type = 'llm'
    LEFT JOIN round_history r ON b.epoch = r.epoch
    WHERE b.status = 'SUCCESS'
  `;
  
  const params: any[] = [];
  if (walletAddress && walletAddress.length > 10) {
    sql += " AND (b.wallet_address = ? OR b.wallet_address IS NULL)";
    params.push(walletAddress);
  }
  
  sql += " ORDER BY b.epoch DESC";
  const rows = conn.prepare(sql).all(...params) as any[];

  let totalBets = rows.length;
  
  // A bet is considered won if the actual round result matches our side
  const wonBetsRows = rows.filter(r => {
    // 优先使用链上真实价格对比
    if (r.oracle_called && r.lock_price && r.close_price) {
      const actualSide = r.close_price > r.lock_price ? "UP" : "DOWN";
      return r.side === actualSide;
    }
    // 备选：使用 LLM 判定的正确性
    return r.correct === 1;
  });

  const lostBetsRows = rows.filter(r => {
    if (r.oracle_called && r.lock_price && r.close_price) {
      const actualSide = r.close_price > r.lock_price ? "UP" : "DOWN";
      return r.side !== actualSide;
    }
    return r.correct === 0;
  });

  let wonBets = wonBetsRows.length;
  let lostBets = lostBetsRows.length;
  let totalAmount = rows.reduce((acc, r) => acc + (r.amount || 0), 0);
  
  let estimatedProfit = rows.reduce((acc, r) => {
    // If it's in wonBetsRows, it's a win
    const isWin = wonBetsRows.some(w => w.epoch === r.epoch);
    const isLoss = lostBetsRows.some(l => l.epoch === r.epoch);
    
    if (isWin) {
      // Calculate dynamic payout
      // Default to 1.9 if data missing
      let payout = 1.9;
      if (r.total_amount > 0 && r.bull_amount > 0 && r.bear_amount > 0) {
        if (r.side === "UP") {
          // Bull payout = Total / Bull
          payout = r.total_amount / r.bull_amount;
        } else if (r.side === "DOWN") {
          // Bear payout = Total / Bear
          payout = r.total_amount / r.bear_amount;
        }
      }
      
      // Profit = (Amount * Payout) - Amount = Amount * (Payout - 1)
      // Note: Payout includes the original stake
      return acc + (r.amount * (payout - 1));
    }
    
    if (isLoss) return acc - r.amount;
    return acc;
  }, 0);

  return {
    totalBets,
    wonBets,
    lostBets,
    winRate: (wonBets + lostBets) > 0 ? (wonBets / (wonBets + lostBets)) * 100 : 0,
    totalAmount,
    estimatedProfit
  };
}

export function listBetLogs(limit: number = 20, walletAddress?: string): (BetLog & { oracle_called?: number, actual_side?: string })[] {
  const conn = getDb();
  let sql = `
    SELECT b.*, r.oracle_called, r.lock_price, r.close_price 
    FROM bet_logs b
    LEFT JOIN round_history r ON b.epoch = r.epoch
  `;
  const params: any[] = [];
  
  if (walletAddress && walletAddress.length > 10) {
    sql += " WHERE (b.wallet_address = ? OR b.wallet_address IS NULL)";
    params.push(walletAddress);
  }
  
  sql += " ORDER BY b.created_at DESC LIMIT ?";
  params.push(limit);
  
  const rows = conn.prepare(sql).all(...params) as any[];
  return rows.map(r => ({
    ...r,
    actual_side: r.oracle_called && r.lock_price && r.close_price 
      ? (r.close_price > r.lock_price ? "UP" : "DOWN")
      : undefined
  }));
}
