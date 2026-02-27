// Ported from Python onchain.py
// EVM / BSC on-chain access utilities for the prediction market.

import { BrowserProvider, JsonRpcProvider, Contract, Wallet, parseEther } from "ethers";

export type Dict<T = any> = Record<string, T>;

export const DEFAULT_BSC_RPCS: string[] = [
  "https://bsc-dataseed.binance.org/",
  "https://bsc-dataseed1.binance.org/",
  "https://bsc-dataseed2.binance.org/",
  "https://1rpc.io/bnb",
  "https://binance.llamarpc.com",
  "https://rpc.ankr.com/bsc",
];

export const PREDICTION_ADDRESS_DEFAULT =
  "0x18b2a687610328590bc8f2e5fedde3b582a49cda";
export const CHAINLINK_FEED_ADDRESS_DEFAULT =
  "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE";
export const CHAINLINK_DECIMALS_DEFAULT = 8;
export const BSC_RPC_TIMEOUT_DEFAULT = 4.0;

const BINANCE_BASE = "https://api.binance.com/api/v3";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// NOTE: we keep ABI structure identical to Python version.
export const PREDICTION_ABI = [
  {
    inputs: [],
    name: "currentEpoch",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "rounds",
    outputs: [
      { internalType: "uint256", name: "epoch", type: "uint256" },
      { internalType: "uint256", name: "startTimestamp", type: "uint256" },
      { internalType: "uint256", name: "lockTimestamp", type: "uint256" },
      { internalType: "uint256", name: "closeTimestamp", type: "uint256" },
      { internalType: "int256", name: "lockPrice", type: "int256" },
      { internalType: "int256", name: "closePrice", type: "int256" },
      { internalType: "uint256", name: "lockOracleId", type: "uint256" },
      { internalType: "uint256", name: "closeOracleId", type: "uint256" },
      { internalType: "uint256", name: "totalAmount", type: "uint256" },
      { internalType: "uint256", name: "bullAmount", type: "uint256" },
      { internalType: "uint256", name: "bearAmount", type: "uint256" },
      { internalType: "uint256", name: "rewardBaseCalAmount", type: "uint256" },
      { internalType: "uint256", name: "rewardAmount", type: "uint256" },
      { internalType: "bool", name: "oracleCalled", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "epoch", type: "uint256" }],
    name: "betBull",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "epoch", type: "uint256" }],
    name: "betBear",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256[]", name: "epochs", type: "uint256[]" }],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "epoch", type: "uint256" },
      { internalType: "address", name: "user", type: "address" },
    ],
    name: "claimable",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const AGGREGATOR_ABI = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { internalType: "uint80", name: "roundId", type: "uint80" },
      { internalType: "int256", name: "answer", type: "int256" },
      { internalType: "uint256", name: "startedAt", type: "uint256" },
      { internalType: "uint256", name: "updatedAt", type: "uint256" },
      { internalType: "uint80", name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

let _provider: JsonRpcProvider | null = null;
let _providerUrl: string | null = null;
let _decimals: number | null = null;
let _decimalsTs = 0;

function rpcCandidates(): string[] {
  const env = process.env.NEXT_PUBLIC_BSC_RPC_URL;
  if (env) {
    return env
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
  }
  return [...DEFAULT_BSC_RPCS];
}

function rpcTimeout(): number {
  const value = process.env.NEXT_PUBLIC_BSC_RPC_TIMEOUT;
  if (!value) return BSC_RPC_TIMEOUT_DEFAULT;
  const num = Number(value);
  return Number.isFinite(num) ? num : BSC_RPC_TIMEOUT_DEFAULT;
}

async function connectWeb3(): Promise<[JsonRpcProvider | null, string | null]> {
  const timeoutSec = rpcTimeout();
  const candidates = rpcCandidates();

  for (const url of candidates) {
    try {
      // Create a provider with a specific network to avoid automatic detection overhead
      const provider = new JsonRpcProvider(url, 56, {
        staticNetwork: true, 
      });
      
      // Simple connectivity check with timeout
      const timeoutMs = 3000;
      try {
        await Promise.race([
          provider.getBlockNumber(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), timeoutMs)
          )
        ]);
        
        console.log(`[OnChain] Connected to RPC: ${url}`);
        return [provider, url];
      } catch (e) {
        // console.log(`[OnChain] RPC ${url} failed/timeout`, e);
        continue;
      }
    } catch (e) {
      console.error(`[OnChain] RPC setup error for ${url}`, e);
      continue;
    }
  }
  return [null, null];
}

