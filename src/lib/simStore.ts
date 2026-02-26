import { Snapshot, buildSnapshot } from "./snapshot";
import { fetchRound } from "./onchain";
import {
  buildVoteSummary,
  applyStrategy,
  computeBetWithStrategy,
  roundResult,
  calcPayout,
} from "./prediction";

export interface SimBet {
  epoch: number;
  direction: "UP" | "DOWN";
  amount: number;
  percent: number;
  placed_at: number;
}

export interface SimState {
  running: boolean;
  strategy: string;
  balance: number;
  start_balance: number;
  started_at: number | null;
  open_bet: SimBet | null;
  history: any[];
  stats: {
    trades: number;
    wins: number;
    losses: number;
    skipped: number;
    max_drawdown: number;
    peak_balance: number;
  };
  status: string;
  last_attempt_epoch: number | null;
}

const SIM_STATES = new Map<string, SimState>();

export function getSimState(simId: string): SimState {
  let state = SIM_STATES.get(simId);
  if (!state) {
    state = {
      running: false,
      strategy: "balanced",
      balance: 0,
      start_balance: 0,
      started_at: null,
      open_bet: null,
      history: [],
      stats: {
        trades: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
        max_drawdown: 0,
        peak_balance: 0,
      },
      status: "未启动",
      last_attempt_epoch: null,
    };
    SIM_STATES.set(simId, state);
  }
  return state;
}

export async function tickSim(simId: string): Promise<SimState> {
  const state = getSimState(simId);
  if (!state.running) return state;

  // Resolve open bet
  if (state.open_bet) {
    const epoch = state.open_bet.epoch;
    try {
      const roundData = await fetchRound(epoch);
      if (roundData.oracle_called && roundData.close_price != null) {
        const actual = roundResult(roundData.lock_price, roundData.close_price);
        const direction = state.open_bet.direction;
        const betAmount = state.open_bet.amount;
        let payout = 1.0;
        if (direction === "UP") {
          payout = calcPayout(roundData.total_amount, roundData.bull_amount) || 1.0;
        } else if (direction === "DOWN") {
          payout = calcPayout(roundData.total_amount, roundData.bear_amount) || 1.0;
        }

        let profit = 0;
        let win = false;
        if (actual === direction) {
          profit = betAmount * (payout - 1.0);
          win = true;
        } else {
          profit = -betAmount;
          win = false;
        }

        state.balance += profit;
        state.stats.trades += 1;
        if (win) state.stats.wins += 1;
        else state.stats.losses += 1;

        if (state.balance > state.stats.peak_balance) {
          state.stats.peak_balance = state.balance;
        }
        const drawdown = (state.stats.peak_balance - state.balance) / state.stats.peak_balance;
        if (drawdown > state.stats.max_drawdown) {
          state.stats.max_drawdown = drawdown;
        }

        state.history.push({
          epoch,
          direction,
          result: actual,
          bet_amount: betAmount,
          payout,
          profit,
          balance: state.balance,
          placed_at: state.open_bet.placed_at,
          resolved_at: Date.now(),
        });

        if (state.history.length > 80) state.history.shift();
        state.open_bet = null;
        state.status = "已结算，等待下一轮";
      }
    } catch (err) {
      state.status = `等待结算错误: ${err}`;
    }
  }

  if (state.open_bet) return state;

  // Place new bet
  const snapshot = await buildSnapshot({ autoBet: false });
  const roundInfo = snapshot.round;
  const epoch = roundInfo.epoch;

  if (!epoch || state.last_attempt_epoch === epoch) return state;

  const now = Date.now();
  if (roundInfo.lock_ts && now >= roundInfo.lock_ts) {
    state.status = "本轮已锁定";
    state.last_attempt_epoch = epoch;
    return state;
  }

  const vote = buildVoteSummary(snapshot.model_predictions, snapshot.accuracy);
  const adjustedVote = applyStrategy(vote, state.strategy);

  // Check for fresh votes
  const hasFresh = snapshot.model_predictions.some(p => !p.stale && (p.predicted_direction === 'UP' || p.predicted_direction === 'DOWN'));
  if (!hasFresh) {
    adjustedVote.decision = "NO";
  }

  const bet = computeBetWithStrategy(state.balance, adjustedVote, state.strategy);
  
  if (adjustedVote.decision !== "NO" && bet.amount > 0) {
    state.open_bet = {
      epoch,
      direction: adjustedVote.decision,
      amount: bet.amount,
      percent: bet.percent,
      placed_at: now,
    };
    state.status = `已下注 ${adjustedVote.decision}`;
  } else {
    state.stats.skipped += 1;
    state.status = "本轮弃权";
  }

  state.last_attempt_epoch = epoch;
  return state;
}
