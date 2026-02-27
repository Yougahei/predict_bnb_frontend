import { getDb } from "./configStore";

export async function upsertRounds(rounds: any[]): Promise<number> {
  if (!rounds || rounds.length === 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  const pool = await getDb();
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const sql = `
      INSERT INTO round_history (
          epoch, start_ts, lock_ts, close_ts, lock_price, close_price,
          total_amount, bull_amount, bear_amount, reward_base, reward_amount,
          oracle_called, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT(epoch) DO UPDATE SET
          start_ts = excluded.start_ts,
          lock_ts = excluded.lock_ts,
          close_ts = excluded.close_ts,
          lock_price = excluded.lock_price,
          close_price = excluded.close_price,
          total_amount = excluded.total_amount,
          bull_amount = excluded.bull_amount,
          bear_amount = excluded.bear_amount,
          reward_base = excluded.reward_base,
          reward_amount = excluded.reward_amount,
          oracle_called = excluded.oracle_called,
          updated_at = excluded.updated_at
    `;

    for (const r of rounds) {
      if (!r.epoch) continue;
      await client.query(sql, [
        Number(r.epoch),
        r.start_ts,
        r.lock_ts,
        r.close_ts,
        r.lock_price,
        r.close_price,
        r.total_amount,
        r.bull_amount,
        r.bear_amount,
        r.reward_base,
        r.reward_amount,
        r.oracle_called ? 1 : 0,
        now
      ]);
    }
    await client.query('COMMIT');
    return rounds.length;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("upsertRounds error", e);
    throw e;
  } finally {
    client.release();
  }
}

export async function getRecentRounds(limit: number = 12): Promise<any[]> {
  const conn = await getDb();
  const res = await conn.query(
      `SELECT epoch, start_ts, lock_ts, close_ts, lock_price, close_price,
               total_amount, bull_amount, bear_amount, reward_base, reward_amount,
               oracle_called
        FROM round_history
        WHERE oracle_called = 1 AND close_ts IS NOT NULL
        ORDER BY epoch DESC
        LIMIT $1`,
      [limit]
  );
  return res.rows.map(r => ({
      ...r,
      epoch: Number(r.epoch),
      start_ts: Number(r.start_ts),
      lock_ts: Number(r.lock_ts),
      close_ts: Number(r.close_ts),
  }));
}

export async function listSettledRounds(limit: number = 200): Promise<any[]> {
  const conn = await getDb();
  let sql = `SELECT epoch, start_ts, lock_ts, close_ts, lock_price, close_price,
                 total_amount, bull_amount, bear_amount, reward_base, reward_amount,
                 oracle_called
          FROM round_history
          WHERE oracle_called = 1 AND close_ts IS NOT NULL
          ORDER BY epoch DESC`;
  
  const params: any[] = [];
  if (limit && limit > 0) {
    sql += ` LIMIT $1`;
    params.push(limit);
  }
  
  const res = await conn.query(sql, params);
  const rows = res.rows.map(r => ({
      ...r,
      epoch: Number(r.epoch),
      start_ts: Number(r.start_ts),
      lock_ts: Number(r.lock_ts),
      close_ts: Number(r.close_ts),
  }));

  return rows.reverse();
}
