// Port of core quantitative logic from app.py into TypeScript.
// The aim is to keep calculations and data shapes as close as possible
// to the original Python implementation.

export type AnyDict = Record<string, any>;

export const VOTE_MIN_CONFIDENCE = 0.05; // Lowered from 0.15 to allow LLM single vote to pass
export const VOTE_PRIOR_TOTAL = 5;
export const VOTE_STALE_WEIGHT = 0.3;

export const SIM_TICK_SEC = 5.0;
export const SIM_MAX_HISTORY = 80;

export const SIM_STRATEGIES: Record<
  string,
  { min_conf: number; min_part: number; size_mult: number }
> = {
  conservative: { min_conf: 0.2, min_part: 0.1, size_mult: 0.8 },
  balanced: { min_conf: 0.05, min_part: 0.0, size_mult: 1.0 }, // Relaxed for LLM priority
  aggressive: { min_conf: 0.01, min_part: 0.0, size_mult: 1.5 },
};

export function roundResult(
  lockPrice: number | null | undefined,
  closePrice: number | null | undefined,
): "UP" | "DOWN" | "FLAT" | null {
  if (lockPrice == null || closePrice == null) return null;
  if (closePrice > lockPrice) return "UP";
  if (closePrice < lockPrice) return "DOWN";
  return "FLAT";
}

export function calcPayout(
  totalAmount: number | null | undefined,
  sideAmount: number | null | undefined,
): number | null {
  if (totalAmount == null || sideAmount == null) return null;
  if (sideAmount <= 0) return null;
  return Number(totalAmount) / Number(sideAmount);
}

