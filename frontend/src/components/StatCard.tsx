import React from 'react'
import Skeleton from './Skeleton'

interface StatCardProps {
  label: string
  value: string | null | undefined
  colorClass?: string
  loading?: boolean
}

const StatCard: React.FC<StatCardProps> = ({ label, value, colorClass = 'text-zinc-800 dark:text-zinc-200', loading = false }) => (
  <div className="border rounded-xl p-3 card-surface">
    <p className="text-2xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</p>
    {loading ? (
      <Skeleton className="h-5 w-20 rounded" />
    ) : (
      <p className={`text-sm font-semibold tabular-nums ${colorClass}`}>{value ?? '-'}</p>
    )}
  </div>
)

export default StatCard
