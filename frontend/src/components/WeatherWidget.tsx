import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  RefreshCw, Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog,
  CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
} from 'lucide-react'
// Lucide icons are used only for the Card title (14px) — Meteocons handles all sized badges
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card } from './Card'

// ── 날씨 아이콘 스타일 ─────────────────────────────────────────────────────────

export type WeatherIconStyle = 'fill' | 'flat' | 'line' | 'mono' | 'badge' | 'lucide'

export const WEATHER_ICON_STYLES: { id: WeatherIconStyle; label: string; desc: string }[] = [
  { id: 'fill',   label: 'Animated', desc: '컬러 애니메이션 아이콘' },
  { id: 'flat',   label: 'Flat',     desc: '플랫 컬러 스타일' },
  { id: 'line',   label: 'Line',     desc: '아웃라인 선 스타일' },
  { id: 'mono',   label: 'Mono',     desc: '흑백 그레이스케일' },
  { id: 'badge',  label: 'Badge',    desc: '그라디언트 원형 배지' },
  { id: 'lucide', label: 'Lucide',   desc: '심플 선형 아이콘' },
]

const ICON_STYLE_KEY = 'weather_icon_style'

const VALID_ICON_STYLES = new Set<string>(['fill', 'flat', 'line', 'mono', 'badge', 'lucide'])

export function getWeatherIconStyle(): WeatherIconStyle {
  const stored = localStorage.getItem(ICON_STYLE_KEY)
  if (!stored || !VALID_ICON_STYLES.has(stored)) return 'fill'
  return stored as WeatherIconStyle
}

export function saveWeatherIconStyle(style: WeatherIconStyle) {
  localStorage.setItem(ICON_STYLE_KEY, style)
  window.dispatchEvent(new CustomEvent('weatherIconStyleChange', { detail: style }))
}

const DEFAULT_LAT  = 37.5665
const DEFAULT_LON  = 126.9780
const DEFAULT_CITY = '서울'
const CACHE_KEY    = 'weather_cache_v5'
const CACHE_TTL    = 30 * 60 * 1000
const DAY_KO       = ['일', '월', '화', '수', '목', '금', '토']

type WMOGroup = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder'

// ── 스타일별 색상 팔레트 ───────────────────────────────────────────────────────

const LUCIDE_COLORS: Record<WMOGroup, string> = {
  clear:   '#F59E0B',
  partly:  '#60A5FA',
  cloudy:  '#9CA3AF',
  fog:     '#94A3B8',
  drizzle: '#93C5FD',
  rain:    '#3B82F6',
  snow:    '#7DD3FC',
  thunder: '#A855F7',
}

function wmoGradient(code: number, isNight = false): string {
  const g = wmoGroup(code)
  if (isNight && (g === 'clear' || g === 'partly'))
    return 'linear-gradient(145deg, #0f172a, #1e3a5f)'
  const table: Record<WMOGroup, string> = {
    clear:   'linear-gradient(145deg, #38bdf8, #0ea5e9)',
    partly:  'linear-gradient(145deg, #7dd3fc, #94a3b8)',
    cloudy:  'linear-gradient(145deg, #94a3b8, #64748b)',
    fog:     'linear-gradient(145deg, #e2e8f0, #cbd5e1)',
    drizzle: 'linear-gradient(145deg, #93c5fd, #64748b)',
    rain:    'linear-gradient(145deg, #3b82f6, #1d4ed8)',
    snow:    'linear-gradient(145deg, #e0f2fe, #bae6fd)',
    thunder: 'linear-gradient(145deg, #7c3aed, #4c1d95)',
  }
  return table[g]
}

function wmoGroup(code: number): WMOGroup {
  if (code === 0)  return 'clear'
  if (code <= 2)   return 'partly'
  if (code === 3)  return 'cloudy'
  if (code <= 48)  return 'fog'
  if (code <= 55)  return 'drizzle'
  if (code <= 67)  return 'rain'
  if (code <= 77)  return 'snow'
  if (code <= 82)  return 'rain'
  if (code <= 86)  return 'snow'
  return 'thunder'
}

function wmoLabel(code: number): string {
  switch (wmoGroup(code)) {
    case 'clear':   return '맑음'
    case 'partly':  return '대체로 맑음'
    case 'cloudy':  return '흐림'
    case 'fog':     return '안개'
    case 'drizzle': return '이슬비'
    case 'rain':    return '비'
    case 'snow':    return '눈'
    case 'thunder': return '뇌우'
  }
}


