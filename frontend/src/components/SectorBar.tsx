import React from 'react'
import Skeleton from './Skeleton'
import EmptyState from './EmptyState'
import { getTonalPalette } from '../utils/theme'

export interface SectorWeight {
  name: string
  value: number
  pct: number
}

interface SectorBarProps {
  items: SectorWeight[]
  loading?: boolean
  emptyMessage?: string
}

const SectorBar: React.FC<SectorBarProps> = ({
  items,
  loading = false,
  emptyMessage = '보유 종목이 없습니다.',
}) => {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-5 w-full rounded" />
        ))}
      </div>
    )
  }

  if (!items.length) {
    return <EmptyState message={emptyMessage} />
  }

  const palette = getTonalPalette()

  return (
    <div className="space-y-2">
      {items.map((s, i) => (
        <div key={s.name} className="flex items-center gap-3">
          <div
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: palette[i % palette.length] }}
          />
          <span className="text-xs text-zinc-600 dark:text-zinc-400 w-28 flex-shrink-0 truncate">{s.name}</span>
          <div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${s.pct}%`,
                backgroundColor: s.pct > 40
                  ? 'var(--tag-amber-fg)'
                  : palette[i % palette.length],
              }}
            />
          </div>
          <span
            className={`text-xs tabular-nums w-12 text-right flex-shrink-0 ${s.pct > 40 ? 'font-medium' : ''}`}
            style={{ color: s.pct > 40 ? 'var(--tag-amber-fg)' : undefined }}
          >
            {s.pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default SectorBar
