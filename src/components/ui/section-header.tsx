import * as React from "react"

export function SectionHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`text-xs font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
