import { getConfig, getDb } from "./configStore";

export interface LLMProfile {
  name: string;
  endpoint: string;
  model: string;
  api_key: string;
  enabled: boolean;
}

export function listLLMProfiles(includeDisabled: boolean = false): LLMProfile[] {
  const conn = getDb();
  let rows: any[];
  if (includeDisabled) {
    rows = conn
      .prepare(
        "SELECT name, endpoint, model, api_key, enabled FROM llm_profiles ORDER BY name"
      )
      .all();
  } else {
    rows = conn
      .prepare(
        "SELECT name, endpoint, model, api_key, enabled FROM llm_profiles WHERE enabled = 1 ORDER BY name"
      )
      .all();
  }

  const profiles: LLMProfile[] = rows.map((row) => ({
    name: row.name,
    endpoint: row.endpoint,
    model: row.model,
    api_key: row.api_key,
    enabled: Boolean(row.enabled),
  }));

  if (profiles.length > 0) {
    return profiles;
  }

  const apiKey = getConfig("LLM_API_KEY") || getConfig("SILICONFLOW_API_KEY");
  if (apiKey) {
    profiles.push({
      name: "default",
      endpoint: getConfig(
        "LLM_ENDPOINT",
        "https://api.siliconflow.cn/v1/chat/completions"
      )!,
      model: getConfig("LLM_MODEL", "deepseek-ai/DeepSeek-V3.2")!,
      api_key: apiKey,
      enabled: true,
    });
  }

  return profiles;
}

export function getLLMProfile(name: string): LLMProfile | null {
  const conn = getDb();
  const row = conn
    .prepare(
      "SELECT name, endpoint, model, api_key, enabled FROM llm_profiles WHERE name = ?"
    )
    .get(name) as any;
  if (!row) return null;
  return {
    name: row.name,
    endpoint: row.endpoint,
    model: row.model,
    api_key: row.api_key,
    enabled: Boolean(row.enabled),
  };
}

export function upsertLLMProfile(profile: LLMProfile): void {
  const now = Math.floor(Date.now() / 1000);
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO llm_profiles (name, endpoint, model, api_key, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         endpoint = excluded.endpoint,
         model = excluded.model,
         api_key = excluded.api_key,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .run(
      profile.name,
      profile.endpoint,
      profile.model,
      profile.api_key,
      profile.enabled ? 1 : 0,
      now,
      now
    );
}

export function deleteLLMProfile(name: string): void {
  const conn = getDb();
  conn.prepare("DELETE FROM llm_profiles WHERE name = ?").run(name);
  conn
    .prepare("DELETE FROM model_predictions WHERE model_type = 'llm' AND model_name = ?")
    .run(name);
}

export function upsertPrediction(params: {
  epoch: number;
  model_type: string;
  model_name: string;
  predicted_direction: string | null;
  predicted_price: number | null;
  prediction_text: string | null;
}): void {
  const now = Math.floor(Date.now() / 1000);
  const conn = getDb();
  conn
    .prepare(
      `INSERT INTO model_predictions (
          epoch, model_type, model_name, predicted_direction, predicted_price, prediction_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(epoch, model_type, model_name) DO UPDATE SET
          predicted_direction = excluded.predicted_direction,
          predicted_price = excluded.predicted_price,
          prediction_text = excluded.prediction_text,
          created_at = excluded.created_at`,
    )
    .run(
      params.epoch,
      params.model_type,
      params.model_name,
      params.predicted_direction,
      params.predicted_price,
      params.prediction_text,
      now
    );
}

export function listPredictionsForEpoch(epoch: number): any[] {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT model_type, model_name, predicted_direction, predicted_price, prediction_text,
              actual_direction, correct, epoch
       FROM model_predictions
       WHERE epoch = ?
       ORDER BY model_type, model_name`
    )
    .all(epoch);
}

export function listLatestPredictions(): any[] {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT mp.model_type, mp.model_name, mp.predicted_direction, mp.predicted_price,
              mp.prediction_text, mp.actual_direction, mp.correct, mp.epoch
       FROM model_predictions mp
       JOIN (
           SELECT model_type, model_name, MAX(epoch) AS max_epoch
           FROM model_predictions
           GROUP BY model_type, model_name
       ) latest
       ON mp.model_type = latest.model_type
          AND mp.model_name = latest.model_name
          AND mp.epoch = latest.max_epoch
       ORDER BY mp.model_type, mp.model_name`
    )
    .all();
}