export function calcTrend(values: number[]): number {
  if (values.length < 2) return 0.0;
  const n = values.length;
  const meanX = (n - 1) / 2.0;
  const meanY =
    values.reduce((acc, v) => acc + v, 0) / (values.length || 1);
  let num = 0.0;
  let den = 0.0;
  values.forEach((v, i) => {
    const dx = i - meanX;
    num += dx * (v - meanY);
    den += dx * dx;
  });
  if (den === 0) return 0.0;
  return num / den;
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pstdev(arr: number[]): number {
  if (!arr.length) return 0;
  const m = mean(arr);
  const varSum = arr.reduce((acc, v) => acc + (v - m) * (v - m), 0);
  return Math.sqrt(varSum / arr.length);
}

export function scoreFromWindow(
  window: AnyDict[],
  livePrice: number | null | undefined,
  lockPrice: number | null | undefined,
  volRegime: "low" | "mid" | "high" = "mid",
): [number, number] {
  const closes = window
    .map((r) => r.close_price as number | null | undefined)
    .filter((v) => v != null) as number[];
  if (!closes.length || livePrice == null) {
    return [0.0, 0.0];
  }

  const longWindow = Math.min(closes.length, 8);
  const shortWindow = Math.min(closes.length, 3);
  const longMa = mean(closes.slice(-longWindow));
  const shortMa = mean(closes.slice(-shortWindow));
  const momentum = longMa ? (shortMa - longMa) / longMa : 0.0;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev) {
      returns.push((closes[i] - prev) / prev);
    }
  }
  const meanRet = returns.length ? mean(returns) : 0.0;
  let vol = returns.length >= 2 ? pstdev(returns) : Math.abs(meanRet);
  vol = vol || 0.0005;
  const accel =
    returns.length >= 2 ? returns[returns.length - 1] - returns[returns.length - 2] : 0.0;

  let rsiBias = 0.0;
  if (returns.length) {
    const recent = returns.slice(-Math.min(6, returns.length));
    const gains = recent.filter((r) => r > 0);
    const losses = recent.filter((r) => r < 0).map((r) => -r);
    const avgGain = gains.length ? mean(gains) : 0.0;
    const avgLoss = losses.length ? mean(losses) : 0.0;
    let rsi: number;
    if (avgLoss === 0 && avgGain === 0) {
      rsi = 50.0;
    } else if (avgLoss === 0) {
      rsi = 100.0;
    } else {
      const rs = avgGain / avgLoss;
      rsi = 100.0 - 100.0 / (1 + rs);
    }
    rsiBias = (rsi - 50.0) / 50.0;
  }

  let rangeBias = 0.0;
  if (closes.length) {
    const low = Math.min(...closes);
    const high = Math.max(...closes);
    if (high > low && livePrice != null) {
      let pos = (livePrice - low) / (high - low);
      pos = Math.min(Math.max(pos, 0.0), 1.0);
      rangeBias = (pos - 0.5) * 2.0;
    }
  }

  const refPrice = lockPrice != null ? lockPrice : livePrice;
  const liveVsLock = refPrice ? (livePrice - refPrice) / refPrice : 0.0;

  const results = window
    .map((r) => (r.result as string | null) || null)
    .filter((r) => r === "UP" || r === "DOWN") as ("UP" | "DOWN")[];
  let upBias = 0.0;
  if (results.length) {
    const ups = results.filter((r) => r === "UP").length;
    const downs = results.filter((r) => r === "DOWN").length;
    upBias = (ups - downs) / Math.max(1, ups + downs);
  }

  const payoutSkews: number[] = [];
  const payoutTrendVals: number[] = [];
  const bullRatioVals: number[] = [];
  const imbalanceVals: number[] = [];

  for (const r of window) {
    const upP = r.up_payout as number | null | undefined;
    const downP = r.down_payout as number | null | undefined;
    if (
      upP != null &&
      downP != null &&
      upP > 0 &&
      downP > 0
    ) {
      const ratio = Math.log(upP / downP);
      payoutSkews.push(ratio);
      payoutTrendVals.push(ratio);
    }
    const totalAmt = r.total_amount as number | null | undefined;
    const bullAmt = r.bull_amount as number | null | undefined;
    const bearAmt = r.bear_amount as number | null | undefined;
    if (totalAmt && totalAmt > 0 && bullAmt != null && bearAmt != null) {
      bullRatioVals.push(bullAmt / totalAmt);
      imbalanceVals.push((bullAmt - bearAmt) / totalAmt);
    }
  }

  const payoutSkew = payoutSkews.length ? mean(payoutSkews) : 0.0;
  const payoutTrend = calcTrend(payoutTrendVals);
  const bullTrend = calcTrend(bullRatioVals);
  const crowdImbalance = imbalanceVals.length ? mean(imbalanceVals) : 0.0;

  const weights: Record<
    "low" | "mid" | "high",
    {
      momentum: number;
      mean_ret: number;
      live_vs_lock: number;
      up_bias: number;
      payout: number;
      rsi: number;
      range: number;
      accel: number;
    }
  > = {
    low: {
      momentum: 0.6,
      mean_ret: 0.22,
      live_vs_lock: 0.12,
      up_bias: 0.05,
      payout: 0.1,
      rsi: 0.04,
      range: 0.04,
      accel: 0.03,
    },
    mid: {
      momentum: 0.5,
      mean_ret: 0.2,
      live_vs_lock: 0.15,
      up_bias: 0.08,
      payout: 0.12,
      rsi: 0.07,
      range: 0.06,
      accel: 0.03,
    },
    high: {
      momentum: 0.3,
      mean_ret: 0.15,
      live_vs_lock: 0.12,
      up_bias: 0.12,
      payout: 0.18,
      rsi: 0.12,
      range: 0.1,
      accel: 0.04,
    },
  };

  const w = weights[volRegime] || weights.mid;

  let score =
    w.momentum * momentum +
    w.mean_ret * meanRet +
    w.live_vs_lock * liveVsLock +
    w.up_bias * upBias +
    w.payout * payoutSkew -
    w.rsi * rsiBias -
    w.range * rangeBias +
    w.accel * accel +
    0.08 * payoutTrend -
    0.07 * bullTrend -
    0.06 * crowdImbalance;

  if (momentum && payoutSkew) {
    if (
      (momentum > 0 && payoutSkew < 0) ||
      (momentum < 0 && payoutSkew > 0)
    ) {
      score *= 0.8;
    }
  }

  const damp = 1 + vol * (volRegime === "high" ? 18 : 12);
  score = score / damp;
  score = Math.max(Math.min(score, 0.009), -0.009);
  return [score, vol];
}

