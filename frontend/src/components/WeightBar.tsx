import React from 'react'
import { Treemap, Tooltip, ResponsiveContainer } from 'recharts'
import { PortfolioItem } from '../api/client'
import { getTonalPalette } from '../utils/theme'

interface WeightBarProps {
  holdings: PortfolioItem[]
  privacyMode?: boolean
}

const WeightBar: React.FC<WeightBarProps> = ({ holdings, privacyMode = false }) => {
  if (!holdings.length) return null
  const totalValue = holdings.reduce((s, h) => s + (h.current_value ?? h.avg_price * h.quantity), 0)
  if (totalValue <= 0) return null

  const sorted = [...holdings].sort((a, b) =>
    (b.current_value ?? b.avg_price * b.quantity) - (a.current_value ?? a.avg_price * a.quantity)
  )
  const COLORS = getTonalPalette()

  // CSS 변수에서 상승/하락 색상 읽기
  const styles =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
      : null
  const colorUp   = styles?.getPropertyValue('--c-up').trim()   || '#F0507A'
  const colorDown = styles?.getPropertyValue('--c-down').trim() || '#1A9EFF'

  // 기타 색상: accent 팔레트 기반 (gray 하드코딩 대신)
  const accentRgb = styles?.getPropertyValue('--c-accent-rgb').trim() || '26 158 255'
  const othersColor = `rgb(${accentRgb} / 0.28)`

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

    const icon = dayChangePct === null ? '' : dayChangePct > 0 ? '▲' : dayChangePct < 0 ? '▼' : ''
    const iconColor = dayChangePct !== null && dayChangePct > 0 ? colorUp : colorDown

    const lineCount = (canShowName1 ? 1 : 0) + (canShowName2 ? 1 : 0) + (canShowPct ? 1 : 0)
    const lineH = 13
    const startY = my - (lineCount * lineH) / 2 + lineH / 2
    let lineIdx = 0

    return (
      <g>
        <rect x={x + 1} y={y + 1} width={w} height={h} fill={fill} rx={2} style={{ cursor: 'default' }} />
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
              {icon && <tspan fill={iconColor} fontSize={8}>{icon} </tspan>}
              <tspan fill="white">{part1}</tspan>
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
              fill="white" fontSize={10} fontWeight={600}
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
              fill="rgba(255,255,255,0.82)" fontSize={9} fontWeight={400}
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
