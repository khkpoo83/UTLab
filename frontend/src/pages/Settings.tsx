import React, { useContext, useEffect, useRef, useState } from 'react'
import {
  Settings2, Clock, CalendarDays, Sparkles, TrendingUp, Database, Palette, Shapes, Wallpaper, AlertCircle,
  User, Lock, Check, X, Calendar, RefreshCw, Unlink, ExternalLink, Wifi, WifiOff,
  PanelLeft, PanelTop, RectangleHorizontal, CloudSun,
} from 'lucide-react'
import { NavModeContext } from '../contexts'
import apiClient, { settingsApi, profileApi, authApi, calendarApi, UserProfile, AiUsageStats, CalendarStatus } from '../api/client'
import { Card } from '../components/Card'
import ProgressBar from '../components/ProgressBar'
import Logo, {
  LOGO_ICON_STYLES, LogoAnyStyle, getLogoIconStyle, setLogoIconStyle,
  NEW_LOGO_STYLES,
  PNG_LOGO_OPTIONS, PngLogoOption, getPngLogoOption, setPngLogoOption,
} from '../components/Logo'
import {
  BgConfig, BgType, GradientDir, loadBgConfig, saveBgConfig, getBgStyle, applyBackground,
} from '../utils/background'
import {
  WeatherIconStyle, WEATHER_ICON_STYLES, getWeatherIconStyle, saveWeatherIconStyle, WeatherBadge,
} from '../components/WeatherWidget'
import { FormInput } from '../components/FormField'
import { OverlayStyle, OVERLAY_OPTIONS, loadOverlayStyle, applyOverlayStyle } from '../utils/overlay'

// ── 프로필 아이콘 픽커 ────────────────────────────────────────────────────────

const VALID_PROFILE_ICONS = new Set([
  'person','technologist','scientist','teacher','cook',
  'mechanic','pilot','artist','astronaut','farmer','firefighter','judge',
])

const LEGACY_ICON_MAP: Record<string, string> = {
  user: 'person', briefcase: 'farmer', code: 'technologist', graduate: 'teacher',
  health: 'scientist', building: 'farmer', chef: 'cook', rocket: 'astronaut',
  lightbulb: 'artist', chart: 'farmer', home: 'person', piggybank: 'farmer',
  shield: 'judge', star: 'person', compass: 'pilot', globe: 'pilot',
  book: 'teacher', sparkles: 'artist',
}

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

function ProfileIconPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const resolved = VALID_PROFILE_ICONS.has(value) ? value : (LEGACY_ICON_MAP[value] ?? 'person')
  return (
    <div className="grid grid-cols-6 gap-2">
      {PROFILE_ICON_LIST.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          title={label}
          className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 transition-all ${
            resolved === id
              ? 'border-accent bg-zinc-50 dark:bg-zinc-800'
              : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-900'
          }`}
          style={resolved === id ? { borderColor: 'var(--c-accent)' } : {}}
        >
          <img src={`/profile-icons/${id}.png`} width={36} height={36} alt="" style={{ objectFit: 'contain' }} />
          <span className="text-2xs text-zinc-500 dark:text-zinc-400 leading-none">{label}</span>
        </button>
      ))}
    </div>
  )
}

/** 아이콘 ID → ReactNode 반환 (헤더 등 외부 사용) */
export function getProfileIconNode(id: string, size = 16): React.ReactNode {
  const resolved = VALID_PROFILE_ICONS.has(id) ? id : (LEGACY_ICON_MAP[id] ?? 'person')
  return (
    <img
      src={`/profile-icons/${resolved}.png`}
      width={size} height={size}
      alt=""
      style={{ objectFit: 'contain', display: 'block', flexShrink: 0 }}
    />
  )
}

// ── 로고 아이콘 피커 ──────────────────────────────────────────────────────────

function LogoIconPicker({
  svgValue, pngValue,
  onSvg, onPng,
}: {
  svgValue: LogoAnyStyle
  pngValue: PngLogoOption | null
  onSvg: (s: LogoAnyStyle) => void
  onPng: (opt: PngLogoOption | null) => void
}) {
  const isPng = pngValue !== null
  const w1392Opts = PNG_LOGO_OPTIONS.filter(o => o.src === 'w1392')
  const w1403Opts = PNG_LOGO_OPTIONS.filter(o => o.src === 'w1403')

  function PngCell({ opt }: { opt: PngLogoOption }) {
    const active = isPng && pngValue?.filterId === opt.filterId
    const imgSrc = opt.src === 'w1392' ? '/logo_width_1392.png' : '/logo_width_1403.png'
    return (
      <button
        onClick={() => onPng(opt)}
        title={opt.label}
        className={`flex flex-col items-center gap-1.5 py-2 px-1 rounded-xl border transition-all bg-white dark:bg-zinc-900 ${
          active ? 'border-2' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
        }`}
        style={active ? { borderColor: 'var(--c-accent)' } : {}}
      >
        <img
          src={imgSrc}
          alt=""
          style={{ width: 36, height: 36, objectFit: 'contain', filter: opt.filter === 'none' ? undefined : opt.filter }}
        />
        <span className="text-2xs text-zinc-500 dark:text-zinc-400 text-center leading-tight">
          {opt.label.split(' · ')[1]}
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-2xs text-zinc-400">로고 아이콘을 선택합니다.</p>

      {/* ── 신규 아이콘 ─────────────────────────────────────────────── */}
      <div>
        <p className="text-2xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">신규 아이콘</p>
        <div className="grid grid-cols-5 gap-2">
          {NEW_LOGO_STYLES.map(s => {
            const active = !isPng && svgValue === s.id
            return (
              <button
                key={s.id}
                onClick={() => { onPng(null); onSvg(s.id) }}
                className={`flex flex-col items-center gap-2 py-3 px-1 rounded-xl border transition-all bg-white dark:bg-zinc-900 ${
                  active ? 'border-2' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                }`}
                style={active ? { borderColor: 'var(--c-accent)' } : {}}
              >
                <s.Component size={44} />
                <span className="text-2xs font-medium text-zinc-600 dark:text-zinc-400 text-center leading-tight">
                  {s.label}<br />
                  <span className="text-zinc-400 dark:text-zinc-500 font-normal">{s.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 기존 그라디언트 SVG ─────────────────────────────────────── */}
      <div>
        <p className="text-2xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">그라디언트 SVG</p>
        <div className="grid grid-cols-5 gap-2">
          {LOGO_ICON_STYLES.map(s => (
            <button
              key={s.id}
              onClick={() => { onPng(null); onSvg(s.id) }}
              className={`flex flex-col items-center gap-2 py-3 px-1 rounded-xl border transition-all bg-white dark:bg-zinc-900 ${
                !isPng && svgValue === s.id ? 'border-2' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
              style={!isPng && svgValue === s.id ? { borderColor: 'var(--c-accent)' } : {}}
            >
              <Logo size="md" iconStyle={s.id} className="text-zinc-900 dark:text-zinc-100" />
              <span className="text-2xs font-medium text-zinc-600 dark:text-zinc-400 text-center leading-tight">
                {s.label}<br />
                <span className="text-zinc-400 dark:text-zinc-500 font-normal">{s.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── PNG ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-2xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">PNG 로고 A</p>
        <div className="grid grid-cols-4 gap-2">
          {w1392Opts.map(opt => <PngCell key={opt.filterId} opt={opt} />)}
        </div>
      </div>
      <div>
        <p className="text-2xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">PNG 로고 B</p>
        <div className="grid grid-cols-4 gap-2">
          {w1403Opts.map(opt => <PngCell key={opt.filterId} opt={opt} />)}
        </div>
      </div>
    </div>
  )
}

// ── 시즌 테마 피커 ────────────────────────────────────────────────────────────

type Season = 'default' | 'spring' | 'summer' | 'autumn' | 'winter' | 'mono'

const SEASONS: { id: Season; label: string; emoji: string; accent: string }[] = [
  { id: 'default', label: '기본',   emoji: '☁️',  accent: '#1A9EFF' },
  { id: 'spring',  label: '봄',     emoji: '🌸',  accent: '#D4608A' },
  { id: 'summer',  label: '여름',   emoji: '🌊',  accent: '#0891B2' },
  { id: 'autumn',  label: '가을',   emoji: '🍂',  accent: '#C2671A' },
  { id: 'winter',  label: '겨울',   emoji: '❄️',  accent: '#7C6FCF' },
  { id: 'mono',    label: '흑백',   emoji: '🖤',  accent: '#52525b' },
]

export function applySeasonTheme(season: Season) {
  const el = document.documentElement
  if (season === 'default') {
    el.removeAttribute('data-season')
  } else {
    el.setAttribute('data-season', season)
  }
  localStorage.setItem('season', season)
}

function SeasonThemePicker({ value, onChange }: { value: Season; onChange: (s: Season) => void }) {
  return (
    <div>
      <p className="text-2xs text-zinc-400 mb-3">앱 전체 강조 색상 테마를 선택합니다. 저장 후 적용됩니다.</p>
      <div className="grid grid-cols-6 gap-2">
        {SEASONS.map(s => (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all bg-white dark:bg-zinc-900 ${
              value === s.id
                ? 'border-2 bg-zinc-50 dark:bg-zinc-800'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
            }`}
            style={value === s.id ? { borderColor: s.accent } : {}}
          >
            <div className="w-6 h-6 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: s.accent }} />
            <span className="text-lg leading-none">{s.emoji}</span>
            <span className="text-2xs font-medium text-zinc-600 dark:text-zinc-400">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
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
type PnlPreset = typeof PNL_PRESETS[number]['id']

export interface PnlColorConfig {
  preset: PnlPreset
  upLight: string
  downLight: string
  upDark: string
  downDark: string
}

const DEFAULT_PNL_CONFIG: PnlColorConfig = {
  preset: 'default',
  upLight: '#F0507A', downLight: '#1A9EFF',
  upDark: '#FF7A97',  downDark: '#4DBFFF',
}

export function loadPnlColorConfig(): PnlColorConfig {
  try {
    const raw = localStorage.getItem('pnl_color_config')
    if (raw) return { ...DEFAULT_PNL_CONFIG, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_PNL_CONFIG }
}

export function applyPnlColors(cfg: PnlColorConfig) {
  const el = document.documentElement
  const isDark = el.classList.contains('dark')
  el.style.setProperty('--c-up',   isDark ? cfg.upDark   : cfg.upLight)
  el.style.setProperty('--c-down', isDark ? cfg.downDark : cfg.downLight)
  // dark/light 전환 시에도 올바른 색이 나오도록 data attribute에 저장
  el.setAttribute('data-pnl-up-light',   cfg.upLight)
  el.setAttribute('data-pnl-down-light', cfg.downLight)
  el.setAttribute('data-pnl-up-dark',    cfg.upDark)
  el.setAttribute('data-pnl-down-dark',  cfg.downDark)
  localStorage.setItem('pnl_color_config', JSON.stringify(cfg))
}

function PnlColorPicker({ value, onChange }: { value: PnlColorConfig; onChange: (c: PnlColorConfig) => void }) {
  const isCustom = value.preset === 'custom'

  const selectPreset = (p: typeof PNL_PRESETS[number]) => {
    if (p.id === 'custom') {
      onChange({ ...value, preset: 'custom' })
    } else {
      onChange({ preset: p.id, upLight: p.upLight, downLight: p.downLight, upDark: p.upDark, downDark: p.downDark })
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-2xs text-zinc-400">상승/하락 표시 색상을 변경합니다. 저장 후 적용됩니다.</p>

      {/* 프리셋 */}
      <div className="flex flex-wrap gap-2">
        {PNL_PRESETS.map(p => {
          const active = value.preset === p.id
          return (
            <button
              key={p.id}
              onClick={() => selectPreset(p)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                active
                  ? 'border-2 bg-zinc-50 dark:bg-zinc-800'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
              style={active ? { borderColor: p.id !== 'custom' ? p.upLight : '#71717a' } : {}}
            >
              {p.id !== 'custom' && (
                <span className="flex gap-1">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: p.upLight }} />
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: p.downLight }} />
                </span>
              )}
              <span className="text-zinc-700 dark:text-zinc-300">{p.label}</span>
            </button>
          )
        })}
      </div>

      {/* 미리보기 */}
      <div className="flex items-center gap-4 px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
        <span className="text-xs text-zinc-500">미리보기</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: value.upLight }}>▲ 3.45%</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: value.downLight }}>▼ 2.10%</span>
        <span className="text-2xs text-zinc-400">(라이트 기준)</span>
      </div>

      {/* 직접 선택 — custom 프리셋일 때만 표시 */}
      {isCustom && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '상승 (라이트)', key: 'upLight' as const },
            { label: '하락 (라이트)', key: 'downLight' as const },
            { label: '상승 (다크)',   key: 'upDark'   as const },
            { label: '하락 (다크)',   key: 'downDark'  as const },
          ].map(({ label, key }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="color"
                value={value[key] || '#888888'}
                onChange={e => onChange({ ...value, [key]: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border border-zinc-200 dark:border-zinc-700 p-0.5 bg-white dark:bg-zinc-800"
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

const GRADIENT_DIRS: { dir: GradientDir; label: string; symbol: string }[] = [
  { dir: '90deg',  label: '→',  symbol: '→' },
  { dir: '135deg', label: '↘',  symbol: '↘' },
  { dir: '180deg', label: '↓',  symbol: '↓' },
  { dir: '225deg', label: '↙',  symbol: '↙' },
  { dir: '45deg',  label: '↗',  symbol: '↗' },
  { dir: '0deg',   label: '↑',  symbol: '↑' },
]

function BgPreviewSwatch({ cfg, size = 40 }: { cfg: BgConfig; size?: number }) {
  if (cfg.type === 'solid') {
    return (
      <div
        className="rounded border border-zinc-200 dark:border-zinc-700"
        style={{ width: size, height: size, backgroundColor: cfg.solidColor || '#f8fafc' }}
      />
    )
  }
  if (cfg.type === 'gradient') {
    return (
      <div
        className="rounded border border-zinc-200 dark:border-zinc-700"
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
      className="rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
      style={{ width: size, height: size, backgroundImage, backgroundSize }}
    />
  )
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-zinc-500 w-20 flex-shrink-0">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color" value={value}
          onChange={e => onChange(e.target.value)}
          className="w-9 h-8 rounded border border-zinc-200 dark:border-zinc-700 cursor-pointer p-0.5 bg-transparent"
        />
        <span className="text-xs text-zinc-400 font-mono">{value}</span>
      </div>
    </div>
  )
}

function BackgroundPicker({ value, onChange }: { value: BgConfig; onChange: (cfg: BgConfig) => void }) {
  const update = (partial: Partial<BgConfig>) => onChange({ ...value, ...partial })
  const isPattern = !['none', 'solid', 'gradient'].includes(value.type)
  const canFixed = value.type !== 'none'

  return (
    <div className="space-y-4">
      <p className="text-2xs text-zinc-400">저장 후 적용됩니다.</p>

      {/* 유형 선택 */}
      <div>
        <label className="text-xs text-zinc-500 block mb-2">배경 유형</label>
        <div className="flex gap-2 flex-wrap">
          {BG_TYPES.map(bt => (
            <button
              key={bt.id}
              onClick={() => update({ type: bt.id })}
              className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border transition-all bg-white dark:bg-zinc-900 ${
                value.type === bt.id
                  ? 'border-2 bg-zinc-50 dark:bg-zinc-800'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
              style={value.type === bt.id ? { borderColor: 'var(--c-accent)' } : {}}
            >
              <BgPreviewSwatch cfg={{ ...value, type: bt.id }} size={32} />
              <span className="text-2xs font-medium text-zinc-600 dark:text-zinc-400">{bt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 단색 옵션 */}
      {value.type === 'solid' && (
        <div className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl">
          <ColorInput
            label="배경 색상"
            value={value.solidColor || '#f8fafc'}
            onChange={v => update({ solidColor: v })}
          />
          <div className="mt-2">
            <label className="text-xs text-zinc-500 block mb-1.5">미리보기</label>
            <BgPreviewSwatch cfg={value} size={80} />
          </div>
        </div>
      )}

      {/* 그라디언트 옵션 */}
      {value.type === 'gradient' && (
        <div className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl">
          <ColorInput
            label="시작 색상"
            value={value.gradientFrom || '#e0f2fe'}
            onChange={v => update({ gradientFrom: v })}
          />
          <ColorInput
            label="종료 색상"
            value={value.gradientTo || '#fdf4ff'}
            onChange={v => update({ gradientTo: v })}
          />
          <div>
            <label className="text-xs text-zinc-500 block mb-2">방향</label>
            <div className="flex gap-2">
              {GRADIENT_DIRS.map(gd => (
                <button
                  key={gd.dir}
                  onClick={() => update({ gradientDir: gd.dir })}
                  className={`w-9 h-9 rounded-lg border text-sm font-bold transition-all ${
                    value.gradientDir === gd.dir
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  {gd.symbol}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1.5">미리보기</label>
            <BgPreviewSwatch cfg={value} size={80} />
          </div>
        </div>
      )}

      {/* 패턴 옵션 */}
      {/* 배경 고정 (스크롤 시 배경 고정) */}
      {canFixed && (
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            className={`relative w-10 h-5 rounded-full transition-colors ${value.bgFixed ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'}`}
            onClick={() => update({ bgFixed: !value.bgFixed })}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value.bgFixed ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">배경 뷰포트 고정 (스크롤 시 배경 고정)</span>
        </label>
      )}

      {isPattern && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-zinc-500 w-20 flex-shrink-0">무늬 색상</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value.patternColor}
                onChange={e => update({ patternColor: e.target.value })}
                className="w-9 h-8 rounded border border-zinc-200 dark:border-zinc-700 cursor-pointer p-0.5 bg-transparent"
              />
              <span className="text-xs text-zinc-400 font-mono">{value.patternColor}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-zinc-500 w-20 flex-shrink-0">크기</label>
            <input type="range" min={10} max={60} step={2} value={value.size}
              onChange={e => update({ size: Number(e.target.value) })} className="flex-1" />
            <span className="text-xs text-zinc-400 w-10 text-right">{value.size}px</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-zinc-500 w-20 flex-shrink-0">불투명도</label>
            <input type="range" min={5} max={100} step={5} value={value.opacity}
              onChange={e => update({ opacity: Number(e.target.value) })} className="flex-1" />
            <span className="text-xs text-zinc-400 w-10 text-right">{value.opacity}%</span>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1.5">미리보기</label>
            <BgPreviewSwatch cfg={value} size={80} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const DAYS = ['월', '화', '수', '목', '금', '토', '일']
const HOURS = Array.from({ length: 19 }, (_, i) => i + 5)  // 05~23시

type Schedule = Record<string, number[]>

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

function ScheduleGrid({ label, scheduleKey, schedule, onChange, dragState }: ScheduleGridProps) {
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
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="text-2xs text-zinc-400">{activeCount}시간/주 활성</span>
      </div>
      <div
        className="overflow-x-auto select-none"
        onMouseUp={() => { if (dragState.current) dragState.current.active = false }}
        onMouseLeave={() => { if (dragState.current) dragState.current.active = false }}
      >
        <table className="text-center border-collapse" style={{ minWidth: 400 }}>
          <thead>
            <tr>
              <th className="w-8 text-2xs text-zinc-400 font-normal pr-1">시</th>
              {DAYS.map((d, i) => (
                <th key={i} className="pb-1 px-0.5">
                  <button
                    onClick={() => toggleDay(i)}
                    className={`w-8 h-6 rounded text-2xs font-medium transition-colors ${
                      (schedule[String(i)]?.length ?? 0) === 24
                        ? 'bg-accent text-white'
                        : (schedule[String(i)]?.length ?? 0) > 0
                        ? 'bg-accent/20 text-accent'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
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
                      className={`text-2xs tabular-nums leading-none transition-colors ${allActive ? 'text-accent font-semibold' : 'text-zinc-400 hover:text-zinc-600'}`}
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
      <p className="text-2xs text-zinc-400 mt-1.5">셀 클릭 또는 드래그로 활성 시간대 선택 · 요일/시간 헤더 클릭으로 행/열 전체 토글</p>
    </div>
  )
}

// ── UI 라디우스 ───────────────────────────────────────────────────────────────

export type UiRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl'

const RADIUS_OPTIONS: { id: UiRadius; label: string; value: string; desc: string }[] = [
  { id: 'none', label: '각진',  value: '0rem',    desc: '0px' },
  { id: 'sm',   label: '약간',  value: '0.25rem', desc: '4px' },
  { id: 'md',   label: '보통',  value: '0.5rem',  desc: '8px' },
  { id: 'lg',   label: '기본',  value: '0.75rem', desc: '12px' },
  { id: 'xl',   label: '둥글',  value: '1.25rem', desc: '20px' },
]

export function getUiRadius(): UiRadius {
  return (localStorage.getItem('ui_radius') as UiRadius) ?? 'lg'
}

export function applyUiRadius(r: UiRadius) {
  const opt = RADIUS_OPTIONS.find(o => o.id === r) ?? RADIUS_OPTIONS[3]
  document.documentElement.style.setProperty('--ui-radius', opt.value)
  localStorage.setItem('ui_radius', r)
}

export function getCardOpacity(): number {
  return parseFloat(localStorage.getItem('card_opacity') ?? '1')
}

export function applyCardOpacity(v: number) {
  document.documentElement.style.setProperty('--card-opacity', String(v))
  localStorage.setItem('card_opacity', String(v))
}

function RadiusPicker({ value, onChange }: { value: UiRadius; onChange: (r: UiRadius) => void }) {
  const handleChange = (r: UiRadius) => {
    applyUiRadius(r)
    onChange(r)
  }

  return (
    <div className="flex gap-2">
      {RADIUS_OPTIONS.map(opt => {
        const active = value === opt.id
        const previewR = opt.value === '0rem' ? '0px' : opt.value
        return (
          <button
            key={opt.id}
            onClick={() => handleChange(opt.id)}
            className={`flex-1 flex flex-col items-center gap-2 py-3 border-2 transition-all ${
              active
                ? 'border-accent bg-accent/5'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
            }`}
            style={{
              borderRadius: opt.value,
              ...(active ? { borderColor: 'var(--c-accent)' } : {}),
            }}
            title={opt.desc}
          >
            {/* 미리보기 사각형 */}
            <div
              className={`w-8 h-8 border-2 ${active ? 'border-accent bg-accent/10' : 'border-zinc-300 dark:border-zinc-600'}`}
              style={{ borderRadius: previewR }}
            />
            <div className="text-center">
              <div className={`text-xs font-medium ${active ? 'text-accent' : 'text-zinc-600 dark:text-zinc-400'}`}>
                {opt.label}
              </div>
              <div className="text-[10px] text-zinc-400">{opt.desc}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── 메뉴 방식 선택기 ──────────────────────────────────────────────────────────

function NavModePicker() {
  const { navMode, setNavMode } = useContext(NavModeContext)

  const options: { id: 'top' | 'sidebar'; label: string; desc: string; Icon: React.ElementType }[] = [
    { id: 'top',     label: '상단 메뉴',   desc: '그룹 탭 + 서브탭 방식', Icon: PanelTop  },
    { id: 'sidebar', label: '좌측 사이드바', desc: '모던 사이드 네비게이션', Icon: PanelLeft },
  ]

  const handleChange = (mode: 'top' | 'sidebar') => {
    setNavMode(mode)
    apiClient.put('/api/settings', { settings: { ui_nav_mode: mode } }).catch(() => {})
    window.dispatchEvent(new CustomEvent('navModeChange', { detail: { mode } }))
  }

  return (
    <div className="flex gap-3">
      {options.map(opt => (
        <button
          key={opt.id}
          onClick={() => handleChange(opt.id)}
          className={`flex-1 flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all ${
            navMode === opt.id
              ? 'border-accent bg-accent/5'
              : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
          }`}
          style={navMode === opt.id ? { borderColor: 'var(--c-accent)' } : {}}
        >
          <opt.Icon size={22} className={navMode === opt.id ? 'text-accent' : 'text-zinc-400'} />
          <div className="text-center">
            <div className={`text-sm font-medium ${navMode === opt.id ? 'text-accent' : 'text-zinc-700 dark:text-zinc-200'}`}>
              {opt.label}
            </div>
            <div className="text-xs text-zinc-400 mt-0.5">{opt.desc}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

// ── 오버레이 스타일 픽커 ──────────────────────────────────────────────────────

function OverlayStylePicker({ value, onChange }: { value: OverlayStyle; onChange: (s: OverlayStyle) => void }) {
  const PREVIEWS: Record<OverlayStyle, { bg: string; label: string }> = {
    both:    { bg: 'rgba(0,0,0,0.5)',     label: '반투명 + 블러' },
    dim:     { bg: 'rgba(0,0,0,0.5)',     label: '반투명 음영' },
    blur:    { bg: 'rgba(0,0,0,0.15)',    label: '밝은 + 블러' },
    frosted: { bg: 'rgba(200,200,200,0.3)', label: '프로스트' },
    none:    { bg: 'transparent',         label: '없음' },
  }

  return (
    <div className="space-y-3">
      <p className="text-2xs text-zinc-400">모달·슬라이드 패널 열릴 때 배경 처리 방식입니다.</p>
      <div className="flex gap-2 flex-wrap">
        {OVERLAY_OPTIONS.map(opt => {
          const active = value === opt.id
          const prev = PREVIEWS[opt.id]
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              className={`flex flex-col items-center gap-2 px-3 py-3 rounded-xl border-2 transition-all bg-white dark:bg-zinc-900 ${
                active
                  ? 'bg-zinc-50 dark:bg-zinc-800'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
              style={active ? { borderColor: 'var(--c-accent)' } : {}}
            >
              {/* 미리보기 */}
              <div className="w-10 h-8 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 relative">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-200 to-pink-200" />
                <div className="absolute inset-0" style={{ background: prev.bg }} />
              </div>
              <span className={`text-xs font-medium ${active ? 'text-accent' : 'text-zinc-600 dark:text-zinc-400'}`}>{opt.label}</span>
              <span className="text-[10px] text-zinc-400">{opt.desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── 날씨 아이콘 스타일 피커 ───────────────────────────────────────────────────

// 미리보기에 사용할 WMO 코드: 맑음/구름조금/비/눈
const ICON_PREVIEW_CODES = [0, 2, 61, 71]

function WeatherIconStylePicker() {
  const [active, setActive] = useState<WeatherIconStyle>(getWeatherIconStyle)

  function handleSelect(id: WeatherIconStyle) {
    saveWeatherIconStyle(id)
    setActive(id)
  }

  return (
    <div className="space-y-3">
      <p className="text-2xs text-zinc-400">날씨 위젯 아이콘 스타일을 선택합니다. 즉시 적용됩니다.</p>
      <div className="grid grid-cols-3 gap-2">
        {WEATHER_ICON_STYLES.map(style => (
          <button
            key={style.id}
            onClick={() => handleSelect(style.id)}
            className={`flex flex-col items-center gap-2 py-3 px-2 rounded-xl border-2 transition-all bg-white dark:bg-zinc-900 ${
              active === style.id
                ? 'bg-zinc-50 dark:bg-zinc-800'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
            }`}
            style={active === style.id ? { borderColor: 'var(--c-accent)' } : {}}
          >
            <div className="flex gap-1.5 items-center justify-center">
              {ICON_PREVIEW_CODES.map(code => (
                <WeatherBadge key={code} code={code} size={26} iconStyle={style.id} />
              ))}
            </div>
            <span className={`text-xs font-medium leading-tight ${active === style.id ? 'text-accent' : 'text-zinc-700 dark:text-zinc-300'}`}>
              {style.label}
            </span>
            <span className="text-[10px] text-zinc-400 leading-tight text-center">{style.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [aiUsage, setAiUsage] = useState<AiUsageStats | null>(null)
  const dragState = useRef<{ active: boolean; day: number; hour: number; setTo: boolean } | null>(null)
  const aiPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 시각 설정 — 저장 전까지 pending 상태, 적용되지 않음
  const [pendingSeason, setPendingSeason] = useState<Season>(() => (localStorage.getItem('season') as Season) ?? 'default')
  const [pendingLogoIcon, setPendingLogoIcon] = useState<LogoAnyStyle>(getLogoIconStyle)
  const [pendingPngLogo, setPendingPngLogo] = useState<PngLogoOption | null>(getPngLogoOption)
  const [pendingBg, setPendingBg] = useState<BgConfig>(loadBgConfig)
  const [pendingPnlColor, setPendingPnlColor] = useState<PnlColorConfig>(loadPnlColorConfig)
  const [pendingRadius, setPendingRadius] = useState<UiRadius>(getUiRadius)
  const [pendingOverlay, setPendingOverlay] = useState<OverlayStyle>(loadOverlayStyle)
  const [pendingCardOpacity, setPendingCardOpacity] = useState<number>(getCardOpacity)

  // 프로필 상태
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileDirty, setProfileDirty] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  // 비밀번호 변경 상태
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 구글 캘린더 상태
  const [calStatus, setCalStatus] = useState<CalendarStatus | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calMsg, setCalMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    settingsApi.get().then(({ data }) => {
      setSettings(data)
      if (data.ui_radius) setPendingRadius(data.ui_radius as UiRadius)
      if (data.ui_overlay_style) setPendingOverlay(data.ui_overlay_style as OverlayStyle)
      if (data.ui_card_opacity != null) setPendingCardOpacity(data.ui_card_opacity as number)
      setLoading(false)
    }).catch(() => setLoading(false))

    profileApi.get().then(p => setProfile(p)).catch(() => {})

    calendarApi.status().then(s => setCalStatus(s)).catch(() => {})

    const fetchAiUsage = () => {
      settingsApi.aiUsage().then(({ data }) => setAiUsage(data)).catch(() => {})
    }
    fetchAiUsage()
    aiPollRef.current = setInterval(fetchAiUsage, 10000)
    return () => { if (aiPollRef.current) clearInterval(aiPollRef.current) }
  }, [])

  const updateProfile = (patch: Partial<UserProfile>) => {
    setProfile(prev => prev ? { ...prev, ...patch } : prev)
    setProfileDirty(true)
    setProfileSaved(false)
  }

  const handleProfileSave = async () => {
    if (!profile) return
    setProfileSaving(true)
    try {
      const updated = await profileApi.update({
        display_name: profile.display_name,
        birth_date: profile.birth_date,
        profile_icon: profile.profile_icon,
        job: profile.job,
        retire_age: profile.retire_age,
        monthly_income_만: profile.monthly_income_만,
      })
      setProfile(updated)
      // 헤더 아이콘 갱신을 위해 localStorage에 캐시
      localStorage.setItem('profileIcon', updated.profile_icon)
      window.dispatchEvent(new Event('profileIconChange'))
      setProfileDirty(false)
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch {
      // ignore
    } finally {
      setProfileSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (pwNew !== pwConfirm) {
      setPwMsg({ ok: false, text: '새 비밀번호가 일치하지 않습니다.' })
      return
    }
    if (pwNew.length < 6) {
      setPwMsg({ ok: false, text: '비밀번호는 6자 이상이어야 합니다.' })
      return
    }
    setPwSaving(true)
    setPwMsg(null)
    try {
      await authApi.changePassword(pwCurrent, pwNew)
      setPwMsg({ ok: true, text: '비밀번호가 변경되었습니다.' })
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? '오류가 발생했습니다.'
      setPwMsg({ ok: false, text: detail })
    } finally {
      setPwSaving(false)
    }
  }

  const handleCalConnect = async () => {
    setCalLoading(true)
    setCalMsg(null)
    try {
      const { auth_url } = await calendarApi.connect()
      window.location.href = auth_url
    } catch {
      setCalMsg({ ok: false, text: '연결 URL 생성에 실패했습니다. 서버 환경변수를 확인하세요.' })
      setCalLoading(false)
    }
  }

  const handleCalDisconnect = async () => {
    if (!window.confirm('Google Calendar 연결을 해제하면 동기화된 일정이 모두 삭제됩니다. 계속하시겠습니까?')) return
    setCalLoading(true)
    setCalMsg(null)
    try {
      await calendarApi.disconnect()
      setCalStatus(null)
      setCalMsg({ ok: true, text: '연결이 해제되었습니다.' })
    } catch {
      setCalMsg({ ok: false, text: '연결 해제 중 오류가 발생했습니다.' })
    } finally {
      setCalLoading(false)
    }
  }

  const handleCalSync = async () => {
    setCalLoading(true)
    setCalMsg(null)
    try {
      const res = await calendarApi.sync()
      setCalMsg({ ok: true, text: res.message })
      calendarApi.status().then(s => setCalStatus(s)).catch(() => {})
    } catch {
      setCalMsg({ ok: false, text: '동기화 중 오류가 발생했습니다.' })
    } finally {
      setCalLoading(false)
    }
  }

  const handleCalRegisterWatch = async () => {
    setCalLoading(true)
    setCalMsg(null)
    try {
      const res = await calendarApi.registerWatch()
      setCalMsg({ ok: res.push_enabled, text: res.message })
      calendarApi.status().then(s => setCalStatus(s)).catch(() => {})
    } catch {
      setCalMsg({ ok: false, text: 'Push 채널 등록 중 오류가 발생했습니다.' })
    } finally {
      setCalLoading(false)
    }
  }

  const update = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
    setSaved(false)
  }

  const updateSeason = (s: Season) => { setPendingSeason(s); setDirty(true); setSaved(false) }
  const updateLogoIcon = (s: LogoAnyStyle) => { setPendingLogoIcon(s); setDirty(true); setSaved(false) }
  const updatePngLogo = (opt: PngLogoOption | null) => { setPendingPngLogo(opt); setDirty(true); setSaved(false) }
  const updateBg = (cfg: BgConfig) => { setPendingBg(cfg); setDirty(true); setSaved(false) }
  const updatePnlColor = (cfg: PnlColorConfig) => { setPendingPnlColor(cfg); setDirty(true); setSaved(false) }
  const updateRadius = (r: UiRadius) => { setPendingRadius(r); setDirty(true); setSaved(false) }
  const updateOverlay = (s: OverlayStyle) => { applyOverlayStyle(s); setPendingOverlay(s); setDirty(true); setSaved(false) }
  const updateCardOpacity = (v: number) => { applyCardOpacity(v); setPendingCardOpacity(v); setDirty(true); setSaved(false) }

  const handleSave = async () => {
    setSaving(true)
    try {
      // 시스템 설정 + UI 설정 한 번에 저장 (DB에 동기화)
      const { data } = await settingsApi.update({
        ...settings,
        ui_season: pendingSeason,
        ui_logo_icon: pendingLogoIcon,
        ui_pnl_color_config: pendingPnlColor,
        ui_bg_config: pendingBg,
        ui_radius: pendingRadius,
        ui_overlay_style: pendingOverlay,
        ui_card_opacity: pendingCardOpacity,
      })
      setSettings(data)
      // 시각 설정 일괄 적용 (localStorage + DOM)
      applySeasonTheme(pendingSeason)
      setLogoIconStyle(pendingLogoIcon)
      setPngLogoOption(pendingPngLogo)
      applyBackground(pendingBg)
      saveBgConfig(pendingBg)
      applyPnlColors(pendingPnlColor)
      applyUiRadius(pendingRadius)
      applyOverlayStyle(pendingOverlay)
      applyCardOpacity(pendingCardOpacity)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-zinc-400">설정 로딩 중...</div>

  const newsSchedule: Schedule = settings.news_schedule ?? {}

  return (
    <div className="w-full space-y-6">

      {/* 페이지 타이틀 */}
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shadow-sm">
          <Settings2 size={18} className="text-zinc-500 dark:text-zinc-400" />
        </div>
        <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">설정</h1>
      </div>

      {/* ── 내 프로필 ────────────────────────────────────────────── */}
      <Card collapsible id="settings-profile" icon={<User size={16} />} title="내 프로필" defaultOpen>
        {profile && (
          <div className="space-y-5">
            {/* 아이콘 + 이름 요약 */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-accent select-none">
                {getProfileIconNode(profile.profile_icon || 'user', 26)}
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {profile.display_name || '이름 미설정'}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {profile.age != null ? `만 ${profile.age}세` : '생년월일 미설정'}
                  {profile.job ? ` · ${profile.job}` : ''}
                </p>
              </div>
            </div>

            {/* 아이콘 선택 */}
            <div>
              <label className="text-xs text-zinc-500 block mb-2">프로필 아이콘</label>
              <ProfileIconPicker
                value={profile.profile_icon || '👤'}
                onChange={icon => updateProfile({ profile_icon: icon })}
              />
            </div>

            {/* 기본 정보 */}
            <div className="grid grid-cols-2 gap-4">
              <FormInput
                label="이름 (표시명)"
                type="text"
                placeholder="홍길동"
                value={profile.display_name ?? ''}
                onChange={e => updateProfile({ display_name: e.target.value || null })}
              />
              <FormInput
                label="직업"
                type="text"
                placeholder="직장인, 자영업, 프리랜서..."
                value={profile.job ?? ''}
                onChange={e => updateProfile({ job: e.target.value || null })}
              />
              <FormInput
                label="생년월일"
                type="date"
                value={profile.birth_date ?? ''}
                onChange={e => updateProfile({ birth_date: e.target.value || null })}
                hint={profile.age != null ? `만 ${profile.age}세` : undefined}
              />
              <FormInput
                label="목표 은퇴 나이"
                type="number"
                min={40} max={80}
                value={profile.retire_age ?? 60}
                onChange={e => updateProfile({ retire_age: parseInt(e.target.value) })}
              />
              <FormInput
                label="월 소득 (만원)"
                type="number"
                min={0} step={10}
                placeholder="500"
                value={profile.monthly_income_만 ?? ''}
                onChange={e => updateProfile({ monthly_income_만: e.target.value ? parseInt(e.target.value) : null })}
              />
            </div>

            <div className="notice notice-accent text-2xs">
              생년월일·은퇴 나이는 은퇴 플래너에서 자동으로 불러옵니다.
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleProfileSave}
                disabled={profileSaving || !profileDirty}
                className="px-5 py-2 text-white text-sm font-medium rounded-lg bg-accent hover:opacity-85 transition-all disabled:opacity-50"
              >
                {profileSaving ? '저장 중...' : '프로필 저장'}
              </button>
              {profileSaved && (
                <span className="flex items-center gap-1 text-xs text-accent font-medium">
                  <Check size={12} /> 저장되었습니다.
                </span>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── 비밀번호 변경 ─────────────────────────────────────────── */}
      <Card collapsible id="settings-password" icon={<Lock size={16} />} title="비밀번호 변경" defaultOpen={false}>
        <div className="space-y-4 max-w-sm">
          <FormInput
            label="현재 비밀번호"
            type="password"
            value={pwCurrent}
            onChange={e => setPwCurrent(e.target.value)}
          />
          <FormInput
            label="새 비밀번호 (6자 이상)"
            type="password"
            value={pwNew}
            onChange={e => setPwNew(e.target.value)}
          />
          <FormInput
            label="새 비밀번호 확인"
            type="password"
            value={pwConfirm}
            onChange={e => setPwConfirm(e.target.value)}
          />
          {pwMsg && (
            <div className={`flex items-center gap-1.5 text-xs font-medium ${pwMsg.ok ? 'text-accent' : 'text-red-500'}`}>
              {pwMsg.ok ? <Check size={13} /> : <X size={13} />}
              {pwMsg.text}
            </div>
          )}
          <button
            onClick={handleChangePassword}
            disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm}
            className="px-5 py-2 text-white text-sm font-medium rounded-lg bg-accent hover:opacity-85 transition-all disabled:opacity-50"
          >
            {pwSaving ? '변경 중...' : '비밀번호 변경'}
          </button>
        </div>
      </Card>

      {/* ── Google 캘린더 연동 ───────────────────────────────────── */}
      <Card collapsible id="settings-calendar" icon={<Calendar size={16} />} title="Google 캘린더 연동" defaultOpen={false}>
        <div className="space-y-4">
          {/* 연결 상태 표시 */}
          {calStatus?.connected ? (
            <>
              <div className="flex items-center gap-2">
                <Wifi size={14} className={`flex-shrink-0 ${calStatus.needs_reconnect ? 'text-amber-500' : 'text-green-500'}`} />
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{calStatus.google_email}</span>
                <span className={`tag text-xs ${calStatus.needs_reconnect ? 'tag-amber' : 'tag-tonal'}`}>
                  {calStatus.needs_reconnect ? '재연결 필요' : '연결됨'}
                </span>
              </div>
              {calStatus.needs_reconnect && (
                <div className="notice notice-amber text-xs">
                  Google 토큰이 만료되었습니다. 아래 버튼으로 다시 연결하면 일정 동기화가 재개됩니다.
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                  <p className="text-2xs text-zinc-400 mb-0.5">동기화 일정</p>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{calStatus.event_count}개</p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                  <p className="text-2xs text-zinc-400 mb-0.5">Push 알림</p>
                  <p className={`text-xs font-semibold ${calStatus.push_enabled ? 'text-green-600 dark:text-green-400' : 'text-zinc-400'}`}>
                    {calStatus.push_enabled ? '활성' : '폴링'}
                  </p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                  <p className="text-2xs text-zinc-400 mb-0.5">채널 만료</p>
                  <p className="text-2xs font-medium text-zinc-600 dark:text-zinc-400 leading-tight">
                    {calStatus.channel_expires
                      ? new Date(calStatus.channel_expires).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
                      : '—'}
                  </p>
                </div>
              </div>
              {!calStatus.push_enabled && (
                <div className="notice notice-amber text-xs">
                  Push 알림 채널이 비활성 상태입니다. GOOGLE_WEBHOOK_BASE_URL 환경변수가 설정되어 있으면
                  "채널 등록" 버튼을 눌러 재등록하세요. 현재는 30분마다 폴링으로 동기화됩니다.
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {calStatus.needs_reconnect ? (
                  <button
                    onClick={handleCalConnect}
                    disabled={calLoading}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:opacity-85 disabled:opacity-50 transition-all"
                  >
                    <ExternalLink size={13} />
                    {calLoading ? '연결 중...' : 'Google 재연결'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleCalSync}
                      disabled={calLoading}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:opacity-85 disabled:opacity-50 transition-all"
                    >
                      <RefreshCw size={13} className={calLoading ? 'animate-spin' : ''} />
                      전체 동기화
                    </button>
                    <button
                      onClick={handleCalRegisterWatch}
                      disabled={calLoading}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-all bg-white dark:bg-zinc-900"
                    >
                      <Wifi size={13} />
                      {calStatus.push_enabled ? 'Push 채널 갱신' : 'Push 채널 등록'}
                    </button>
                  </>
                )}
                <button
                  onClick={handleCalDisconnect}
                  disabled={calLoading}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-red-300 dark:border-red-700 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-all bg-white dark:bg-zinc-900"
                >
                  <Unlink size={13} />
                  연결 해제
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-zinc-400">
                <WifiOff size={14} />
                <span className="text-sm">Google Calendar가 연결되지 않았습니다.</span>
              </div>
              <div className="notice notice-zinc text-xs space-y-1">
                <p>연결하면 다른 기기에서 등록한 일정이 플래너에 자동으로 반영됩니다.</p>
                <p>서버에 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI 환경변수가 필요합니다.</p>
              </div>
              <button
                onClick={handleCalConnect}
                disabled={calLoading}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:opacity-85 disabled:opacity-50 transition-all"
              >
                <ExternalLink size={13} />
                {calLoading ? '연결 중...' : 'Google 계정으로 연결'}
              </button>
            </>
          )}
          {calMsg && (
            <div className={`flex items-center gap-1.5 text-xs font-medium ${calMsg.ok ? 'text-accent' : 'text-red-500'}`}>
              {calMsg.ok ? <Check size={13} /> : <X size={13} />}
              {calMsg.text}
            </div>
          )}
          <p className="text-2xs text-zinc-400">
            연결 후 Push 알림으로 다른 기기 변경사항이 수 초 내 플래너에 반영됩니다.
          </p>
        </div>
      </Card>

      {/* 미저장 변경사항 안내 */}
      {dirty && (
        <div className="notice notice-amber flex items-center gap-2">
          <AlertCircle size={14} className="flex-shrink-0" />
          <span>저장되지 않은 변경사항이 있습니다. 저장 버튼을 눌러야 적용됩니다.</span>
        </div>
      )}

      {/* 조회 인터벌 */}
      <Card collapsible id="settings-interval" icon={<Clock size={16} />} title="조회 인터벌">
        <div className="grid grid-cols-2 gap-4">
          <FormInput
            label="주식 조회 주기 (분)"
            type="number" min={5} max={60} step={5}
            value={settings.stock_interval_minutes ?? 15}
            onChange={(e) => update('stock_interval_minutes', parseInt(e.target.value))}
          />
          <FormInput
            label="뉴스 조회 주기 (시간)"
            type="number" min={1} max={24} step={1}
            value={settings.news_interval_hours ?? 1}
            onChange={(e) => update('news_interval_hours', parseInt(e.target.value))}
          />
        </div>
      </Card>

      {/* 뉴스 조회 스케줄 */}
      <Card collapsible id="settings-news-schedule" icon={<CalendarDays size={16} />} title="뉴스 조회 스케줄" defaultOpen={false}>
        <div className="space-y-3">
          <p className="text-2xs text-zinc-400">활성화된 요일/시간대에만 뉴스를 자동 수집합니다.</p>
          <ScheduleGrid
            label="뉴스 조회 활성 시간"
            scheduleKey="news_schedule"
            schedule={newsSchedule}
            onChange={update}
            dragState={dragState}
          />
        </div>
      </Card>

      {/* AI 서머리 설정 */}
      <Card collapsible id="settings-ai-summary" icon={<Sparkles size={16} />} title="AI 서머리 설정">
        <div className="grid grid-cols-3 gap-4">
          <FormInput
            label="요약 시작 시간 (시)"
            type="number" min={0} max={23}
            value={settings.ai_summary_start_hour ?? 8}
            onChange={(e) => update('ai_summary_start_hour', parseInt(e.target.value))}
          />
          <FormInput
            label="요약 종료 시간 (시)"
            type="number" min={0} max={23}
            value={settings.ai_summary_end_hour ?? 22}
            onChange={(e) => update('ai_summary_end_hour', parseInt(e.target.value))}
          />
          <FormInput
            label="회당 최대 요약 건수"
            type="number" min={1} max={50}
            value={settings.ai_summary_max_items ?? 20}
            onChange={(e) => update('ai_summary_max_items', parseInt(e.target.value))}
          />
        </div>
      </Card>

      {/* Gemini AI 사용량 */}
      <Card
        collapsible
        id="settings-ai-usage"
        icon={<TrendingUp size={16} />}
        title="Gemini AI 사용량"
        right={aiUsage && <span className="text-2xs text-zinc-400">{aiUsage.model}</span>}
      >
        {aiUsage ? (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-500">일 요청 (RPD)</span>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {aiUsage.rpd_used} / {aiUsage.rpd_limit}
                  <span className="text-zinc-400 font-normal ml-1">(남은 {aiUsage.rpd_remaining})</span>
                </span>
              </div>
              <ProgressBar
                value={Math.min(100, (aiUsage.rpd_used / aiUsage.rpd_limit) * 100)}
                height="md"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-500">현재 분당 요청 (RPM)</span>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {aiUsage.rpm_used} / {aiUsage.rpm_limit}
                  <span className="text-zinc-400 font-normal ml-1">(남은 {aiUsage.rpm_remaining})</span>
                </span>
              </div>
              <ProgressBar
                value={Math.min(100, (aiUsage.rpm_used / aiUsage.rpm_limit) * 100)}
                height="md"
              />
            </div>
            <div className="grid grid-cols-3 gap-3 pt-1">
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                <p className="text-2xs text-zinc-400 mb-0.5">입력 토큰 (오늘)</p>
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{aiUsage.tokens_in_today.toLocaleString()}</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                <p className="text-2xs text-zinc-400 mb-0.5">출력 토큰 (오늘)</p>
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{aiUsage.tokens_out_today.toLocaleString()}</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                <p className="text-2xs text-zinc-400 mb-0.5">누적 실패</p>
                <p className={`text-xs font-semibold ${aiUsage.failed_total > 0 ? 'text-red-500' : 'text-zinc-700 dark:text-zinc-300'}`}>
                  {aiUsage.failed_total}
                </p>
              </div>
            </div>
            <p className="text-2xs text-zinc-400">무료 티어 기준 · 일 요청은 자정에 초기화 · 10초마다 갱신</p>
          </div>
        ) : (
          <p className="text-xs text-zinc-400">로딩 중...</p>
        )}
      </Card>

      {/* 데이터 보관 */}
      <Card collapsible id="settings-retention" icon={<Database size={16} />} title="데이터 보관">
        <div className="max-w-xs">
          <FormInput
            label="뉴스 보관 기간 (일)"
            type="number" min={7} max={365}
            value={settings.news_retention_days ?? 30}
            onChange={(e) => update('news_retention_days', parseInt(e.target.value))}
          />
        </div>
      </Card>

      {/* 메뉴 방식 */}
      <Card collapsible id="settings-nav" icon={<PanelLeft size={16} />} title="메뉴 방식">
        <NavModePicker />
      </Card>

      {/* 모서리 둥글기 */}
      <Card collapsible id="settings-radius" icon={<RectangleHorizontal size={16} />} title="모서리 둥글기">
        <RadiusPicker value={pendingRadius} onChange={updateRadius} />
      </Card>

      {/* 오버레이 스타일 */}
      <Card collapsible id="settings-overlay" icon={<Shapes size={16} />} title="모달·슬라이드 배경 처리" defaultOpen={false}>
        <OverlayStylePicker value={pendingOverlay} onChange={updateOverlay} />
      </Card>

      {/* 카드 투명도 */}
      <Card collapsible id="settings-card-opacity" icon={<Wallpaper size={16} />} title="카드 투명도" defaultOpen={false}>
        <div className="space-y-3">
          <p className="text-2xs text-zinc-400">카드 배경 투명도 조절 — 배경 무늬/색상과 조합할 때 활용하세요. 즉시 적용됩니다.</p>
          <div className="flex items-center gap-3">
            <label className="text-xs text-zinc-500 w-16 flex-shrink-0">투명도</label>
            <input
              type="range" min={0.1} max={1} step={0.05}
              value={pendingCardOpacity}
              onChange={e => updateCardOpacity(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs text-zinc-400 w-10 text-right">{Math.round(pendingCardOpacity * 100)}%</span>
          </div>
          {/* 미리보기 */}
          <div
            className="rounded-xl border p-3 text-xs text-zinc-600 dark:text-zinc-400"
            style={{
              backgroundColor: `rgb(255 255 255 / ${pendingCardOpacity})`,
              borderColor: `rgb(228 228 231 / ${Math.max(pendingCardOpacity, 0.3)})`,
            }}
          >
            카드 배경 미리보기 (라이트 기준)
          </div>
        </div>
      </Card>

      {/* 날씨 아이콘 스타일 */}
      <Card collapsible id="settings-weather-icon" icon={<CloudSun size={16} />} title="날씨 아이콘 스타일" defaultOpen={false}>
        <WeatherIconStylePicker />
      </Card>

      {/* 색상 테마 */}
      <Card collapsible id="settings-theme" icon={<Palette size={16} />} title="색상 테마">
        <div className="space-y-6">
          <div>
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-3">강조 색상</p>
            <SeasonThemePicker value={pendingSeason} onChange={updateSeason} />
          </div>
          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-5">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-3">등락 색상</p>
            <PnlColorPicker value={pendingPnlColor} onChange={updatePnlColor} />
          </div>
        </div>
      </Card>

      {/* 배경 무늬 */}
      <Card collapsible id="settings-background" icon={<Wallpaper size={16} />} title="배경 무늬">
        <BackgroundPicker value={pendingBg} onChange={updateBg} />
      </Card>

      {/* 로고 아이콘 */}
      <Card collapsible id="settings-logo-icon" icon={<Shapes size={16} />} title="로고 아이콘">
        <LogoIconPicker
          svgValue={pendingLogoIcon}
          pngValue={pendingPngLogo}
          onSvg={updateLogoIcon}
          onPng={updatePngLogo}
        />
      </Card>

      <div className="flex items-center gap-3 pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-60 ${
            dirty
              ? 'bg-accent hover:opacity-85 shadow-md'
              : 'bg-accent hover:opacity-85'
          }`}
        >
          {saving ? '저장 중...' : dirty ? '저장하기' : '설정 저장'}
        </button>
        {saved && <span className="text-xs text-accent font-medium">저장되었습니다.</span>}
        {dirty && !saving && <span className="text-xs text-amber-500">미저장 변경사항 있음</span>}
      </div>
    </div>
  )
}

export default Settings
