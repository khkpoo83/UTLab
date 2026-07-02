// Presentational pickers for the Settings page (roadmap Phase 3, P3-3).
// Extracted verbatim from pages/Settings.tsx to shrink that god-component.
// These are pure/controlled components — no Settings state, only value+onChange.
import React from 'react'
import { Check, PanelTop, PanelLeft } from 'lucide-react'
import { OptionTile, OptionGrid } from './OptionTile'
import { Segmented } from './Segmented'
import { RangeField } from './RangeField'
import { LogoAnyStyle, NEW_LOGO_STYLES } from '../Logo'
import { BgConfig, BgType, GradientDir, getBgStyle } from '../../utils/background'
import {
  WeatherIconStyle,
  WEATHER_ICON_STYLES,
  saveWeatherIconStyle,
  WeatherBadge,
} from '../WeatherWidget'
import { OverlayStyle, OVERLAY_OPTIONS } from '../../utils/overlay'
import {
  resolveProfileIcon,
  PnlColorConfig,
  applyUiRadius,
  UiRadius,
  ColorTheme,
  COLOR_THEMES,
} from '../../utils/settings-utils'

// ── 프로필 아이콘 픽커 ────────────────────────────────────────────────────────

const PROFILE_ICON_LIST: { id: string; label: string }[] = [
  { id: 'person',       label: '기본'     },
  { id: 'technologist', label: '개발자'   },
  { id: 'scientist',    label: '과학자'   },
  { id: 'teacher',      label: '선생님'   },
  { id: 'cook',         label: '요리사'   },
  { id: 'mechanic',     label: '엔지니어' },
  { id: 'pilot',        label: '파일럿'   },
  { id: 'artist',       label: '아티스트' },
  { id: 'astronaut',    label: '우주인'   },
  { id: 'farmer',       label: '사업가'   },
  { id: 'firefighter',  label: '소방관'   },
  { id: 'judge',        label: '법조인'   },
]

export function ProfileIconPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const resolved = resolveProfileIcon(value)
  return (
    <OptionGrid cols={6}>
      {PROFILE_ICON_LIST.map(({ id, label }) => (
        <OptionTile
          key={id}
          active={resolved === id}
          onClick={() => onChange(id)}
          title={label}
          preview={<img src={`/profile-icons/${id}.png`} width={36} height={36} alt="" style={{ objectFit: 'contain' }} />}
          label={label}
        />
      ))}
    </OptionGrid>
  )
}

// ── 로고 아이콘 피커 ──────────────────────────────────────────────────────────

export function LogoIconPicker({ svgValue, onSvg }: { svgValue: LogoAnyStyle; onSvg: (s: LogoAnyStyle) => void }) {
  return (
    <OptionGrid cols={5}>
      {NEW_LOGO_STYLES.map(s => (
        <OptionTile
          key={s.id}
          active={svgValue === s.id}
          onClick={() => onSvg(s.id)}
          title={s.desc}
          preview={<s.Component size={38} />}
          label={s.label}
        />
      ))}
    </OptionGrid>
  )
}

// ── 등락 색상 ────────────────────────────────────────────────────────────────

const PNL_PRESETS = [
  { id: 'default',   label: '기본',    upLight: '#F0507A', downLight: '#1A9EFF', upDark: '#FF7A97', downDark: '#4DBFFF' },
  { id: 'vivid',     label: '진한',    upLight: '#ef4444', downLight: '#3b82f6', upDark: '#f87171', downDark: '#60a5fa' },
  { id: 'us',        label: '미국식',  upLight: '#16a34a', downLight: '#dc2626', upDark: '#4ade80', downDark: '#f87171' },
  { id: 'warm',      label: '주황/보라', upLight: '#f97316', downLight: '#8b5cf6', upDark: '#fb923c', downDark: '#a78bfa' },
  { id: 'custom',    label: '직접선택', upLight: '', downLight: '', upDark: '', downDark: '' },
] as const