function WmoLucideIcon({ code, isNight, size, color }: {
  code: number; isNight?: boolean; size: number; color?: string
}) {
  const g = wmoGroup(code)
  const p = { size, color: color ?? 'currentColor', strokeWidth: 1.75 }
  if (g === 'clear')   return isNight ? <Moon {...p} /> : <Sun {...p} />
  if (g === 'partly')  return isNight ? <CloudMoon {...p} /> : <CloudSun {...p} />
  if (g === 'cloudy')  return <Cloud {...p} />
  if (g === 'fog')     return <CloudFog {...p} />
  if (g === 'drizzle') return <CloudDrizzle {...p} />
  if (g === 'rain')    return <CloudRain {...p} />
  if (g === 'snow')    return <CloudSnow {...p} />
  return <CloudLightning {...p} />
}

// ── Meteocons SVG 매핑 ──────────────────────────────────────────────────────────

function wmoMeteocon(code: number, isNight: boolean, style: WeatherIconStyle = 'fill'): string {
  const g = wmoGroup(code)
  const dn = isNight ? 'night' : 'day'
  // fill/mono/badge all use the root animated fill icons
  if (style === 'fill' || style === 'mono' || style === 'badge') {
    if (g === 'clear')   return isNight ? 'clear-night-v2' : 'clear-day-v2'
    if (g === 'partly')  return isNight ? 'partly-cloudy-night-v2' : 'partly-cloudy-day-v2'
    if (g === 'cloudy')  return 'cloudy-v2'
    if (g === 'fog')     return 'fog-v2'
    if (g === 'drizzle') return 'drizzle-v2'
    if (g === 'rain')    return 'rain-v2'
    if (g === 'snow')    return 'snow-v2'
    return 'thunderstorms-rain-v2'
  }
  const dir = style  // 'flat' | 'line'
  if (g === 'clear')   return `${dir}/clear-${dn}`
  if (g === 'partly')  return `${dir}/partly-cloudy-${dn}`
  if (g === 'cloudy')  return `${dir}/cloudy`
  if (g === 'fog')     return `${dir}/fog`
  if (g === 'drizzle') return `${dir}/drizzle`
  if (g === 'rain')    return `${dir}/rain`
  if (g === 'snow')    return `${dir}/snow`
  return `${dir}/thunderstorms-${dn}`
}

function MeteoconImg({ icon, size, style: s }: {
  icon: string; size: number; style?: React.CSSProperties
}) {
  return (
    <img
      src={`/weather-icons/${icon}.svg`}
      width={size}
      height={size}
      alt=""
      style={{ display: 'block', flexShrink: 0, ...s }}
    />
  )
}