export async function getWeb3(): Promise<[JsonRpcProvider | null, string | null]> {
  // If we already have a provider, verify it's still working
  if (_provider) {
    try {
      // Quick check to see if the provider is still responsive
      await Promise.race([
        _provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]);
      return [_provider, _providerUrl];
    } catch (e) {
      console.warn(`[OnChain] Existing provider ${_providerUrl} became unresponsive, reconnecting...`);
      _provider = null;
      _providerUrl = null;
    }
  }
  if (_provider) {
    return [_provider, _providerUrl];
  }
  const [prov, url] = await connectWeb3();
  if (prov && url) {
    _provider = prov;
    _providerUrl = url;
    return [prov, url];
  }
  return [null, null];
}

async function getContract(address: string, abi: any): Promise<Contract> {
  const [prov] = await getWeb3();
  if (!prov) {
    throw new Error("BSC RPC unavailable");
  }
  if (!address) {
    throw new Error("Invalid contract address");
  }
  return new Contract(address, abi, prov);
}

export function getAddressFromPrivateKey(pk: string): string | null {
  if (!pk) return null;
  try {
    const cleanPk = pk.startsWith("0x") ? pk : "0x" + pk;
    const wallet = new Wallet(cleanPk);
    return wallet.address;
  } catch (e) {
    return null;
  }
}

export async function getPredictionContract(): Promise<Contract> {
  const address =
    process.env.NEXT_PUBLIC_PREDICTION_ADDRESS || PREDICTION_ADDRESS_DEFAULT;
  return getContract(address, PREDICTION_ABI);
}

export async function getChainlinkContract(): Promise<Contract> {
  const address =
    process.env.NEXT_PUBLIC_CHAINLINK_FEED_ADDRESS || CHAINLINK_FEED_ADDRESS_DEFAULT;
  return getContract(address, AGGREGATOR_ABI);
}

async function getDecimals(): Promise<number> {
  const now = Date.now() / 1000;
  if (_decimals != null && now - _decimalsTs < 3600) {
    return _decimals;
  }
  try {
    const contract = await getChainlinkContract();
    const decimals: bigint = await contract.decimals();
    _decimals = Number(decimals);
    _decimalsTs = now;
    return _decimals;
  } catch {
    if (_decimals == null) {
      const raw = process.env.NEXT_PUBLIC_CHAINLINK_DECIMALS_DEFAULT;
      if (raw != null) {
        const n = Number(raw);
        _decimals = Number.isFinite(n) ? n : CHAINLINK_DECIMALS_DEFAULT;
      } else {
        _decimals = CHAINLINK_DECIMALS_DEFAULT;
      }
    }
    return _decimals;
  }
}

function toPrice(value: bigint | null | undefined, decimals: number): number | null {
  if (value == null) return null;
  return Number(value) / 10 ** decimals;
}

function toAmount(
  value: bigint | null | undefined,
  decimals: number = 18,
): number | null {
  if (value == null) return null;
  return Number(value) / 10 ** decimals;
}

export async function fetchChainlinkPrice(): Promise<Dict> {
  return callWithRetry(async () => {
    const contract = await getChainlinkContract();
    const [roundId, answer, startedAt, updatedAt] = await contract.latestRoundData();
    const decimals = await getDecimals();
    const price = toPrice(answer, decimals);
    return {
      price,
      round_id: Number(roundId),
      started_at: Number(startedAt),
      updated_at: Number(updatedAt),
      decimals,
      source: "chainlink",
    };
  });
}

