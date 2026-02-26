"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function formatTs(ts: number | null) {
  if (!ts) return "--";
  return new Date(ts).toLocaleString();
}

function formatNumber(value: number | null | undefined, digits = 4) {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}

export default function GamingPage() {
  const [state, setState] = useState<any>(null);
  const [amount, setAmount] = useState(100);
  const [strategy, setStrategy] = useState("balanced");
  const [loading, setLoading] = useState(false);

  async function loadState() {
    const res = await fetch("/api/gaming?simId=admin-sim");
    if (res.ok) {
      const json = await res.json();
      setState(json);
    }
  }

  useEffect(() => {
    loadState();
    const id = setInterval(loadState, 5000);
    return () => clearInterval(id);
  }, []);

  async function handleAction(action: "start" | "stop") {
    setLoading(true);
    try {
      const res = await fetch("/api/gaming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, simId: "admin-sim", amount, strategy }),
      });
      if (res.ok) {
        const json = await res.json();
        setState(json);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">模拟器</h1>
          <p className="mt-1 text-sm text-slate-400">使用虚拟资金模拟下注策略。</p>
        </div>
      </header>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider">当前余额</div>
            <div className="mt-2 text-2xl font-semibold text-sky-400">${formatNumber(state?.balance, 2)}</div>
            <div className="mt-1 text-xs text-slate-500">初始: ${formatNumber(state?.start_balance, 2)}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider">收益率 (ROI)</div>
            <div className={`mt-2 text-2xl font-semibold ${state?.balance >= state?.start_balance ? 'text-emerald-400' : 'text-rose-400'}`}>
              {state?.start_balance ? (((state.balance - state.start_balance) / state.start_balance) * 100).toFixed(2) : '0.00'}%
            </div>
            <div className="mt-1 text-xs text-slate-500">利润: ${formatNumber(state?.balance - state?.start_balance, 2)}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider">胜率 / 交易数</div>
            <div className="mt-2 text-2xl font-semibold text-slate-100">
              {state?.stats?.trades ? ((state.stats.wins / state.stats.trades) * 100).toFixed(1) : '0.0'}%
            </div>
            <div className="mt-1 text-xs text-slate-500">{state?.stats?.wins} 胜 / {state?.stats?.losses} 负</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider">最大回撤</div>
            <div className="mt-2 text-2xl font-semibold text-rose-400">{(state?.stats?.max_drawdown * 100).toFixed(1)}%</div>
            <div className="mt-1 text-xs text-slate-500">跳过: {state?.stats?.skipped}</div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-1 rounded-2xl border border-slate-800 bg-slate-950/80 p-6">
            <h2 className="text-lg font-medium">控制面板</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">初始资金 (USDT)</label>
                <input 
                  type="number" 
                  className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-sm" 
                  value={amount} 
                  onChange={e => setAmount(Number(e.target.value))} 
                  disabled={state?.running}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">模拟策略</label>
                <select 
                  className="w-full rounded bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                  value={strategy}
                  onChange={e => setStrategy(e.target.value)}
                  disabled={state?.running}
                >
                  <option value="conservative">保守</option>
                  <option value="balanced">均衡</option>
                  <option value="aggressive">激进</option>
                </select>
              </div>
              <div className="pt-2">
                {!state?.running ? (
                  <button 
                    onClick={() => handleAction('start')} 
                    className="w-full py-2 rounded-full bg-emerald-500 text-slate-950 font-medium hover:bg-emerald-400 transition"
                    disabled={loading}
                  >
                    启动模拟
                  </button>
                ) : (
                  <button 
                    onClick={() => handleAction('stop')} 
                    className="w-full py-2 rounded-full bg-rose-500 text-slate-50 font-medium hover:bg-rose-400 transition"
                    disabled={loading}
                  >
                    停止模拟
                  </button>
                )}
              </div>
              <div className="mt-4 p-3 rounded bg-slate-900/50 border border-slate-800">
                <div className="text-xs text-slate-500">状态: <span className="text-slate-200">{state?.status}</span></div>
                {state?.open_bet && (
                  <div className="mt-2 text-xs text-slate-300">
                    当前下注: <span className={state.open_bet.direction === 'UP' ? 'text-emerald-400' : 'text-rose-400'}>{state.open_bet.direction}</span> ({formatNumber(state.open_bet.amount, 2)})
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-2 rounded-2xl border border-slate-800 bg-slate-950/80 p-6">
            <h2 className="text-lg font-medium">交易历史</h2>
            <div className="mt-4 overflow-auto max-h-[400px]">
              <table className="w-full text-xs text-left">
                <thead className="text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="pb-2">回合</th>
                    <th className="pb-2">方向</th>
                    <th className="pb-2">结果</th>
                    <th className="pb-2">金额</th>
                    <th className="pb-2">盈亏</th>
                    <th className="pb-2">余额</th>
                    <th className="pb-2">时间</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {state?.history?.slice().reverse().map((h: any, i: number) => (
                    <tr key={i} className="border-b border-slate-900/50">
                      <td className="py-2 font-mono">{h.epoch}</td>
                      <td className={`py-2 ${h.direction === 'UP' ? 'text-emerald-400' : 'text-rose-400'}`}>{h.direction}</td>
                      <td className={`py-2 ${h.result === h.direction ? 'text-emerald-400' : 'text-rose-400'}`}>{h.result}</td>
                      <td className="py-2">{formatNumber(h.bet_amount, 2)}</td>
                      <td className={`py-2 ${h.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {h.profit >= 0 ? '+' : ''}{formatNumber(h.profit, 2)}
                      </td>
                      <td className="py-2 font-mono">{formatNumber(h.balance, 2)}</td>
                      <td className="py-2 text-slate-500 text-[10px]">{formatTs(h.resolved_at)}</td>
                    </tr>
                  ))}
                  {(!state?.history || state.history.length === 0) && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-600">暂无交易记录</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    );
  }
