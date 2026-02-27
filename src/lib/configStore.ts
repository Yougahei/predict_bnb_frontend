import { Pool } from 'pg';

let pool: Pool;

const dbConfig = {
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'predict_bnb',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
};

if (process.env.NODE_ENV === 'production') {
  pool = new Pool(dbConfig);
} else {
  // Use global variable to preserve connection pool across hot reloads in development
  if (!(global as any).postgresPool) {
    (global as any).postgresPool = new Pool(dbConfig);
  }
  pool = (global as any).postgresPool;
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS llm_profiles (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE,
    endpoint TEXT,
    model TEXT,
    api_key TEXT,
    enabled INTEGER DEFAULT 1,
    created_at BIGINT,
    updated_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS model_predictions (
    id SERIAL PRIMARY KEY,
    epoch BIGINT,
    model_type TEXT,
    model_name TEXT,
    predicted_direction TEXT,
    predicted_price DOUBLE PRECISION,
    prediction_text TEXT,
    created_at BIGINT,
    actual_direction TEXT,
    resolved_at BIGINT,
    correct INTEGER,
    UNIQUE(epoch, model_type, model_name)
  )`,
  `CREATE TABLE IF NOT EXISTS round_history (
    epoch BIGINT PRIMARY KEY,
    start_ts BIGINT,
    lock_ts BIGINT,
    close_ts BIGINT,
    lock_price DOUBLE PRECISION,
    close_price DOUBLE PRECISION,
    total_amount DOUBLE PRECISION,
    bull_amount DOUBLE PRECISION,
    bear_amount DOUBLE PRECISION,
    reward_base DOUBLE PRECISION,
    reward_amount DOUBLE PRECISION,
    oracle_called INTEGER,
    updated_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS bet_logs (
    id SERIAL PRIMARY KEY,
    epoch BIGINT,
    side TEXT,
    amount DOUBLE PRECISION,
    tx_hash TEXT,
    status TEXT,
    error TEXT,
    claimed INTEGER DEFAULT 0,
    wallet_address TEXT,
    created_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS bet_locks (
    epoch BIGINT PRIMARY KEY,
    created_at BIGINT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_round_close_ts ON round_history(close_ts)`
];

let initialized = false;

export async function getDb() {
  if (!initialized) {
    try {
      for (const sql of TABLES) {
        await pool.query(sql);
      }
      
      // Migrations
      try { await pool.query("ALTER TABLE bet_logs ADD COLUMN IF NOT EXISTS claimed INTEGER DEFAULT 0"); } catch (e) {}
      try { await pool.query("ALTER TABLE bet_logs ADD COLUMN IF NOT EXISTS wallet_address TEXT"); } catch (e) {}

      initialized = true;
    } catch (e) {
      console.error("Failed to initialize DB", e);
      // Don't throw immediately, allow retries or handling by caller
      // But for getDb, maybe we should?
      // If DB is down, we can't do much.
      throw e;
    }
  }
  return pool;
}

export async function getConfig(key: string, defaultValue: string | null = null): Promise<string | null> {
  const db = await getDb();
  try {
    const res = await db.query("SELECT value FROM app_config WHERE key = $1", [key]);
    if (res.rows.length > 0 && res.rows[0].value != null) {
      return res.rows[0].value;
    }
  } catch (e) {
    console.error("getConfig error", e);
  }
  const env = process.env[key];
  return env != null ? env : defaultValue;
}

export async function setConfig(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  if (value == null) {
    await db.query("DELETE FROM app_config WHERE key = $1", [key]);
  } else {
    await db.query(
      `INSERT INTO app_config (key, value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, now]
    );
  }
}