async function callWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const isNetworkError = 
        e.code === 'ECONNRESET' || 
        e.code === 'ETIMEDOUT' || 
        e.code === 'NETWORK_ERROR' ||
        e.message?.includes('network') || 
        e.message?.includes('timeout') ||
        e.message?.includes('connection') ||
        e.message?.includes('unavailable');

      if (i < retries - 1) {
        console.warn(`[OnChain] Call failed (attempt ${i + 1}/${retries}): ${e.message}`);
        
        if (isNetworkError) {
          console.log("[OnChain] Network error detected, clearing provider cache...");
          _provider = null;
          _providerUrl = null;
        }
        
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
        continue;
      }
      throw e;
    }
  }
  throw new Error("Unreachable");
}

export async function fetchBinancePrice(): Promise<number> {
  const resp = await fetch(`${BINANCE_BASE}/ticker/price?symbol=BNBUSDT`);
  if (!resp.ok) throw new Error(`Binance error: ${resp.statusText}`);
  const data = await resp.json();
  return parseFloat(data.price);
}

export async function fetchCoingeckoPrice(): Promise<number> {
  const resp = await fetch(`${COINGECKO_BASE}/simple/price?ids=binancecoin&vs_currencies=usd`);
  if (!resp.ok) throw new Error(`Coingecko error: ${resp.statusText}`);
  const data = await resp.json();
  return parseFloat(data.binancecoin.usd);
}

