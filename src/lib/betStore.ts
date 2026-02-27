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

export async function logBet(bet: Omit<BetLog, "id" | "created_at">): Promise<number> {
  const conn = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const res = await conn.query(
      `INSERT INTO bet_logs (epoch, side, amount, tx_hash, status, error, claimed, wallet_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [bet.epoch, bet.side, bet.amount, bet.tx_hash, bet.status, bet.error, bet.claimed, bet.wallet_address, now]
  );
  return res.rows[0].id;
}

export async function acquireBetLock(epoch: number): Promise<boolean> {
  const conn = await getDb();
  const now = Math.floor(Date.now() / 1000);
  try {
    await conn.query("INSERT INTO bet_locks (epoch, created_at) VALUES ($1, $2)", [epoch, now]);
    return true;
  } catch (err: any) {
    // Unique violation
    if (err.code === '23505') {
      return false;
    }
    console.error("acquireBetLock error", err);
    return false;
  }
}

export async function updateBetStatus(
  id: number, 
  status: string, 
  txHash?: string, 
  error?: string, 
  claimed?: number
): Promise<void> {
  const conn = await getDb();
  if (claimed !== undefined) {
    await conn.query("UPDATE bet_logs SET claimed = $1 WHERE id = $2", [claimed, id]);
  }

  if (txHash && error) {
    await conn.query("UPDATE bet_logs SET status = $1, tx_hash = $2, error = $3 WHERE id = $4", [status, txHash, error, id]);
  } else if (txHash) {
    await conn.query("UPDATE bet_logs SET status = $1, tx_hash = $2 WHERE id = $3", [status, txHash, id]);
  } else if (error) {
    await conn.query("UPDATE bet_logs SET status = $1, error = $2 WHERE id = $3", [status, error, id]);
  } else {
    await conn.query("UPDATE bet_logs SET status = $1 WHERE id = $2", [status, id]);
  }
}

export async function markAsClaimed(epochs: number[]): Promise<void> {
  const conn = await getDb();
  if (epochs.length === 0) return;
  const placeholders = epochs.map((_, i) => `$${i + 1}`).join(",");
  await conn.query(`UPDATE bet_logs SET claimed = 1 WHERE epoch IN (${placeholders})`, epochs);
}

export async function getAutoClaimableEpochs(delaySeconds: number = 300): Promise<number[]> {
  const conn = await getDb();
  const threshold = Math.floor(Date.now() / 1000) - delaySeconds;
  
  const sql = `
    SELECT b.epoch
    FROM bet_logs b
    JOIN round_history r ON b.epoch = r.epoch
    WHERE b.status = 'SUCCESS' 
      AND b.claimed = 0
      AND r.oracle_called = 1
      AND r.close_ts < $1
    ORDER BY b.epoch ASC
    LIMIT 20
  `;
  
  const res = await conn.query(sql, [threshold]);
  return res.rows.map((r: any) => parseInt(r.epoch)); // Ensure number
}

export async function getBetStats(walletAddress?: string) {
  const conn = await getDb();
  let sql = `
    SELECT 
      b.epoch, b.side, b.amount, b.status, b.claimed,
      p.correct, p.actual_direction,
      r.oracle_called, r.close_price, r.lock_price,
      r.total_amount, r.bull_amount, r.bear_amount
    FROM bet_logs b
    LEFT JOIN model_predictions p ON b.epoch = p.epoch AND p.model_type = 'llm'
    LEFT JOIN round_history r ON b.epoch = r.epoch
    WHERE b.status = 'SUCCESS'
  `;
  
  const params: any[] = [];
  if (walletAddress && walletAddress.length > 10) {
    sql += " AND (b.wallet_address = $1 OR b.wallet_address IS NULL)";
    params.push(walletAddress);
  }
  
  sql += " ORDER BY b.epoch DESC";
  const res = await conn.query(sql, params);
  const rows = res.rows;

  let totalBets = rows.length;
  
  const wonBetsRows = rows.filter((r: any) => {
    if (r.oracle_called && r.lock_price && r.close_price) {
      const actualSide = r.close_price > r.lock_price ? "UP" : "DOWN";
      return r.side === actualSide;
    }
    return r.correct === 1;
  });

  const lostBetsRows = rows.filter((r: any) => {
    if (r.oracle_called && r.lock_price && r.close_price) {
      const actualSide = r.close_price > r.lock_price ? "UP" : "DOWN";
      return r.side !== actualSide;
    }
    return r.correct === 0;
  });

  let wonBets = wonBetsRows.length;
  let lostBets = lostBetsRows.length;
  let totalAmount = rows.reduce((acc: number, r: any) => acc + (parseFloat(r.amount) || 0), 0);
  
  let estimatedProfit = rows.reduce((acc: number, r: any) => {
    // If it's in wonBetsRows, it's a win
    const isWin = wonBetsRows.some((w: any) => w.epoch === r.epoch);
    const isLoss = lostBetsRows.some((l: any) => l.epoch === r.epoch);
    
    if (isWin) {
      let payout = 1.9;
      if (r.total_amount > 0 && r.bull_amount > 0 && r.bear_amount > 0) {
        if (r.side === "UP") {
          payout = r.total_amount / r.bull_amount;
        } else if (r.side === "DOWN") {
          payout = r.total_amount / r.bear_amount;
        }
      }
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

export async function listBetLogs(limit: number = 20, walletAddress?: string): Promise<(BetLog & { oracle_called?: number, actual_side?: string })[]> {
  const conn = await getDb();
  let sql = `
    SELECT b.*, r.oracle_called, r.lock_price, r.close_price 
    FROM bet_logs b
    LEFT JOIN round_history r ON b.epoch = r.epoch
  `;
  const params: any[] = [];
  let paramIdx = 1;
  
  if (walletAddress && walletAddress.length > 10) {
    sql += ` WHERE (b.wallet_address = $${paramIdx++} OR b.wallet_address IS NULL)`;
    params.push(walletAddress);
  }
  
  sql += ` ORDER BY b.created_at DESC LIMIT $${paramIdx++}`;
  params.push(limit);
  
  const res = await conn.query(sql, params);
  return res.rows.map((r: any) => ({
    ...r,
    epoch: parseInt(r.epoch),
    created_at: parseInt(r.created_at),
    amount: parseFloat(r.amount),
    actual_side: r.oracle_called && r.lock_price && r.close_price 
      ? (r.close_price > r.lock_price ? "UP" : "DOWN")
      : undefined
  }));
}
