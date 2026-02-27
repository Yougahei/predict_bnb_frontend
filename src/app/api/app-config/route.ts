import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/configStore";

const CONFIG_GROUPS = [
  {
    title: "网络代理",
    fields: [
      {
        key: "SOCKS5_PROXY",
        label: "SOCKS5 代理",
        placeholder: "socks5h://172.23.64.1:10808",
      },
      {
        key: "HTTP_TIMEOUT",
        label: "HTTP 超时 (秒)",
        placeholder: "6",
      },
    ],
  },
  {
    title: "链上数据",
    fields: [
      {
        key: "BSC_RPC_URL",
        label: "BSC RPC URL",
        placeholder: "https://bsc-dataseed.binance.org/",
      },
      {
        key: "BSC_RPC_TIMEOUT",
        label: "RPC 超时 (秒)",
        placeholder: "4",
      },
      {
        key: "PREDICTION_ADDRESS",
        label: "Prediction 合约地址",
        placeholder: "0x18b2a687610328590bc8f2e5fedde3b582a49cda",
      },
      {
        key: "CHAINLINK_FEED_ADDRESS",
        label: "Chainlink BNB/USD Feed 地址",
        placeholder: "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
      },
      {
        key: "CHAINLINK_DECIMALS_DEFAULT",
        label: "Chainlink 价格小数位",
        placeholder: "8",
      },
      {
        key: "WALLET_ADDRESS",
        label: "钱包地址 (用于显示余额)",
        placeholder: "0x...",
      },
      {
        key: "USD_CNY_RATE",
        label: "USD/CNY 汇率 (手动配置)",
        placeholder: "7.25",
      },
    ],
  },
  {
    title: "LLM 全局配置",
    fields: [
      {
        key: "LLM_ENABLE_THINKING",
        label: "启用思维链 (DeepSeek V3)",
        placeholder: "0 或 1",
      },
      {
        key: "LLM_TIMEOUT",
        label: "超时秒数",
        placeholder: "12",
      },
      {
        key: "LLM_AUTO_PREDICT",
        label: "开启自动 LLM 分析",
        placeholder: "1 为开启，0 为关闭",
      },
    ],
  },
  {
    title: "自动下注后台配置",
    fields: [
      {
        key: "AUTO_BET_ENABLED",
        label: "启用自动下注",
        placeholder: "1 为开启，0 为关闭",
      },
      {
        key: "WALLET_PRIVATE_KEY",
        label: "钱包私钥",
        placeholder: "0x...",
      },
      {
        key: "STRATEGY",
        label: "当前策略 (conservative/balanced/aggressive)",
        placeholder: "balanced",
      },
      {
        key: "BET_PERCENTAGE_CONSERVATIVE",
        label: "保守策略仓位 (%)",
        placeholder: "10",
      },
      {
        key: "BET_PERCENTAGE_BALANCED",
        label: "稳健策略仓位 (%)",
        placeholder: "10",
      },
      {
        key: "BET_PERCENTAGE_AGGRESSIVE",
        label: "激进策略仓位 (%)",
        placeholder: "10",
      },
      {
        key: "BET_PERCENTAGE",
        label: "默认/兜底下注仓位 (%)",
        placeholder: "10",
      },
    ],
  },
];

export async function GET() {
  const groups = await Promise.all(CONFIG_GROUPS.map(async (group) => ({
    title: group.title,
    fields: await Promise.all(group.fields.map(async (field) => {
      const value = await getConfig(field.key);
      return {
        ...field,
        value: value || "",
        has_value: !!value,
      };
    })),
  })));

  return NextResponse.json({ groups });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { key, value, clear } = body;

    if (clear) {
      await setConfig(key, null);
    } else {
      await setConfig(key, value);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "failed" }, { status: 400 });
  }
}
