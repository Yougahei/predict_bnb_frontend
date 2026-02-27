// Snapshot builder approximating app.py's _build_snapshot and build_recent_rounds
// using the already-ported onchain and prediction logic.

import { fetchLivePrice, fetchCurrentRound, fetchRecentRounds, fetchBalance } from "./onchain";
import {
  AnyDict,
  calcPayout,
  roundResult,
  roundMomentumPrediction,
  buildVoteSummary,
  computeBetWithStrategy,
} from "./prediction";
import { getModelConfig, type ModelConfig } from "./modelConfig";
import { getConfig } from "./configStore";
import {
  upsertPrediction,
  listPredictionsForEpoch,
  listLatestPredictions,
  getAccuracyStats,
  resolvePredictions,
} from "./modelStore";
import { upsertRounds, getRecentRounds } from "./historyStore";
import { scheduleLLMPredictions } from "./llmClient";
import { runAutoBetLogic, runAutoClaimLogic } from "./autoBet";

const SYMBOL = "BNBUSD";

export interface RoundSummary {
  epoch: number | null;
  start_ts: number | null;
  lock_ts: number | null;
  close_ts: number | null;
  lock_price: number | null;
  close_price: number | null;
  result: string | null;
  total_amount: number | null;
  bull_amount: number | null;
  bear_amount: number | null;
  reward_base: number | null;
  reward_amount: number | null;
  up_payout: number | null;
  down_payout: number | null;
}

let LAST_SYNC_TS = 0;
let LAST_RESOLVE_TS = 0;
let LAST_AUTO_BET_EPOCH: number | null = null;

export async function buildRecentRounds(limit: number = 12): Promise<RoundSummary[]> {
  const now = Date.now();
  if (now - LAST_SYNC_TS > 30 * 1000) {
    LAST_SYNC_TS = now;
    // Sync in background
    (async () => {
      try {
        const raw = await fetchRecentRounds(limit * 3);
        await upsertRounds(raw);
      } catch (err) {
        console.error("Round sync error", err);
      }
    })();
  }

  const rounds = await getRecentRounds(limit);
  const output: RoundSummary[] = [];
  for (const r of rounds) {
    const result = roundResult(r.lock_price, r.close_price);
    const upPayout = calcPayout(r.total_amount, r.bull_amount);
    const downPayout = calcPayout(r.total_amount, r.bear_amount);
    output.push({
      epoch: r.epoch,
      start_ts: r.start_ts,
      lock_ts: r.lock_ts,
      close_ts: r.close_ts,
      lock_price: r.lock_price,
      close_price: r.close_price,
      result,
      total_amount: r.total_amount,
      bull_amount: r.bull_amount,
      bear_amount: r.bear_amount,
      reward_base: r.reward_base,
      reward_amount: r.reward_amount,
      up_payout: upPayout,
      down_payout: downPayout,
    });
  }
  return output;
}

export interface Snapshot {
  as_of_ts: number;
  price: number | null;
  price_source: string | null;
  price_updated_at: number | null;
  round: {
    epoch: number | null;
    start_ts: number | null;
    lock_ts: number | null;
    close_ts: number | null;
    lock_price: number | null;
    close_price: number | null;
    time_left_sec: number | null;
  };
  prediction: AnyDict | null;
  recent_rounds: RoundSummary[];
  symbol: string;
  model_config: ModelConfig;
  model_predictions: AnyDict[];
  accuracy: AnyDict[];
  vote_summary: AnyDict | null;
  bet_suggestion: AnyDict | null;
  wallet_balance: number | null;
  usd_cny_rate: number;
}

export interface BuildSnapshotOptions {
  autoBet?: boolean;
}

async function mergeModelPredictions(epoch: number | null): Promise<AnyDict[]> {
  if (!epoch) return listLatestPredictions();

  const currentRows = await listPredictionsForEpoch(epoch);
  const latestRows = await listLatestPredictions();

  const existing = new Set(
    currentRows.map((r) => `${r.model_type}::${r.model_name}`)
  );

  const modelPredictions: AnyDict[] = [...currentRows];

  for (const row of latestRows) {
    const key = `${row.model_type}::${row.model_name}`;
    if (existing.has(key)) continue;
    if (row.epoch === epoch) continue;

    modelPredictions.push({
      ...row,
      stale: true,
    });
  }

  return modelPredictions;
}

