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

const MA_WINDOW = 20

interface OhlcvInfo {
  time: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function accentHexFromVar(): string {
  const rawRgb = cssVar('--c-accent-rgb', '26 158 255')
  const [r, g, b] = rawRgb.split(' ').map(Number)
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
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
  const maSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const avgPriceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null)
  const avgPriceLineOwnerRef = useRef<'candle' | 'line' | null>(null)
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick')
  const [showMA, setShowMA] = useState(true)
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
      (parseFloat(cssVar('--card-opacity', '1')) || 1) + 0.1,
      1
    )
    const bgColor = isDark
      ? `rgba(24,24,27,${panelOpacity})`
      : `rgba(255,255,255,${panelOpacity})`
    const textColor = isDark ? '#a1a1aa' : '#71717a'
    const gridColor = isDark ? '#1c1c1f' : '#f1f1f3'
    const borderColor = isDark ? '#27272a' : '#e4e4e7'
    const accentHex = accentHexFromVar()

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
        scaleMargins: { top: 0.1, bottom: 0.26 },
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
    const upColor   = cssVar('--c-up', '#F0507A')
    const downColor = cssVar('--c-down', '#1A9EFF')

    // 거래량 히스토그램 (하단 서브패널, 별도 price scale)
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      priceLineVisible: false,
      lastValueVisible: false,
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })
    volumeSeriesRef.current = volumeSeries

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

    // 이동평균선 (MA20)
    const maSeries = chart.addLineSeries({
      color: isDark ? '#d4a574' : '#c08a4a',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    maSeriesRef.current = maSeries

    // crosshair 이동 시 OHLCV 툴팁 업데이트
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || param.point === undefined) {
        setTooltip(null)
        return
      }
      const barData = param.seriesData.get(candleSeriesRef.current!) as any
        ?? param.seriesData.get(lineSeriesRef.current!) as any
      const volData = param.seriesData.get(volumeSeriesRef.current!) as any
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
        volume: volData?.value ?? null,
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
      maSeriesRef.current = null
      volumeSeriesRef.current = null
      avgPriceLineRef.current = null
      avgPriceLineOwnerRef.current = null
    }
  }, [isDark, accentVersion, pnlVersion]) // height는 applyOptions로 별도 처리

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height })
    }
  }, [height])

  // 데이터 업데이트 (data / chartType / avgPrice / showMA 바뀔 때)
  useEffect(() => {
    const candle = candleSeriesRef.current
    const line = lineSeriesRef.current
    const ma = maSeriesRef.current
    const vol = volumeSeriesRef.current
    if (!candle || !line || !ma || !vol) return

    const validData = data.filter(
      (d) => d.open !== null && d.high !== null && d.low !== null && d.close !== null
    )

    type T = import('lightweight-charts').Time
    const candleData = validData.map((d) => ({
      time: d.time as T,
      open: d.open!, high: d.high!, low: d.low!, close: d.close!,
    }))
    const lineData = validData.map((d) => ({ time: d.time as T, value: d.close! }))

    const upColor   = cssVar('--c-up', '#F0507A')
    const downColor = cssVar('--c-down', '#1A9EFF')
    const volData = validData.map((d) => ({
      time: d.time as T,
      value: d.volume ?? 0,
      color: (d.close! >= (d.open ?? d.close!))
        ? (isDark ? 'rgba(240,80,122,0.4)' : 'rgba(240,80,122,0.35)')
        : (isDark ? 'rgba(26,158,255,0.4)' : 'rgba(26,158,255,0.35)'),
    }))
    void upColor; void downColor

    // 이동평균(MA) 계산
    const maData: { time: T; value: number }[] = []
    if (validData.length >= MA_WINDOW) {
      for (let i = MA_WINDOW - 1; i < validData.length; i++) {
        let sum = 0
        for (let j = i - MA_WINDOW + 1; j <= i; j++) sum += validData[j].close!
        maData.push({ time: validData[i].time as T, value: sum / MA_WINDOW })
      }
    }

    if (chartType === 'candlestick') {
      candle.setData(candleData)
      candle.applyOptions({ visible: true })
      line.setData([])
      line.applyOptions({ visible: false })
    } else {
      line.setData(lineData)
      line.applyOptions({ visible: true })
      candle.setData([])
      candle.applyOptions({ visible: false })
    }

    vol.setData(volData)
    ma.setData(showMA ? maData : [])
    ma.applyOptions({ visible: showMA && maData.length > 0 })

    // 평균단가선: 캔들/라인 어느 모드든 "보이는 시리즈"에 부착
    const activeSeries = chartType === 'candlestick' ? candle : line
    const desiredOwner = chartType === 'candlestick' ? 'candle' : 'line'
    if (avgPriceLineRef.current && avgPriceLineOwnerRef.current) {
      const owner = avgPriceLineOwnerRef.current === 'candle' ? candle : line
      owner.removePriceLine(avgPriceLineRef.current)
      avgPriceLineRef.current = null
      avgPriceLineOwnerRef.current = null
    }
    if (avgPrice && avgPrice > 0 && validData.length > 0) {
      const avgRgb = cssVar('--c-accent-rgb', '26 158 255')
      const [ar, ag, ab] = avgRgb.split(' ').map(Number)
      avgPriceLineRef.current = activeSeries.createPriceLine({
        price: avgPrice,
        color: `rgba(${ar},${ag},${ab},0.8)`,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '평균단가',
      })
      avgPriceLineOwnerRef.current = desiredOwner
    }

    if (validData.length > 0) chartRef.current?.timeScale().fitContent()
    setTooltip(null)
  }, [data, chartType, avgPrice, showMA, isDark])

  const hasData = data.some(
    (d) => d.open !== null && d.high !== null && d.low !== null && d.close !== null
  )

  return (
    <div className="space-y-2">
      {/* 기간 / 차트옵션 버튼 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange?.(p)}
              className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
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
            onClick={() => setShowMA(v => !v)}
            title="20일 이동평균선"
            className={`px-2 py-0.5 text-xs rounded-md transition-colors border ${
              showMA
                ? 'border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-500/10'
                : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            MA20
          </button>
          <span className="w-px h-3 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
          <button
            onClick={() => setChartType('candlestick')}
            className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
              chartType === 'candlestick'
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-400'
            }`}
          >
            캔들
          </button>
          <button
            onClick={() => setChartType('line')}
            className={`px-2 py-0.5 text-xs rounded-md transition-colors ${
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
      <div className="h-5 flex items-center gap-3 text-2xs tabular-nums overflow-hidden">
        {tooltip ? (
          <>
            <span className="text-zinc-400 flex-shrink-0">{tooltip.time}</span>
            {tooltip.open  != null && <span>시<span className="ml-0.5 text-zinc-700 dark:text-zinc-300">{formatPrice(tooltip.open)}</span></span>}
            {tooltip.high  != null && <span>고<span className="ml-0.5 text-up">{formatPrice(tooltip.high)}</span></span>}
            {tooltip.low   != null && <span>저<span className="ml-0.5 text-down">{formatPrice(tooltip.low)}</span></span>}
            {tooltip.close != null && <span>종<span className={`ml-0.5 font-semibold ${tooltip.close >= (tooltip.open ?? tooltip.close) ? 'text-up' : 'text-down'}`}>{formatPrice(tooltip.close)}</span></span>}
            {tooltip.volume != null && tooltip.volume > 0 && <span className="text-zinc-400">량<span className="ml-0.5 text-zinc-500 dark:text-zinc-400">{Math.round(tooltip.volume).toLocaleString()}</span></span>}
          </>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-500">캔들 위에 커서를 올려보세요</span>
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
        {!loading && !hasData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg pointer-events-none">
            <span className="text-xs text-zinc-400">차트 데이터를 불러올 수 없습니다</span>
            <span className="text-2xs text-zinc-400 dark:text-zinc-500">잠시 후 다시 시도해 주세요</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default StockChart
