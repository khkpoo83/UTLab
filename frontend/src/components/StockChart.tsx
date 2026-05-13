import React, { useEffect, useRef, useState } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts'
import { ChartPoint } from '../api/client'
import { formatPrice } from '../utils/format'

interface StockChartProps {
  data: ChartPoint[]
  avgPrice?: number
  onPeriodChange?: (period: string) => void
  period?: string
  loading?: boolean
  height?: number
}

const PERIODS = ['1d', '1w', '1m', '3m', '1y'] as const
type Period = (typeof PERIODS)[number]

const PERIOD_LABELS: Record<Period, string> = {
  '1d': '1일',
  '1w': '1주',
  '1m': '1달',
  '3m': '3달',
  '1y': '1년',
}

interface OhlcvInfo {
  time: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

const StockChart: React.FC<StockChartProps> = ({
  data,
  avgPrice,
  onPeriodChange,
  period = '3m',
  loading = false,
  height = 280,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const avgPriceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null)
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick')
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'))
  const [accentVersion, setAccentVersion] = useState(0)
  const [pnlVersion, setPnlVersion] = useState(0)
  const [tooltip, setTooltip] = useState<OhlcvInfo | null>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
      setPnlVersion(v => v + 1)  // 다크/라이트 전환 시 등락 색상도 재읽기
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setAccentVersion(v => v + 1)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-season'] })
    return () => observer.disconnect()
  }, [])

  // 등락 색상 변경 감지 (--c-up/--c-down이 style 속성으로 override될 때)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setPnlVersion(v => v + 1)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [])

  // 차트 인스턴스 생성 (isDark / accentVersion 바뀔 때만 재생성)
  useEffect(() => {
    if (!containerRef.current) return

    const panelOpacity = Math.min(
      (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-opacity').trim()) || 1) + 0.1,
      1
    )
    const bgColor = isDark
      ? `rgba(24,24,27,${panelOpacity})`
      : `rgba(255,255,255,${panelOpacity})`
    const textColor = isDark ? '#a1a1aa' : '#71717a'
    const gridColor = isDark ? '#18181b' : '#f4f4f5'
    const borderColor = isDark ? '#27272a' : '#e4e4e7'

    const rawRgb = getComputedStyle(document.documentElement)
      .getPropertyValue('--c-accent-rgb').trim() || '26 158 255'
    const [r, g, b] = rawRgb.split(' ').map(Number)
    const accentHex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor,
        fontSize: 11,
        fontFamily: 'Pretendard, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height,
    })

    chartRef.current = chart

    // 등락 색상: CSS 변수에서 읽어 사용자 설정 반영
    const pnlStyle  = getComputedStyle(document.documentElement)
    const upColor   = pnlStyle.getPropertyValue('--c-up').trim()   || '#F0507A'
    const downColor = pnlStyle.getPropertyValue('--c-down').trim() || '#1A9EFF'

    const candleSeries = chart.addCandlestickSeries({
      upColor,
      downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
    })
    candleSeriesRef.current = candleSeries

    const lineSeries = chart.addLineSeries({
      color: accentHex,
      lineWidth: 2,
      priceLineVisible: false,
    })
    lineSeriesRef.current = lineSeries

    // crosshair 이동 시 OHLCV 툴팁 업데이트
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || param.point === undefined) {
        setTooltip(null)
        return
      }
      const series = candleSeriesRef.current || lineSeriesRef.current
      if (!series) return
      const barData = param.seriesData.get(candleSeriesRef.current!) as any
        ?? param.seriesData.get(lineSeriesRef.current!) as any
      if (!barData) {
        setTooltip(null)
        return
      }
      const timeStr = typeof param.time === 'string'
        ? param.time
        : String(param.time)
      setTooltip({
        time: timeStr,
        open: barData.open ?? null,
        high: barData.high ?? null,
        low: barData.low ?? null,
        close: barData.close ?? (barData.value ?? null),
        volume: null,
      })
    })

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
        chart.timeScale().fitContent()
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      lineSeriesRef.current = null
      avgPriceLineRef.current = null
    }
  }, [isDark, accentVersion, pnlVersion]) // height는 applyOptions로 별도 처리

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height })
    }
  }, [height])

  // 데이터 업데이트 (data / chartType / avgPrice 바뀔 때)
  useEffect(() => {
    if (!data.length || !candleSeriesRef.current || !lineSeriesRef.current) return

    const validData = data.filter(
      (d) => d.open !== null && d.high !== null && d.low !== null && d.close !== null
    )

    const candleData = validData.map((d) => ({
      time: d.time as import('lightweight-charts').Time,
      open: d.open!,
      high: d.high!,
      low: d.low!,
      close: d.close!,
    }))

    const lineData = validData.map((d) => ({
      time: d.time as import('lightweight-charts').Time,
      value: d.close!,
    }))

    if (chartType === 'candlestick') {
      candleSeriesRef.current.setData(candleData)
      candleSeriesRef.current.applyOptions({ visible: true })
      lineSeriesRef.current.setData([])
      lineSeriesRef.current.applyOptions({ visible: false })
    } else {
      lineSeriesRef.current.setData(lineData)
      lineSeriesRef.current.applyOptions({ visible: true })
      candleSeriesRef.current.setData([])
      candleSeriesRef.current.applyOptions({ visible: false })
    }

    if (avgPriceLineRef.current && candleSeriesRef.current) {
      candleSeriesRef.current.removePriceLine(avgPriceLineRef.current)
      avgPriceLineRef.current = null
    }
    if (avgPrice && chartType === 'candlestick' && candleSeriesRef.current) {
      const avgRgb = getComputedStyle(document.documentElement)
        .getPropertyValue('--c-accent-rgb').trim() || '26 158 255'
      const [ar, ag, ab] = avgRgb.split(' ').map(Number)
      const avgColor = `rgba(${ar},${ag},${ab},0.7)`
      avgPriceLineRef.current = candleSeriesRef.current.createPriceLine({
        price: avgPrice,
        color: avgColor,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '평균단가',
      })
    }

    chartRef.current?.timeScale().fitContent()
    setTooltip(null)
  }, [data, chartType, avgPrice])

  return (
    <div className="space-y-2">
      {/* 기간 / 차트타입 버튼 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange?.(p)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                period === p
                  ? 'bg-accent text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setChartType('candlestick')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              chartType === 'candlestick'
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-400'
            }`}
          >
            캔들
          </button>
          <button
            onClick={() => setChartType('line')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              chartType === 'line'
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-400'
            }`}
          >
            라인
          </button>
        </div>
      </div>

      {/* OHLCV 툴팁 */}
      <div className="h-5 flex items-center gap-3 text-2xs tabular-nums">
        {tooltip ? (
          <>
            <span className="text-zinc-400">{tooltip.time}</span>
            {tooltip.open  != null && <span>시<span className="ml-0.5 text-zinc-700 dark:text-zinc-300">{formatPrice(tooltip.open)}</span></span>}
            {tooltip.high  != null && <span>고<span className="ml-0.5 text-up">{formatPrice(tooltip.high)}</span></span>}
            {tooltip.low   != null && <span>저<span className="ml-0.5 text-down">{formatPrice(tooltip.low)}</span></span>}
            {tooltip.close != null && <span>종<span className={`ml-0.5 font-semibold ${tooltip.close >= (tooltip.open ?? tooltip.close) ? 'text-up' : 'text-down'}`}>{formatPrice(tooltip.close)}</span></span>}
          </>
        ) : (
          <span className="text-zinc-500 dark:text-zinc-400">캔들 위에 커서를 올려보세요</span>
        )}
      </div>

      {/* 차트 컨테이너 — loading 중에도 유지 (overlay 처리) */}
      <div className="relative">
        <div
          ref={containerRef}
          className="w-full rounded-lg overflow-hidden border border-zinc-100 dark:border-zinc-800"
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-zinc-900/70 rounded-lg">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  )
}

export default StockChart