export async function buildSnapshot(options: BuildSnapshotOptions = {}): Promise<Snapshot> {
  const now = new Date();
  const nowTs = now.getTime();

  const [priceData, currentRound, recent, walletBalance] = await Promise.all([
    fetchLivePrice().catch(() => null),
    fetchCurrentRound().catch(() => null),
    buildRecentRounds().catch(() => [] as RoundSummary[]),
    (async () => {
      const addr = await getConfig("WALLET_ADDRESS");
      return addr ? fetchBalance(addr).catch(() => null) : null;
    })(),
  ]);

  const price = priceData?.price ?? null;
  const priceSource = priceData?.source ?? null;
  const priceUpdatedAt = priceData?.updated_at
    ? priceData.updated_at * 1000
    : null;

  const closeTs = currentRound?.close_ts ?? null;
  let timeLeftSec: number | null = null;
  if (closeTs != null) {
    timeLeftSec = Math.max(0, Math.floor((closeTs - nowTs) / 1000));
  }

  const roundInfo = {
    epoch: currentRound?.epoch ?? null,
    start_ts: currentRound?.start_ts ?? null,
    lock_ts: currentRound?.lock_ts ?? null,
    close_ts: currentRound?.close_ts ?? null,
    lock_price: currentRound?.lock_price ?? null,
    close_price: currentRound?.close_price ?? null,
    time_left_sec: timeLeftSec,
  };

  const prediction = roundMomentumPrediction(
    recent as AnyDict[],
    price,
    roundInfo.lock_price,
  );

  const epoch = roundInfo.epoch;
  if (epoch && prediction) {
    await upsertPrediction({
      epoch,
      model_type: "quant",
      model_name: prediction.model || "quant",
      predicted_direction: prediction.direction,
      predicted_price: prediction.predicted_price,
      prediction_text: null,
    });
  }

  // LLM Payload building
  const llmAutoPredict = await getConfig("LLM_AUTO_PREDICT");
  if (epoch && llmAutoPredict === "1") {
    const payload = {
      timestamp: nowTs,
      price,
      round: {
        epoch,
        lock_price: roundInfo.lock_price,
        close_price: roundInfo.close_price,
        lock_ts: roundInfo.lock_ts,
        close_ts: roundInfo.close_ts,
        time_left_sec: roundInfo.time_left_sec,
      },
      recent_rounds: recent.slice(0, 6).map((r) => ({
        epoch: r.epoch,
        result: r.result,
        lock_price: r.lock_price,
        close_price: r.close_price,
        total_amount: r.total_amount,
        bull_amount: r.bull_amount,
        bear_amount: r.bear_amount,
        up_payout: r.up_payout,
        down_payout: r.down_payout,
      })),
    };
    scheduleLLMPredictions(epoch, payload);
  }

  // Resolve predictions periodically
  if (nowTs - LAST_RESOLVE_TS > 20 * 1000) {
    LAST_RESOLVE_TS = nowTs;
    await resolvePredictions();
  }

  const modelConfig = await getModelConfig();
  const modelPredictions = await mergeModelPredictions(epoch);
  const accuracyStats = await getAccuracyStats();
  const usdCnyRateStr = await getConfig("USD_CNY_RATE", "7.25");
  const usdCnyRate = Number(usdCnyRateStr || "7.25");

  const voteSummary =
    modelPredictions.length > 0
      ? buildVoteSummary(modelPredictions, accuracyStats)
      : null;

  const betSuggestion =
    voteSummary != null
      ? computeBetWithStrategy(
          modelConfig.base_amount,
          voteSummary,
          modelConfig.strategy,
        )
      : null;

  const lockLeftSec =
    roundInfo.lock_ts != null
      ? Math.floor((roundInfo.lock_ts - nowTs) / 1000)
      : null;

  if (
    options.autoBet &&
    betSuggestion &&
    epoch &&
    lockLeftSec != null &&
    lockLeftSec <= 33 &&
    lockLeftSec >= 2 &&
    LAST_AUTO_BET_EPOCH !== epoch
  ) {
    LAST_AUTO_BET_EPOCH = epoch;
    (async () => {
      try {
        await runAutoBetLogic(epoch, voteSummary);
      } catch (err) {
        console.error("Auto bet error", err);
      }
    })();
  }
  
  // 顺便检查是否有需要自动领奖的
  if (options.autoBet) {
    runAutoClaimLogic().catch(e => console.error("Auto claim error", e));
  }

  return {
    as_of_ts: nowTs,
    price,
    price_source: priceSource,
    price_updated_at: priceUpdatedAt,
    round: roundInfo,
    prediction,
    recent_rounds: recent,
    symbol: SYMBOL,
    model_config: modelConfig,
    model_predictions: modelPredictions,
    accuracy: accuracyStats,
    vote_summary: voteSummary,
    bet_suggestion: betSuggestion,
    wallet_balance: walletBalance,
    usd_cny_rate: usdCnyRate,
  };
}