export function WeatherBadge({ code, isNight = false, size, iconStyle }: {
  code: number; isNight?: boolean; size: number; iconStyle?: WeatherIconStyle
}) {
  const style = iconStyle ?? 'fill'
  const g = wmoGroup(code)
  const icon = wmoMeteocon(code, isNight, style)

  // mono: fill 아이콘 + CSS grayscale 필터 (currentColor SVG는 <img>에서 렌더 불가)
  if (style === 'mono') {
    return (
      <div style={{ width: size, height: size, flexShrink: 0, filter: 'grayscale(1) contrast(0.85)' }}>
        <MeteoconImg icon={icon} size={size} />
      </div>
    )
  }

  // badge: 그라디언트 원형 배지 + fill 아이콘
  if (style === 'badge') {
    const innerSz = Math.round(size * 0.78)
    return (
      <div style={{
        width: size, height: size, flexShrink: 0,
        background: wmoGradient(code, isNight),
        borderRadius: '50%',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        <MeteoconImg icon={icon} size={innerSz} />
      </div>
    )
  }

  // lucide: 날씨별 색상 적용된 Lucide 선형 아이콘
  if (style === 'lucide') {
    const color = (isNight && (g === 'clear' || g === 'partly')) ? '#A5B4FC' : LUCIDE_COLORS[g]
    return (
      <div style={{
        width: size, height: size, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <WmoLucideIcon code={code} isNight={isNight} size={Math.round(size * 0.82)} color={color} />
      </div>
    )
  }

  // fill / flat / line — Meteocons SVG (시각적으로 서로 다른 아이콘 세트)
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <MeteoconImg icon={icon} size={size} />
    </div>
  )
}

// ── Data types ─────────────────────────────────────────────────────────────────

interface HourlyPoint { hour: number; temp: number; precipProb: number; wmoCode: number }
export interface DayForecast {
  date: string; wmoCode: number; tempMax: number; tempMin: number
  precipProbMax: number; hourly: HourlyPoint[]
}
interface WeatherCache {
  lat: number; lon: number; city: string; fetchedAt: number
  temp: number; feelsLike: number; humidity: number; windSpeed: number
  precipitation: number; wmoCode: number; daily: DayForecast[]
}

function loadCache(): WeatherCache | null {
  try {
    const s = localStorage.getItem(CACHE_KEY)
    if (!s) return null
    const c: WeatherCache = JSON.parse(s)
    if (Date.now() - c.fetchedAt > CACHE_TTL) return null
    if (!c.daily?.[0]?.hourly) return null
    return c
  } catch { return null }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DayCol({ d, i, isSelected, onSelect, compact, iconStyle }: {
  d: DayForecast; i: number; isSelected?: boolean; onSelect?: () => void; compact?: boolean; iconStyle?: WeatherIconStyle
}) {
  const dn      = new Date(d.date + 'T00:00:00')
  const dayName = i === 0 ? '내일' : DAY_KO[dn.getDay()]
  return (
    <div
      onClick={onSelect}
      className={`flex flex-col items-center gap-0.5 min-w-0 py-1 ${compact ? 'px-0 overflow-hidden' : 'flex-1 px-0.5'} rounded-lg transition-colors ${
        onSelect ? 'cursor-pointer select-none' : ''
      } ${isSelected ? 'bg-accent/8 dark:bg-accent/12' : onSelect ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60' : ''}`}
    >
      <span className="text-2xs font-medium truncate w-full text-center" style={{ color: 'var(--ink-3)' }}>{dayName}</span>
      <WeatherBadge code={d.wmoCode} size={compact ? 20 : 28} iconStyle={iconStyle} />
      <span className="text-2xs font-semibold tabular-nums" style={{ color: 'var(--ink-1)' }}>{d.tempMax}°</span>
      <span className="text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>{d.tempMin}°</span>
    </div>
  )
}

// flat w≥3 전용 — 아이콘(좌) + 요일·기온·강수(우) 수평 2줄, 빈 공간 최소화
function FlatDayItem({ d, i, iconStyle }: { d: DayForecast; i: number; iconStyle?: WeatherIconStyle }) {
  const dn      = new Date(d.date + 'T00:00:00')
  const dayName = i === 0 ? '내일' : DAY_KO[dn.getDay()]
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0 px-1.5">
      <WeatherBadge code={d.wmoCode} size={44} iconStyle={iconStyle} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-xs font-semibold truncate" style={{ color: 'var(--ink-1)' }}>{dayName}</span>
          <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--ink-0)' }}>{d.tempMax}°</span>
        </div>
        <div className="flex items-center justify-between mt-px gap-1">
          <span className="text-2xs text-blue-500 dark:text-blue-400 tabular-nums">💧{d.precipProbMax}%</span>
          <span className="text-2xs tabular-nums shrink-0" style={{ color: 'var(--ink-4)' }}>{d.tempMin}°</span>
        </div>
      </div>
    </div>
  )
}

// narrow 전용 — 큰 배지(왼쪽) + 날짜/기온 2줄(오른쪽)
// compact=true: 배지 축소 + flex-1로 컨테이너 높이 균등 채움 (h=2일 때 7일 표시용)
function NarrowDayItem({ d, i, isSelected, onSelect, compact, iconStyle }: {
  d: DayForecast; i: number; isSelected?: boolean; onSelect?: () => void; compact?: boolean; iconStyle?: WeatherIconStyle
}) {
  const dn      = new Date(d.date + 'T00:00:00')
  const dayName = i === 0 ? '내일' : DAY_KO[dn.getDay()]
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-2 px-1 rounded-lg transition-colors select-none ${
        compact ? 'flex-1 min-h-0' : 'py-0.5'
      } ${onSelect ? 'cursor-pointer' : ''} ${
        isSelected ? 'bg-accent/8 dark:bg-accent/12' : onSelect ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60' : ''
      }`}
    >
      <WeatherBadge code={d.wmoCode} size={compact ? 28 : 40} iconStyle={iconStyle} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold" style={{ color: 'var(--ink-1)' }}>{dayName}</span>
          <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--ink-0)' }}>{d.tempMax}°</span>
        </div>
        <div className="flex items-center justify-between mt-px">
          <span className="text-2xs text-blue-500 dark:text-blue-400 tabular-nums">💧{d.precipProbMax}%</span>
          <span className="text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>{d.tempMin}°</span>
        </div>
      </div>
    </div>
  )
}

function DayRow({ d, i, isSelected, onSelect, rangeMin, rangeSpan, compact, iconStyle }: {
  d: DayForecast; i: number; isSelected?: boolean; onSelect?: () => void
  rangeMin: number; rangeSpan: number; compact?: boolean; iconStyle?: WeatherIconStyle
}) {
  const dn      = new Date(d.date + 'T00:00:00')
  const dayName = i === 0 ? '내일' : DAY_KO[dn.getDay()]
  const barLeft  = ((d.tempMin - rangeMin) / rangeSpan) * 100
  const barWidth = Math.max((d.tempMax - d.tempMin) / rangeSpan * 100, 8)
  const py = compact ? 'py-0.5' : 'py-1'
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-1.5 w-full px-1.5 rounded-lg transition-colors select-none ${
        onSelect ? 'cursor-pointer' : ''
      } ${isSelected ? 'bg-accent/8 dark:bg-accent/12' : onSelect ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60' : ''} ${py}`}
    >
      <span className="text-2xs font-medium w-7 shrink-0" style={{ color: 'var(--ink-3)' }}>{dayName}</span>
      <WeatherBadge code={d.wmoCode} size={24} iconStyle={iconStyle} />
      <span className="text-2xs text-blue-500 dark:text-blue-400 w-7 text-right shrink-0 tabular-nums">{d.precipProbMax}%</span>
      <span className="text-2xs tabular-nums w-6 text-right shrink-0" style={{ color: 'var(--ink-4)' }}>{d.tempMin}°</span>
      <div className="flex-1 h-1.5 rounded-full relative overflow-hidden mx-0.5" style={{ background: 'var(--mist)' }}>
        <div className="absolute top-0 h-full rounded-full bg-accent" style={{ left: `${barLeft}%`, width: `${barWidth}%` }} />
      </div>
      <span className="text-2xs font-semibold tabular-nums w-6 shrink-0" style={{ color: 'var(--ink-1)' }}>{d.tempMax}°</span>
    </div>
  )
}

