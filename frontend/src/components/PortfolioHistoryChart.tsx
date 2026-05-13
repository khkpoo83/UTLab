import React, { useEffect, useState } from 'react'
import {
  ComposedChart, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { portfolioApi, PortfolioHistoryPoint } from '../api/client'

interface PortfolioHistoryChartProps {
  accountNo?: string
  todayPnlPct?: number
}

const PortfolioHistoryChart: React.FC<PortfolioHistoryChartProps> = ({ accountNo, todayPnlPct }) => {
  const [rawData, setRawData] = useState<PortfolioHistoryPoint[]>([])
  const [period, setPeriod] = useState<7 | 30 | 90 | 180 | 365>(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    portfolioApi.history(period, accountNo).then(res => {
      setRawData(res.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [period, accountNo])

  if (loading) return <div className="h-36 skeleton rounded" />

  const todayStr = new Date().toISOString().slice(5, 10)
  const base = rawData.map(d => ({ date: d.date.slice(5), pnl_pct: Math.round(d.pnl_pct * 100) / 100 }))
  if (todayPnlPct !== undefined && (base.length === 0 || base[base.length - 1].date !== todayStr)) {
    base.push({ date: todayStr, pnl_pct: Math.round(todayPnlPct * 100) / 100 })
  }

  if (!base.length) return <p className="text-2xs text-zinc-400 text-center py-4">히스토리 없음 · KIS 동기화 후 적립됩니다</p>

  if (base.length === 1) {
    const pnl = base[0].pnl_pct
    return (
      <div className="py-4 text-center">
        <p className={`text-2xl font-bold tabular-nums ${pnl >= 0 ? 'text-up' : 'text-down'}`}>
          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
        </p>
        <p className="text-2xs text-zinc-400 mt-1">오늘 기준 · 매일 동기화 후 히스토리 적립</p>
      </div>
    )
  }

  const chartData = base.map((d, i) => ({
    date: d.date,
    pnl_pct: d.pnl_pct,
    day_chg: i === 0 ? null : Math.round((d.pnl_pct - base[i - 1].pnl_pct) * 100) / 100,
  }))

  const pnlValues = chartData.map(d => d.pnl_pct)
  const yMin = Math.min(...pnlValues)
  const yMax = Math.max(...pnlValues)
  const yPad = Math.max((yMax - yMin) * 0.12, 0.3)

  const dayValues = chartData.map(d => d.day_chg ?? 0)
  const dayAbsMax = Math.max(...dayValues.map(Math.abs), 0.1)

  // 0% 기준선이 항상 차트 안에 보이도록
  // 전구간 음수: 데이터 범위의 25%+yPad 여백 → barMin/barMax 비율 확보
  const domainMax = yMax <= 0 ? (yMax - yMin) * 0.25 + yPad : yMax + yPad
  const domainMinNaive = yMin >= 0 ? -(yPad * 0.4) : yMin - yPad

  // barMin/barMax = domainMin/domainMax 이어야 바 0선이 pnl 0선과 일치
  // barMin이 -dayAbsMax보다 크면 음수 바가 차트 밖으로 잘려나가므로
  // domainMin을 확장해 barMin이 최소 -dayAbsMax 이하가 되도록 보장
  const barMax = Math.max(dayAbsMax * 5, (domainMax - domainMinNaive) * 0.25)
  const barMinAligned = barMax * domainMinNaive / domainMax
  const barMin = Math.min(barMinAligned, -dayAbsMax)
  const domainMin = barMin < barMinAligned ? barMin * domainMax / barMax : domainMinNaive
  const dayDomain: [number, number] = [barMin, barMax]

  const isDark = document.documentElement.classList.contains('dark')
  const UP_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--c-up').trim() || '#F0507A'
  const DN_COLOR = getComputedStyle(document.documentElement).getPropertyValue('--c-down').trim() || '#1A9EFF'
  const GRID_COLOR = isDark ? '#3f3f46' : '#d1d5db'
  const TICK_COLOR = isDark ? '#a1a1aa' : '#71717a'
  const TICK_ZERO_COLOR = isDark ? '#d4d4d8' : '#52525b'
  const gradId = `pnlGrad_${accountNo ?? 'total'}`
  const fillId = `pnlFill_${accountNo ?? 'total'}`

  // 모든 값이 같은 부호이면 단색 사용 (objectBoundingBox 그라디언트 오정렬 방지)
  const allPositive = yMin >= 0
  const allNegative = yMax <= 0
  const strokeColor = allPositive ? UP_COLOR : allNegative ? DN_COLOR : `url(#${gradId})`
  const areaFill = allPositive ? UP_COLOR : allNegative ? DN_COLOR : `url(#${fillId})`
  const areaFillOpacity = (allPositive || allNegative) ? 0.13 : 1
  // 0% 기준선 위치: objectBoundingBox는 실제 데이터 범위(yMin~yMax) 기준 — 패딩된 도메인 X
  const zeroRatio = (yMax - yMin) > 0 ? yMax / (yMax - yMin) : (yMax <= 0 ? 0 : 1)
  const clampedZero = Math.max(0.01, Math.min(0.99, zeroRatio))

  return (
    <div>
      <div className="flex gap-1 mb-2">
        {([7, 30, 90, 180, 365] as const).map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`text-2xs px-1.5 py-0.5 rounded ${period === p
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-medium'
              : 'text-zinc-400 dark:text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'}`}>
            {p === 7 ? '7일' : p === 30 ? '1개월' : p === 90 ? '3개월' : p === 180 ? '6개월' : '1년'}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset={`${(clampedZero * 100 - 0.5).toFixed(1)}%`} stopColor={UP_COLOR} stopOpacity="1" />
              <stop offset={`${(clampedZero * 100 + 0.5).toFixed(1)}%`} stopColor={DN_COLOR} stopOpacity="1" />
            </linearGradient>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={UP_COLOR} stopOpacity="0.18" />
              <stop offset={`${(clampedZero * 100).toFixed(1)}%`} stopColor={UP_COLOR} stopOpacity="0.03" />
              <stop offset={`${(clampedZero * 100).toFixed(1)}%`} stopColor={DN_COLOR} stopOpacity="0.03" />
              <stop offset="100%" stopColor={DN_COLOR} stopOpacity="0.18" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} strokeOpacity={0.7} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: TICK_COLOR }} tickLine={{ stroke: GRID_COLOR }} axisLine={false} interval="preserveStartEnd" />
          <YAxis
            yAxisId="left"
            axisLine={false}
            tickLine={false}
            width={38}
            domain={[domainMin, domainMax]}
            tick={(props: { x: number; y: number; payload: { value: number } }) => {
              const { x, y, payload } = props
              const isZero = Math.abs(payload.value) < 0.001
              return (
                <text x={x} y={y} dy={3} textAnchor="end" fontSize={9}
                  fill={isZero ? TICK_ZERO_COLOR : TICK_COLOR}
                  fontWeight={isZero ? 700 : 400}>
                  {payload.value.toFixed(1)}%
                </text>
              )
            }}
          />
          <YAxis yAxisId="bar" hide domain={dayDomain} />
          <ReferenceLine y={0} yAxisId="left" stroke="#6b7280" strokeWidth={1.2} />
          <Tooltip
            formatter={(value: number, name: string) => [
              `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`,
              name === 'pnl_pct' ? '누적 수익률' : '일별 등락',
            ]}
            labelFormatter={l => l}
            contentStyle={{
              fontSize: 10,
              padding: '4px 8px',
              borderRadius: 6,
              backgroundColor: 'var(--tooltip-bg)',
              border: '1px solid var(--tooltip-border)',
              color: 'var(--tooltip-text)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            }}
            itemStyle={{ color: 'var(--tooltip-text)', padding: '1px 0' }}
            labelStyle={{ color: 'var(--tooltip-label)', marginBottom: 2 }}
          />
          <Bar yAxisId="bar" dataKey="day_chg" barSize={10} radius={[2, 2, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={(d.day_chg ?? 0) >= 0 ? UP_COLOR : DN_COLOR} fillOpacity={0.65} />
            ))}
          </Bar>
          <Area yAxisId="left" type="monotone" dataKey="pnl_pct" stroke={strokeColor} strokeWidth={1.8} fill={areaFill} fillOpacity={areaFillOpacity} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default PortfolioHistoryChart
