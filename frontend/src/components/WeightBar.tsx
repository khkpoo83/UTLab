import React from 'react'
import { Treemap, Tooltip, ResponsiveContainer } from 'recharts'
import { PortfolioItem } from '../api/client'

interface WeightBarProps {
  holdings: PortfolioItem[]
  privacyMode?: boolean
}

// 라이트/다크 모두 지원하는 ink 스케일
const INK_COLORS = ['#0A0A0B', '#18181A', '#3C3C40', '#6B6A65', '#A8A6A0', '#D9D7D2']

const WeightBar: React.FC<WeightBarProps> = ({ holdings, privacyMode = false }) => {
  if (!holdings.length) return null
  const totalValue = holdings.reduce((s, h) => s + (h.current_value ?? h.avg_price * h.quantity), 0)
  if (totalValue <= 0) return null

  const sorted = [...holdings].sort((a, b) =>
    (b.current_value ?? b.avg_price * b.quantity) - (a.current_value ?? a.avg_price * a.quantity)
  )

  const styles =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
      : null
  const colorUp   = styles?.getPropertyValue('--c-up').trim()   || '#E5484D'
  const colorDown = styles?.getPropertyValue('--c-down').trim() || '#2A6FDB'
  const dotColor  = styles?.getPropertyValue('--dot').trim()    || '#F59E0B'
  const isDark    = typeof window !== 'undefined' && document.documentElement.classList.contains('dark')

  // 다크모드: 밝은 ink 스케일로 반전
  const COLORS = isDark
    ? ['#FFFFFF', '#E8E6E1', '#C8C6C0', '#A8A6A0', '#6B6A65', '#3C3C40']
    : INK_COLORS
  const othersColor = isDark ? '#4A4A50' : '#D9D7D2'

  const top = sorted.slice(0, 8)
  const rest = sorted.slice(8)

  const data = top.map((h, i) => {
    const val = h.current_value ?? h.avg_price * h.quantity
    return {
      name: h.name,
      ticker: h.ticker,
      value: val,
      pct: val / totalValue * 100,
      fill: COLORS[i % COLORS.length],
      dayChangePct: h.day_change_pct ?? null,
    }
  })
  if (rest.length > 0) {
    const restVal = rest.reduce((s, h) => s + (h.current_value ?? h.avg_price * h.quantity), 0)
    data.push({
      name: `기타 ${rest.length}종목`,
      ticker: '',
      value: restVal,
      pct: restVal / totalValue * 100,
      fill: othersColor,
      dayChangePct: null,
    })
  }

  const renderNode = (props: any) => {
    const { x, y, width, height, name = '', pct = 0, fill = '#888', depth = 0, dayChangePct = null } = props
    if (depth === 0 || width < 2 || height < 2) return <g />

    const w = Math.max(0, width - 2)
    const h = Math.max(0, height - 2)
    const mx = x + width / 2
    const my = y + height / 2

    // 6자 기준으로 이름 2줄 분할 → ETF처럼 앞부분 같은 긴 이름 구별
    const part1 = name.length > 6 ? name.slice(0, 6) : name
    const part2raw = name.length > 6 ? name.slice(6, 12) : ''
    const part2 = part2raw + (name.length > 12 ? '…' : '')

    const canShowName1 = !privacyMode && w > 22 && h > 16
    const canShowName2 = !privacyMode && !!part2 && w > 26 && h > 30
    const canShowPct   = w > 18 && h > (canShowName1 ? (canShowName2 ? 46 : 28) : 14)

    const isUp = dayChangePct !== null && dayChangePct > 0
    const showDot = dayChangePct !== null && dayChangePct > 0 && w > 14 && h > 14

    // 셀이 어두울수록 white 텍스트, 밝을수록 ink 텍스트
    const fillIndex = COLORS.indexOf(fill)
    const textColor = isDark
      ? (fillIndex <= 2 ? 'var(--ink-0)' : 'white')
      : (fillIndex <= 2 ? 'white' : 'var(--ink-1)')

    const lineCount = (canShowName1 ? 1 : 0) + (canShowName2 ? 1 : 0) + (canShowPct ? 1 : 0)
    const lineH = 13
    const startY = my - (lineCount * lineH) / 2 + lineH / 2
    let lineIdx = 0

    return (
      <g>
        <rect x={x + 1} y={y + 1} width={w} height={h} fill={fill} rx={2} style={{ cursor: 'default' }} />
        {/* 상승 amber 도트 */}
        {showDot && <circle cx={x + w - 5} cy={y + 5} r={2.5} fill={dotColor} />}
        {/* 하락 작은 파란 도트 */}
        {dayChangePct !== null && !isUp && w > 14 && h > 14 && (
          <circle cx={x + w - 5} cy={y + 5} r={2} fill={colorDown} fillOpacity={0.6} />
        )}
        {canShowName1 && (() => {
          const ly = startY + lineIdx++ * lineH
          return (
            <text
              x={mx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={600}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <tspan fill={textColor}>{part1}</tspan>
            </text>
          )
        })()}
        {canShowName2 && (() => {
          const ly = startY + lineIdx++ * lineH
          return (
            <text
              key="n2"
              x={mx} y={ly}
              textAnchor="middle" dominantBaseline="middle"
              fill={textColor} fontSize={10} fontWeight={600}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >{part2}</text>
          )
        })()}
        {canShowPct && (() => {
          const ly = startY + lineIdx++ * lineH
          return (
            <text
              key="pct"
              x={mx} y={ly}
              textAnchor="middle" dominantBaseline="middle"
              fill={textColor} fontSize={9} fontWeight={400} opacity={0.65}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >{`${pct.toFixed(0)}%`}</text>
          )
        })()}
      </g>
    )
  }

  const renderTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    if (!d) return null
    const dc: number | null = d.dayChangePct ?? null
    return (
      <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 text-2xs shadow-lg pointer-events-none">
        {!privacyMode && (
          <p className="font-semibold text-zinc-800 dark:text-zinc-100">
            {d.name}{d.ticker ? ` (${d.ticker})` : ''}
          </p>
        )}
        <p className="text-zinc-500 dark:text-zinc-400 tabular-nums">비중 {d.pct.toFixed(1)}%</p>
        {dc !== null && (
          <p
            className="tabular-nums font-semibold"
            style={{ color: dc >= 0 ? colorUp : colorDown }}
          >
            당일 {dc >= 0 ? '+' : ''}{dc.toFixed(2)}%
          </p>
        )}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={88}>
      <Treemap
        data={data}
        dataKey="value"
        aspectRatio={3}
        isAnimationActive={false}
        content={renderNode as any}
      >
        <Tooltip content={renderTooltip} />
      </Treemap>
    </ResponsiveContainer>
  )
}

export default WeightBar
