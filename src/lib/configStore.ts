import { Pool, PoolConfig } from 'pg';

let pool: Pool;

// Prioritize connection string if available (e.g. from Vercel or .env)
// We replace sslmode=require with sslmode=no-verify to silence the warning about libpq security changes,
// since we are explicitly setting rejectUnauthorized: false below which handles the security posture we want (allow self-signed/cloud certs).
let connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

// IMPORTANT: In local development, we often don't have SSL enabled on the Docker container.
// If we are connecting to localhost, we should probably strip SSL requirements or connection string
// unless explicitly configured.
const isLocalhost = (connectionString && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'))) 
                    || (!connectionString && (process.env.POSTGRES_HOST === 'localhost' || process.env.POSTGRES_HOST === '127.0.0.1'));

if (connectionString && connectionString.includes('sslmode=require')) {
  connectionString = connectionString.replace('sslmode=require', 'sslmode=no-verify');
}

let dbConfig: PoolConfig;

if (connectionString) {
  dbConfig = {
    connectionString,
    ssl: isLocalhost ? false : { rejectUnauthorized: false }
  };
} else {
  dbConfig = {
    user: process.env.POSTGRES_USER || 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB || 'predict_bnb',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    ssl: false // Explicitly disable SSL for individual params config (usually local)
  };
}

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

let initPromise: Promise<void> | null = null;

export async function getDb() {
  if (process.env.NODE_ENV !== 'production') {
    if ((global as any).dbInitPromise) {
      initPromise = (global as any).dbInitPromise;
    }
  }

  if (!initPromise) {
    initPromise = (async () => {
      try {
        for (const sql of TABLES) {
          try {
            await pool.query(sql);
          } catch (e: any) {
            // Ignore unique constraint violation on pg_type (race condition during table creation)
            if (e.code === '23505' && e.constraint === 'pg_type_typname_nsp_index') {
              continue;
            }
            // Ignore "relation already exists" if IF NOT EXISTS somehow failed to catch it
            if (e.code === '42P07') {
              continue;
            }
            throw e;
          }
        }
        
        // Migrations
        try { await pool.query("ALTER TABLE bet_logs ADD COLUMN IF NOT EXISTS claimed INTEGER DEFAULT 0"); } catch (e) {}
        try { await pool.query("ALTER TABLE bet_logs ADD COLUMN IF NOT EXISTS wallet_address TEXT"); } catch (e) {}

      } catch (e) {
        console.error("Failed to initialize DB", e);
        throw e;
      }
    })();

    if (process.env.NODE_ENV !== 'production') {
      (global as any).dbInitPromise = initPromise;
    }
  }

  try {
    await initPromise;
  } catch (e) {
    // If initialization failed, reset the promise so it can be retried (or handled by upper layers)
    initPromise = null;
    if (process.env.NODE_ENV !== 'production') {
      (global as any).dbInitPromise = null;
    }
    throw e;
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
