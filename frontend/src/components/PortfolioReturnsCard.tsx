import React, { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Area, Bar, Cell, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { portfolioApi, PortfolioHistoryPoint } from '../api/client'
import { Card } from './Card'
import { TrendingUp } from 'lucide-react'
import Skeleton from './Skeleton'

interface Props {
  accountNo?: string
  privacyMode?: boolean
  dragHandle?: React.ReactNode
}

function fmtKRW(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`
  if (abs >= 10_000) return `${Math.round(v / 10_000)}만`
  return v.toLocaleString('ko-KR')
}

const PERIODS = [30, 90, 180, 365] as const
type Period = typeof PERIODS[number]
const PERIOD_LABELS: Record<Period, string> = { 30: '1개월', 90: '3개월', 180: '6개월', 365: '1년' }

const PortfolioReturnsCard: React.FC<Props> = ({ accountNo, privacyMode = false, dragHandle }) => {
  const [rawData, setRawData] = useState<PortfolioHistoryPoint[]>([])
  const [period, setPeriod] = useState<Period>(90)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    portfolioApi.history(period, accountNo)
      .then(r => setRawData(r.data))
      .catch(() => setRawData([]))
      .finally(() => setLoading(false))
  }, [period, accountNo])

  const isDark = document.documentElement.classList.contains('dark')
  const UP = getComputedStyle(document.documentElement).getPropertyValue('--c-up').trim() || '#EF4444'
  const DN = getComputedStyle(document.documentElement).getPropertyValue('--c-down').trim() || '#3B82F6'
  const GRID = isDark ? '#3f3f46' : '#e4e4e7'
  const TICK = isDark ? '#a1a1aa' : '#71717a'
  const DASH = isDark ? '#71717a' : '#9ca3af'

  // 통계 — 미실현 + 실현 합산
  const stats = useMemo(() => {
    if (!rawData.length) return null
    const last = rawData[rawData.length - 1]
    const totalPnl = (d: typeof rawData[0]) => d.pnl + (d.realized_pnl ?? 0)
    const maxPnl = Math.max(...rawData.map(totalPnl))
    let peak = -Infinity, mdd = 0
    rawData.forEach(d => {
      const tp = totalPnl(d)
      if (tp > peak) peak = tp
      const dd = tp - peak
      if (dd < mdd) mdd = dd
    })
    return { currentPnl: totalPnl(last), maxPnl, mdd }
  }, [rawData])

  // 원금·평가금 차트 데이터 — 평가금에 실현 손익 포함
  const areaData = useMemo(() =>
    rawData.map(d => ({
      date: d.date.slice(5),
      cost: d.total_cost,
      value: d.total_value + (d.realized_pnl ?? 0),
    })),
  [rawData])

  // 월별 수익금 차트 — 총 손익(미실현+실현) 기준
  const monthlyData = useMemo(() => {
    if (!rawData.length) return []
    const byMonth = new Map<string, number>()
    rawData.forEach(d => byMonth.set(d.date.slice(0, 7), d.pnl + (d.realized_pnl ?? 0)))
    const entries = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return entries.map(([month, pnl], i) => ({
      month: month.slice(5),
      delta: i === 0 ? pnl : pnl - entries[i - 1][1],
    }))
  }, [rawData])

  const pBlur = privacyMode ? 'blur-sm select-none pointer-events-none' : ''
  const isProfit = (stats?.currentPnl ?? 0) >= 0
  const accentColor = isProfit ? UP : DN

  // Y 도메인 (0에서 시작, 적절한 패딩)
  const allVals = areaData.flatMap(d => [d.cost, d.value]).filter(v => v > 0)
  const yMin = allVals.length ? Math.min(...allVals) : 0
  const yMax = allVals.length ? Math.max(...allVals) : 0
  const yPad = Math.max((yMax - yMin) * 0.1, yMax * 0.05)
  const areaDomain: [number, number] = [Math.max(0, yMin - yPad), yMax + yPad]

  const tooltipBox: React.CSSProperties = {
    background: 'var(--tooltip-bg)',
    border: '1px solid var(--tooltip-border)',
    borderRadius: 10,
    padding: '9px 11px',
    boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
    minWidth: 140,
  }
  const ttRow = (color: string, lbl: string, val: React.ReactNode) => (
    <div key={lbl} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 11, lineHeight: 1.65 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--tooltip-label)' }}>
        {color
          ? <span style={{ width: 12, height: 0, borderTop: `2px ${color === DASH ? 'dashed' : 'solid'} ${color}`, display: 'inline-block', flexShrink: 0 }} />
          : <span style={{ width: 12, flexShrink: 0 }} />}
        {lbl}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: 'var(--tooltip-text)' }}>{val}</span>
    </div>
  )

  // 차트1 툴팁: 평가금을 큰 글씨로
  const renderAreaTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    const diff = p.value - p.cost
    const up = diff >= 0
    return (
      <div style={tooltipBox}>
        <div style={{ fontSize: 10, color: 'var(--tooltip-label)', marginBottom: 5 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--tooltip-text)' }}>
          {fmtKRW(p.value)}
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--tooltip-label)', marginTop: 1, marginBottom: 6 }}>평가금+실현손익</div>
        {ttRow(DASH, '투자원금', fmtKRW(p.cost))}
        {ttRow('', '평가손익', <span style={{ color: up ? UP : DN, fontWeight: 600 }}>{`${up ? '+' : ''}${fmtKRW(diff)}`}</span>)}
      </div>
    )
  }

  // 차트2 툴팁: 월별 손익을 큰 글씨로
  const renderMonthlyTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const v = payload[0].payload.delta as number
    const up = v >= 0
    return (
      <div style={tooltipBox}>
        <div style={{ fontSize: 10, color: 'var(--tooltip-label)', marginBottom: 5 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: up ? UP : DN }}>
          {up ? '+' : ''}{fmtKRW(v)}
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--tooltip-label)', marginTop: 1 }}>월별 손익</div>
      </div>
    )
  }

  return (
    <Card
      collapsible
      dragHandle={dragHandle}
      icon={<TrendingUp size={15} />}
      title="수익금 분석"
      subtitle="투자원금 변동 포함 실제 손익"
    >
      <div className="p-4 space-y-4">
        {/* 기간 선택 */}
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`text-2xs px-1.5 py-0.5 rounded transition-colors ${period === p
                ? 'bg-zinc-200 dark:bg-zinc-700 text-ink-1 font-medium'
                : 'text-ink-4 hover:text-ink-2'}`}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
            </div>
            <Skeleton className="h-36 rounded" />
            <Skeleton className="h-24 rounded" />
          </div>
        ) : !rawData.length ? (
          <p className="text-xs text-ink-4 text-center py-6">
            히스토리 없음 · KIS 동기화 후 적립됩니다
          </p>
        ) : (
          <>
            {/* 통계 3개 */}
            {stats && (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-3">
                  <p className="text-2xs text-ink-3 mb-1 leading-tight">현재 수익금</p>
                  <p className={`text-sm font-bold tabular-nums leading-tight ${stats.currentPnl >= 0 ? 'text-up' : 'text-down'} ${pBlur}`}>
                    {stats.currentPnl >= 0 ? '+' : ''}{fmtKRW(stats.currentPnl)}
                  </p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-3">
                  <p className="text-2xs text-ink-3 mb-1 leading-tight">최대 수익금</p>
                  <p className={`text-sm font-bold tabular-nums leading-tight text-up ${pBlur}`}>
                    +{fmtKRW(stats.maxPnl)}
                  </p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-3">
                  <p className="text-2xs text-ink-3 mb-1 leading-tight">최대 낙폭</p>
                  <p className={`text-sm font-bold tabular-nums leading-tight ${stats.mdd < 0 ? 'text-down' : 'text-ink-4'} ${pBlur}`}>
                    {stats.mdd < 0 ? fmtKRW(stats.mdd) : '—'}
                  </p>
                </div>
              </div>
            )}

            {/* 차트 1: 투자원금 vs 평가금 */}
            <div>
              <p className="text-2xs text-ink-4 mb-2 flex items-center gap-3">
                <span>투자원금 vs 평가금</span>
                <span className="flex items-center gap-1">
                  <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={DASH} strokeWidth="1.5" strokeDasharray="4 2" /></svg>
                  <span>원금</span>
                </span>
                <span className="flex items-center gap-1">
                  <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={accentColor} strokeWidth="2" /></svg>
                  <span>평가금+실현손익</span>
                </span>
              </p>
              <ResponsiveContainer width="100%" height={150}>
                <ComposedChart data={areaData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.7} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: TICK }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis axisLine={false} tickLine={false} width={46}
                    domain={areaDomain}
                    tickFormatter={fmtKRW}
                    tick={{ fontSize: 9, fill: TICK }} />
                  <Tooltip content={renderAreaTooltip} cursor={{ stroke: DASH, strokeOpacity: 0.5, strokeWidth: 1 }} />
                  {/* 평가금 영역 (배경 채움) */}
                  <Area type="monotone" dataKey="value"
                    fill={accentColor} stroke={accentColor}
                    strokeWidth={2} fillOpacity={0.13}
                    dot={false} isAnimationActive={false} />
                  {/* 투자원금 점선 (위에 렌더링 → 항상 보임) */}
                  <Line type="monotone" dataKey="cost"
                    stroke={DASH} strokeWidth={1.5}
                    strokeDasharray="5 3"
                    dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-2xs text-ink-4 mt-1">
                점선(원금) 위 = 수익 구간 · 아래 = 손실 구간
              </p>
            </div>

            {/* 차트 2: 월별 수익금 변동 */}
            {monthlyData.length >= 2 && (
              <div>
                <p className="text-2xs text-ink-4 mb-2">월별 수익금 변동</p>
                <ResponsiveContainer width="100%" height={90}>
                  <ComposedChart data={monthlyData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} strokeOpacity={0.7} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: TICK }} tickLine={false} axisLine={false} />
                    <YAxis axisLine={false} tickLine={false} width={46}
                      tickFormatter={fmtKRW}
                      tick={{ fontSize: 9, fill: TICK }}
                      domain={[(v: number) => Math.min(v, 0), (v: number) => Math.max(v, 0)]} />
                    <ReferenceLine y={0} stroke={DASH} strokeWidth={1} />
                    <Tooltip content={renderMonthlyTooltip} cursor={{ fill: TICK, fillOpacity: 0.08 }} />
                    <Bar dataKey="delta" barSize={20} radius={[2, 2, 0, 0]}>
                      {monthlyData.map((d, i) => (
                        <Cell key={i} fill={d.delta >= 0 ? UP : DN} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

export default PortfolioReturnsCard
