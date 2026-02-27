import {
  listLLMProfiles,
  getLastPredictionDirection,
  getLastPredictionTime,
  upsertPrediction,
  LLMProfile,
} from "./modelStore";
import { getConfig } from "./configStore";

const CACHE = new Map<string, { time: number; value: any }>();

function cacheGet(key: string, ttl: number): any | null {
  const entry = CACHE.get(key);
  if (entry && Date.now() - entry.time < ttl * 1000) {
    return entry.value;
  }
  return null;
}

function cacheSet(key: string, value: any): void {
  CACHE.set(key, { time: Date.now(), value });
}

function buildMessages(payload: any, allowAbstain: boolean): { role: string; content: string }[] {
  let rule = "";
  if (allowAbstain) {
    rule =
      "你可以输出 UP / DOWN / ABSTAIN。" +
      "当你认为自己的预测准确率低于60%时可以选择 ABSTAIN。" +
      "禁止连续弃权。";
  } else {
    rule = "本次必须输出 UP 或 DOWN，不可弃权。";
  }

  const system =
    "你是一个中立的数据解读助手。请根据输入数据给出预测方向。" +
    rule +
    '只输出JSON，格式为: {"direction":"UP/DOWN/ABSTAIN","summary":"简短分析，含仅供演示"}。' +
    "不要输出多余文本。";

  const user = "以下是JSON数据：\n" + JSON.stringify(payload);

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function parseResponse(text: string): { direction: string | null; summary: string } {
  const cleaned = (text || "").trim();
  if (!cleaned) return { direction: null, summary: "" };

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const data = JSON.parse(match[0]);
      let direction = data.direction;
      const summary = data.summary || "";
      if (typeof direction === "string") {
        direction = direction.trim().toUpperCase();
        if (direction === "FLAT") direction = "ABSTAIN";
      }
      return { direction, summary };
    } catch {
      // ignore
    }
  }

  const upper = cleaned.toUpperCase();
  let direction: string | null = null;
  if (
    upper.includes("ABSTAIN") ||
    upper.includes("SKIP") ||
    upper.includes("PASS") ||
    cleaned.includes("弃权")
  ) {
    direction = "ABSTAIN";
  } else if (upper.includes("UP")) {
    direction = "UP";
  } else if (upper.includes("DOWN")) {
    direction = "DOWN";
  }

  return { direction, summary: cleaned.slice(0, 280) };
}

async function requestLLM(
  profile: LLMProfile,
  payload: any,
  allowAbstain: boolean
): Promise<{ direction: string | null; summary: string; raw: string } | null> {
  const { endpoint, model, api_key } = profile;
  if (!endpoint || !model || !api_key) return null;

  const enableThinking = (await getConfig("LLM_ENABLE_THINKING")) === "1";

  const body: any = {
    model,
    messages: buildMessages(payload, allowAbstain),
    temperature: 0.2,
    max_tokens: 220,
  };
  
  if (enableThinking) {
    body.enable_thinking = true;
  }

  const headers = {
    Authorization: `Bearer ${api_key}`,
    "Content-Type": "application/json",
  };

  const timeoutStr = (await getConfig("LLM_TIMEOUT", "12")) || "12";
  const timeout = parseInt(timeoutStr) * 1000;

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(id);

    if (!resp.ok) {
      if (resp.status === 429) {
        // Simple retry for 429
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return requestLLM(profile, payload, allowAbstain);
      }
      throw new Error(`HTTP error: ${resp.status}`);
    }

    const data = await resp.json();
    const choices = data.choices || [];
    if (!choices.length) {
      return { direction: null, summary: "ERROR: empty choices", raw: "" };
    }

    const content = (choices[0].message?.content || "").trim();
    const parsed = parseResponse(content);
    return {
      direction: parsed.direction,
      summary: parsed.summary,
      raw: content,
    };
  } catch (err) {
    return { direction: null, summary: `ERROR: ${err}`, raw: "" };
  }
}

const ACTIVE_REQUESTS = new Set<string>();

export async function scheduleLLMPredictions(
  epoch: number | null,
  payload: any
): Promise<void> {
  if (!epoch) return;

  const profiles = await listLLMProfiles();
  if (!profiles.length) return;

  for (const profile of profiles) {
    const name = profile.name || profile.model;
    const cacheKey = `llm:${name}:${epoch}`;

    // Check memory cache first
    const cached = cacheGet(cacheKey, 120);
    if (cached) continue;
    
    // Check database to persist interval across restarts/refreshes
    const lastTime = await getLastPredictionTime("llm", name, epoch);
    const nowTsSec = Math.floor(Date.now() / 1000);
    if (nowTsSec - lastTime < 120) {
      // Still within 2 minutes gap for this epoch
      continue;
    }

    if (ACTIVE_REQUESTS.has(cacheKey)) continue;

    ACTIVE_REQUESTS.add(cacheKey);

    // Run in "background"
    (async () => {
      try {
        const lastDir = await getLastPredictionDirection("llm", name);
        const allowAbstain = lastDir !== "ABSTAIN";

        const result = await requestLLM(profile, payload, allowAbstain);

        if (result && result.direction === "ABSTAIN" && !allowAbstain) {
          // Force fallback if abstain not allowed
          const live = payload.price;
          const lockPrice = payload.round?.lock_price;
          if (live != null && lockPrice != null) {
            result.direction = live > lockPrice ? "UP" : "DOWN";
            result.summary += "（自动拒绝弃权）";
          }
        }

        if (result && !result.summary.startsWith("ERROR")) {
          await upsertPrediction({
            epoch,
            model_type: "llm",
            model_name: name,
            predicted_direction: result.direction,
            predicted_price: null,
            prediction_text: result.summary,
          });
          cacheSet(cacheKey, result);
        }
      } catch (err) {
        console.error(`LLM prediction error for ${name}`, err);
      } finally {
        ACTIVE_REQUESTS.delete(cacheKey);
      }
    })();
  }
}
