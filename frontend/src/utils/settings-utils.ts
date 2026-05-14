// Settings 페이지에서 외부 컴포넌트(App, TopBar, SidebarNav)가 사용하는 유틸 함수 모음.
// Settings.tsx를 React.lazy로 완전 분리하기 위해 이 파일에서 import.

import React from 'react'

// ── 프로필 아이콘 ──────────────────────────────────────────────────────────────

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

export function resolveProfileIcon(id: string): string {
  return VALID_PROFILE_ICONS.has(id) ? id : (LEGACY_ICON_MAP[id] ?? 'person')
}

export function getProfileIconNode(id: string, size = 16): React.ReactNode {
  const resolved = resolveProfileIcon(id)
  return React.createElement('img', {
    src: `/profile-icons/${resolved}.png`,
    width: size, height: size,
    alt: '',
    style: { objectFit: 'contain', display: 'block', flexShrink: 0 },
  })
}

// ── 시즌 테마 ─────────────────────────────────────────────────────────────────

export type Season = 'default' | 'spring' | 'summer' | 'autumn' | 'winter' | 'mono'

export function applySeasonTheme(season: Season) {
  const el = document.documentElement
  if (season === 'default') {
    el.removeAttribute('data-season')
  } else {
    el.setAttribute('data-season', season)
  }
  localStorage.setItem('season', season)
}

// ── 등락 색상 ─────────────────────────────────────────────────────────────────

export interface PnlColorConfig {
  preset: string
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
  el.setAttribute('data-pnl-up-light',   cfg.upLight)
  el.setAttribute('data-pnl-down-light', cfg.downLight)
  el.setAttribute('data-pnl-up-dark',    cfg.upDark)
  el.setAttribute('data-pnl-down-dark',  cfg.downDark)
  localStorage.setItem('pnl_color_config', JSON.stringify(cfg))
}

// ── UI 라디우스 ───────────────────────────────────────────────────────────────

export type UiRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl'

const RADIUS_VALUES: Record<UiRadius, string> = {
  none: '0rem', sm: '0.25rem', md: '0.5rem', lg: '0.75rem', xl: '1.25rem',
}

export function getUiRadius(): UiRadius {
  return (localStorage.getItem('ui_radius') as UiRadius) ?? 'lg'
}

export function applyUiRadius(r: UiRadius) {
  document.documentElement.style.setProperty('--ui-radius', RADIUS_VALUES[r] ?? RADIUS_VALUES.lg)
  localStorage.setItem('ui_radius', r)
}

// ── 카드 불투명도 ─────────────────────────────────────────────────────────────

export function getCardOpacity(): number {
  return parseFloat(localStorage.getItem('card_opacity') ?? '1')
}

export function applyCardOpacity(v: number) {
  document.documentElement.style.setProperty('--card-opacity', String(v))
  localStorage.setItem('card_opacity', String(v))
}
