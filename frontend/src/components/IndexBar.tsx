import React, { useEffect, useState } from 'react'
import { indicesApi, MarketIndex } from '../api/client'

const IndexBar: React.FC = () => {
  const [indices, setIndices] = useState<MarketIndex[]>([])
  const [loading, setLoading] = useState(true)

  const fetchIndices = async () => {
    try {
      const { data } = await indicesApi.get()
      setIndices(data)
    } catch {
      // Silent fail for index bar
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIndices()
    const interval = setInterval(fetchIndices, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-6 overflow-x-auto">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-4 w-32 rounded" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-5 overflow-x-auto scrollbar-none flex-nowrap">
      {indices.map((idx) => {
        const isUp = (idx.change ?? 0) > 0
        const isDown = (idx.change ?? 0) < 0
        const colorClass = isUp
          ? 'text-up'
          : isDown
            ? 'text-down'
            : 'text-zinc-500 dark:text-zinc-400'

        return (
          <div key={idx.symbol} className="flex items-baseline gap-1.5 whitespace-nowrap flex-shrink-0">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {idx.name}
            </span>
            {idx.price !== null ? (
              <>
                <span className="text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {idx.price.toLocaleString('ko-KR', {
                    minimumFractionDigits: idx.price > 1000 ? 0 : 2,
                    maximumFractionDigits: idx.price > 1000 ? 0 : 2,
                  })}
                </span>
                <span className={`text-2xs tabular-nums ${colorClass}`}>
                  {isUp ? '▲' : isDown ? '▼' : ''}
                  {idx.change_pct !== null
                    ? ` ${Math.abs(idx.change_pct).toFixed(2)}%`
                    : ''}
                </span>
              </>
            ) : (
              <span className="text-xs text-zinc-400">-</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default IndexBar
