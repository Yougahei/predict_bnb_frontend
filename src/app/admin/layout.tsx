"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const navItems = [
    { name: "预测面板", href: "/admin", icon: "📊" },
    { name: "策略模拟器", href: "/admin/gaming", icon: "🎮" },
    { name: "自动下注", href: "/admin/auto-bet", icon: "🤖" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      {/* Background Gradient */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-sky-500/10 via-emerald-500/5 to-fuchsia-500/10" />

      {/* Top Navigation Bar */}
      <nav className="relative z-10 border-b border-slate-800 bg-slate-950/50 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-sky-500 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-sky-500/20">
                  B
                </div>
                <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-sky-400 to-emerald-400 bg-clip-text text-transparent">
                  PredictBNB
                </span>
              </div>

              <div className="hidden md:flex items-center gap-1">
                {navItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        isActive
                          ? "bg-slate-800 text-sky-400 shadow-inner"
                          : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
                      }`}
                    >
                      <span>{item.icon}</span>
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                Live Network
              </span>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Nav */}
      <div className="md:hidden sticky top-16 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm flex justify-around py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 px-4 py-1 rounded-xl text-[10px] transition-all ${
                isActive ? "text-sky-400" : "text-slate-500"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.name}
            </Link>
          );
        })}
      </div>

      <div className="relative z-0">
        {children}
      </div>
    </div>
  );
}
