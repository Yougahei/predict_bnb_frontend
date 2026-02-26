import { getDb } from "./configStore";

export function upsertRounds(rounds: any[]): number {
  if (!rounds || rounds.length === 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  const conn = getDb();

  const insert = conn.prepare(`
    INSERT INTO round_history (
        epoch, start_ts, lock_ts, close_ts, lock_price, close_price,
        total_amount, bull_amount, bear_amount, reward_base, reward_amount,
        oracle_called, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  `);

  const transaction = conn.transaction((items) => {
    for (const r of items) {
      if (!r.epoch) continue;
      insert.run(
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
      );
    }
  });

  transaction(rounds);
  return rounds.length;
}

export function getRecentRounds(limit: number = 12): any[] {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT epoch, start_ts, lock_ts, close_ts, lock_price, close_price,
               total_amount, bull_amount, bear_amount, reward_base, reward_amount,
               oracle_called
        FROM round_history
        WHERE oracle_called = 1 AND close_ts IS NOT NULL
        ORDER BY epoch DESC
        LIMIT ?`
    )
    .all(limit);
}

export function listSettledRounds(limit: number = 200): any[] {
  const conn = getDb();
  let rows: any[];
  if (limit && limit > 0) {
    rows = conn
      .prepare(
        `SELECT epoch, start_ts, lock_ts, close_ts, lock_price, close_price,
                 total_amount, bull_amount, bear_amount, reward_base, reward_amount,
                 oracle_called
          FROM round_history
          WHERE oracle_called = 1 AND close_ts IS NOT NULL
          ORDER BY epoch DESC
          LIMIT ?`
      )
      .all(limit);
  } else {
    rows = conn
      .prepare(
        `SELECT epoch, start_ts, lock_ts, close_ts, lock_price, close_price,
                 total_amount, bull_amount, bear_amount, reward_base, reward_amount,
                 oracle_called
          FROM round_history
          WHERE oracle_called = 1 AND close_ts IS NOT NULL
          ORDER BY epoch DESC`
      )
      .all();
  }

  return rows.reverse();
}
