"use client";

import { useEffect, useState } from "react";
import { formatTs, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { StatsCard } from "@/components/admin/stats-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function GamingPage() {
  const [state, setState] = useState<any>(null);
  const [amount, setAmount] = useState(100);
  const [strategy, setStrategy] = useState("balanced");
  const [loading, setLoading] = useState(false);

  async function loadState() {
    try {
      const res = await fetch("/api/gaming?simId=admin-sim");
      if (res.ok) {
        const json = await res.json();
        setState(json);
      }
    } catch (e) {
      console.error(e);
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
      <PageHeader
        title="策略模拟器"
        description="使用虚拟资金模拟下注策略。"
      />

      <section className="grid gap-4 md:grid-cols-4">
        <StatsCard 
          title="当前余额" 
          value={`$${formatNumber(state?.balance, 2)}`}
          subValue={`初始: $${formatNumber(state?.start_balance, 2)}`}
          valueClassName="text-sky-600 dark:text-sky-400"
          variant="glass"
        />
        <StatsCard 
          title="收益率 (ROI)" 
          value={`${state?.start_balance ? (((state.balance - state.start_balance) / state.start_balance) * 100).toFixed(2) : '0.00'}%`}
          subValue={`利润: $${formatNumber((state?.balance || 0) - (state?.start_balance || 0), 2)}`}
          valueClassName={(state?.balance || 0) >= (state?.start_balance || 0) ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
          variant="glass"
        />
        <StatsCard 
          title="胜率" 
          value={`${state?.stats?.trades ? ((state.stats.wins / state.stats.trades) * 100).toFixed(1) : '0.0'}%`}
          subValue={`${state?.stats?.wins || 0} 胜 / ${state?.stats?.losses || 0} 负`}
          variant="glass"
        />
        <StatsCard 
          title="最大回撤" 
          value={`${(state?.stats?.max_drawdown * 100 || 0).toFixed(1)}%`}
          subValue={`跳过: ${state?.stats?.skipped || 0}`}
          valueClassName="text-rose-600 dark:text-rose-400"
          variant="glass"
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-1 space-y-4">
          <Card className="h-full" variant="glass">
            <CardHeader>
              <CardTitle>控制面板</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>初始资金 (USDT)</Label>
                <Input 
                  type="number" 
                  value={amount} 
                  onChange={e => setAmount(Number(e.target.value))} 
                  disabled={state?.running}
                />
              </div>
              <div className="space-y-2">
                <Label>模拟策略</Label>
                <Select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  disabled={state?.running}
                >
                  <option value="conservative">保守 (Conservative)</option>
                  <option value="balanced">均衡 (Balanced)</option>
                  <option value="aggressive">激进 (Aggressive)</option>
                </Select>
              </div>
              <div className="pt-2">
                {!state?.running ? (
                  <Button 
                    onClick={() => handleAction('start')} 
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20"
                    disabled={loading}
                  >
                    {loading ? "启动中..." : "启动模拟"}
                  </Button>
                ) : (
                  <Button 
                    onClick={() => handleAction('stop')} 
                    className="w-full bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/20"
                    disabled={loading}
                  >
                    {loading ? "停止中..." : "停止模拟"}
                  </Button>
                )}
              </div>
              
              <div className="mt-4 p-3 rounded-lg bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <span>状态</span>
                  <Badge variant={state?.running ? "success" : "default"}>
                    {state?.status || 'IDLE'}
                  </Badge>
                </div>
                {state?.open_bet && (
                  <div className="text-xs text-slate-600 dark:text-slate-300 border-t border-slate-200 dark:border-slate-800 pt-2 mt-2">
                    <div className="flex justify-between items-center">
                      <span>当前下注</span>
                      <span className={state.open_bet.direction === 'UP' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>
                        {state.open_bet.direction}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span>金额</span>
                      <span className="font-mono">{formatNumber(state.open_bet.amount, 2)}</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Card className="h-full flex flex-col" variant="glass">
            <CardHeader>
              <CardTitle>交易历史</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-hidden p-0">
              <div className="overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-white dark:bg-slate-950 z-10">
                    <TableRow>
                      <TableHead className="w-[80px]">回合</TableHead>
                      <TableHead className="w-[80px]">方向</TableHead>
                      <TableHead className="w-[80px]">结果</TableHead>
                      <TableHead>金额</TableHead>
                      <TableHead>盈亏</TableHead>
                      <TableHead>余额</TableHead>
                      <TableHead className="text-right">时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state?.history?.slice().reverse().map((h: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-slate-500 dark:text-slate-400">{h.epoch}</TableCell>
                        <TableCell>
                          <span className={`font-medium ${h.direction === 'UP' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {h.direction}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`font-medium ${h.result === h.direction ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {h.result}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono">{formatNumber(h.bet_amount, 2)}</TableCell>
                        <TableCell className={`font-mono font-medium ${h.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {h.profit >= 0 ? '+' : ''}{formatNumber(h.profit, 2)}
                        </TableCell>
                        <TableCell className="font-mono">{formatNumber(h.balance, 2)}</TableCell>
                        <TableCell className="text-right text-slate-400 dark:text-slate-500 text-[10px]">{formatTs(h.resolved_at)}</TableCell>
                      </TableRow>
                    ))}
                    {(!state?.history || state.history.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-600">
                          暂无交易记录
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