export function directionFromScore(
  score: number,
  refPrice: number | null | undefined,
  livePrice: number | null | undefined,
  vol: number,
  volRegime: "low" | "mid" | "high" = "mid",
): ["UP" | "DOWN" | "FLAT", number, number] {
  if (livePrice == null) {
    return ["FLAT", 0.0, 0.0];
  }
  const ref = refPrice != null ? refPrice : livePrice;
  const predictedPrice = livePrice * (1 + score);
  const epsFactor = volRegime === "high" ? 1.35 : volRegime === "low" ? 0.85 : 1.0;
  const epsilon = Math.max(
    0.02,
    ref * Math.max(0.0001, vol * 0.6) * epsFactor,
  );
  let direction: "UP" | "DOWN" | "FLAT";
  if (Math.abs(predictedPrice - ref) < epsilon) {
    direction = "FLAT";
  } else {
    direction = predictedPrice > ref ? "UP" : "DOWN";
  }
  const z = Math.abs(score) / (vol || 1e-6);
  let confidence = 1 / (1 + Math.exp(-(z - 0.5)));
  confidence = Math.max(0.5, Math.min(0.95, confidence));
  return [direction, predictedPrice, confidence];
}

export function volRegime(ordered: AnyDict[]): "low" | "mid" | "high" {
  const closes = ordered
    .map((r) => r.close_price as number | null | undefined)
    .filter((v) => v != null) as number[];
  if (closes.length < 4) return "mid";
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev) {
      returns.push((closes[i] - prev) / prev);
    }
  }
  if (returns.length < 3) return "mid";
  const absRets = returns.map((r) => Math.abs(r));
  const recent = absRets.slice(-Math.min(6, absRets.length));
  const hist = absRets.slice(-Math.min(24, absRets.length));
  let median = hist.length
    ? hist.slice().sort((a, b) => a - b)[Math.floor(hist.length / 2)]
    : 0.0005;
  const current = recent.length ? mean(recent) : median;
  median = median || 0.0005;
  if (current > median * 1.4) return "high";
  if (current < median * 0.7) return "low";
  return "mid";
}

function evaluateStrategy(
  ordered: AnyDict[],
  lookback: number,
  mode: "trend" | "revert",
  evalWindow: number,
  regime: "low" | "mid" | "high",
): [number, number] {
  const start = Math.max(lookback, ordered.length - evalWindow);
  let correct = 0;
  let total = 0;
  for (let i = start; i < ordered.length; i++) {
    const window = ordered.slice(i - lookback, i);
    const target = ordered[i];
    const live =
      (target.lock_price as number | null | undefined) ??
      (window[window.length - 1]?.close_price as number | null | undefined);
    const [baseScore, v] = scoreFromWindow(
      window,
      live,
      target.lock_price as number | null | undefined,
      regime,
    );
    const score = mode === "revert" ? -baseScore : baseScore;
    const [direction] = directionFromScore(
      score,
      target.lock_price as number | null | undefined,
      live,
      v,
      regime,
    );
    const actual =
      (target.result as string | null) ??
      roundResult(
        target.lock_price as number | null | undefined,
        target.close_price as number | null | undefined,
      );
    if (actual === "UP" || actual === "DOWN" || actual === "FLAT") {
      total += 1;
      if (direction === actual) correct += 1;
    }
  }
  return [correct, total];
}