export async function fetchLivePrice(): Promise<Dict> {
  // Try Chainlink first
  try {
    const data = await fetchChainlinkPrice();
    if (data.price != null) return data;
  } catch (err) {
    console.error("Chainlink fetch error", err);
  }

  // Fallback to Binance
  try {
    const price = await fetchBinancePrice();
    return {
      price,
      source: "binance",
      updated_at: Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    console.error("Binance fetch error", err);
  }

  // Fallback to Coingecko
  try {
    const price = await fetchCoingeckoPrice();
    return {
      price,
      source: "coingecko",
      updated_at: Math.floor(Date.now() / 1000),
    };
  } catch (err) {
    console.error("Coingecko fetch error", err);
  }

  throw new Error("All price sources failed");
}

export async function fetchCurrentEpoch(): Promise<number> {
  return callWithRetry(async () => {
    const contract = await getPredictionContract();
    const epoch: bigint = await contract.currentEpoch();
    return Number(epoch);
  });
}

export interface RoundData {
  epoch: number;
  start_ts: number;
  lock_ts: number;
  close_ts: number;
  lock_price: number | null;
  close_price: number | null;
  lock_oracle_id: number;
  close_oracle_id: number;
  total_amount: number | null;
  bull_amount: number | null;
  bear_amount: number | null;
  reward_base: number | null;
  reward_amount: number | null;
  oracle_called: boolean;
}

export async function fetchRound(epoch: number): Promise<RoundData> {
  return callWithRetry(async () => {
    const contract = await getPredictionContract();
    const decimals = await getDecimals();
    const data = await contract.rounds(BigInt(epoch));
    return {
      epoch: Number(data[0]),
      start_ts: Number(data[1]) * 1000,
      lock_ts: Number(data[2]) * 1000,
      close_ts: Number(data[3]) * 1000,
      lock_price: data[4] ? toPrice(data[4], decimals) : null,
      close_price: data[5] ? toPrice(data[5], decimals) : null,
      lock_oracle_id: Number(data[6]),
      close_oracle_id: Number(data[7]),
      total_amount: data[8] != null ? toAmount(data[8]) : null,
      bull_amount: data[9] != null ? toAmount(data[9]) : null,
      bear_amount: data[10] != null ? toAmount(data[10]) : null,
      reward_base: data[11] != null ? toAmount(data[11]) : null,
      reward_amount: data[12] != null ? toAmount(data[12]) : null,
      oracle_called: Boolean(data[13]),
    };
  });
}

export async function fetchCurrentRound(): Promise<RoundData & { current_epoch: number }> {
  const epoch = await fetchCurrentEpoch();
  const current = await fetchRound(epoch);
  return {
    ...current,
    current_epoch: epoch,
  };
}

export async function fetchBalance(address: string): Promise<number | null> {
  const [prov] = await getWeb3();
  if (!prov || !address) return null;
  try {
    const balance = await prov.getBalance(address);
    return Number(balance) / 10 ** 18;
  } catch (err) {
    console.error("fetchBalance error", err);
    return null;
  }
}

export async function placeBet(
  privateKey: string,
  epoch: number,
  side: "UP" | "DOWN",
  amountBnb: number
): Promise<{ hash: string } | null> {
  const [prov] = await getWeb3();
  if (!prov || !privateKey) return null;

  try {
    const wallet = new Wallet(privateKey, prov);
    const contract = new Contract(
      process.env.NEXT_PUBLIC_PREDICTION_ADDRESS || PREDICTION_ADDRESS_DEFAULT,
      PREDICTION_ABI,
      wallet
    );

    const method = side === "UP" ? "betBull" : "betBear";
    // Ensure amount doesn't have too many decimals for ethers parseEther (max 18, but 9 is safe and plenty)
    const safeAmount = Math.floor(amountBnb * 1e9) / 1e9;
    const val = parseEther(safeAmount.toFixed(9));
    
    // PancakeSwap prediction contract requires epoch as argument
    const nonce = await prov.getTransactionCount(wallet.address, "latest");
    const tx = await contract[method](BigInt(epoch), { value: val, nonce });
    return { hash: tx.hash };
  } catch (err) {
    console.error("placeBet error", err);
    throw err;
  }
}

export async function checkClaimable(
  epoch: number,
  userAddress: string
): Promise<boolean> {
  try {
    return await callWithRetry(async () => {
      const contract = await getPredictionContract();
      return await contract.claimable(BigInt(epoch), userAddress);
    });
  } catch (err) {
    console.error(`checkClaimable error for epoch ${epoch}`, err);
    return false;
  }
}

export async function claimRewards(
  privateKey: string,
  epochs: number[]
): Promise<{ hash: string } | null> {
  const [prov] = await getWeb3();
  if (!prov || !privateKey || epochs.length === 0) return null;

  try {
    const wallet = new Wallet(privateKey, prov);
    const contract = new Contract(
      process.env.NEXT_PUBLIC_PREDICTION_ADDRESS || PREDICTION_ADDRESS_DEFAULT,
      PREDICTION_ABI,
      wallet
    );

    // Get nonce manually to prevent stuck transactions
    const nonce = await prov.getTransactionCount(wallet.address, "latest");
    
    // Use a fixed high gas limit per claim (e.g. 200k per epoch)
    // 300k base + 100k per epoch to be safe
    const gasLimit = BigInt(300000 + epochs.length * 100000);

    const tx = await contract.claim(epochs.map((e) => BigInt(e)), { 
      nonce,
      gasLimit 
    });
    
    console.log(`[OnChain] Claim tx sent: ${tx.hash}, waiting for confirmation...`);
    await tx.wait(1); // Wait for 1 confirmation
    console.log(`[OnChain] Claim tx confirmed: ${tx.hash}`);

    return { hash: tx.hash };
  } catch (err) {
    console.error("claimRewards error", err);
    throw err;
  }
}

export async function fetchRecentRounds(limit: number = 12): Promise<RoundData[]> {
  let epoch = await fetchCurrentEpoch();
  const rounds: RoundData[] = [];
  let checked = 0;
  while (epoch > 0 && rounds.length < limit && checked < limit * 3) {
    const data = await fetchRound(epoch);
    checked += 1;
    if (data.close_ts && data.oracle_called) {
      rounds.push(data);
    }
    epoch -= 1;
  }
  return rounds;
}

