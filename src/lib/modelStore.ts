import { getConfig, getDb } from "./configStore";

export interface LLMProfile {
  name: string;
  endpoint: string;
  model: string;
  api_key: string;
  enabled: boolean;
}

export async function listLLMProfiles(includeDisabled: boolean = false): Promise<LLMProfile[]> {
  const conn = await getDb();
  let rows: any[];
  if (includeDisabled) {
    const res = await conn.query(
        "SELECT name, endpoint, model, api_key, enabled FROM llm_profiles ORDER BY name"
    );
    rows = res.rows;
  } else {
    const res = await conn.query(
        "SELECT name, endpoint, model, api_key, enabled FROM llm_profiles WHERE enabled = 1 ORDER BY name"
    );
    rows = res.rows;
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

  const apiKey = await getConfig("LLM_API_KEY") || await getConfig("SILICONFLOW_API_KEY");
  if (apiKey) {
    const endpoint = await getConfig(
        "LLM_ENDPOINT",
        "https://api.siliconflow.cn/v1/chat/completions"
    );
    const model = await getConfig("LLM_MODEL", "deepseek-ai/DeepSeek-V3.2");
    
    profiles.push({
      name: "default",
      endpoint: endpoint!,
      model: model!,
      api_key: apiKey,
      enabled: true,
    });
  }

  return profiles;
}

export async function getLLMProfile(name: string): Promise<LLMProfile | null> {
  const conn = await getDb();
  const res = await conn.query(
    "SELECT name, endpoint, model, api_key, enabled FROM llm_profiles WHERE name = $1",
    [name]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    name: row.name,
    endpoint: row.endpoint,
    model: row.model,
    api_key: row.api_key,
    enabled: Boolean(row.enabled),
  };
}

export async function upsertLLMProfile(profile: LLMProfile): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const conn = await getDb();
  await conn.query(
      `INSERT INTO llm_profiles (name, endpoint, model, api_key, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(name) DO UPDATE SET
         endpoint = excluded.endpoint,
         model = excluded.model,
         api_key = excluded.api_key,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
      [
        profile.name,
        profile.endpoint,
        profile.model,
        profile.api_key,
        profile.enabled ? 1 : 0,
        now,
        now
      ]
  );
}

export async function deleteLLMProfile(name: string): Promise<void> {
  const conn = await getDb();
  await conn.query("DELETE FROM llm_profiles WHERE name = $1", [name]);
  await conn.query("DELETE FROM model_predictions WHERE model_type = 'llm' AND model_name = $1", [name]);
}

export async function upsertPrediction(params: {
  epoch: number;
  model_type: string;
  model_name: string;
  predicted_direction: string | null;
  predicted_price: number | null;
  prediction_text: string | null;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const conn = await getDb();
  await conn.query(
      `INSERT INTO model_predictions (
          epoch, model_type, model_name, predicted_direction, predicted_price, prediction_text, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(epoch, model_type, model_name) DO UPDATE SET
          predicted_direction = excluded.predicted_direction,
          predicted_price = excluded.predicted_price,
          prediction_text = excluded.prediction_text,
          created_at = excluded.created_at`,
      [
        params.epoch,
        params.model_type,
        params.model_name,
        params.predicted_direction,
        params.predicted_price,
        params.prediction_text,
        now
      ]
  );
}

export async function listPredictionsForEpoch(epoch: number): Promise<any[]> {
  const conn = await getDb();
  const res = await conn.query(
    `SELECT model_type, model_name, predicted_direction, predicted_price, prediction_text,
              actual_direction, correct, epoch
       FROM model_predictions
       WHERE epoch = $1
       ORDER BY model_type, model_name`,
    [epoch]
  );
  return res.rows.map(r => ({
      ...r,
      epoch: Number(r.epoch),
      predicted_price: r.predicted_price ? parseFloat(r.predicted_price) : null
  }));
}

export async function listLatestPredictions(): Promise<any[]> {
  const conn = await getDb();
  const res = await conn.query(
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
  );
  return res.rows.map(r => ({
      ...r,
      epoch: Number(r.epoch),
      predicted_price: r.predicted_price ? parseFloat(r.predicted_price) : null
  }));
}

export async function getLastPredictionDirection(
  modelType: string,
  modelName: string
): Promise<string | null> {
  const conn = await getDb();
  const res = await conn.query(
    `SELECT predicted_direction
       FROM model_predictions
       WHERE model_type = $1 AND model_name = $2 AND predicted_direction IS NOT NULL
       ORDER BY epoch DESC, created_at DESC
       LIMIT 1`,
    [modelType, modelName]
  );
  const row = res.rows[0];
  return row ? row.predicted_direction : null;
}

export async function getLastPredictionTime(
  modelType: string,
  modelName: string,
  epoch: number
): Promise<number> {
  const conn = await getDb();
  const res = await conn.query(
    `SELECT created_at
       FROM model_predictions
       WHERE model_type = $1 AND model_name = $2 AND epoch = $3
       ORDER BY created_at DESC
       LIMIT 1`,
    [modelType, modelName, epoch]
  );
  const row = res.rows[0];
  return row ? Number(row.created_at) : 0;
}

export async function getAccuracyStats(): Promise<any[]> {
  const conn = await getDb();
  const res = await conn.query(
      `SELECT model_type, model_name,
              SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct,
              SUM(CASE WHEN predicted_direction IN ('UP', 'DOWN') THEN 1 ELSE 0 END) as acted,
              COUNT(*) as total
       FROM model_predictions
       WHERE actual_direction IS NOT NULL
       GROUP BY model_type, model_name
       ORDER BY model_type, model_name`
  );
  const rows = res.rows;

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

  const profiles = await listLLMProfiles();
  for (const profile of profiles) {
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

export async function clearPredictionStats(): Promise<number> {
  const conn = await getDb();
  const res = await conn.query("DELETE FROM model_predictions WHERE actual_direction IS NOT NULL");
  return res.rowCount || 0;
}

export async function resolvePredictions(): Promise<number> {
  const pool = await getDb();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    
    const res = await client.query(
        `SELECT p.id, p.epoch, r.lock_price, r.close_price, p.predicted_direction
        FROM model_predictions p
        JOIN round_history r ON r.epoch = p.epoch
        WHERE p.actual_direction IS NULL
            AND r.oracle_called = 1
            AND r.close_price IS NOT NULL`
    );
    const rows = res.rows;

    if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
    }

    const now = Math.floor(Date.now() / 1000);

    for (const row of rows) {
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

      await client.query(
        "UPDATE model_predictions SET actual_direction = $1, resolved_at = $2, correct = $3 WHERE id = $4",
        [actual, now, correct, id]
      );
    }
    
    await client.query('COMMIT');
    return rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
