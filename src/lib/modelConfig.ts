import { getConfig, setConfig } from "./configStore";

export type StrategyName = "conservative" | "balanced" | "aggressive";

export interface ModelConfig {
  /** 账户总资金，用于计算建议下注额 */
  base_amount: number;
  /** 使用哪种下注风格 */
  strategy: StrategyName;
  /** 是否启用 round-momentum 模型参与投票 */
  enable_round_momentum: boolean;
}

export function getModelConfig(): ModelConfig {
  const base_amount = parseFloat(getConfig("BASE_AMOUNT", "100") || "100");
  const strategy = (getConfig("STRATEGY", "balanced") || "balanced") as StrategyName;
  const enable_round_momentum = getConfig("ENABLE_ROUND_MOMENTUM", "1") === "1";

  return {
    base_amount,
    strategy,
    enable_round_momentum,
  };
}

export function updateModelConfig(partial: Partial<ModelConfig>): ModelConfig {
  if (partial.base_amount !== undefined) {
    setConfig("BASE_AMOUNT", partial.base_amount.toString());
  }
  if (partial.strategy !== undefined) {
    setConfig("STRATEGY", partial.strategy);
  }
  if (partial.enable_round_momentum !== undefined) {
    setConfig("ENABLE_ROUND_MOMENTUM", partial.enable_round_momentum ? "1" : "0");
  }
  return getModelConfig();
}
