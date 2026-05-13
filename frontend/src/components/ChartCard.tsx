import React from 'react'

interface ChartCardProps {
  title?: string
  height?: number
  loading?: boolean
  empty?: boolean
  emptyMessage?: string
  children: React.ReactNode
  className?: string
  /** 우측 상단에 표시할 액션/뱃지 */
  right?: React.ReactNode
}

/**
 * 차트를 감싸는 카드 래퍼.
 * - border + rounded-xl + bg-white dark:bg-zinc-900 + padding
 * - loading 시 skeleton, empty 시 빈 상태 메시지
 */
export default function ChartCard({
  title,
  height = 200,
  loading = false,
  empty = false,
  emptyMessage = '데이터가 부족합니다.',
  children,
  className = '',
  right,
}: ChartCardProps) {
  return (
    <div className={`border rounded-xl p-4 card-surface ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</h3>}
          {right && <div>{right}</div>}
        </div>
      )}
      {loading ? (
        <div className="skeleton rounded" style={{ height }} />
      ) : empty ? (
        <div className="flex items-center justify-center text-sm text-zinc-400" style={{ height }}>
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
