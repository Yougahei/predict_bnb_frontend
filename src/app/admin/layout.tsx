"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 transition-colors duration-300">
      {/* Background Gradient */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-sky-500/5 via-emerald-500/5 to-fuchsia-500/5 dark:from-sky-500/10 dark:via-emerald-500/5 dark:to-fuchsia-500/10" />

      {/* Top Navigation Bar */}
      <nav className="relative z-10 border-b border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/50 backdrop-blur-md transition-colors duration-300">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-sky-500 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-sky-500/20">
                  B
                </div>
                <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-sky-500 to-emerald-500 dark:from-sky-400 dark:to-emerald-400 bg-clip-text text-transparent">
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
                          ? "bg-slate-200 dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-inner"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-900"
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
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-500 font-bold hidden sm:inline-block">
                  Live Network
                </span>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Nav */}
      <div className="md:hidden sticky top-16 z-10 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm flex justify-around py-2 transition-colors duration-300">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 px-4 py-1 rounded-xl text-[10px] transition-all ${
                isActive ? "text-sky-600 dark:text-sky-400 bg-slate-100 dark:bg-transparent" : "text-slate-500"
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
