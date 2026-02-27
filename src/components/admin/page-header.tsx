import * as React from "react"

interface PageHeaderProps {
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <header className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
        {description && <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  )
}
