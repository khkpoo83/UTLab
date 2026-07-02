import React, { memo } from 'react'
import { Globe } from 'lucide-react'
import { Card } from './Card'
import { useIndices, IntradayPoint } from '../api/hooks/useIndices'

const KOREAN_SYMBOLS = new Set(['^KS11', '^KQ11'])

// unix초(UTC) → KST 날짜/시각 파트
function kstParts(ts: number): { md: string; hm: string; ymd: string } {
  const d = new Date((ts + 9 * 3600) * 1000) // 9h 미리 더하고 UTC 게터 사용
  const mm = (n: number) => String(n).padStart(2, '0')
  return {
    md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
    hm: `${mm(d.getUTCHours())}:${mm(d.getUTCMinutes())}`,
    ymd: `${d.getUTCFullYear()}-${mm(d.getUTCMonth() + 1)}-${mm(d.getUTCDate())}`,
  }
}

interface SparkGeo {
  line: string
  area: string
  endX: number
  endY: number
  timeLabel: string // 거래시간(KST, 날짜 포함)
  live: boolean
}

// 인트라데이 데이터 → SVG path(240x60) + 거래시간(KST) + 장중여부
function buildGeometry(data: IntradayPoint[], isKorean: boolean): SparkGeo | null {
  if (data.length < 2) return null
  const W = 240,
    H = 60,
    PAD = 4

  let xMin: number, xMax: number, timeLabel: string
  let visible = data
  if (isKorean) {
    // 데이터 첫 포인트의 KST 날짜 기준 09:00~15:30 고정 도메인
    const p0 = kstParts(data[0].time)
    xMin = new Date(`${p0.ymd}T09:00:00+09:00`).getTime() / 1000
    xMax = new Date(`${p0.ymd}T15:30:00+09:00`).getTime() / 1000
    visible = data.filter((d) => d.time >= xMin && d.time <= xMax)
    timeLabel = `${p0.md} 09:00–15:30`
  } else {
    xMin = data[0].time
    xMax = data[data.length - 1].time
    const a = kstParts(xMin),
      b = kstParts(xMax)
    // 세션 시작 날짜(KST)를 붙여 미국 야간 세션도 언제 거래된 건지 명확히
    timeLabel = `${a.md} ${a.hm}–${b.hm}`
  }
  if (visible.length < 2) return null

  const xRange = xMax - xMin || 1
  const toX = (ts: number) => PAD + ((ts - xMin) / xRange) * (W - PAD * 2)

  const closes = visible.map((d) => d.close)
  const vMin = Math.min(...closes)
  const vMax = Math.max(...closes)
  const vRange = vMax - vMin || 1
  const toY = (v: number) => PAD + (1 - (v - vMin) / vRange) * (H - PAD * 2)

  const pts = visible.map((d) => `${toX(d.time).toFixed(1)} ${toY(d.close).toFixed(1)}`)
  const line = 'M' + pts.join(' L')
  const first = visible[0],
    last = visible[visible.length - 1]
  const area = `${line} L${toX(last.time).toFixed(1)} ${H} L${toX(first.time).toFixed(1)} ${H} Z`

  const live = Date.now() / 1000 - last.time < 15 * 60

  return { line, area, endX: toX(last.time), endY: toY(last.close), timeLabel, live }
}

