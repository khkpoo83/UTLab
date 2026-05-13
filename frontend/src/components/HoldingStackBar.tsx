import React from 'react'
import { RecommendItem } from '../api/client'
import { getTonalPalette } from '../utils/theme'

interface HoldingStackBarProps {
  items: RecommendItem[]
  portfolioValues: Map<string, number>
}

const HoldingStackBar: React.FC<HoldingStackBarProps> = ({ items, portfolioValues }) => {
  const values = items.map(item => portfolioValues.get(item.ticker) ?? 1)
  const total = values.reduce((s, v) => s + v, 0)
  const p = getTonalPalette()

  return (
    <div className="mb-3">
      <p className="text-2xs text-zinc-400 mb-1">보유 종목</p>
      <div className="flex h-5 rounded overflow-hidden gap-px">
        {items.map((item, i) => {
          const w = total > 0 ? (values[i] / total * 100) : (100 / items.length)
          return (
            <div
              key={item.ticker}
              className="flex items-center justify-center overflow-hidden cursor-default"
              style={{ width: `${w}%`, backgroundColor: p[i % p.length] }}
              title={`${item.name} (${w.toFixed(1)}%)`}
            >
              {w > 8 && <span className="text-white text-2xs truncate px-1">{item.name}</span>}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {items.map((item, i) => {
          const w = total > 0 ? (values[i] / total * 100) : (100 / items.length)
          return (
            <span key={item.ticker} className="flex items-center gap-1 text-2xs text-zinc-500">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p[i % p.length] }} />
              {item.name} ({w.toFixed(1)}%)
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default HoldingStackBar
