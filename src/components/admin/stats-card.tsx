import * as React from "react"
import { Card, CardContent, CardProps } from "@/components/ui/card"
import { SectionHeader } from "@/components/ui/section-header"

interface StatsCardProps extends CardProps {
  title: string
  value: React.ReactNode
  subValue?: React.ReactNode
  valueClassName?: string
}

export function StatsCard({ title, value, subValue, className, valueClassName, variant = "glass", ...props }: StatsCardProps) {
  return (
    <Card className={className} variant={variant} {...props}>
      <CardContent className="p-6">
        <SectionHeader>{title}</SectionHeader>
        <div className={`mt-3 text-2xl font-semibold ${valueClassName || "text-slate-900 dark:text-slate-100"}`}>
          {value}
        </div>
        {subValue && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{subValue}</div>}
      </CardContent>
    </Card>
  )
}
