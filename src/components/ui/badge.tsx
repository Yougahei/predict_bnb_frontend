import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "error"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default:
      "border-transparent bg-slate-900 text-slate-50 hover:bg-slate-900/80 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-50/80",
    secondary:
      "border-transparent bg-slate-100 text-slate-900 hover:bg-slate-100/80 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-800/80",
    destructive:
      "border-transparent bg-rose-500 text-slate-50 hover:bg-rose-500/80 dark:bg-rose-900 dark:text-slate-50 dark:hover:bg-rose-900/80",
    outline: "text-slate-950 dark:text-slate-50",
    
    // Custom soft variants
    success: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25",
    warning: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25",
    info: "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-400 hover:bg-sky-500/25",
    error: "border-transparent bg-rose-500/15 text-rose-700 dark:text-rose-400 hover:bg-rose-500/25",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 dark:focus:ring-slate-300",
        variants[variant as keyof typeof variants] || variants.default,
        className
      )}
      {...props}
    />
  )
}

export { Badge }