// 온도+강수 겹친 듀얼 Y축 차트 (토글 없음)
function HourlyChart({ hourly, dayLabel }: {
  hourly: HourlyPoint[]
  dayLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartH, setChartH] = useState(120)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height
      if (h > 20) setChartH(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const isDark      = document.documentElement.classList.contains('dark')
  const tempColor   = isDark ? '#f87171' : '#ef4444'   // 온도: 빨간 계열
  const precipColor = isDark ? '#71717a' : '#9ca3af'   // 강수: 회색 계열
  const tickFill    = isDark ? '#a1a1aa' : '#71717a'
  const gridColor   = isDark ? '#52525b' : '#d4d4d8'

  const data = Array.from({ length: 24 }, (_, hr) => {
    const pt = hourly.find(h => h.hour === hr)
    return {
      h:      String(hr).padStart(2, '0'),
      temp:   pt?.temp ?? null,
      precip: pt?.precipProb ?? null,
    }
  })

  const xTick = ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
    const hr = parseInt(payload.value, 10)
    if (hr % 3 !== 0) return <g key={`xt-${hr}`} />
    return (
      <text key={`xt-${hr}`} x={x} y={y + 10} textAnchor="middle" fontSize={9} fill={tickFill}>
        {String(hr).padStart(2, '0')}
      </text>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-1 shrink-0">
        <span className="text-2xs" style={{ color: 'var(--ink-4)' }}>{dayLabel} 시간별</span>
        <div className="flex items-center gap-2.5 text-2xs" style={{ color: 'var(--ink-4)' }}>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: tempColor }} />
            온도
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: precipColor }} />
            강수
          </span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
        <ResponsiveContainer width="100%" height={chartH}>
          <ComposedChart data={data} margin={{ top: 8, right: 36, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="wTempGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tempColor} stopOpacity={0.4} />
                <stop offset="100%" stopColor={tempColor} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="wPrecipGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={precipColor} stopOpacity={0.35} />
                <stop offset="100%" stopColor={precipColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridColor} strokeOpacity={0.65} vertical={true} horizontal={true} />
            <XAxis dataKey="h" interval={0} tick={xTick} tickLine={false} axisLine={false} height={18} />
            <YAxis
              yAxisId="temp"
              tick={{ fontSize: 9, fill: tickFill }}
              axisLine={false} tickLine={false}
              width={30}
              tickFormatter={v => `${v}°`}
            />
            <YAxis
              yAxisId="precip"
              orientation="right"
              tick={{ fontSize: 9, fill: tickFill }}
              axisLine={false} tickLine={false}
              width={32}
              tickFormatter={v => `${v}%`}
              domain={[0, 100]}
            />
            <Tooltip
              formatter={(v: number, name: string) => [
                name === 'temp' ? `${v}°C` : `${v}%`,
                name === 'temp' ? '온도' : '강수확률',
              ]}
              labelFormatter={l => `${parseInt(l as string, 10)}시`}
              contentStyle={{
                fontSize: 10, borderRadius: 6, padding: '3px 8px',
                backgroundColor: 'var(--c-surface)',
                border: '1px solid var(--line)',
                color: 'var(--ink-0)',
              }}
            />
            {/* precip 먼저 렌더 → temp 선이 위에 표시됨 */}
            <Area
              yAxisId="precip"
              type="linear"
              dataKey="precip"
              stroke={precipColor}
              strokeWidth={1.5}
              fill="url(#wPrecipGrad)"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Area
              yAxisId="temp"
              type="linear"
              dataKey="temp"
              stroke={tempColor}
              strokeWidth={2}
              fill="url(#wTempGrad)"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function WeatherWidget({ widgetW, widgetH, title, dragHandle, minH }: {
  widgetW: number; widgetH: number; title?: string; dragHandle?: React.ReactNode; minH?: number
}) {
  const [cache,       setCache]       = useState<WeatherCache | null>(loadCache)
  const [loading,     setLoading]     = useState(!loadCache())
  const [refreshing,  setRefreshing]  = useState(false)
  const [error,       setError]       = useState(false)
  const [selectedDay, setSelectedDay] = useState(0)
  const [iconStyle,   setIconStyle]   = useState<WeatherIconStyle>(getWeatherIconStyle)

  useEffect(() => {
    const handler = (e: Event) => setIconStyle((e as CustomEvent<WeatherIconStyle>).detail)
    window.addEventListener('weatherIconStyleChange', handler)
    return () => window.removeEventListener('weatherIconStyleChange', handler)
  }, [])

  const fetchWeather = useCallback(async (lat: number, lon: number, city: string) => {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&hourly=temperature_2m,precipitation_probability,weather_code` +
        `&timezone=Asia%2FSeoul&forecast_days=8`
      const data = await fetch(url).then(r => r.json())

      const hourlyByDate = new Map<string, HourlyPoint[]>()
      ;(data.hourly?.time as string[] ?? []).forEach((t, i) => {
        const [date, tp] = t.split('T')
        const hour = parseInt(tp?.split(':')[0] ?? '0', 10)
        if (!hourlyByDate.has(date)) hourlyByDate.set(date, [])
        hourlyByDate.get(date)!.push({
          hour, temp: Math.round(data.hourly.temperature_2m[i]),
          precipProb: data.hourly.precipitation_probability[i] ?? 0,
          wmoCode: data.hourly.weather_code[i] ?? 0,
        })
      })

      const c: WeatherCache = {
        lat, lon, city, fetchedAt: Date.now(),
        temp:          Math.round(data.current.temperature_2m),
        feelsLike:     Math.round(data.current.apparent_temperature),
        humidity:      data.current.relative_humidity_2m,
        windSpeed:     Math.round(data.current.wind_speed_10m),
        precipitation: Math.round(data.current.precipitation * 10) / 10,
        wmoCode:       data.current.weather_code,
        daily: (data.daily.time as string[]).map((date, i) => ({
          date, wmoCode: data.daily.weather_code[i],
          tempMax: Math.round(data.daily.temperature_2m_max[i]),
          tempMin: Math.round(data.daily.temperature_2m_min[i]),
          precipProbMax: data.daily.precipitation_probability_max[i] ?? 0,
          hourly: hourlyByDate.get(date) ?? [],
        })),
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(c))
      setCache(c)
      setError(false)
    } catch { setError(true) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  const initLocation = useCallback(() => {
    const go = (lat: number, lon: number) =>
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=ko`)
        .then(r => r.json())
        .then(d => {
          const a = d.address ?? {}
          // 구/군 단위 우선 → 읍/면 → 시 순으로 폴백
          const district = a.city_district || a.borough || a.quarter || ''
          const town     = a.suburb || a.town || a.village || ''
          const city     = a.city || a.county || a.state_district || ''
          fetchWeather(lat, lon, district || town || city || DEFAULT_CITY)
        })
        .catch(() => fetchWeather(lat, lon, DEFAULT_CITY))
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(p => go(p.coords.latitude, p.coords.longitude), () => go(DEFAULT_LAT, DEFAULT_LON), { timeout: 5000 })
      : go(DEFAULT_LAT, DEFAULT_LON)
  }, [fetchWeather])

  useEffect(() => { if (!cache) initLocation() }, [])               // eslint-disable-line
  useEffect(() => {
    if (!cache) return
    const rem = CACHE_TTL - (Date.now() - cache.fetchedAt)
    if (rem <= 0) { fetchWeather(cache.lat, cache.lon, cache.city); return }
    const t = setTimeout(() => fetchWeather(cache.lat, cache.lon, cache.city), rem)
    return () => clearTimeout(t)
  }, [cache, fetchWeather])

  const handleRefresh = () => {
    setRefreshing(true)
    cache ? fetchWeather(cache.lat, cache.lon, cache.city) : initLocation()
  }

  const now       = new Date()
  const isNight   = now.getHours() < 6 || now.getHours() >= 20
  const wmo       = cache?.wmoCode ?? 0
  const cardTitle = title ?? cache?.city ?? '날씨'

  const allMax    = cache?.daily.map(d => d.tempMax) ?? []
  const allMin    = cache?.daily.map(d => d.tempMin) ?? []
  const rangeMin  = allMin.length ? Math.min(...allMin) : 0
  const rangeSpan = Math.max((allMax.length ? Math.max(...allMax) : 40) - rangeMin + 1, 1)

  const w = widgetW
  const h = widgetH

  const layout =
    h === 1 && w === 1 ? 'tiny'   :
    h === 1            ? 'flat'   :
    w === 1            ? 'narrow' :
    w === 2            ? 'wide'   :
    h === 2            ? 'medium' :
                         'full'

  const showHourly  = layout === 'wide' || layout === 'full' || (layout === 'narrow' && h >= 4)
  const dayCount    = 7
  const selDay      = cache?.daily[selectedDay]
  const selDayLabel = selectedDay === 0 ? '오늘' : selDay
    ? `${DAY_KO[new Date(selDay.date + 'T00:00:00').getDay()]}요일`
    : ''

  // medium: w에 따라 일별예보 컬럼 너비 조정 (chart 공간 균형)
  const medDailyW = w >= 4 ? 260 : w >= 3 ? 210 : 180

  return (
    <Card
      icon={<WmoLucideIcon code={wmo} isNight={isNight} size={14} />}
      title={cardTitle}
      subtitle={cache && cache.city !== cardTitle ? cache.city : undefined}
      dragHandle={dragHandle}
      minH={minH}
      className="h-full flex flex-col"
      contentClassName="p-3 flex-1 min-h-0 overflow-hidden"
      right={
        <button onClick={handleRefresh} className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" style={{ color: 'var(--ink-4)' }}>
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
        </button>
      }
    >
      {loading && <div className="flex items-center justify-center py-8"><div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" /></div>}
      {error && !cache && (
        <div className="flex flex-col items-center justify-center gap-2 py-6" style={{ color: 'var(--ink-4)' }}>
          <p className="text-xs">날씨를 불러올 수 없습니다</p>
          <button onClick={handleRefresh} className="text-2xs underline opacity-70 hover:opacity-100">재시도</button>
        </div>
      )}

      {cache && !loading && (
        <>
          {/* ── tiny: 1×1 ── */}
          {layout === 'tiny' && (
            <div className="flex items-center gap-2.5 h-full">
              <WeatherBadge code={wmo} isNight={isNight} size={64} iconStyle={iconStyle} />
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="text-3xl font-thin tabular-nums leading-none" style={{ color: 'var(--ink-0)' }}>{cache.temp}°</div>
                <div className="text-xs" style={{ color: 'var(--ink-3)' }}>{wmoLabel(wmo)}</div>
                <div className="text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>↑{cache.daily[0]?.tempMax}° ↓{cache.daily[0]?.tempMin}°</div>
                <div className="flex gap-2 text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>
                  <span>💧{cache.humidity}%</span>
                  <span>🌧{cache.precipitation}㎜</span>
                </div>
              </div>
            </div>
          )}

          {/* ── flat: h=1, w≥2 ── */}
          {layout === 'flat' && (
            <div className="flex items-center gap-2 h-full overflow-hidden">
              <div className="flex items-center gap-2 overflow-hidden" style={{ width: 96, flexShrink: 0 }}>
                <WeatherBadge code={wmo} isNight={isNight} size={44} iconStyle={iconStyle} />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="text-xl font-thin tabular-nums leading-none" style={{ color: 'var(--ink-0)' }}>{cache.temp}°</div>
                  <div className="text-2xs truncate" style={{ color: 'var(--ink-3)' }}>{wmoLabel(wmo)}</div>
                </div>
              </div>
              <div className="h-10 w-px" style={{ flexShrink: 0, background: 'var(--line)' }} />
              <div className="flex flex-1 min-w-0 overflow-hidden">
                {cache.daily.slice(1, 1 + dayCount).map((d, i) =>
                  w >= 3
                    ? <FlatDayItem key={d.date} d={d} i={i} iconStyle={iconStyle} />
                    : (
                      <div key={d.date} style={{ flex: `0 0 calc(100% / ${dayCount})`, minWidth: 0, overflow: 'hidden' }}>
                        <DayCol d={d} i={i} compact iconStyle={iconStyle} />
                      </div>
                    )
                )}
              </div>
            </div>
          )}

          {/* ── narrow: w=1 ── */}
          {layout === 'narrow' && (
            <div className="flex flex-col gap-2 h-full overflow-hidden">
              <div
                onClick={showHourly ? () => setSelectedDay(0) : undefined}
                className={`flex items-center gap-2.5 shrink-0 rounded-xl px-1 py-0.5 -mx-1 transition-colors ${
                  showHourly ? 'cursor-pointer' : ''
                } ${selectedDay === 0 && showHourly ? 'bg-accent/8 dark:bg-accent/12' : showHourly ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40' : ''}`}
              >
                <WeatherBadge code={wmo} isNight={isNight} size={h <= 2 ? 44 : 60} iconStyle={iconStyle} />
                <div>
                  <div className={`${h <= 2 ? 'text-xl' : 'text-2xl'} font-thin tabular-nums leading-none`} style={{ color: 'var(--ink-0)' }}>
                    {cache.temp}°
                  </div>
                  <div className="text-xs" style={{ color: 'var(--ink-3)' }}>{wmoLabel(wmo)}</div>
                  <div className="text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>↑{cache.daily[0]?.tempMax}° ↓{cache.daily[0]?.tempMin}°</div>
                  {h >= 3 && (
                    <div className="text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>💧{cache.humidity}% · 🌧{cache.precipitation}㎜</div>
                  )}
                </div>
              </div>
              <div
                className={`flex flex-col border-t pt-1 overflow-hidden ${showHourly ? 'shrink-0' : 'flex-1'} ${!showHourly && h >= 3 ? 'justify-between' : ''}`}
                style={{ borderColor: 'var(--line)' }}
              >
                {cache.daily.slice(1, 8).map((d, i) => (
                  <NarrowDayItem
                    key={d.date} d={d} i={i}
                    compact={h <= 2 && !showHourly}
                    isSelected={showHourly && selectedDay === i + 1}
                    onSelect={showHourly ? () => setSelectedDay(i + 1) : undefined}
                    iconStyle={iconStyle}
                  />
                ))}
              </div>
              {showHourly && (
                <div className="flex-1 min-h-0 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
                  <HourlyChart hourly={selDay?.hourly ?? []} dayLabel={selDayLabel} />
                </div>
              )}
            </div>
          )}

          {/* ── wide: w=2, h≥2 ── */}
          {layout === 'wide' && (
            <div className="flex flex-col gap-2 h-full overflow-hidden">
              <div
                onClick={() => setSelectedDay(0)}
                className={`flex items-center gap-2.5 shrink-0 rounded-xl px-1 py-0.5 -mx-1 cursor-pointer transition-colors ${
                  selectedDay === 0 ? 'bg-accent/8 dark:bg-accent/12' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                }`}
              >
                <WeatherBadge code={wmo} isNight={isNight} size={48} iconStyle={iconStyle} />
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-thin tabular-nums leading-none" style={{ color: 'var(--ink-0)' }}>{cache.temp}°</span>
                    <span className="text-xs" style={{ color: 'var(--ink-3)' }}>{wmoLabel(wmo)}</span>
                  </div>
                  <div className="text-2xs tabular-nums mt-0.5" style={{ color: 'var(--ink-4)' }}>
                    ↑{cache.daily[0]?.tempMax}° ↓{cache.daily[0]?.tempMin}° · 💧{cache.humidity}% · 💨{cache.windSpeed}㎞/h
                  </div>
                </div>
              </div>
              <div className="flex border-t pt-1 shrink-0" style={{ borderColor: 'var(--line)' }}>
                {cache.daily.slice(1, 8).map((d, i) => (
                  <DayCol key={d.date} d={d} i={i} isSelected={selectedDay === i + 1} onSelect={() => setSelectedDay(i + 1)} iconStyle={iconStyle} />
                ))}
              </div>
              <div className="flex-1 min-h-0 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
                <HourlyChart hourly={selDay?.hourly ?? []} dayLabel={selDayLabel} />
              </div>
            </div>
          )}

          {/* ── medium: w≥3, h=2 — 현재날씨 | 7일예보(선택) | 시간별차트 ── */}
          {layout === 'medium' && (
            <div className="flex gap-3 h-full overflow-hidden">
              <div
                onClick={() => setSelectedDay(0)}
                className={`flex flex-col gap-1.5 shrink-0 w-[110px] rounded-xl px-1 py-1 -mx-1 -my-1 cursor-pointer transition-colors ${
                  selectedDay === 0 ? 'bg-accent/8 dark:bg-accent/12' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                }`}
              >
                <WeatherBadge code={wmo} isNight={isNight} size={72} iconStyle={iconStyle} />
                <div className="text-4xl font-thin tabular-nums leading-none" style={{ color: 'var(--ink-0)' }}>{cache.temp}°</div>
                <div className="text-xs" style={{ color: 'var(--ink-3)' }}>{wmoLabel(wmo)}</div>
                <div className="text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>↑{cache.daily[0]?.tempMax}° ↓{cache.daily[0]?.tempMin}°</div>
                <div className="mt-auto flex flex-col gap-0.5 text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>
                  <span>💧{cache.humidity}%</span>
                  <span>🌧{cache.precipitation}㎜</span>
                  <span>💨{cache.windSpeed}㎞/h</span>
                </div>
              </div>
              <div
                className="flex flex-col justify-between border-l pl-3 shrink-0 overflow-hidden"
                style={{ width: medDailyW, borderColor: 'var(--line)' }}
              >
                {cache.daily.slice(1, 8).map((d, i) => (
                  <DayRow
                    key={d.date} d={d} i={i} compact
                    isSelected={selectedDay === i + 1}
                    onSelect={() => setSelectedDay(i + 1)}
                    rangeMin={rangeMin} rangeSpan={rangeSpan}
                    iconStyle={iconStyle}
                  />
                ))}
              </div>
              <div className="flex-1 min-h-0 min-w-0 border-l pl-3 overflow-hidden" style={{ borderColor: 'var(--line)' }}>
                <HourlyChart hourly={selDay?.hourly ?? []} dayLabel={selDayLabel} />
              </div>
            </div>
          )}

          {/* ── full: w≥3, h≥3 ── */}
          {layout === 'full' && (
            <div className="flex flex-col gap-2 h-full overflow-hidden">
              <div
                onClick={() => setSelectedDay(0)}
                className={`flex items-center gap-3 shrink-0 rounded-xl px-1 py-0.5 -mx-1 cursor-pointer transition-colors ${
                  selectedDay === 0 ? 'bg-accent/8 dark:bg-accent/12' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                }`}
              >
                <WeatherBadge code={wmo} isNight={isNight} size={76} iconStyle={iconStyle} />
                <div>
                  <div className="flex items-end gap-2">
                    <span className="text-5xl font-thin tabular-nums leading-none" style={{ color: 'var(--ink-0)' }}>{cache.temp}°</span>
                    <span className="text-sm pb-1" style={{ color: 'var(--ink-3)' }}>{wmoLabel(wmo)}</span>
                  </div>
                  <div className="flex gap-3 mt-0.5 text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>
                    <span>↑{cache.daily[0]?.tempMax}° ↓{cache.daily[0]?.tempMin}°</span>
                    <span>💧{cache.humidity}%</span>
                    <span>🌧{cache.precipitation}㎜</span>
                    <span>💨{cache.windSpeed}㎞/h</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-0 border-t pt-1 shrink-0" style={{ borderColor: 'var(--line)' }}>
                {cache.daily.slice(1, 8).map((d, i) => (
                  <DayRow
                    key={d.date} d={d} i={i} compact
                    isSelected={selectedDay === i + 1}
                    onSelect={() => setSelectedDay(i + 1)}
                    rangeMin={rangeMin} rangeSpan={rangeSpan}
                    iconStyle={iconStyle}
                  />
                ))}
              </div>
              <div className="flex-1 min-h-0 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
                <HourlyChart hourly={selDay?.hourly ?? []} dayLabel={selDayLabel} />
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