export function chooseLookback(
  ordered: AnyDict[],
  regime: "low" | "mid" | "high",
  evalWindow: number = 24,
): number {
  if (ordered.length <= 6) {
    return Math.max(3, ordered.length);
  }
  const maxLb = Math.min(8, ordered.length);
  let bestLb = Math.min(6, maxLb);
  let bestAcc = -1.0;
  for (let lb = 4; lb <= maxLb; lb++) {
    const [trendCorrect, trendTotal] = evaluateStrategy(
      ordered,
      lb,
      "trend",
      evalWindow,
      regime,
    );
    const [revertCorrect, revertTotal] = evaluateStrategy(
      ordered,
      lb,
      "revert",
      evalWindow,
      regime,
    );
    const trendAcc = trendTotal ? trendCorrect / trendTotal : 0.0;
    const revertAcc = revertTotal ? revertCorrect / revertTotal : 0.0;
    const acc = Math.max(trendAcc, revertAcc);
    if (acc > bestAcc) {
      bestAcc = acc;
      bestLb = lb;
    }
  }
  return bestLb;
}

export function chooseThreshold(
  ordered: AnyDict[],
  lookback: number,
  strategy: "trend" | "revert",
  regime: "low" | "mid" | "high",
  evalWindow: number = 24,
): [number, number, number] {
  const thresholds = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
  const start = Math.max(lookback, ordered.length - evalWindow);
  let bestT = 0.6;
  let bestScore = -1.0;
  let bestAcc = 0.0;
  let bestCov = 0.0;

  for (const t of thresholds) {
    let correct = 0;
    let acted = 0;
    let total = 0;
    for (let i = start; i < ordered.length; i++) {
      const window = ordered.slice(i - lookback, i);
      const target = ordered[i];
      const live =
        (target.lock_price as number | null | undefined) ??
        (window[window.length - 1]?.close_price as number | null | undefined);
      const [baseScore, v] = scoreFromWindow(
        window,
        live,
        target.lock_price as number | null | undefined,
        regime,
      );
      const score = strategy === "revert" ? -baseScore : baseScore;
      const [direction, , conf] = directionFromScore(
        score,
        target.lock_price as number | null | undefined,
        live,
        v,
        regime,
      );
      const predDir =
        conf < t || direction === "FLAT" ? "ABSTAIN" : direction;
      const actual =
        (target.result as string | null) ??
        roundResult(
          target.lock_price as number | null | undefined,
          target.close_price as number | null | undefined,
        );
      if (actual === "UP" || actual === "DOWN" || actual === "FLAT") {
        total += 1;
        if (predDir === "UP" || predDir === "DOWN") {
          acted += 1;
          if (predDir === actual) correct += 1;
        }
      }
    }
    if (!acted || !total) continue;
    const accuracy = correct / acted;
    const coverage = acted / total;
    const scoreVal = accuracy * Math.sqrt(coverage);
    if (scoreVal > bestScore) {
      bestScore = scoreVal;
      bestT = t;
      bestAcc = accuracy;
      bestCov = coverage;
    }
  }

  return [bestT, bestAcc, bestCov];
}

export function chooseStrategy(
  rounds: AnyDict[],
  lookback: number = 6,
  evalWindow: number = 24,
  regime: "low" | "mid" | "high" = "mid",
): "trend" | "revert" {
  const usable = rounds.filter(
    (r) => r.lock_price != null && r.close_price != null,
  );
  if (usable.length < lookback + 6) return "trend";
  const ordered = [...usable].reverse();
  const start = Math.max(lookback, ordered.length - evalWindow);

  const evalMode = (mode: "trend" | "revert"): [number, number] => {
    let correct = 0;
    let total = 0;
    for (let i = start; i < ordered.length; i++) {
      const window = ordered.slice(i - lookback, i);
      const target = ordered[i];
      const live =
        (target.lock_price as number | null | undefined) ??
        (window[window.length - 1]?.close_price as number | null | undefined);
      const [baseScore, v] = scoreFromWindow(
        window,
        live,
        target.lock_price as number | null | undefined,
        regime,
      );
      const score = mode === "revert" ? -baseScore : baseScore;
      const [direction] = directionFromScore(
        score,
        target.lock_price as number | null | undefined,
        live,
        v,
        regime,
      );
      const actual =
        (target.result as string | null) ??
        roundResult(
          target.lock_price as number | null | undefined,
          target.close_price as number | null | undefined,
        );
      if (actual === "UP" || actual === "DOWN" || actual === "FLAT") {
        total += 1;
        if (direction === actual) correct += 1;
      }
    }
    return [correct, total];
  };

  const [trendCorrect, trendTotal] = evalMode("trend");
  const [revertCorrect, revertTotal] = evalMode("revert");
  const trendAcc = trendTotal ? trendCorrect / trendTotal : 0.0;
  const revertAcc = revertTotal ? revertCorrect / revertTotal : 0.0;

  let threshold: number;
  if (regime === "high") threshold = -0.01;
  else if (regime === "low") threshold = 0.01;
  else threshold = 0.03;

  if (revertTotal && revertAcc > trendAcc + threshold) {
    return "revert";
  }
  return "trend";
}

