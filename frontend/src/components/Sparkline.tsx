import React from 'react'

interface SparklineProps {
  data: number[]
}

const Sparkline: React.FC<SparklineProps> = ({ data }) => {
  if (!data.length) return <span className="text-ink-4">-</span>
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 60
  const h = 24
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ')
  const isUp = data[data.length - 1] >= data[0]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        fill="none"
        stroke={isUp ? 'var(--c-up)' : 'var(--c-down)'}
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  )
}

export default Sparkline
