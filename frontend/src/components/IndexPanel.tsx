import React, { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { indicesApi, MarketIndex } from '../api/client'
import apiClient from '../api/client'
import { Card, fmtUpdated } from './Card'

interface IntradayPoint {
  time: number
  close: number
}

function MiniSparkline({ data, isUp, isKorean = false }: { data: IntradayPoint[]; isUp: boolean; isKorean?: boolean }) {
  if (data.length < 2) return null

  const W = 100, CHART_H = 34
  const color = isUp ? 'var(--c-up)' : 'var(--c-down)'
  const isDark = document.documentElement.classList.contains('dark')
  const axisColor = isDark ? '#52525b' : '#d4d4d8'
  const labelColor = isDark ? '#71717a' : '#a1a1aa'

  let xMin: number, xMax: number
  if (isKorean) {
    const now = new Date()
    const kstStr = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    xMin = new Date(`${kstStr}T09:00:00+09:00`).getTime() / 1000
    xMax = new Date(`${kstStr}T15:30:00+09:00`).getTime() / 1000
  } else {
    xMin = data[0].time
    xMax = data[data.length - 1].time
  }
  const xRange = xMax - xMin || 1
  const toX = (ts: number) => (ts - xMin) / xRange * W

  const visibleData = isKorean
    ? data.filter(d => d.time >= xMin && d.time <= xMax)
    : data

  if (visibleData.length < 2) return null

  const closes = visibleData.map(d => d.close)
  const vMin = Math.min(...closes)
  const vMax = Math.max(...closes)
  const vRange = vMax - vMin || 1
  const toY = (v: number) => CHART_H - 1 - ((v - vMin) / vRange) * (CHART_H - 4)
  const points = visibleData.map(d => `${toX(d.time)},${toY(d.close)}`).join(' ')

  const nowTs = Date.now() / 1000
  const currentX = toX(nowTs)
  const showCurrentLine = isKorean && currentX > 0 && currentX < W

  // 시간 레이블 (HTML로 분리해서 stretching 방지)
  const timeLabels: { pct: number; label: string; align: 'left' | 'center' | 'right' }[] = isKorean
    ? [
        { pct: 0,   label: '09:00', align: 'left' },
        { pct: 50,  label: '12:15', align: 'center' },
        { pct: 100, label: '15:30', align: 'right' },
      ]
    : [0, Math.floor(visibleData.length / 2), visibleData.length - 1].map((i, li) => {
        const d = new Date(visibleData[i].time * 1000)
        const label = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
        return {
          pct: li === 0 ? 0 : li === 2 ? 100 : 50,
          label,
          align: (li === 0 ? 'left' : li === 2 ? 'right' : 'center') as 'left' | 'center' | 'right',
        }
      })

  return (
    <div className="w-full flex flex-col gap-0">
      {/* 차트 SVG: x축만 늘어남, y는 고정 */}
      <svg
        width="100%" height={CHART_H + 1}
        viewBox={`0 0 ${W} ${CHART_H + 1}`}
        preserveAspectRatio="none"
        className="w-full overflow-visible"
      >
        {/* x축 */}
        <line x1={0} y1={CHART_H} x2={W} y2={CHART_H} stroke={axisColor} strokeWidth="0.6" />
        {/* y축 */}
        <line x1={0} y1={0} x2={0} y2={CHART_H} stroke={axisColor} strokeWidth="0.6" />
        {/* 차트 라인 */}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
          opacity="0.9"
        />
        {/* 현재 시각 수직선 (한국) */}
        {showCurrentLine && (
          <line x1={currentX} y1={0} x2={currentX} y2={CHART_H}
            stroke={color} strokeWidth="0.7" strokeDasharray="2,1.5" opacity="0.45" />
        )}
      </svg>
      {/* 시간 레이블: HTML로 렌더링해 글자 왜곡 없음 */}
      <div className="relative w-full flex justify-between" style={{ height: 10 }}>
        {timeLabels.map(({ label, align }, i) => (
          <span
            key={i}
            style={{ fontSize: 7, color: labelColor, lineHeight: '10px', textAlign: align }}
            className={i === 1 ? 'flex-1 text-center' : 'shrink-0'}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

const IndexPanel: React.FC = () => {
  const [indices, setIndices] = useState<MarketIndex[]>([])
  const [intradays, setIntradays] = useState<Record<string, IntradayPoint[]>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await indicesApi.get()
        setIndices(data)
        setLastUpdated(new Date())
        for (const idx of data) {
          apiClient.get<IntradayPoint[]>(`/api/indices/${encodeURIComponent(idx.symbol)}/intraday`)
            .then(({ data: intraday }) => {
              if (intraday && intraday.length > 1) {
                setIntradays(prev => ({ ...prev, [idx.symbol]: intraday }))
              }
            })
            .catch(() => {})
        }
      } catch {
        // ignore
      }
    }
    load()
    const interval = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  if (indices.length === 0) return null

  return (
    <Card
      collapsible
      id="index-panel"
      icon={<Globe size={15} />}
      title="글로벌 지수"
      subtitle={lastUpdated ? `${fmtUpdated(lastUpdated)}` : '5분마다 갱신'}
      contentClassName=""
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100 dark:divide-zinc-800">
        {indices.map((idx) => {
          const isUp = (idx.change_pct ?? 0) > 0
          const isDown = (idx.change_pct ?? 0) < 0
          const colorCls = isUp ? 'text-up' : isDown ? 'text-down' : 'text-zinc-400 dark:text-zinc-500'
          const intradayData = intradays[idx.symbol] ?? []
          const absChange = idx.change !== null ? Math.abs(idx.change) : null
          const changeFmt = absChange !== null
            ? absChange.toLocaleString('ko-KR', { minimumFractionDigits: absChange >= 100 ? 0 : 2, maximumFractionDigits: absChange >= 100 ? 0 : 2 })
            : null
          return (
            <div
              key={idx.symbol}
              className="px-3 py-2.5 flex flex-col justify-center overflow-hidden hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors cursor-default"
            >
              {/* 지수명 */}
              <p className="text-2xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5 truncate">{idx.name}</p>

              {idx.price !== null ? (
                <div className="flex items-center gap-2 min-w-0">
                  {/* 좌: 3단 숫자 */}
                  <div className="flex flex-col gap-0.5 tabular-nums leading-none min-w-0 shrink-0">
                    {/* 상단: 등락 포인트 */}
                    <span className={`text-2xs font-medium truncate ${colorCls}`}>
                      {isUp ? '▲' : isDown ? '▼' : ''}
                      {changeFmt ? ` ${changeFmt}` : ' -'}
                    </span>
                    {/* 중단: 현재 지수 (가장 크게) */}
                    <span className="text-lg font-semibold tabular-nums text-zinc-600 dark:text-zinc-300 tracking-tight leading-snug">
                      {idx.price >= 1000
                        ? Math.round(idx.price).toLocaleString('ko-KR')
                        : idx.price.toFixed(2)}
                    </span>
                    {/* 하단: 퍼센트 */}
                    <span className={`text-2xs font-medium truncate ${colorCls}`}>
                      {idx.change_pct !== null
                        ? `${isUp ? '+' : ''}${idx.change_pct.toFixed(2)}%`
                        : '-'}
                    </span>
                  </div>

                  {/* 우: 스파크라인 (남은 공간 전부) */}
                  {intradayData.length > 1 ? (
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <MiniSparkline
                        data={intradayData}
                        isUp={isUp}
                        isKorean={idx.symbol === '^KS11' || idx.symbol === '^KQ11'}
                      />
                    </div>
                  ) : (
                    <div className="flex-1" />
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-400">-</p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default IndexPanel