const IndexSpark = memo(function IndexSpark({
  data,
  isKorean,
}: {
  data: IntradayPoint[]
  isKorean: boolean
}) {
  const geo = buildGeometry(data, isKorean)
  if (!geo) return null
  const gid = `gi-grad-${Math.round(geo.endX)}-${Math.round(geo.endY)}-${data.length}`
  return (
    <svg
      viewBox="0 0 240 60"
      preserveAspectRatio="none"
      width="100%"
      height="44"
      style={{ display: 'block', overflow: 'visible', color: 'var(--gi-c)' }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.26" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={geo.area} fill={`url(#${gid})`} stroke="none" />
      <path
        className="gi-glow"
        d={geo.line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={geo.endX} cy={geo.endY} r={3} fill="var(--dot)" />
    </svg>
  )
})

const IndexPanel: React.FC = () => {
  const { data } = useIndices()
  const indices = data?.indices ?? []
  const intradays = data?.intradays ?? {}
  const updatedAt = data?.updatedAt ?? null

  if (indices.length === 0) return null

  // 기준시각 KST "M/D HH:MM:SS"
  let refLabel: string | null = null
  if (updatedAt) {
    const d = new Date(Date.parse(updatedAt) + 9 * 3600 * 1000)
    refLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.toISOString().slice(11, 19)}`
  }

  return (
    <Card
      collapsible
      id="index-panel"
      icon={<Globe size={15} />}
      title="Global Index"
      right={
        refLabel ? (
          <span
            className="ut-mono"
            style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 500 }}
          >
            {refLabel} 기준
          </span>
        ) : undefined
      }
      contentClassName="px-4 pb-4 pt-1"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {indices.map((idx) => {
          const isUp = (idx.change_pct ?? 0) > 0
          const isDown = (idx.change_pct ?? 0) < 0
          const giColor = isUp ? 'var(--up)' : isDown ? 'var(--down)' : 'var(--ink-4)'
          const intradayData = intradays[idx.symbol] ?? []
          const isKorean = KOREAN_SYMBOLS.has(idx.symbol)
          const geo = intradayData.length > 1 ? buildGeometry(intradayData, isKorean) : null
          const absChange = idx.change !== null ? Math.abs(idx.change) : null
          const changeFmt =
            absChange !== null
              ? absChange.toLocaleString('ko-KR', {
                  minimumFractionDigits: absChange >= 100 ? 0 : 2,
                  maximumFractionDigits: absChange >= 100 ? 0 : 2,
                })
              : null
          return (
            <div
              key={idx.symbol}
              className="gi-card flex flex-col"
              style={{ '--gi-c': giColor } as React.CSSProperties}
            >
              <div className="flex flex-col" style={{ padding: '13px 14px 0', gap: 6 }}>
                {/* 지수명 + 장중표시 / pill 뱃지 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}
                  >
                    <span
                      className="ut-eyebrow"
                      style={{
                        fontSize: 10.5,
                        letterSpacing: '0.04em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {idx.name}
                    </span>
                    {geo?.live && (
                      <span
                        title="장중"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 9999,
                          background: '#22c55e',
                          flexShrink: 0,
                          boxShadow: '0 0 5px #22c55e',
                        }}
                      />
                    )}
                  </span>
                  {idx.change_pct !== null && (
                    <span className="gi-pill ut-mono" style={{ flexShrink: 0 }}>
                      {isUp ? '▲' : isDown ? '▼' : ''} {Math.abs(idx.change_pct).toFixed(2)}%
                    </span>
                  )}
                </div>

                {idx.price !== null ? (
                  /* 큰 숫자 */
                  <div
                    className="ut-mono"
                    style={{
                      fontSize: 23,
                      fontWeight: 700,
                      color: 'var(--ink-0)',
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                    }}
                  >
                    {idx.price >= 1000
                      ? Math.round(idx.price).toLocaleString('ko-KR')
                      : idx.price.toFixed(2)}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--ink-4)' }}>
                    -
                  </p>
                )}
              </div>

              {/* 영역+라인 그래프 (글로우 + endpoint 점) */}
              {idx.price !== null &&
                (geo ? (
                  <div style={{ marginTop: 9 }}>
                    <IndexSpark data={intradayData} isKorean={isKorean} />
                  </div>
                ) : (
                  <div style={{ height: 44, marginTop: 9 }} />
                ))}

              {/* 하단 한 줄: 등락값 + 거래시간(KST, 날짜 포함) */}
              {idx.price !== null && (
                <div
                  className="ut-mono"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 6,
                    padding: '6px 14px 10px',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: giColor, flexShrink: 0 }}>
                    {isUp ? '+' : isDown ? '-' : ''}
                    {changeFmt ?? '-'}
                  </span>
                  {geo && (
                    <span
                      style={{
                        fontSize: 9.5,
                        color: 'var(--ink-4)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {geo.timeLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default memo(IndexPanel)
