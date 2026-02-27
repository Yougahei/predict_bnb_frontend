import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";

// Detect environment: Vercel, AWS Lambda, or local production build
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL;
const isLambda = process.env.AWS_LAMBDA_FUNCTION_NAME || process.cwd().startsWith("/var/task");
const isProduction = process.env.NODE_ENV === "production";

// Use temp directory in serverless environments or when explicitly requested
const useTempDir = isVercel || isLambda || (isProduction && process.cwd() === "/");

const DB_PATH =
  process.env.CONFIG_DB ||
  (useTempDir
    ? path.join(os.tmpdir(), "predict_bnb_data", "config.db")
    : path.join(process.cwd(), "predict_bnb_data", "config.db"));

const TABLES = [
  `CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS llm_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    endpoint TEXT,
    model TEXT,
    api_key TEXT,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS model_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epoch INTEGER,
    model_type TEXT,
    model_name TEXT,
    predicted_direction TEXT,
    predicted_price REAL,
    prediction_text TEXT,
    created_at INTEGER,
    actual_direction TEXT,
    resolved_at INTEGER,
    correct INTEGER,
    UNIQUE(epoch, model_type, model_name)
  )`,
  `CREATE TABLE IF NOT EXISTS round_history (
    epoch INTEGER PRIMARY KEY,
    start_ts INTEGER,
    lock_ts INTEGER,
    close_ts INTEGER,
    lock_price REAL,
    close_price REAL,
    total_amount REAL,
    bull_amount REAL,
    bear_amount REAL,
    reward_base REAL,
    reward_amount REAL,
    oracle_called INTEGER,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS bet_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epoch INTEGER,
    side TEXT,
    amount REAL,
    tx_hash TEXT,
    status TEXT,
    error TEXT,
    claimed INTEGER DEFAULT 0,
    wallet_address TEXT,
    created_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS bet_locks (
    epoch INTEGER PRIMARY KEY,
    created_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_round_close_ts ON round_history(close_ts)`
];

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    // Ensure directory exists
    const dir = path.dirname(DB_PATH);
    const fs = require('node:fs');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err: any) {
        // Fallback to /tmp if mkdir fails (e.g. permission denied)
        if (err.code === 'EACCES' || err.code === 'EROFS') {
          console.warn(`[ConfigStore] Write permission denied at ${dir}, falling back to OS temp dir.`);
          const tempDir = path.join(os.tmpdir(), "predict_bnb_data");
          if (!fs.existsSync(tempDir)) {
             fs.mkdirSync(tempDir, { recursive: true });
          }
          // Update DB_PATH for this session (hacky but necessary)
          // Note: DB_PATH is const, so we can't reassign it. We should have used let.
          // But since we are inside getDb, we can just open the new path.
          const newDbPath = path.join(tempDir, "config.db");
          db = new Database(newDbPath);
          db.pragma("journal_mode = WAL");
          for (const sql of TABLES) {
            db.exec(sql);
          }
          
          // Migration for fallback DB
          try { db.exec("ALTER TABLE bet_logs ADD COLUMN claimed INTEGER DEFAULT 0"); } catch (e) {}
          try { db.exec("ALTER TABLE bet_logs ADD COLUMN wallet_address TEXT"); } catch (e) {}
          
          return db;
        }
        throw err;
      }
    }

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    for (const sql of TABLES) {
      db.exec(sql);
    }

    // Migration: Add missing columns if they don't exist
    try {
      db.exec("ALTER TABLE bet_logs ADD COLUMN claimed INTEGER DEFAULT 0");
    } catch (e) {}
    try {
      db.exec("ALTER TABLE bet_logs ADD COLUMN wallet_address TEXT");
    } catch (e) {}
  }
  return db;
}

export function getConfig(key: string, defaultValue: string | null = null): string | null {
  const conn = getDb();
  try {
    const row = conn
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get(key) as { value: string | null } | undefined;
    if (row && row.value != null) {
      return row.value;
    }
  } catch (e) {
    console.error("getConfig error", e);
  }
  const env = process.env[key];
  return env != null ? env : defaultValue;
}

export function setConfig(key: string, value: string | null): void {
  const conn = getDb();
  const now = Math.floor(Date.now() / 1000);
  if (value == null) {
    conn.prepare("DELETE FROM app_config WHERE key = ?").run(key);
  } else {
    conn
      .prepare(
        `INSERT INTO app_config (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }
}