export function PnlColorPicker({ value, onChange }: { value: PnlColorConfig; onChange: (c: PnlColorConfig) => void }) {
  const isCustom = value.preset === 'custom'

  const selectPreset = (id: string) => {
    const p = PNL_PRESETS.find(x => x.id === id)
    if (!p) return
    if (p.id === 'custom') {
      onChange({ ...value, preset: 'custom' })
    } else {
      onChange({ preset: p.id, upLight: p.upLight, downLight: p.downLight, upDark: p.upDark, downDark: p.downDark })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Segmented
          value={value.preset}
          onChange={selectPreset}
          options={PNL_PRESETS.map(p => ({ value: p.id, label: p.label }))}
        />
        <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
          <span style={{ color: value.upLight }}>▲3.45%</span>
          <span style={{ color: value.downLight }}>▼2.10%</span>
        </span>
      </div>

      {isCustom && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '상승 (라이트)', key: 'upLight' as const },
            { label: '하락 (라이트)', key: 'downLight' as const },
            { label: '상승 (다크)',   key: 'upDark'   as const },
            { label: '하락 (다크)',   key: 'downDark'  as const },
          ].map(({ label, key }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-ink-2">
              <input
                type="color"
                value={value[key] || '#888888'}
                onChange={e => onChange({ ...value, [key]: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-ink-5 p-0.5 bg-white dark:bg-zinc-800"
              />
              {label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 배경 피커 ─────────────────────────────────────────────────────────────────

const BG_TYPES: { id: BgType; label: string }[] = [
  { id: 'none',     label: '없음'   },
  { id: 'solid',    label: '단색'   },
  { id: 'gradient', label: '그라디언트' },
  { id: 'dot',      label: '도트'   },
  { id: 'grid',     label: '격자'   },
  { id: 'line',     label: '줄무늬' },
  { id: 'diagonal', label: '사선'   },
  { id: 'cross',    label: '크로스' },
]

const GRADIENT_DIRS: { dir: GradientDir; symbol: string }[] = [
  { dir: '90deg',  symbol: '→' },
  { dir: '135deg', symbol: '↘' },
  { dir: '180deg', symbol: '↓' },
  { dir: '225deg', symbol: '↙' },
  { dir: '45deg',  symbol: '↗' },
  { dir: '0deg',   symbol: '↑' },
]

function BgPreviewSwatch({ cfg, size = 40 }: { cfg: BgConfig; size?: number }) {
  if (cfg.type === 'solid') {
    return (
      <div
        className="rounded border border-ink-5"
        style={{ width: size, height: size, backgroundColor: cfg.solidColor || '#f8fafc' }}
      />
    )
  }
  if (cfg.type === 'gradient') {
    return (
      <div
        className="rounded border border-ink-5"
        style={{
          width: size, height: size,
          backgroundImage: `linear-gradient(${cfg.gradientDir || '135deg'}, ${cfg.gradientFrom || '#e0f2fe'}, ${cfg.gradientTo || '#fdf4ff'})`,
        }}
      />
    )
  }
  const { backgroundImage, backgroundSize } = getBgStyle(cfg)
  return (
    <div
      className="rounded border border-ink-5 bg-white dark:bg-zinc-900"
      style={{ width: size, height: size, backgroundImage, backgroundSize }}
    />
  )
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-ink-3 w-20 flex-shrink-0">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color" value={value}
          onChange={e => onChange(e.target.value)}
          className="w-9 h-8 rounded border border-ink-5 cursor-pointer p-0.5 bg-transparent"
        />
        <span className="text-xs text-ink-4 font-mono">{value}</span>
      </div>
    </div>
  )
}

export function BackgroundPicker({ value, onChange }: { value: BgConfig; onChange: (cfg: BgConfig) => void }) {
  const update = (partial: Partial<BgConfig>) => onChange({ ...value, ...partial })
  const isPattern = !['none', 'solid', 'gradient'].includes(value.type)

  return (
    <div className="space-y-4">
      {/* 유형 선택 */}
      <div>
        <OptionGrid>
          {BG_TYPES.map(bt => (
            <OptionTile
              key={bt.id}
              active={value.type === bt.id}
              onClick={() => update({ type: bt.id })}
              preview={<BgPreviewSwatch cfg={{ ...value, type: bt.id }} size={32} />}
              label={bt.label}
            />
          ))}
        </OptionGrid>
      </div>

      {/* 단색 옵션 */}
      {value.type === 'solid' && (
        <div className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl">
          <ColorInput label="배경 색상" value={value.solidColor || '#f8fafc'} onChange={v => update({ solidColor: v })} />
        </div>
      )}

      {/* 그라디언트 옵션 */}
      {value.type === 'gradient' && (
        <div className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl">
          <ColorInput label="시작 색상" value={value.gradientFrom || '#e0f2fe'} onChange={v => update({ gradientFrom: v })} />
          <ColorInput label="종료 색상" value={value.gradientTo || '#fdf4ff'} onChange={v => update({ gradientTo: v })} />
          <Segmented<GradientDir>
            value={value.gradientDir ?? '135deg'}
            onChange={d => update({ gradientDir: d })}
            options={GRADIENT_DIRS.map(gd => ({ value: gd.dir, label: gd.symbol }))}
          />
        </div>
      )}

      {isPattern && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-ink-3 w-20 flex-shrink-0">무늬 색상</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value.patternColor}
                onChange={e => update({ patternColor: e.target.value })}
                className="w-9 h-8 rounded border border-ink-5 cursor-pointer p-0.5 bg-transparent"
              />
              <span className="text-xs text-ink-4 font-mono">{value.patternColor}</span>
            </div>
          </div>
          <RangeField label="크기" min={10} max={60} step={2} value={value.size} onChange={v => update({ size: v })} display={`${value.size}px`} labelWidth={80} />
          <RangeField label="불투명도" min={5} max={100} step={5} value={value.opacity} onChange={v => update({ opacity: v })} display={`${value.opacity}%`} labelWidth={80} />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const DAYS = ['월', '화', '수', '목', '금', '토', '일']
const HOURS = Array.from({ length: 19 }, (_, i) => i + 5)  // 05~23시

export type Schedule = Record<string, number[]>

function isActive(schedule: Schedule, day: number, hour: number): boolean {
  return (schedule[String(day)] ?? []).includes(hour)
}

function toggleCell(schedule: Schedule, day: number, hour: number): Schedule {
  const hours = schedule[String(day)] ?? []
  const next = hours.includes(hour)
    ? hours.filter((h) => h !== hour)
    : [...hours, hour].sort((a, b) => a - b)
  return { ...schedule, [String(day)]: next }
}

// ── ScheduleGrid ─────────────────────────────────────────────────────────────

interface ScheduleGridProps {
  label: string
  scheduleKey: string
  schedule: Schedule
  onChange: (key: string, val: Schedule) => void
  dragState: React.MutableRefObject<{ active: boolean; day: number; hour: number; setTo: boolean } | null>
}

export function ScheduleGrid({ label, scheduleKey, schedule, onChange, dragState }: ScheduleGridProps) {
  const handleMouseDown = (day: number, hour: number) => {
    const setTo = !isActive(schedule, day, hour)
    dragState.current = { active: true, day, hour, setTo }
    onChange(scheduleKey, toggleCell(schedule, day, hour))
  }

  const handleMouseEnter = (day: number, hour: number) => {
    if (!dragState.current?.active) return
    const { setTo } = dragState.current
    const currently = isActive(schedule, day, hour)
    if (currently !== setTo) {
      onChange(scheduleKey, toggleCell(schedule, day, hour))
    }
  }

  const toggleDay = (day: number) => {
    const hours = (schedule[String(day)] ?? []).filter(h => HOURS.includes(h))
    const next = hours.length === HOURS.length ? [] : HOURS
    onChange(scheduleKey, { ...schedule, [String(day)]: next })
  }

  const toggleHour = (hour: number) => {
    const allActive = DAYS.every((_, d) => isActive(schedule, d, hour))
    const next: Schedule = { ...schedule }
    for (let d = 0; d < 7; d++) {
      const hours = next[String(d)] ?? []
      if (allActive) {
        next[String(d)] = hours.filter((h) => h !== hour)
      } else if (!hours.includes(hour)) {
        next[String(d)] = [...hours, hour].sort((a, b) => a - b)
      }
    }
    onChange(scheduleKey, next)
  }

  const activeCount = DAYS.reduce((sum, _, d) => sum + (schedule[String(d)]?.filter(h => HOURS.includes(h)).length ?? 0), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-ink-1">{label}</span>
        <span className="text-2xs text-ink-4">{activeCount}시간/주 활성</span>
      </div>
      <div
        className="overflow-x-auto select-none"
        onMouseUp={() => { if (dragState.current) dragState.current.active = false }}
        onMouseLeave={() => { if (dragState.current) dragState.current.active = false }}
      >
        <table className="text-center border-collapse" style={{ minWidth: 400 }}>
          <thead>
            <tr>
              <th className="w-8 text-2xs text-ink-4 font-normal pr-1">시</th>
              {DAYS.map((d, i) => (
                <th key={i} className="pb-1 px-0.5">
                  <button
                    onClick={() => toggleDay(i)}
                    className={`w-8 h-6 rounded text-2xs font-medium transition-colors ${
                      (schedule[String(i)]?.length ?? 0) === 24
                        ? 'bg-accent text-white'
                        : (schedule[String(i)]?.length ?? 0) > 0
                        ? 'bg-accent/20 text-accent'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-ink-3'
                    }`}
                  >
                    {d}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((hour) => {
              const allActive = DAYS.every((_, d) => isActive(schedule, d, hour))
              return (
                <tr key={hour}>
                  <td className="pr-1.5 text-right">
                    <button
                      onClick={() => toggleHour(hour)}
                      className={`text-2xs tabular-nums leading-none transition-colors ${allActive ? 'text-accent font-semibold' : 'text-ink-4 hover:text-ink-2'}`}
                    >
                      {String(hour).padStart(2, '0')}
                    </button>
                  </td>
                  {DAYS.map((_, day) => {
                    const active = isActive(schedule, day, hour)
                    return (
                      <td key={day} className="px-0.5 py-0.5">
                        <div
                          onMouseDown={() => handleMouseDown(day, hour)}
                          onMouseEnter={() => handleMouseEnter(day, hour)}
                          className={`w-8 h-4 rounded-sm cursor-pointer transition-colors ${
                            active
                              ? 'bg-accent'
                              : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                          }`}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-ink-4 mt-1.5">셀 클릭 또는 드래그로 활성 시간대 선택 · 요일/시간 헤더 클릭으로 행/열 전체 토글</p>
    </div>
  )
}

// ── UI 라디우스 ───────────────────────────────────────────────────────────────

const RADIUS_OPTIONS: { id: UiRadius; label: string; value: string; desc: string }[] = [
  { id: 'none', label: '각진',  value: '0rem',    desc: '0px' },
  { id: 'sm',   label: '약간',  value: '0.25rem', desc: '4px' },
  { id: 'md',   label: '보통',  value: '0.5rem',  desc: '8px' },
  { id: 'lg',   label: '기본',  value: '0.75rem', desc: '12px' },
  { id: 'xl',   label: '둥글',  value: '1.25rem', desc: '20px' },
]

export function RadiusPicker({ value, onChange }: { value: UiRadius; onChange: (r: UiRadius) => void }) {
  return (
    <Segmented
      value={value}
      onChange={r => { applyUiRadius(r); onChange(r) }}
      options={RADIUS_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
    />
  )
}

// ── 메뉴 방식 선택기 ──────────────────────────────────────────────────────────

export function NavModePicker({ value, onChange }: { value: 'top' | 'sidebar'; onChange: (mode: 'top' | 'sidebar') => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: 'top',     label: '상단 메뉴',   icon: <PanelTop size={14} /> },
        { value: 'sidebar', label: '좌측 사이드바', icon: <PanelLeft size={14} /> },
      ]}
    />
  )
}

// ── 오버레이 스타일 픽커 ──────────────────────────────────────────────────────

export function OverlayStylePicker({ value, onChange }: { value: OverlayStyle; onChange: (s: OverlayStyle) => void }) {
  return (
    <Segmented<OverlayStyle>
      value={value}
      onChange={onChange}
      options={OVERLAY_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
    />
  )
}

// ── 날씨 아이콘 스타일 피커 ───────────────────────────────────────────────────

export function WeatherIconStylePicker({ value, onChange }: { value: WeatherIconStyle; onChange: (id: WeatherIconStyle) => void }) {
  function handleSelect(id: WeatherIconStyle) {
    saveWeatherIconStyle(id)
    onChange(id)
  }

  return (
    <OptionGrid>
      {WEATHER_ICON_STYLES.map(style => (
        <OptionTile
          key={style.id}
          row
          active={value === style.id}
          onClick={() => handleSelect(style.id)}
          title={style.desc}
          preview={<WeatherBadge code={0} size={18} iconStyle={style.id} />}
          label={style.label}
        />
      ))}
    </OptionGrid>
  )
}

// ── 메모 색상 모드 픽커 ───────────────────────────────────────────────────────

export function MemoColorPicker({ value, onChange }: { value: 'pastel' | 'theme'; onChange: (m: 'pastel' | 'theme') => void }) {
  return (
    <Segmented<'pastel' | 'theme'>
      value={value}
      onChange={onChange}
      options={[
        { value: 'pastel', label: '파스텔' },
        { value: 'theme',  label: '테마 색상' },
      ]}
    />
  )
}

// ── 색상 테마(팔레트) 픽커 ────────────────────────────────────────────────────
// 포인트 색상 대체. 10팔레트가 accent 계열을 한 번에 구동(라이트/다크 개별 튜닝).
// 스와치는 현재 모드(다크/라이트)에 맞는 accent를 미리보기.

export function ThemePicker({ value, onChange }: { value: ColorTheme; onChange: (t: ColorTheme) => void }) {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2.5">
      {COLOR_THEMES.map(t => {
        const swatch = isDark ? t.dark : t.light
        const active = value === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            title={t.label}
            className="flex flex-col items-center gap-1 group"
          >
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
              style={{
                background: t.id === 'default'
                  ? `conic-gradient(${t.light}, ${t.dark}, ${t.light})`
                  : swatch,
                boxShadow: active
                  ? `0 0 0 2px var(--c-surface), 0 0 0 4px ${swatch}`
                  : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
              }}
            >
              {active && <Check size={15} className="text-white drop-shadow" strokeWidth={3} />}
            </span>
            <span className={`text-2xs leading-none ${active ? 'text-ink-1 font-semibold' : 'text-ink-3'}`}>{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── 푸터 배경 픽커 옵션 ───────────────────────────────────────────────────────

export const FOOTER_BG_OPTIONS = [
  {
    id: 'particle', label: '파티클', desc: '떨어지는 입자',
    preview: (
      <svg viewBox="0 0 60 44" className="w-full mb-1" style={{ height: 40 }}>
        {[[12,8],[28,14],[44,6],[8,26],[36,30],[52,20],[20,38],[48,38]].map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r={1.5} fill="currentColor" opacity={0.4+i*0.05}/>
        ))}
        {[[16,18],[32,22],[50,12]].map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r={1} fill="currentColor" opacity={0.25}/>
        ))}
      </svg>
    ),
  },
  {
    id: 'prism', label: '프리즘', desc: '크리스탈 패턴',
    preview: (
      <svg viewBox="0 0 60 44" className="w-full mb-1" style={{ height: 40 }}>
        {[[30,2,58,22,30,42],[30,2,30,42,2,22],[2,22,30,42,30,22],[30,22,58,22,30,42]].map((pts,i)=>(
          <polygon key={i} points={pts.reduce((a,v,j)=>j%2?a+','+v:a+(a?' ':'')+v,'')}
            fill="currentColor" opacity={0.06+i*0.06} stroke="currentColor" strokeWidth={0.6} strokeOpacity={0.2}/>
        ))}
      </svg>
    ),
  },
  {
    id: 'wire', label: '와이어', desc: '기하학적 선',
    preview: (
      <svg viewBox="0 0 60 44" className="w-full mb-1" style={{ height: 40 }}>
        <polygon points="30,3 52,16 52,31 30,44 8,31 8,16" fill="none" stroke="currentColor" strokeWidth={1} strokeOpacity={0.35}/>
        <polygon points="30,10 44,22 30,34 16,22" fill="none" stroke="currentColor" strokeWidth={0.8} strokeOpacity={0.5}/>
        <line x1="8" y1="16" x2="52" y2="31" stroke="currentColor" strokeWidth={0.6} strokeOpacity={0.2}/>
        <line x1="52" y1="16" x2="8" y2="31" stroke="currentColor" strokeWidth={0.6} strokeOpacity={0.2}/>
        {[[30,3],[52,16],[52,31],[30,44],[8,31],[8,16],[30,22]].map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r={1.4} fill="currentColor" opacity={0.55}/>
        ))}
      </svg>
    ),
  },
]

// ── 마퀴 표시형태/위치 미리보기 ───────────────────────────────────────────────

export const MARQUEE_TYPES = [
  {
    id: 'triple', label: '3단 (대·중·소)',
    preview: (
      <div className="space-y-1 w-full px-2">
        <div className="h-3 rounded" style={{ background: 'currentColor', opacity: 0.8 }} />
        <div className="h-2 rounded" style={{ background: 'currentColor', opacity: 0.5 }} />
        <div className="h-1.5 rounded" style={{ background: 'currentColor', opacity: 0.3 }} />
      </div>
    ),
  },
  {
    id: 'single', label: '한 줄 (소형)',
    preview: (
      <div className="w-full px-2 flex items-center" style={{ height: 28 }}>
        <div className="h-1.5 rounded w-full" style={{ background: 'currentColor', opacity: 0.5 }} />
      </div>
    ),
  },
]

export const MARQUEE_POSITIONS = [
  {
    id: 'top', label: '상단 (제목 아래)',
    preview: (
      <div className="w-full px-2 space-y-1" style={{ height: 36 }}>
        <div className="h-1.5 rounded w-3/4" style={{ background: 'currentColor', opacity: 0.7 }} />
        <div className="h-1 rounded w-1/2" style={{ background: 'currentColor', opacity: 0.4 }} />
      </div>
    ),
  },
  {
    id: 'bottom', label: '하단 (에디터노트 위)',
    preview: (
      <div className="w-full px-2 flex flex-col justify-end" style={{ height: 36 }}>
        <div className="h-1 rounded w-1/2 mb-0.5" style={{ background: 'currentColor', opacity: 0.4 }} />
        <div className="h-1.5 rounded w-3/4" style={{ background: 'currentColor', opacity: 0.7 }} />
      </div>
    ),
  },
]

export function marqueeSpeedLabel(s: number): string {
  if (s <= 30) return '매우 빠름'
  if (s <= 50) return '빠름'
  if (s <= 75) return '보통'
  if (s <= 100) return '느림'
  return '매우 느림'
}
