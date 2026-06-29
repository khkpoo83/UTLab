import React from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { getTonalPalette } from '../utils/theme'
import EmptyState from './EmptyState'

interface SectorDonutProps {
  sectors: Record<string, number>
  loading?: boolean
  emptyMessage?: string
}

const SectorDonut: React.FC<SectorDonutProps> = ({
  sectors,
  loading = false,
  emptyMessage = '포트폴리오 데이터가 없습니다.',
}) => {
  if (loading) {
    return <div className="h-48 skeleton rounded" />
  }

  const data = Object.entries(sectors)
    .map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)

  if (!data.length) {
    return <EmptyState message={emptyMessage} className="h-48" />
  }

  const p = getTonalPalette()

  return (
    <div>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={68}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={p[index % p.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => [`${value.toFixed(1)}%`, '비중']}
            contentStyle={{
              fontSize: 12,
              backgroundColor: 'var(--tooltip-bg)',
              border: '1px solid var(--tooltip-border)',
              borderRadius: 8,
              color: 'var(--tooltip-text)',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {data.map((d, i) => (
          <span key={d.name} className="flex items-center gap-1 text-2xs text-ink-3">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: p[i % p.length] }} />
            {d.name} ({d.value.toFixed(1)}%)
          </span>
        ))}
      </div>
    </div>
  )
}

export default SectorDonut
