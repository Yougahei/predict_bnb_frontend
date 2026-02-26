"use client";

import { useEffect, useState } from "react";
import type { Snapshot } from "@/lib/snapshot";

function formatTs(ts: number | null) {
  if (!ts) return "--";
  const d = new Date(ts);
  return d.toLocaleString();
}

function formatNumber(value: number | null | undefined, digits = 4) {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}

export default function AdminPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [intervalSec, setIntervalSec] = useState(10);
  const [analyzing, setAnalyzing] = useState(false);
  const [autoLLM, setAutoLLM] = useState(false);

  // LLM Profiles
  const [llmProfiles, setLlmProfiles] = useState<any[]>([]);
  const [newProfile, setNewProfile] = useState({ name: "", endpoint: "", model: "", api_key: "", enabled: true });

  // App Config
  const [configGroups, setConfigGroups] = useState<any[]>([]);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/predict");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadProfiles() {
    try {
      const res = await fetch("/api/llm-profiles");
      if (res.ok) {
        const json = await res.json();
        setLlmProfiles(json);
      }
    } catch (e) {
      console.error("Failed to load profiles", e);
    }
  }

  async function loadConfig() {
    const res = await fetch("/api/app-config");
    if (res.ok) {
      const json = await res.json();
      setConfigGroups(json.groups);

      // Check for LLM_AUTO_PREDICT status
      const llmGroup = json.groups.find((g: any) => g.title === "LLM 全局配置");
      if (llmGroup) {
        const autoField = llmGroup.fields.find((f: any) => f.key === "LLM_AUTO_PREDICT");
        if (autoField) {
          setAutoLLM(autoField.value === "1");
        }
      }
    }
  }

  useEffect(() => {
    load();
    loadProfiles();
    loadConfig();
  }, []);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      load();
    }, Math.max(5, intervalSec) * 1000);
    return () => clearInterval(id);
  }, [auto, intervalSec]);

  const directionLabel =
    data?.prediction?.direction === "UP"
      ? "看涨"
      : data?.prediction?.direction === "DOWN"
        ? "看跌"
        : data?.prediction?.direction === "ABSTAIN"
          ? "观望"
          : "--";

  async function handleAddProfile() {
    if (!newProfile.name || !newProfile.endpoint || !newProfile.model) return;
    const res = await fetch("/api/llm-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newProfile),
    });
    if (res.ok) {
      setNewProfile({ name: "", endpoint: "", model: "", api_key: "", enabled: true });
      loadProfiles();
    }
  }

  async function handleUpdateProfile(profile: any) {
    await fetch("/api/llm-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    loadProfiles();
  }

  async function handleDeleteProfile(name: string) {
    if (!confirm(`确定删除模型 ${name} 吗？`)) return;
    await fetch("/api/llm-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", name }),
    });
    loadProfiles();
  }

  async function handleUpdateAppConfig(key: string, value: string, clear = false) {
    await fetch("/api/app-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, clear }),
    });
    loadConfig();
  }

  async function handleToggleAutoLLM() {
    const nextValue = autoLLM ? "0" : "1";
    try {
      const res = await fetch("/api/app-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "LLM_AUTO_PREDICT", value: nextValue }),
      });
      if (res.ok) {
        setAutoLLM(nextValue === "1");
      }
    } catch (e) {
      console.error("Failed to toggle auto LLM", e);
    }
  }

  async function handleManualAnalyze() {
    if (analyzing) {
      setAnalyzing(false);
      return;
    }
    try {
      setAnalyzing(true);
      const res = await fetch("/api/analyze", { method: "POST" });
      if (!res.ok) throw new Error("分析请求失败");
      // Give it a moment for the async prediction to start and possibly finish
      setTimeout(() => {
        load();
        setAnalyzing(false);
      }, 2000);
    } catch (e: any) {
      alert(e.message || "分析失败");
      setAnalyzing(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">预测后台</h1>
            <p className="mt-1 text-sm text-slate-400">实时监控 BNB 价格、回合状态与量化预测。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleToggleAutoLLM}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all shadow-sm ${
                autoLLM
                  ? "bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/50 hover:bg-rose-500/20"
                  : "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/50 hover:bg-emerald-500/20"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${autoLLM ? "bg-rose-500 animate-pulse" : "bg-emerald-500"}`} />
              {autoLLM ? "停止自动 LLM 分析" : "启动自动 LLM 分析"}
            </button>
            <span className="h-6 w-px bg-slate-800" />
            <div className="flex items-center gap-2 rounded-full bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 ring-1 ring-slate-700/80">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded border-slate-600 bg-slate-900"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                />
                自动刷新
              </label>
              <span className="h-3 w-px bg-slate-700/60" />
              <span>间隔</span>
              <input
                type="number"
                min={5}
                max={120}
                value={intervalSec}
                onChange={(e) =>
                  setIntervalSec(Math.min(120, Math.max(5, Number(e.target.value) || 10)))
                }
                className="w-14 rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-right text-xs text-slate-100 outline-none"
              />
              <span>秒</span>
            </div>
            <button
              onClick={load}
              className="rounded-full bg-sky-500 px-4 py-1.5 text-sm font-medium text-slate-950 shadow-sm shadow-sky-500/40 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-sky-800"
              disabled={loading}
            >
              {loading ? "刷新中..." : "立即刷新"}
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-sky-900/40">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              实时价格 (USD)
            </div>
            <div className="mt-3 text-3xl font-semibold text-sky-400">
              {formatNumber(data?.price, 4)}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              数据源: <span className="text-slate-200">{data?.price_source ?? "--"}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              更新时间: {formatTs(data?.price_updated_at ?? null)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-emerald-900/40">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              当前回合
            </div>
            <div className="mt-2 text-sm text-slate-300">
              回合号: <span className="font-medium text-slate-50">{data?.round.epoch ?? "--"}</span>
            </div>
            <div className="mt-1 text-sm text-slate-300">
              锁定价:{" "}
              <span className="font-mono text-slate-50">
                {formatNumber(data?.round.lock_price, 4)}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              锁定时间: {formatTs(data?.round.lock_ts ?? null)}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              结算时间: {formatTs(data?.round.close_ts ?? null)}
            </div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs text-emerald-300 ring-1 ring-emerald-500/40">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              剩余 {data?.round.time_left_sec != null ? `${data.round.time_left_sec}s` : "--"}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-fuchsia-900/40">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
              量化预测
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <div
                className={`text-2xl font-semibold ${
                  data?.prediction?.direction === "UP"
                    ? "text-emerald-400"
                    : data?.prediction?.direction === "DOWN"
                      ? "text-rose-400"
                      : "text-slate-300"
                }`}
              >
                {directionLabel}
              </div>
              {data?.prediction?.confidence != null && (
                <span className="text-xs text-slate-400">
                  置信度 {(data.prediction.confidence * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <div className="mt-2 text-sm text-slate-300">
              预测价:{" "}
              <span className="font-mono text-slate-50">
                {formatNumber(data?.prediction?.predicted_price ?? null, 4)}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              模型: <span className="text-slate-200">{data?.prediction?.model ?? "--"}</span>
            </div>
          </div>

          {data?.wallet_balance !== undefined && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-amber-900/40">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                  钱包余额
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {configGroups.find(g => g.title === "链上数据")?.fields.find((f: any) => f.key === "WALLET_ADDRESS")?.value?.slice(0, 6)}...
                </div>
              </div>
              
              <div className="mt-3 flex flex-col gap-1">
                <div className="text-2xl font-semibold text-amber-400">
                  {formatNumber(data?.wallet_balance, 4)} <span className="text-sm font-normal text-slate-400">BNB</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <span className="font-medium text-emerald-400">
                    ${formatNumber((data?.wallet_balance || 0) * (data?.price || 0), 2)}
                  </span>
                  <span className="h-3 w-px bg-slate-800" />
                  <span className="font-medium text-sky-400">
                    ¥{formatNumber((data?.wallet_balance || 0) * (data?.price || 0) * (data?.usd_cny_rate || 7.25), 2)}
                  </span>
                </div>
              </div>
              
              <div className="mt-3 text-[10px] text-slate-500 italic">
                汇率: 1 USD ≈ {data?.usd_cny_rate || 7.25} CNY
              </div>
            </div>
          )}
        </section>

        {/* Current Predictions Table */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg shadow-slate-900/50">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-100">
              当前回合模型预测
              <span className="ml-2 text-xs text-slate-500 font-mono">
                (Epoch: {data?.round?.epoch ?? "--"})
              </span>
            </div>
            {!autoLLM && (
              <button
                onClick={handleManualAnalyze}
                className={`rounded-full px-4 py-1 text-xs font-medium transition-all ${
                  analyzing
                    ? "bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/50"
                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                }`}
                disabled={loading}
              >
                {analyzing ? "分析中..." : "手动 LLM 分析"}
              </button>
            )}
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950">
            <div className="max-h-64 overflow-auto">
              <table className="min-w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/90 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">轮数 (Epoch)</th>
                    <th className="px-3 py-2 font-medium">类型</th>
                    <th className="px-3 py-2 font-medium">模型</th>
                    <th className="px-3 py-2 font-medium">方向</th>
                    <th className="px-3 py-2 font-medium">摘要</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.model_predictions?.map((p, idx) => (
                    <tr key={idx} className="border-t border-slate-800/80 hover:bg-slate-900/60">
                      <td className="px-3 py-2 font-mono text-slate-400">{p.epoch || "--"}</td>
                      <td className="px-3 py-2">{p.model_type}</td>
                      <td className="px-3 py-2">{p.model_name}</td>
                      <td className={`px-3 py-2 font-medium ${p.predicted_direction === 'UP' ? 'text-emerald-400' : p.predicted_direction === 'DOWN' ? 'text-rose-400' : 'text-slate-400'}`}>
                        {p.predicted_direction || 'ABSTAIN'}
                      </td>
                      <td className="px-3 py-2 text-slate-400 max-w-xs truncate" title={p.prediction_text}>
                        {p.prediction_text || '--'}
                      </td>
                      <td className="px-3 py-2">
                        {p.stale ? <span className="text-slate-500">过期</span> : <span className="text-emerald-500">实时</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Accuracy Stats Table */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg shadow-slate-900/50">
          <div className="text-sm font-medium text-slate-100">模型预测准确率</div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950">
            <table className="min-w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">类型</th>
                  <th className="px-3 py-2 font-medium">模型</th>
                  <th className="px-3 py-2 font-medium">命中/出手</th>
                  <th className="px-3 py-2 font-medium">准确率</th>
                  <th className="px-3 py-2 font-medium">覆盖率</th>
                </tr>
              </thead>
              <tbody>
                {data?.accuracy?.map((s, idx) => (
                  <tr key={idx} className="border-t border-slate-800/80 hover:bg-slate-900/60">
                    <td className="px-3 py-2">{s.model_type}</td>
                    <td className="px-3 py-2">{s.model_name}</td>
                    <td className="px-3 py-2">{s.correct} / {s.acted}</td>
                    <td className="px-3 py-2 font-mono">{(s.accuracy * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 font-mono">{(s.coverage * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-2 grid gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg shadow-slate-900/50">
            <div className="text-sm font-medium text-slate-100">LLM 模型管理</div>
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <input placeholder="模型名称" className="rounded border border-slate-700 bg-slate-900 px-2 py-1" value={newProfile.name} onChange={e => setNewProfile({...newProfile, name: e.target.value})} />
                <input placeholder="Endpoint" className="rounded border border-slate-700 bg-slate-900 px-2 py-1" value={newProfile.endpoint} onChange={e => setNewProfile({...newProfile, endpoint: e.target.value})} />
                <input placeholder="Model ID" className="rounded border border-slate-700 bg-slate-900 px-2 py-1" value={newProfile.model} onChange={e => setNewProfile({...newProfile, model: e.target.value})} />
                <input placeholder="API Key" className="rounded border border-slate-700 bg-slate-900 px-2 py-1" value={newProfile.api_key} onChange={e => setNewProfile({...newProfile, api_key: e.target.value})} />
              </div>
              <button onClick={handleAddProfile} className="w-full rounded bg-sky-500 py-1 text-xs font-medium text-slate-950">新增 LLM 模型</button>
              
              <div className="max-h-40 overflow-auto space-y-2 border-t border-slate-800 pt-2">
                {llmProfiles.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 text-[11px] bg-slate-900/50 p-2 rounded">
                    <div className="truncate flex-1">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-slate-500 truncate">{p.model}</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => handleUpdateProfile({...p, enabled: !p.enabled})} className={`px-2 py-0.5 rounded ${p.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                        {p.enabled ? '已启' : '禁用'}
                      </button>
                      <button onClick={() => handleDeleteProfile(p.name)} className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400">删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* App Global Config */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg shadow-slate-900/50">
          <div className="text-sm font-medium text-slate-100">全局配置</div>
          <div className="mt-3 grid gap-6 md:grid-cols-2">
            {configGroups.map((group, gIdx) => (
              <div key={gIdx} className="space-y-3">
                <div className="text-xs font-semibold text-slate-400 border-b border-slate-800 pb-1">{group.title}</div>
                {group.fields.map((field: any, fIdx: number) => (
                  <div key={fIdx} className="flex flex-col gap-1">
                    <label className="text-[11px] text-slate-300">{field.label}</label>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                        defaultValue={field.value}
                        onBlur={(e) => handleUpdateAppConfig(field.key, e.target.value)}
                        placeholder={field.placeholder}
                      />
                      <button onClick={() => handleUpdateAppConfig(field.key, "", true)} className="text-[10px] text-slate-500 hover:text-rose-400">清空</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-lg shadow-slate-900/50">
          <div className="text-sm font-medium text-slate-100">最近已结算回合</div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950">
            <div className="max-h-80 overflow-auto">
              <table className="min-w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/90 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">回合号</th>
                    <th className="px-3 py-2 font-medium">锁定时间</th>
                    <th className="px-3 py-2 font-medium">锁定价</th>
                    <th className="px-3 py-2 font-medium">收盘价</th>
                    <th className="px-3 py-2 font-medium">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.recent_rounds?.map((r) => (
                    <tr key={r.epoch} className="border-t border-slate-800/80 hover:bg-slate-900/60">
                      <td className="px-3 py-2 font-mono text-slate-200">{r.epoch}</td>
                      <td className="px-3 py-2 text-slate-400">{formatTs(r.lock_ts)}</td>
                      <td className="px-3 py-2 font-mono text-slate-100">{formatNumber(r.lock_price, 4)}</td>
                      <td className="px-3 py-2 font-mono text-slate-100">{formatNumber(r.close_price, 4)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${
                          r.result === "UP" ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40" :
                          r.result === "DOWN" ? "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/40" :
                          "bg-slate-600/20 text-slate-200 ring-1 ring-slate-500/40"
                        }`}>
                          {r.result ?? "--"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    );
  }
