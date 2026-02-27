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

export async function getModelConfig(): Promise<ModelConfig> {
  const base_amount = parseFloat((await getConfig("BASE_AMOUNT", "100")) || "100");
  const strategy = ((await getConfig("STRATEGY", "balanced")) || "balanced") as StrategyName;
  const enable_round_momentum = (await getConfig("ENABLE_ROUND_MOMENTUM", "1")) === "1";

  return {
    base_amount,
    strategy,
    enable_round_momentum,
  };
}

export async function updateModelConfig(partial: Partial<ModelConfig>): Promise<ModelConfig> {
  if (partial.base_amount !== undefined) {
    await setConfig("BASE_AMOUNT", partial.base_amount.toString());
  }
  if (partial.strategy !== undefined) {
    await setConfig("STRATEGY", partial.strategy);
  }
  if (partial.enable_round_momentum !== undefined) {
    await setConfig("ENABLE_ROUND_MOMENTUM", partial.enable_round_momentum ? "1" : "0");
  }
  return getModelConfig();
}