export function getLastPredictionDirection(
  modelType: string,
  modelName: string
): string | null {
  const conn = getDb();
  const row = conn
    .prepare(
      `SELECT predicted_direction
       FROM model_predictions
       WHERE model_type = ? AND model_name = ? AND predicted_direction IS NOT NULL
       ORDER BY epoch DESC, created_at DESC
       LIMIT 1`
    )
    .get(modelType, modelName) as { predicted_direction: string } | undefined;
  return row ? row.predicted_direction : null;
}

export function getLastPredictionTime(
  modelType: string,
  modelName: string,
  epoch: number
): number {
  const conn = getDb();
  const row = conn
    .prepare(
      `SELECT created_at
       FROM model_predictions
       WHERE model_type = ? AND model_name = ? AND epoch = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(modelType, modelName, epoch) as { created_at: number } | undefined;
  return row ? row.created_at : 0;
}

export function getAccuracyStats(): any[] {
  const conn = getDb();
  const rows = conn
    .prepare(
      `SELECT model_type, model_name,
              SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct,
              SUM(CASE WHEN predicted_direction IN ('UP', 'DOWN') THEN 1 ELSE 0 END) as acted,
              COUNT(*) as total
       FROM model_predictions
       WHERE actual_direction IS NOT NULL
       GROUP BY model_type, model_name
       ORDER BY model_type, model_name`
    )
    .all() as any[];

  const statsMap = new Map<string, any>();
  for (const row of rows) {
    const accuracy = Number(row.correct || 0) / Number(row.acted || 1);
    const coverage = Number(row.acted || 0) / Number(row.total || 1);
    const key = `${row.model_type}::${row.model_name}`;
    statsMap.set(key, {
      model_type: row.model_type,
      model_name: row.model_name,
      correct: Number(row.correct || 0),
      acted: Number(row.acted || 0),
      total: Number(row.total || 0),
      accuracy,
      coverage,
    });
  }

  for (const profile of listLLMProfiles()) {
    const key = `llm::${profile.name || profile.model}`;
    if (!statsMap.has(key)) {
      statsMap.set(key, {
        model_type: "llm",
        model_name: profile.name || profile.model,
        correct: 0,
        acted: 0,
        total: 0,
        accuracy: 0.0,
        coverage: 0.0,
      });
    }
  }

  const stats = Array.from(statsMap.values());
  stats.sort((a, b) => {
    if (a.model_type !== b.model_type) return a.model_type.localeCompare(b.model_type);
    return a.model_name.localeCompare(b.model_name);
  });
  return stats;
}

export function clearPredictionStats(): number {
  const conn = getDb();
  const result = conn
    .prepare("DELETE FROM model_predictions WHERE actual_direction IS NOT NULL")
    .run();
  return result.changes;
}

export function resolvePredictions(): number {
  const conn = getDb();
  const rows = conn
    .prepare(
      `SELECT p.id, p.epoch, r.lock_price, r.close_price, p.predicted_direction
       FROM model_predictions p
       JOIN round_history r ON r.epoch = p.epoch
       WHERE p.actual_direction IS NULL
         AND r.oracle_called = 1
         AND r.close_price IS NOT NULL`
    )
    .all() as any[];

  if (rows.length === 0) return 0;

  const now = Math.floor(Date.now() / 1000);
  const update = conn.prepare(
    "UPDATE model_predictions SET actual_direction = ?, resolved_at = ?, correct = ? WHERE id = ?"
  );

  const transaction = conn.transaction((items: any[]) => {
    for (const row of items) {
      const { id, lock_price, close_price, predicted_direction } = row;
      if (lock_price == null || close_price == null) continue;

      let actual: string;
      if (close_price > lock_price) actual = "UP";
      else if (close_price < lock_price) actual = "DOWN";
      else actual = "FLAT";

      let correct: number | null = null;
      if (predicted_direction && predicted_direction !== "ABSTAIN" && predicted_direction !== "FLAT") {
        correct = predicted_direction === actual ? 1 : 0;
      }

      update.run(actual, now, correct, id);
    }
  });

  transaction(rows);
  return rows.length;
}