export function roundMomentumPrediction(
  recentRounds: AnyDict[],
  livePrice: number | null | undefined,
  lockPrice: number | null | undefined,
): AnyDict | null {
  if (livePrice == null) return null;
  const ordered = [...recentRounds]
    .filter((r) => r.close_price != null)
    .reverse();
  if (!ordered.length) return null;

  const regime = volRegime(ordered);
  const lookback = chooseLookback(ordered, regime, 24);
  const window = ordered.slice(-lookback);
  const strategy = chooseStrategy(ordered, lookback, 24, regime);
  const [threshold, thAcc, thCov] = chooseThreshold(
    ordered,
    lookback,
    strategy,
    regime,
    24,
  );
  let [score, vol] = scoreFromWindow(window, livePrice, lockPrice, regime);
  if (strategy === "revert") {
    score = -score;
  }
  let [dir, predictedPrice, confidence] = directionFromScore(
    score,
    lockPrice,
    livePrice,
    vol,
    regime,
  );
  let direction: "UP" | "DOWN" | "FLAT" | "ABSTAIN" = dir;
  if (confidence < threshold || direction === "FLAT") {
    direction = "ABSTAIN";
  }
  return {
    predicted_price: predictedPrice,
    direction,
    confidence,
    model: "round-momentum",
    strategy,
    regime,
    lookback,
    threshold,
    threshold_acc: thAcc,
    threshold_cov: thCov,
  };
}

function smoothedAccuracy(stat: AnyDict | null | undefined): number {
  if (!stat) return 0.5;
  const correct = Number(stat.correct ?? 0);
  const acted = Number(stat.acted ?? 0);
  const priorCorrect = VOTE_PRIOR_TOTAL * 0.5;
  return (correct + priorCorrect) / (acted + VOTE_PRIOR_TOTAL);
}

function weightForModel(stat: AnyDict | null | undefined, stale: boolean): number {
  let weight = smoothedAccuracy(stat);
  if (stale) {
    weight *= VOTE_STALE_WEIGHT;
  }
  if (weight < 0.05) weight = 0.05;
  return weight;
}

