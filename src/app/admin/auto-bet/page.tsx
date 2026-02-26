"use client";

import { useEffect, useState } from "react";

function formatTs(ts: number | null) {
  if (!ts) return "--";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

export default function AutoBetPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Config state
  const [autoBetEnabled, setAutoBetEnabled] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [betPercentage, setBetPercentage] = useState("10");
  const [saving, setSaving] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  
  // Claiming state
  const [claimableEpochs, setClaimableEpochs] = useState<number[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [bnbPrice, setBnbPrice] = useState<number | null>(null);

  async function loadConfig() {
    const res = await fetch("/api/app-config");
    if (res.ok) {
      const json = await res.json();
      const allFields = json.groups.flatMap((g: any) => g.fields);
      const enabled = allFields.find((f: any) => f.key === "AUTO_BET_ENABLED")?.value === "1";
      const pk = allFields.find((f: any) => f.key === "WALLET_PRIVATE_KEY")?.value || "";
      const pct = allFields.find((f: any) => f.key === "BET_PERCENTAGE")?.value || "10";
      
      setAutoBetEnabled(enabled);
      setHasStoredKey(!!pk && pk.length > 10);
      // We don't set privateKey state from load to keep it hidden
      setBetPercentage(pct);
    }
  }

  async function updateConfig(key: string, value: string) {
    let finalValue = value.trim();
    if (key === "WALLET_PRIVATE_KEY") {
      // Remove 0x prefix if present
      if (finalValue.startsWith("0x")) {
        finalValue = finalValue.substring(2);
      }
      
      if (finalValue.length !== 64) {
        alert(`私钥长度不正确：当前长度为 ${finalValue.length}，标准私钥应为 64 位十六进制字符串。`);
        return;
      }
      
      if (!/^[0-9a-fA-F]{64}$/.test(finalValue)) {
        alert("私钥包含非十六进制字符，请确保只包含数字 0-9 和字母 a-f。");
        return;
      }
    }
    
    setSaving(true);
    try {
      const res = await fetch("/api/app-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: finalValue }),
      });
      
      if (res.ok) {
        if (key === "WALLET_PRIVATE_KEY") {
          setPrivateKey(""); 
          setShowKeyInput(false);
          setHasStoredKey(true); // Force immediate UI update
          setTimeout(() => alert("私钥已安全保存到数据库"), 50);
        }
        await loadConfig();
      } else {
        alert("保存失败，请检查网络");
      }
    } catch (e: any) {
      alert("错误: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function loadLogs() {
    try {
      setLoading(true);
      const res = await fetch("/api/bet-logs");
      if (res.ok) {
        const json = await res.json();
        setLogs(json.logs || []);
        setStats(json.stats || null);
        if (json.balance !== undefined) {
          setBalance(json.balance);
        }
        if (json.bnbPrice) {
          setBnbPrice(json.bnbPrice);
        }
      }
      
      // Also check for claimable rewards
      const claimRes = await fetch("/api/claim");
      if (claimRes.ok) {
        const claimJson = await claimRes.json();
        setClaimableEpochs(claimJson.claimable_epochs || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    if (claimableEpochs.length === 0 || claiming) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ epochs: claimableEpochs }),
      });
      const json = await res.json();
      if (json.success) {
        alert(`领取成功！交易哈希: ${json.hash}`);
        loadLogs();
      } else {
        throw new Error(json.error || "领取失败");
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setClaiming(false);
    }
  }

  useEffect(() => {
    loadConfig();
    loadLogs();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(loadLogs, 10000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">自动下注</h1>
          <p className="mt-1 text-sm text-slate-400 flex items-center gap-4">
            <span>基于大模型预测的自动下注管理与日志。</span>
            {balance !== null && (
              <span className="rounded bg-slate-800 px-3 py-1 font-mono text-emerald-400 border border-slate-700">
                当前余额: {balance.toFixed(4)} BNB 
                {bnbPrice ? ` (≈ $${(balance * bnbPrice).toFixed(2)})` : ""}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {claimableEpochs.length > 0 && (
            <button
              onClick={handleClaim}
              disabled={claiming}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all shadow-lg ${
                claiming 
                  ? "bg-slate-700 text-slate-400 cursor-not-allowed" 
                  : "bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 animate-pulse"
              }`}
            >
              {claiming ? "领取中..." : `领取奖金 (${claimableEpochs.length} 个回合)`}
            </button>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            自动刷新日志
          </label>
          <button onClick={loadLogs} className="px-4 py-1.5 rounded-full bg-slate-800 text-sm hover:bg-slate-700">刷新</button>
        </div>
      </header>

      <section className="grid gap-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    if (!hasStoredKey) {
                      alert("请先保存有效的钱包私钥，才能开启自动下注。");
                      return;
                    }
                    updateConfig("AUTO_BET_ENABLED", autoBetEnabled ? "0" : "1");
                  }}
                  disabled={saving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    autoBetEnabled ? "bg-emerald-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      autoBetEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
                <span className="text-sm font-medium text-slate-200">
                  {autoBetEnabled ? "自动下注已开启" : "自动下注已关闭"}
                </span>
              </div>

              <div className="flex flex-col gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">钱包私钥</label>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${hasStoredKey ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                      {hasStoredKey ? "● 已保存" : "○ 未保存"}
                    </span>
                  </div>
                  
                  {!showKeyInput && hasStoredKey ? (
                    <div className="flex gap-2">
                      <div className="flex-1 bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-500 font-mono">
                        ****************************************************************
                      </div>
                      <button 
                        onClick={() => setShowKeyInput(true)}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300 transition-colors shrink-0"
                      >
                        修改
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="password"
                        value={privateKey}
                        onChange={(e) => setPrivateKey(e.target.value)}
                        placeholder="粘贴 64 位十六进制私钥..."
                        autoComplete="off"
                        className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-emerald-500/50 transition-colors font-mono"
                      />
                      <div className="flex gap-2">
                        <button 
                          onClick={() => updateConfig("WALLET_PRIVATE_KEY", privateKey)}
                          disabled={saving || privateKey.length < 60}
                          className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 rounded-lg text-xs font-medium text-white transition-all whitespace-nowrap"
                        >
                          {saving ? "保存中..." : "保存私钥"}
                        </button>
                        {hasStoredKey && (
                          <button 
                            onClick={() => { setShowKeyInput(false); setPrivateKey(""); }}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-300 whitespace-nowrap"
                          >
                            取消
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <p className="text-[9px] text-slate-600 italic">私钥仅保存在本地数据库，刷新页面后输入框会清空以保护隐私。</p>
                </div>

                <div className="space-y-3 pt-2 border-t border-slate-800/30">
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">下注仓位 (%)</label>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={betPercentage}
                        onChange={(e) => setBetPercentage(e.target.value)}
                        onMouseUp={(e: any) => updateConfig("BET_PERCENTAGE", e.target.value)}
                        className="flex-1 h-1.5 rounded-lg appearance-none bg-slate-800 accent-emerald-500 cursor-pointer"
                      />
                      <span className="text-sm font-mono text-emerald-400 w-12 text-right">{betPercentage}%</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["10", "25", "50", "75", "100"].map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            setBetPercentage(p);
                            updateConfig("BET_PERCENTAGE", p);
                          }}
                          className={`min-w-[60px] flex-1 py-1.5 rounded text-[10px] font-bold transition-all ${
                            betPercentage === p 
                              ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 scale-105" 
                              : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                          }`}
                        >
                          {p === "100" ? "MAX" : `${p}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center px-8 border-l border-slate-800/50">
              <div className={`text-4xl mb-2 ${autoBetEnabled ? "animate-bounce" : "opacity-20"}`}>🤖</div>
              <div className={`text-[10px] font-bold uppercase tracking-widest ${autoBetEnabled ? "text-emerald-500" : "text-slate-600"}`}>
                {autoBetEnabled ? "System Active" : "System Idle"}
              </div>
            </div>
          </div>
        </div>

        {autoBetEnabled && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">总下注次数</div>
              <div className="mt-1 text-2xl font-semibold text-slate-100">{stats?.totalBets || 0}</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">胜率 (Win Rate)</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-400">{(stats?.winRate || 0).toFixed(1)}%</div>
              <div className="text-[10px] text-slate-500 mt-1">{stats?.wonBets || 0} 胜 / {stats?.lostBets || 0} 负</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">累计投入</div>
              <div className="mt-1 text-2xl font-semibold text-amber-400">
                {(stats?.totalAmount || 0).toFixed(4)} <span className="text-xs">BNB</span>
                {bnbPrice && (
                  <div className="text-xs text-slate-500 font-normal mt-1">
                    ≈ ${( (stats?.totalAmount || 0) * bnbPrice ).toFixed(2)}
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">预估净收益</div>
              <div className={`mt-1 text-2xl font-semibold ${(stats?.estimatedProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {(stats?.estimatedProfit || 0) >= 0 ? '+' : ''}{(stats?.estimatedProfit || 0).toFixed(4)} <span className="text-xs">BNB</span>
                {bnbPrice && (
                  <div className={`text-xs font-normal mt-1 ${(stats?.estimatedProfit || 0) >= 0 ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                    ≈ ${( (stats?.estimatedProfit || 0) * bnbPrice ).toFixed(2)}
                  </div>
                )}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">按 1.9x 赔率预估</div>
            </div>
          </div>
        )}

        {autoBetEnabled && (
          <>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 ring-1 ring-rose-500/10">
              <div className="flex items-start gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <h3 className="font-medium text-rose-200 text-sm">风险提示</h3>
                  <p className="mt-1 text-xs text-rose-300/80 leading-relaxed">
                    自动下注涉及真实资金。请务必确认下注金额。
                    建议先从小金额（如 0.001 BNB）开始测试。
                    您的私钥仅保存在本地数据库中，但仍请注意服务器安全。
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg shadow-slate-900/50">
              <div className="text-sm font-medium text-slate-100 flex items-center justify-between">
                <span>下注记录 (最近 50 条)</span>
                {loading && <span className="text-[10px] text-sky-400 animate-pulse">加载中...</span>}
              </div>
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950">
                <div className="max-h-[600px] overflow-auto">
              <table className="min-w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/90 text-slate-400 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 font-medium">时间</th>
                    <th className="px-4 py-3 font-medium">回合</th>
                    <th className="px-4 py-3 font-medium">方向</th>
                    <th className="px-4 py-3 font-medium">金额</th>
                    <th className="px-4 py-3 font-medium">赔率 (Payout)</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">领取</th>
                    <th className="px-4 py-3 font-medium">交易哈希 / 错误信息</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-slate-800/80 hover:bg-slate-900/40 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-400">{formatTs(log.created_at)}</td>
                      <td className="px-4 py-3 font-mono">{log.epoch}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${log.side === 'UP' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                          {log.side === 'UP' ? '看涨 (UP)' : '看跌 (DOWN)'}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono">{log.amount.toFixed(4)} BNB</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {(() => {
                          if (log.total_amount) {
                            let payout = 0;
                            if (log.side === 'UP' && log.bull_amount > 0) {
                              payout = log.total_amount / log.bull_amount;
                            } else if (log.side === 'DOWN' && log.bear_amount > 0) {
                              payout = log.total_amount / log.bear_amount;
                            }
                            if (payout > 0) {
                              return (
                                <span className={payout >= 2 ? "text-amber-400 font-bold" : "text-slate-400"}>
                                  {payout.toFixed(2)}x
                                </span>
                              );
                            }
                          }
                          return <span className="text-slate-600">--</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                          log.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' :
                          log.status === 'FAILED' ? 'bg-rose-500/20 text-rose-400' :
                          'bg-sky-500/20 text-sky-400 animate-pulse'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {log.claimed === 1 ? (
                          <span className="text-emerald-500 text-[10px] font-bold">已领</span>
                        ) : log.status === 'SUCCESS' && log.actual_side ? (
                          log.side === log.actual_side ? (
                            <span className="text-amber-500 text-[10px] font-medium animate-pulse">可领取</span>
                          ) : (
                            <span className="text-slate-600 text-[10px]">未中奖</span>
                          )
                        ) : log.status === 'SUCCESS' ? (
                          <span className="text-slate-600 text-[10px]">待结算</span>
                        ) : (
                          <span className="text-slate-800 text-[10px]">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate">
                        {log.tx_hash ? (
                          <a href={`https://bscscan.com/tx/${log.tx_hash}`} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline font-mono">
                            {log.tx_hash.slice(0, 10)}...{log.tx_hash.slice(-8)}
                          </a>
                        ) : (
                          <span className="text-rose-400/70 italic">{log.error || '--'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-600">
                        暂无下注记录。请在上方开启自动下注并等待新回合开始。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
