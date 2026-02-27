"use client";

import { useEffect, useState } from "react";
import { formatTs, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { StatsCard } from "@/components/admin/stats-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AutoBetPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Config state
  const [autoBetEnabled, setAutoBetEnabled] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [strategy, setStrategy] = useState("balanced");
  
  // Strategy-specific percentages
  const [pctMap, setPctMap] = useState<Record<string, string>>({
    conservative: "10",
    balanced: "10",
    aggressive: "10",
  });
  
  const [saving, setSaving] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  
  // Claiming state
  const [claimableEpochs, setClaimableEpochs] = useState<number[]>([]);
  const [claimableDetails, setClaimableDetails] = useState<{epoch: number, close_ts: number}[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [bnbPrice, setBnbPrice] = useState<number | null>(null);
  const [claimCountdown, setClaimCountdown] = useState<number | null>(null);
  
  // Custom alert state
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  async function loadConfig() {
    const res = await fetch("/api/app-config");
    if (res.ok) {
      const json = await res.json();
      const allFields = json.groups.flatMap((g: any) => g.fields);
      const enabled = allFields.find((f: any) => f.key === "AUTO_BET_ENABLED")?.value === "1";
      const pk = allFields.find((f: any) => f.key === "WALLET_PRIVATE_KEY")?.value || "";
      const strat = allFields.find((f: any) => f.key === "STRATEGY")?.value || "balanced";
      
      const newPctMap = { ...pctMap };
      newPctMap.conservative = allFields.find((f: any) => f.key === "BET_PERCENTAGE_CONSERVATIVE")?.value || "10";
      newPctMap.balanced = allFields.find((f: any) => f.key === "BET_PERCENTAGE_BALANCED")?.value || "10";
      newPctMap.aggressive = allFields.find((f: any) => f.key === "BET_PERCENTAGE_AGGRESSIVE")?.value || "10";

      setAutoBetEnabled(enabled);
      setHasStoredKey(!!pk && pk.length > 10);
      setStrategy(strat);
      setPctMap(newPctMap);
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
        setToast({ message: `私钥长度不正确：当前长度为 ${finalValue.length}，标准私钥应为 64 位十六进制字符串。`, type: 'error' });
        return;
      }
      
      if (!/^[0-9a-fA-F]{64}$/.test(finalValue)) {
        setToast({ message: "私钥包含非十六进制字符，请确保只包含数字 0-9 和字母 a-f。", type: 'error' });
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
          setToast({ message: "私钥已安全保存到数据库", type: 'success' });
        }
        await loadConfig();
      } else {
        setToast({ message: "保存失败，请检查网络", type: 'error' });
      }
    } catch (e: any) {
      setToast({ message: "错误: " + e.message, type: 'error' });
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
        setClaimableDetails(claimJson.claimable_details || []);
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
        setToast({ message: `领取成功！交易哈希: ${json.hash}`, type: 'success' });
        loadLogs();
      } else {
        throw new Error(json.error || "领取失败");
      }
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
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

  useEffect(() => {
    if (claimableDetails.length === 0) {
      setClaimCountdown(null);
      return;
    }

    const interval = setInterval(() => {
      // 找最旧的那个未领取回合，因为它最先触发自动领取
      // 如果最旧的已经超时了，那就应该立即领取
      const oldest = [...claimableDetails].sort((a, b) => a.close_ts - b.close_ts)[0];
      if (!oldest) return;

      const now = Math.floor(Date.now() / 1000);
      const deadline = oldest.close_ts + 60; // 60s timeout
      const left = deadline - now;
      
      setClaimCountdown(left > 0 ? left : 0);

      // 如果倒计时结束且没在领取中，自动触发领取
      if (left <= 0 && !claiming && claimableEpochs.length > 0) {
        handleClaim();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [claimableDetails, claiming, claimableEpochs]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8 relative">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-2xl transition-all transform duration-300 ${
          toast.type === 'success' 
            ? 'bg-emerald-500/90 text-white border border-emerald-400' 
            : 'bg-rose-500/90 text-white border border-rose-400'
        }`}>
          <div className="flex items-center gap-2">
            <span>{toast.type === 'success' ? '✅' : '❌'}</span>
            <span className="font-medium text-sm">{toast.message}</span>
          </div>
        </div>
      )}

      <PageHeader
        title="自动下注"
        description="基于大模型预测的自动下注管理与日志。"
      >
        <div className="flex items-center gap-3">
          {balance !== null && (
            <Badge variant="outline" className="font-mono text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
              余额: {balance.toFixed(4)} BNB 
              {bnbPrice ? ` (≈ $${(balance * bnbPrice).toFixed(2)})` : ""}
            </Badge>
          )}
          
          {claimableEpochs.length > 0 && (
            <Button
              onClick={handleClaim}
              disabled={claiming || (claimCountdown === 0)}
              className={`transition-all shadow-lg ${
                claiming || claimCountdown === 0
                  ? "opacity-70 cursor-not-allowed" 
                  : "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 animate-pulse border-none"
              }`}
              size="sm"
            >
              {claiming 
                ? "领取中..." 
                : claimCountdown === 0
                  ? "自动领取中..."
                  : `领取奖金 (${claimCountdown ? claimCountdown + 's' : claimableEpochs.length + '个'})`}
            </Button>
          )}
          
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
            <input 
              type="checkbox" 
              checked={autoRefresh} 
              onChange={e => setAutoRefresh(e.target.checked)} 
              className="rounded border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 accent-emerald-500" 
            />
            自动刷新
          </label>
          <Button variant="outline" size="sm" onClick={loadLogs}>刷新</Button>
        </div>
      </PageHeader>

      <section className="grid gap-6">
        <Card className="bg-white/40 dark:bg-slate-900/40" variant="glass">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-1 space-y-6">
                
                {/* Switch & Status */}
                <div className="flex items-center gap-4">
                  <Switch
                    checked={autoBetEnabled}
                    onCheckedChange={(checked) => {
                       if (!hasStoredKey && checked) {
                        setToast({ message: "请先保存有效的钱包私钥，才能开启自动下注。", type: 'error' });
                        return;
                      }
                      updateConfig("AUTO_BET_ENABLED", checked ? "1" : "0");
                    }}
                    disabled={saving}
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {autoBetEnabled ? "自动下注已开启" : "自动下注已关闭"}
                  </span>
                </div>

                <div className="flex flex-col gap-6">
                  {/* Private Key Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">钱包私钥</Label>
                      <Badge variant={hasStoredKey ? "success" : "error"}>
                        {hasStoredKey ? "● 已保存" : "○ 未保存"}
                      </Badge>
                    </div>
                    
                    {!showKeyInput && hasStoredKey ? (
                      <div className="flex gap-2">
                        <div className="flex-1 bg-slate-100 dark:bg-slate-950/50 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-500 font-mono">
                          ****************************************************************
                        </div>
                        <Button 
                          variant="secondary" 
                          size="sm"
                          onClick={() => setShowKeyInput(true)}
                        >
                          修改
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                          type="password"
                          value={privateKey}
                          onChange={(e) => setPrivateKey(e.target.value)}
                          placeholder="粘贴 64 位十六进制私钥..."
                          autoComplete="off"
                          className="font-mono text-xs"
                        />
                        <div className="flex gap-2">
                          <Button 
                            onClick={() => updateConfig("WALLET_PRIVATE_KEY", privateKey)}
                            disabled={saving || privateKey.length < 60}
                            size="sm"
                            className="whitespace-nowrap"
                          >
                            {saving ? "保存中..." : "保存私钥"}
                          </Button>
                          {hasStoredKey && (
                            <Button 
                              variant="secondary"
                              size="sm"
                              onClick={() => { setShowKeyInput(false); setPrivateKey(""); }}
                            >
                              取消
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                    <p className="text-[9px] text-slate-500 dark:text-slate-600 italic">私钥仅保存在本地数据库，刷新页面后输入框会清空以保护隐私。</p>
                  </div>

                  {/* Strategy Section */}
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800/30">
                    <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">下注策略</Label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {[
                        { id: "conservative", label: "保守 (Conservative)", desc: "高置信度 (20%)，金额较小 (0.8x)" },
                        { id: "balanced", label: "稳健 (Balanced)", desc: "中等置信度 (5%)，标准金额 (1.0x)" },
                        { id: "aggressive", label: "激进 (Aggressive)", desc: "低置信度 (1%)，金额较大 (1.5x)" }
                      ].map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setStrategy(s.id);
                            updateConfig("STRATEGY", s.id);
                          }}
                          className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 ${
                            strategy === s.id
                              ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 ring-2 ring-emerald-500/20 shadow-sm"
                              : "bg-white/50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold">{s.label}</span>
                            {strategy === s.id && <span className="text-emerald-500">✓</span>}
                          </div>
                          <div className="text-[10px] mt-1 opacity-80">{s.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Slider Section */}
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800/30">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                        {strategy === "conservative" ? "保守" : strategy === "aggressive" ? "激进" : "稳健"}策略 - 下注比例 (%)
                      </Label>
                      <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        {pctMap[strategy] || "10"}%
                      </span>
                    </div>
                    <div className="flex flex-col gap-4">
                      <Slider
                        min={1}
                        max={50}
                        step={1}
                        value={parseInt(pctMap[strategy] || "10")}
                        onChange={(val) => {
                          setPctMap(prev => ({ ...prev, [strategy]: val.toString() }));
                        }}
                        onMouseUp={(e: any) => {
                           // For Slider component, onMouseUp is passed to input but event target might be different in wrapper.
                           // Actually the Slider component I wrote passes props to input, so onMouseUp should work on input.
                           // But I need to be careful with types.
                           // Better to use useEffect or a debounced save, but following original logic:
                           const key = `BET_PERCENTAGE_${strategy.toUpperCase()}`;
                           updateConfig(key, pctMap[strategy] || "10");
                        }}
                      />
                      <div className="relative w-full h-4 text-[10px] text-slate-400 font-mono mt-1">
                        <span className="absolute left-0 -translate-x-0">1%</span>
                        <span className="absolute left-[18.4%] -translate-x-1/2">10%</span>
                        <span className="absolute left-[49%] -translate-x-1/2">25%</span>
                        <span className="absolute right-0 translate-x-0">50%</span>
                      </div>
                    </div>
                    <p className="text-[9px] text-slate-500 dark:text-slate-600 italic">
                      注意：此比例仅对当前选择的【{strategy === "conservative" ? "保守" : strategy === "aggressive" ? "激进" : "稳健"}】策略生效。
                    </p>
                  </div>
                </div>
              </div>

              {/* Status Indicator */}
              <div className="flex md:flex-col items-center justify-center p-6 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800/50 md:min-w-[180px] gap-4">
                <div className={`text-5xl transition-all duration-500 ${autoBetEnabled ? "scale-110 drop-shadow-lg" : "grayscale opacity-50"}`}>🤖</div>
                <div className={`text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full border ${
                  autoBetEnabled 
                    ? "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-800" 
                    : "text-slate-400 bg-slate-100 border-slate-200 dark:text-slate-500 dark:bg-slate-800 dark:border-slate-700"
                }`}>
                  {autoBetEnabled ? "System Active" : "System Idle"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {autoBetEnabled && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatsCard title="总下注次数" value={stats?.totalBets || 0} />
            <StatsCard 
              title="胜率 (Win Rate)" 
              value={`${(stats?.winRate || 0).toFixed(1)}%`}
              subValue={stats?.wonBets ? `${stats.wonBets} 胜 / ${stats.lostBets || 0} 负` : undefined}
              valueClassName="text-emerald-600 dark:text-emerald-400"
            />
            <StatsCard 
              title="累计投入" 
              value={`${(stats?.totalAmount || 0).toFixed(4)} BNB`}
              subValue={bnbPrice ? `≈ $${( (stats?.totalAmount || 0) * bnbPrice ).toFixed(2)}` : undefined}
              valueClassName="text-amber-600 dark:text-amber-400"
            />
            <StatsCard 
              title="预估净收益" 
              value={`${(stats?.estimatedProfit || 0) >= 0 ? '+' : ''}${(stats?.estimatedProfit || 0).toFixed(4)} BNB`}
              subValue={bnbPrice ? `≈ $${( (stats?.estimatedProfit || 0) * bnbPrice ).toFixed(2)}` : undefined}
              valueClassName={(stats?.estimatedProfit || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
            />
          </div>
        )}

        {autoBetEnabled && (
          <>
            <Alert variant="destructive">
              <span className="text-xl mr-3">⚠️</span>
              <div className="flex-1">
                <AlertTitle>风险提示</AlertTitle>
                <AlertDescription>
                  自动下注涉及真实资金。请务必确认下注金额。
                  建议先从小金额（如 0.001 BNB）开始测试。
                  您的私钥仅保存在本地数据库中，但仍请注意服务器安全。
                </AlertDescription>
              </div>
            </Alert>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">下注记录 (最近 50 条)</CardTitle>
                {loading && <span className="text-[10px] text-sky-600 dark:text-sky-400 animate-pulse">加载中...</span>}
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[600px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[140px]">时间</TableHead>
                        <TableHead>回合</TableHead>
                        <TableHead>方向</TableHead>
                        <TableHead>金额</TableHead>
                        <TableHead>赔率 (Payout)</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>领取</TableHead>
                        <TableHead>交易哈希 / 错误信息</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-slate-500 dark:text-slate-400 font-mono text-xs whitespace-nowrap">{formatTs(log.created_at)}</TableCell>
                          <TableCell className="font-mono">{log.epoch}</TableCell>
                          <TableCell>
                            <Badge variant={log.side === 'UP' ? 'success' : 'error'}>
                              {log.side === 'UP' ? '看涨 (UP)' : '看跌 (DOWN)'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono">{log.amount.toFixed(4)} BNB</TableCell>
                          <TableCell className="font-mono text-xs">
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
                                    <span className={payout >= 2 ? "text-amber-600 dark:text-amber-400 font-bold" : "text-slate-400"}>
                                      {payout.toFixed(2)}x
                                    </span>
                                  );
                                }
                              }
                              return <span className="text-slate-400 dark:text-slate-600">--</span>;
                            })()}
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              log.status === 'SUCCESS' ? 'success' :
                              log.status === 'FAILED' ? 'error' : 'default'
                            } className={log.status === 'PENDING' ? 'animate-pulse' : ''}>
                              {log.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {log.claimed === 1 ? (
                              <span className="text-emerald-600 dark:text-emerald-500 text-[10px] font-bold">已领</span>
                            ) : log.status === 'SUCCESS' && log.actual_side ? (
                              log.side === log.actual_side ? (
                                <span className="text-amber-600 dark:text-amber-500 text-[10px] font-medium animate-pulse">可领取</span>
                              ) : (
                                <span className="text-slate-500 dark:text-slate-600 text-[10px]">未中奖</span>
                              )
                            ) : log.status === 'SUCCESS' ? (
                              <span className="text-slate-500 dark:text-slate-600 text-[10px]">待结算</span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-800 text-[10px]">--</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-xs truncate">
                            {log.tx_hash ? (
                              <a href={`https://bscscan.com/tx/${log.tx_hash}`} target="_blank" rel="noreferrer" className="text-sky-600 dark:text-sky-400 hover:underline font-mono">
                                {log.tx_hash.slice(0, 10)}...{log.tx_hash.slice(-8)}
                              </a>
                            ) : (
                              <span className="text-rose-500/70 dark:text-rose-400/70 italic">{log.error || '--'}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {logs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                            暂无下注记录。请在上方开启自动下注并等待新回合开始。
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </section>
    </main>
  );
}