export function buildVoteSummary(
  modelPredictions: AnyDict[],
  accuracyStats: AnyDict[],
): AnyDict {
  const statsMap = new Map<string, AnyDict>();
  for (const s of accuracyStats) {
    statsMap.set(`${s.model_type}::${s.model_name}`, s);
  }

  let upWeight = 0.0;
  let downWeight = 0.0;
  let totalModels = 0;
  let votedModels = 0;
  const details: AnyDict[] = [];

  for (const pred of modelPredictions) {
    const modelType = pred.model_type as string | undefined;
    const modelName = pred.model_name as string | undefined;
    const direction = (pred.predicted_direction as string | null)?.toUpperCase() || "";
    const stale = Boolean(pred.stale);
    
    // 如果是 LLM 模型，无论是否过期，给予绝对权重优先权
    // 强制权重为 2.0 (普通模型最大为 1.0)，确保 LLM 的意见能主导
    let weight = 0.5; // default
    let stat: AnyDict | undefined;

    if (modelType === "llm") {
      // 绝对霸权逻辑：LLM 的权重设为 1000，直接无视其他模型
      weight = 1000.0; 
      stat = statsMap.get(`${modelType}::${modelName}`);
    } else {
      // 量化模型如果不想要，可以在这里直接把权重设为 0，或者保留一点点参考
      // 既然用户要求“只要配置的大模型分析”，那我们就把其他模型的权重降到极低
      weight = 0.001;
      stat = statsMap.get(`${modelType}::${modelName}`);
    }

    if (weight >= 1.0) {
      totalModels += 1;
    }

    let voteWeight = 0.0;
    if (direction === "UP" || direction === "DOWN") {
      voteWeight = weight;
      // Only count participation if the model has significant weight (ignore suppressed models)
      if (weight >= 1.0) {
        votedModels += 1;
      }
      if (direction === "UP") upWeight += voteWeight;
      else downWeight += voteWeight;
    }

    details.push({
      model_type: modelType,
      model_name: modelName,
      direction: direction || null,
      accuracy: stat ? Number(stat.accuracy ?? 0.0) : 0.0,
      acted: stat ? Number(stat.acted ?? 0) : 0,
      total: stat ? Number(stat.total ?? 0) : 0,
      weight,
      vote_weight: voteWeight,
      stale,
    });
  }

  const totalWeight = upWeight + downWeight;
  const confidence =
    totalWeight > 0 ? Math.abs(upWeight - downWeight) / totalWeight : 0.0;
  let decision: "UP" | "DOWN" | "ABSTAIN" = "ABSTAIN";
  if (totalWeight > 0 && upWeight !== downWeight && confidence >= VOTE_MIN_CONFIDENCE) {
    decision = upWeight > downWeight ? "UP" : "DOWN";
  }
  const participation =
    totalModels > 0 ? votedModels / totalModels : 0.0;
  details.sort((a, b) => b.weight - a.weight);

  return {
    decision,
    confidence,
    participation,
    up_weight: upWeight,
    down_weight: downWeight,
    total_weight: totalWeight,
    details,
  };
}

export function computeBet(amount: number, vote: AnyDict): AnyDict {
  if (amount <= 0) {
    return { amount: 0.0, percent: 0.0, score: 0.0 };
  }
  if (vote.decision === "NO") {
    return { amount: 0.0, percent: 0.0, score: 0.0 };
  }
  let score =
    Number(vote.confidence ?? 0.0) * Number(vote.participation ?? 0.0);
  score = Math.max(0.0, Math.min(score, 1.0));
  let percent = 0.05 + 0.2 * score;
  percent = Math.max(0.05, Math.min(percent, 0.25));
  return { amount: amount * percent, percent, score };
}

function strategyConfig(name: string | null | undefined): {
  min_conf: number;
  min_part: number;
  size_mult: number;
} {
  if (!name) return SIM_STRATEGIES.balanced;
  return SIM_STRATEGIES[name] ?? SIM_STRATEGIES.balanced;
}

export function applyStrategy(vote: AnyDict, strategy: string): AnyDict {
  const config = strategyConfig(strategy);
  const adjusted = { ...vote };
  const decision = adjusted.decision as string | undefined;
  const confidence = Number(adjusted.confidence ?? 0.0);
  const participation = Number(adjusted.participation ?? 0.0);
  if (decision !== "NO") {
    if (confidence < config.min_conf || participation < config.min_part) {
      adjusted.decision = "NO";
    }
  }
  return adjusted;
}

export function computeBetWithStrategy(
  amount: number,
  vote: AnyDict,
  strategy: string,
): AnyDict {
  const base = computeBet(amount, vote);
  if (Number(base.amount ?? 0.0) <= 0 || vote.decision === "NO") {
    return base;
  }
  const config = strategyConfig(strategy);
  let percent =
    Number(base.percent ?? 0.0) * Number(config.size_mult ?? 1.0);
  percent = Math.max(0.05, Math.min(percent, 0.25));
  return { amount: amount * percent, percent, score: base.score };
}

