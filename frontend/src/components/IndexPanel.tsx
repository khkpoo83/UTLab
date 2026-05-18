import React, { memo, useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import apiClient, { indicesApi, MarketIndex } from '../api/client'
import { Card } from './Card'

interface IntradayPoint {
  time: number
  close: number
}

const MiniSparkline = memo(function MiniSparkline({ data, isKorean = false }: { data: IntradayPoint[]; isKorean?: boolean }) {
  if (data.length < 2) return null

  const W = 100, CHART_H = 30
  const lineColor = 'var(--ink-3)'
  const dotColor = 'var(--dot)'
  const isDark = document.documentElement.classList.contains('dark')
  const labelColor = isDark ? '#71717a' : '#a1a1aa'

  let xMin: number, xMax: number
  if (isKorean) {
    // 오늘이 아닌 첫 데이터 포인트의 날짜 기준으로 계산 (장 마감 후 데이터가 전일자인 경우 대응)
    const kstStr = new Date(data[0].time * 1000 + 9 * 3600 * 1000).toISOString().slice(0, 10)
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

  const lastPt = visibleData[visibleData.length - 1]
  const dotX = toX(lastPt.time)
  const dotY = toY(lastPt.close)

  return (
    <div className="w-full flex flex-col gap-0">
      <svg
        width="100%" height={CHART_H + 1}
        viewBox={`0 0 ${W} ${CHART_H + 1}`}
        preserveAspectRatio="none"
        className="w-full overflow-visible"
      >
        <polyline
          fill="none"
          stroke={lineColor}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
          opacity="0.7"
        />
        {showCurrentLine && (
          <line x1={currentX} y1={0} x2={currentX} y2={CHART_H}
            stroke={lineColor} strokeWidth="0.6" strokeDasharray="2,1.5" opacity="0.35" />
        )}
        <circle cx={dotX} cy={dotY} r={2.5} fill={dotColor} />
      </svg>
      <div className="relative w-full flex justify-between" style={{ height: 9 }}>
        {timeLabels.map(({ label, align }, i) => (
          <span key={i} style={{ fontSize: 7, color: labelColor, lineHeight: '9px', textAlign: align }}
            className={i === 1 ? 'flex-1 text-center' : 'shrink-0'}>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
})

const IndexPanel: React.FC = () => {
  const [indices, setIndices] = useState<MarketIndex[]>([])
  const [intradays, setIntradays] = useState<Record<string, IntradayPoint[]>>({})

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await indicesApi.get()
        setIndices(data)
        // 병렬로 intraday 데이터 fetch
        const results = await Promise.allSettled(
          data.map(idx =>
            apiClient.get<IntradayPoint[]>(`/api/indices/${encodeURIComponent(idx.symbol)}/intraday`)
              .then(({ data: intraday }) => ({ symbol: idx.symbol, intraday }))
          )
        )
        const merged: Record<string, IntradayPoint[]> = {}
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.intraday && r.value.intraday.length > 1) {
            merged[r.value.symbol] = r.value.intraday
          }
        }
        if (Object.keys(merged).length > 0) setIntradays(merged)
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
      title="Global Index"

      contentClassName=""
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100 dark:divide-white/[.07]">
        {indices.map((idx) => {
          const isUp = (idx.change_pct ?? 0) > 0
          const isDown = (idx.change_pct ?? 0) < 0
          const intradayData = intradays[idx.symbol] ?? []
          const absChange = idx.change !== null ? Math.abs(idx.change) : null
          const changeFmt = absChange !== null
            ? absChange.toLocaleString('ko-KR', { minimumFractionDigits: absChange >= 100 ? 0 : 2, maximumFractionDigits: absChange >= 100 ? 0 : 2 })
            : null
          return (
            <div
              key={idx.symbol}
              className="px-3 py-3 flex flex-col justify-between overflow-hidden hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors cursor-default"
              style={{ gap: 6 }}
            >
              {/* 지수명 eyebrow */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="ut-eyebrow" style={{ fontSize: 10 }}>{idx.name}</span>
                {idx.change_pct !== null && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: isUp ? 'var(--up)' : isDown ? 'var(--down)' : 'var(--ink-4)' }}>
                    {isUp ? '▲' : isDown ? '▼' : ''}{Math.abs(idx.change_pct).toFixed(2)}%
                  </span>
                )}
              </div>

              {idx.price !== null ? (
                <>
                  {/* 큰 숫자 */}
                  <div className="ut-mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-0)', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {idx.price >= 1000
                      ? Math.round(idx.price).toLocaleString('ko-KR')
                      : idx.price.toFixed(2)}
                  </div>
                  {/* 등락값 + 스파크라인 */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: isUp ? 'var(--up)' : isDown ? 'var(--down)' : 'var(--ink-4)', flexShrink: 0 }}>
                      {isUp ? '+' : ''}{changeFmt ?? '-'}
                    </span>
                    {intradayData.length > 1 && (
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <MiniSparkline
                          data={intradayData}
                          isKorean={idx.symbol === '^KS11' || idx.symbol === '^KQ11'}
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs" style={{ color: 'var(--ink-4)' }}>-</p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default memo(IndexPanel)
