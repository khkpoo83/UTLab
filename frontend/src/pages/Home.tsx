import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Briefcase, Lightbulb, Newspaper, ChevronRight, CalendarClock,
  BookOpen, LayoutGrid, X, Camera, Calendar,
  Move, Check, Plus, CloudSun,
} from 'lucide-react'
import Skeleton from '../components/Skeleton'
import WeatherWidget from '../components/WeatherWidget'
import CalendarWidget from '../components/CalendarWidget'
import PhotoWidget from '../components/PhotoWidget'
import { Card } from '../components/Card'
import { PageTitle } from '../components/PageTitle'
import { formatPrice, formatPct, relativeTime } from '../utils/format'
import { STRENGTH_CONFIG } from '../constants/stock'
import {
  portfolioApi, kisApi, recommendApi, newsApi, diaryApi, settingsApi, calendarApi,
  KISPortfolioAccount, RecommendItem, NewsItem, DiaryEntry, CalendarEventItem,
} from '../api/client'

// ── 그리팅 ───────────────────────────────────────────────────────────────────

function buildGreeting(
  now: Date,
  summary: { pnl: number; pnlPct: number; dayPnl: number; totalValue: number },
  itemCount: number,
  loaded: boolean,
): string {
  const hour = now.getHours()
  const age  = now.getFullYear() - 1983
  const retireAge   = Number(localStorage.getItem('planner_retirement_age') ?? 55)
  const yearsToRetire = Math.max(0, retireAge - age)

  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000,
  )

  const fmt = (n: number) =>
    Math.abs(n) >= 100_000_000
      ? `${(n / 100_000_000).toFixed(1)}억원`
      : `${Math.round(n).toLocaleString('ko-KR')}원`
  const pnlStr    = (summary.pnl    >= 0 ? '+' : '') + fmt(summary.pnl)
  const pctStr    = (summary.pnlPct >= 0 ? '+' : '') + summary.pnlPct.toFixed(2) + '%'
  const dayStr    = (summary.dayPnl >= 0 ? '+' : '') + fmt(summary.dayPnl)
  const totalStr  = Math.round(summary.totalValue / 10000).toLocaleString('ko-KR') + '만원'

  let pool: string[]
  if (hour < 5) {
    pool = [
      `🌙 새벽에도 시장이 눈에 밟히시나요? ${age}세 투자자, 오늘도 수고하십니다.`,
      loaded
        ? `🌙 이 시간엔 미국장이 한창이네요. ${itemCount}개 종목이 오버나이트 중입니다.`
        : '🌙 이 시간엔 미국장이 한창이네요. 오버나이트 포지션 잘 버텨주길 바랍니다.',
      '🌙 늦은 밤입니다. 내일 좋은 컨디션을 위해 일단 쉬어가세요.',
      '🌙 새벽 시장 정보는 내일 아침에도 확인할 수 있습니다. 숙면이 최고의 투자입니다.',
      loaded
        ? `🌙 은퇴까지 D-${yearsToRetire}년. 새벽에도 포트폴리오 챙기는 모습이 그 답입니다.`
        : `🌙 ${age}세의 새벽, 내일도 침착하게 임합시다.`,
    ]
  } else if (hour < 9) {
    pool = [
      '🌅 좋은 아침입니다. 오늘 개장 전 준비 잘 되셨나요?',
      `🌅 ${age}세, 은퇴까지 D-${yearsToRetire}년. 오늘 하루도 그 여정의 한 걸음입니다.`,
      '🌅 아침이 밝았습니다. 오늘 하루도 냉정하고 침착하게.',
      '🌅 굿모닝. 국내장 개장까지 얼마 남지 않았습니다.',
      loaded
        ? `🌅 아침 포트폴리오 확인. 누적 ${pctStr}, 오늘도 잘 지켜봅시다.`
        : '🌅 아침입니다. 오늘 어떤 흐름이 펼쳐질지 기대됩니다.',
    ]
  } else if (hour < 13) {
    pool = [
      loaded
        ? `☀️ 장이 열렸습니다. ${itemCount}개 종목과 오늘을 시작합니다.`
        : '☀️ 장이 열렸습니다. 오전장 침착하게 대응해봅시다.',
      loaded
        ? `☀️ 누적 수익률 ${pctStr}. 오전장은 느긋하게 지켜보는 게 최선입니다.`
        : '☀️ 오전장 진행 중. 단기 노이즈에 흔들리지 않는 게 중요합니다.',
      `☀️ ${age}세의 오전, 조급함 없이 오늘 흐름을 읽어봅시다.`,
      loaded
        ? `☀️ 누적 손익 ${pnlStr}. 오늘도 잘 지켜주길 바랍니다.`
        : '☀️ 오전 시장이 열렸습니다. 오늘 하루도 차분하게.',
      loaded
        ? `☀️ ${itemCount}개 종목이 지금 이 순간도 움직이고 있습니다.`
        : '☀️ 시장이 열려 있습니다. 오늘 뉴스도 확인해보세요.',
    ]
  } else if (hour < 17) {
    pool = [
      loaded
        ? `🌤 오후장 진행 중. 오늘 어제 대비 ${dayStr} 변동 중이네요.`
        : '🌤 오후장입니다. 오늘의 흐름을 정리해볼 시간입니다.',
      '🌤 점심은 드셨나요? 배부른 상태에서의 판단이 더 냉정합니다.',
      `🌤 ${age}세 투자자의 오후, 느긋하게 시장을 지켜볼 자격이 있습니다.`,
      loaded
        ? `🌤 ${itemCount}개 종목 중 오늘 웃는 종목이 더 많길 바랍니다.`
        : '🌤 오후장, 오늘의 흐름을 확인해보세요.',
      loaded
        ? `🌤 은퇴까지 D-${yearsToRetire}년. 총 ${totalStr}이 착실히 쌓이고 있습니다.`
        : `🌤 은퇴까지 D-${yearsToRetire}년. 오늘도 그 여정을 걷고 있습니다.`,
    ]
  } else if (hour < 21) {
    pool = [
      '🌇 장 마감이 가까워집니다. 오늘 하루 어떠셨나요?',
      loaded
        ? `🌇 오늘 ${dayStr}. 수고하셨습니다. 저녁 식사 맛있게 드세요.`
        : '🌇 저녁입니다. 오늘도 고생하셨습니다.',
      loaded
        ? `🌇 ${itemCount}개 종목이 오늘 하루를 버텨냈습니다.`
        : '🌇 저녁은 시장 걱정 잠시 내려두셔도 됩니다.',
      `🌇 은퇴까지 D-${yearsToRetire}년. 오늘 하루도 착실히 쌓아가고 있습니다.`,
      loaded
        ? `🌇 누적 손익 ${pnlStr}. ${age}세에 이 정도면 잘 해오고 있습니다.`
        : `🌇 ${age}세의 저녁, 오늘도 잘 마무리해봅시다.`,
    ]
  } else {
    pool = [
      '🌃 오늘 하루도 마무리됩니다. AI 일기가 오늘을 기록해줄 겁니다.',
      loaded
        ? `🌃 총 ${totalStr}. 내일도 잘 지켜주길 바랍니다.`
        : '🌃 내일의 시장은 내일 걱정하면 됩니다. 오늘은 편히 쉬세요.',
      '🌃 내일의 시장은 내일 걱정하면 됩니다. 오늘은 편히 쉬세요.',
      `🌃 ${age}세, 은퇴까지 D-${yearsToRetire}년. 오늘도 잘 버텼습니다.`,
      loaded
        ? `🌃 누적 수익률 ${pctStr}. 오늘도 포트폴리오가 잘 지켜줬습니다.`
        : '🌃 오늘 하루도 수고하셨습니다. 좋은 밤 되세요.',
    ]
  }

  return pool[dayOfYear % pool.length]
}

// ── 플래너 상수 ───────────────────────────────────────────────────────────────

const PLANNER_BIRTH_YEAR = 1983
const PLANNER_CURRENT_YEAR = new Date().getFullYear()
const PLANNER_MILESTONES = [
  { year: 2031, label: 'ISA 만기',        age: 48 },
  { year: 2039, label: '삼성이글루 개시', age: 56 },
  { year: 2042, label: '교보변액 개시',   age: 59 },
  { year: 2043, label: 'DC IRP 개시',     age: 60 },
]

// ── 위젯 그리드 시스템 ────────────────────────────────────────────────────────

const GRID_COLS  = 4
const GRID_ROW_H = 180   // px per row unit
const GRID_GAP   = 12    // px (gap-3)

interface WidgetCfg {
  id: string
  visible: boolean
  x: number   // 0-based column start
  y: number   // 0-based row start
  w: number   // column span (1–GRID_COLS)
  h: number   // row span (1+)
  customTitle?: string
}

interface DragState {
  widgetId:  string
  startPx:   number   // pointer clientX at drag start
  startPy:   number   // pointer clientY at drag start
  origX:     number   // widget grid x at drag start
  origY:     number   // widget grid y at drag start
  targetX:   number   // current target grid x
  targetY:   number   // current target grid y
  cellW:     number   // grid cell width in px
  cellH:     number   // grid cell height in px
}

interface ResizeState {
  widgetId: string
  startPx:  number
  startPy:  number
  origW:    number
  origH:    number
  cellW:    number
}

const WIDGET_META: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: 'portfolio',       label: '내 포트폴리오', icon: <Briefcase size={13} /> },
  { id: 'recommend',       label: 'AI 추천 Top3',  icon: <Lightbulb size={13} /> },
  { id: 'news',            label: '오늘의 뉴스',   icon: <Newspaper size={13} /> },
  { id: 'diary',           label: 'AI 투자 일기',  icon: <BookOpen size={13} /> },
  { id: 'planner',         label: '은퇴 플래너',   icon: <CalendarClock size={13} /> },
  { id: 'shortcuts',       label: '바로가기',       icon: <ChevronRight size={13} /> },
  { id: 'photo',           label: '오늘의 사진',    icon: <Camera size={13} /> },
  { id: 'calendar',        label: '캘린더',         icon: <Calendar size={13} /> },
  { id: 'calendar-events', label: '다가오는 일정',  icon: <CalendarClock size={13} /> },
  { id: 'weather',         label: '날씨',           icon: <CloudSun size={13} /> },
]

// 기본 레이아웃 (4열 그리드)
const DEFAULT_WIDGETS: WidgetCfg[] = [
  { id: 'portfolio',       visible: true,  x: 0, y: 0,  w: 2, h: 2 },
  { id: 'recommend',       visible: true,  x: 2, y: 0,  w: 2, h: 2 },
  { id: 'news',            visible: true,  x: 0, y: 2,  w: 4, h: 3 },
  { id: 'diary',           visible: true,  x: 0, y: 5,  w: 4, h: 2 },
  { id: 'planner',         visible: true,  x: 0, y: 7,  w: 2, h: 2 },
  { id: 'shortcuts',       visible: true,  x: 2, y: 7,  w: 2, h: 1 },
  { id: 'photo',           visible: true,  x: 0, y: 9,  w: 2, h: 2 },
  { id: 'calendar',        visible: true,  x: 2, y: 8,  w: 2, h: 3 },
  { id: 'calendar-events', visible: true,  x: 0, y: 11, w: 2, h: 2 },
  { id: 'weather',         visible: false, x: 2, y: 9,  w: 2, h: 2 },
]

const WIDGET_STORAGE_KEY = 'home_widgets_v4'

function colsToX(size?: string): { x: number; w: number } {
  switch (size) {
    case 'quarter':       return { x: 0, w: 1 }
    case 'three-quarter': return { x: 0, w: 3 }
    case 'full':          return { x: 0, w: 4 }
    default:              return { x: 0, w: 2 }
  }
}

function loadWidgets(serverData?: WidgetCfg[] | null): WidgetCfg[] {
  const tryKeys = [WIDGET_STORAGE_KEY, 'home_widgets_v3', 'home_widgets_v2']
  const source = serverData ?? (() => {
    for (const key of tryKeys) {
      try {
        const s = localStorage.getItem(key)
        if (s) return JSON.parse(s)
      } catch { /* ignore */ }
    }
    return null
  })()

  if (!source || !Array.isArray(source)) return DEFAULT_WIDGETS

  const savedMap = new Map<string, any>(source.map((w: any) => [w.id, w]))
  const allIds   = new Set(DEFAULT_WIDGETS.map(d => d.id))
  const merged: WidgetCfg[] = []

  for (const raw of source) {
    if (!allIds.has(raw.id)) continue
    // v4 format
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y) && Number.isFinite(raw.w) && Number.isFinite(raw.h)) {
      merged.push({ id: raw.id, visible: raw.visible ?? true, x: raw.x, y: raw.y, w: raw.w, h: raw.h, customTitle: raw.customTitle ?? undefined })
    } else {
      // migrate from v2/v3
      const def = DEFAULT_WIDGETS.find(d => d.id === raw.id) ?? DEFAULT_WIDGETS[0]
      const { w } = colsToX(raw.size)
      const h = raw.h ?? (raw.rows ?? 2)
      merged.push({ id: raw.id, visible: raw.visible ?? true, x: def.x, y: def.y, w, h })
    }
  }
  // add new widgets not in saved data
  for (const d of DEFAULT_WIDGETS) {
    if (!savedMap.has(d.id)) merged.push({ ...d })
  }
  return merged
}

function persistWidgets(widgets: WidgetCfg[]) {
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(widgets))
  settingsApi.update({ ui_home_widgets: widgets }).catch(() => {})
}

// 위젯을 (nx, ny)에 배치 – 겹치는 위젯은 아래로 밀어냄
function placeWidget(widgets: WidgetCfg[], id: string, nx: number, ny: number): WidgetCfg[] {
  const moving = widgets.find(w => w.id === id)
  if (!moving) return widgets

  const mx2 = nx + moving.w
  const my2 = ny + moving.h

  const result = widgets.map(w => {
    if (w.id === id) return { ...w, x: nx, y: ny }
    if (!w.visible) return w   // invisible 위젯은 이동 대상에서 제외
    const ox2 = w.x + w.w
    const oy2 = w.y + w.h
    const overlapsX = w.x < mx2 && ox2 > nx
    const overlapsY = w.y < my2 && oy2 > ny
    if (overlapsX && overlapsY) {
      return { ...w, y: ny + moving.h }
    }
    return w
  })

  return compactWidgets(result)
}

// 빈 행 제거 – visible 위젯만 위로 올림 (invisible 위젯은 위치 보존)
function compactWidgets(widgets: WidgetCfg[]): WidgetCfg[] {
  const visible = widgets.filter(w => w.visible)
  const sorted  = [...visible].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x)
  const placed: WidgetCfg[] = []

  for (const w of sorted) {
    let newY = 0
    for (const p of placed) {
      const overlapsX = w.x < p.x + p.w && w.x + w.w > p.x
      if (overlapsX) newY = Math.max(newY, p.y + p.h)
    }
    placed.push({ ...w, y: newY })
  }

  const placedMap = new Map(placed.map(p => [p.id, p]))
  return widgets.map(w => w.visible ? (placedMap.get(w.id) ?? w) : w)
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function calcKisSummary(kisAccounts: KISPortfolioAccount[]) {
  const totalValue = kisAccounts.reduce((s, b) => s + b.total_eval_amount, 0)
  const totalCost  = kisAccounts.reduce((s, b) => s + b.total_purchase_amount, 0)
  const pnl        = totalValue - totalCost
  const pnlPct     = totalCost > 0 ? (pnl / totalCost) * 100 : 0
  let dayPnl = 0
  for (const b of kisAccounts)
    for (const h of b.holdings)
      if (h.day_change != null) dayPnl += h.day_change * h.quantity
  return { totalValue, pnl, pnlPct, dayPnl }
}

function flattenRecommends(groups: import('../api/client').RecommendGroup[]): RecommendItem[] {
  const all: RecommendItem[] = []
  for (const g of groups)
    for (const item of g.items)
      if (!item.is_portfolio) all.push(item)
  const order: Record<string, number> = { strong: 0, normal: 1, watch: 2 }
  all.sort((a, b) => (order[a.strength ?? 'watch'] ?? 2) - (order[b.strength ?? 'watch'] ?? 2))
  return all.slice(0, 3)
}

// ── 바로가기 ─────────────────────────────────────────────────────────────────

const NAV_CARDS = [
  { to: '/portfolio', label: '포트폴리오', icon: <Briefcase size={18} /> },
  { to: '/news',      label: '뉴스',       icon: <Newspaper size={18} /> },
  { to: '/recommend', label: '추천',       icon: <Lightbulb size={18} /> },
  { to: '/planner',   label: '플래너',     icon: <CalendarClock size={18} /> },
]

// ── 그리드 오버레이 (편집 모드) ───────────────────────────────────────────────

function GridOverlay({ rows }: { rows: number }) {
  const cells = GRID_COLS * Math.max(rows, 6)
  return (
    <div
      className="absolute inset-0 pointer-events-none z-0"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
        gridTemplateRows:    `repeat(${Math.max(rows, 6)}, ${GRID_ROW_H}px)`,
        gap: GRID_GAP + 'px',
      }}
    >
      {Array.from({ length: cells }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-dashed border-accent/20 dark:border-accent/15"
        />
      ))}
    </div>
  )
}

// ── 드롭 존 고스트 ────────────────────────────────────────────────────────────

// visible prop으로 hidden 토글 — DOM 삽입/제거 없이 안정적 트리 유지 (insertBefore 에러 방지)
function DropGhost({ x, y, w, h, visible }: { x: number; y: number; w: number; h: number; visible: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-xl bg-accent/10 border-2 border-accent/50 border-dashed pointer-events-none z-10 transition-all duration-100${visible ? '' : ' hidden'}`}
      style={{
        gridColumn: `${x + 1} / span ${w}`,
        gridRow:    `${y + 1} / span ${h}`,
      }}
    />
  )
}

// ── 위젯 셀 ──────────────────────────────────────────────────────────────────

function WidgetCell({
  widget,
  editMode,
  isDragging,
  onDragStart,
  onResizeStart,
  children,
}: {
  widget: WidgetCfg
  editMode: boolean
  isDragging: boolean
  onDragStart: (e: React.PointerEvent) => void
  onResizeStart: (e: React.PointerEvent) => void
  children: React.ReactNode
}) {
  return (
    <div
      translate="no"
      style={{
        gridColumn: `${widget.x + 1} / span ${widget.w}`,
        gridRow:    `${widget.y + 1} / span ${widget.h}`,
        minHeight:  widget.h * GRID_ROW_H + 'px',
        transition: isDragging ? 'none' : 'grid-column 0.18s ease, grid-row 0.18s ease',
      }}
      className={`relative group/cell ${isDragging ? 'opacity-40 z-0' : 'z-10'}`}
    >
      {/* 드래그 핸들 (편집 모드) */}
      {editMode && (
        <div
          onPointerDown={onDragStart}
          className="absolute top-0 left-0 right-0 h-10 z-30 cursor-grab active:cursor-grabbing touch-none select-none rounded-t-xl"
          title="드래그해서 이동"
        />
      )}

      {/* 컨텐츠 */}
      <div className={`h-full ${editMode ? 'pointer-events-none select-none' : ''}`}>
        {children}
      </div>

      {/* 리사이즈 핸들 (편집 모드) */}
      {editMode && (
        <ResizeHandle onResizeStart={onResizeStart} widget={widget} />
      )}

      {/* 편집 모드 테두리 강조 */}
      {editMode && !isDragging && (
        <div className="absolute inset-0 rounded-xl ring-1 ring-accent/30 pointer-events-none z-20" />
      )}
    </div>
  )
}

// ── 리사이즈 핸들 ─────────────────────────────────────────────────────────────

function ResizeHandle({
  onResizeStart,
}: {
  widget?: WidgetCfg
  onResizeStart: (e: React.PointerEvent) => void
}) {
  return (
    <div
      onPointerDown={onResizeStart}
      className="absolute bottom-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-md cursor-nwse-resize z-30 touch-none select-none bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-700 shadow-sm hover:bg-accent/10 hover:border-accent/50 transition-colors"
      title="드래그로 크기 조절"
    >
      {/* 코너 리사이즈 아이콘: 왼쪽 상단 + 오른쪽 하단 L자 화살표 */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-zinc-400 dark:text-zinc-500">
        <polyline points="5,1 1,1 1,5"  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <polyline points="9,13 13,13 13,9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <line x1="1" y1="1" x2="13" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 2"/>
      </svg>
    </div>
  )
}

// ── 위젯 관리 패널 ─────────────────────────────────────────────────────────────

function WidgetPanel({
  widgets,
  onChange,
  onClose,
}: {
  widgets: WidgetCfg[]
  onChange: (next: WidgetCfg[]) => void
  onClose: () => void
}) {
  const toggle = (id: string) =>
    onChange(widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w))

  const commitTitle = (id: string, value: string) => {
    const meta = WIDGET_META.find(m => m.id === id)
    const trimmed = value.trim()
    const customTitle = trimmed === '' || trimmed === meta?.label ? undefined : trimmed
    const next = widgets.map(w => w.id === id ? { ...w, customTitle } : w)
    onChange(next)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'var(--overlay-filter)', WebkitBackdropFilter: 'var(--overlay-filter)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full sm:w-[22rem] panel-surface border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <LayoutGrid size={14} className="text-accent" />
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">위젯 표시 설정</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 py-2">
          {widgets.map(w => {
            const meta = WIDGET_META.find(m => m.id === w.id)
            if (!meta) return null
            return (
              <div key={w.id} className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <span className="text-zinc-400 dark:text-zinc-500 flex-shrink-0">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <input
                    key={w.id + '|' + (w.customTitle ?? '')}
                    defaultValue={w.customTitle ?? meta.label}
                    placeholder={meta.label}
                    onBlur={e => commitTitle(w.id, e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTitle(w.id, e.currentTarget.value) } }}
                    className="w-full text-sm text-zinc-700 dark:text-zinc-300 bg-transparent outline-none border-b border-transparent focus:border-accent/50 pb-px truncate"
                  />
                  {w.customTitle && w.customTitle !== meta.label && (
                    <p className="text-2xs text-zinc-400 dark:text-zinc-500 truncate">{meta.label}</p>
                  )}
                </div>
                <div
                  className="flex-shrink-0 cursor-pointer"
                  onClick={() => toggle(w.id)}
                >
                  <div className={`w-8 h-5 rounded-full transition-colors ${w.visible ? 'bg-accent' : 'bg-zinc-200 dark:bg-zinc-700'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm mt-0.5 transition-transform ${w.visible ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 text-2xs text-zinc-400 text-center">
          타이틀 클릭으로 이름 변경 · 편집 모드에서 드래그해 배치
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── 위젯 에러 경계 ────────────────────────────────────────────────────────────

class WidgetErrorBoundary extends React.Component<
  { children: React.ReactNode; widgetId: string; resetKey: boolean },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidUpdate(prev: this['props']) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  componentDidCatch(error: Error) {
    console.error('[Widget]', this.props.widgetId, error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full card-surface border rounded-xl flex flex-col items-center justify-center gap-2">
          <p className="text-xs text-zinc-400">위젯 오류</p>
          <button
            className="text-2xs text-accent underline"
            onClick={() => this.setState({ hasError: false })}
          >
            재시도
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── 홈 에러 경계 ──────────────────────────────────────────────────────────────

class HomeErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; msg: string; remountKey: number }
> {
  state = { hasError: false, msg: '', remountKey: 0 }
  static getDerivedStateFromError(e: Error) { return { hasError: true, msg: e.message } }
  componentDidCatch(e: Error) {
    // insertBefore 에러는 브라우저 확장프로그램 DOM 조작으로 인한 것 — 자동 복구
    if (e.message.includes('insertBefore') || e.message.includes('child of this node')) {
      setTimeout(() => this.setState(s => ({ hasError: false, msg: '', remountKey: s.remountKey + 1 })), 0)
    } else {
      console.error('[Home render error]', e)
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-500">
          <p className="text-sm">레이아웃 오류가 발생했습니다.</p>
          {this.state.msg && (
            <p className="text-xs text-zinc-400 max-w-sm text-center">{this.state.msg}</p>
          )}
          <button
            className="text-sm text-accent underline"
            onClick={() => this.setState(s => ({ hasError: false, msg: '', remountKey: s.remountKey + 1 }))}
          >
            재시도
          </button>
        </div>
      )
    }
    return <React.Fragment key={this.state.remountKey}>{this.props.children}</React.Fragment>
  }
}

// ── 메인 (내부 구현) ──────────────────────────────────────────────────────────

function HomeContent() {
  const navigate = useNavigate()

  // 데이터 상태
  const [kisAccounts, setKisAccounts] = useState<KISPortfolioAccount[]>([])
  const [itemCount,   setItemCount]   = useState(0)
  const [top3,        setTop3]        = useState<RecommendItem[]>([])
  const [news,        setNews]        = useState<NewsItem[]>([])
  const [diary,       setDiary]       = useState<DiaryEntry | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [now,         setNow]         = useState(() => new Date())
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEventItem[]>([])

  // 위젯 상태
  const [widgets,    setWidgets]    = useState<WidgetCfg[]>(() => loadWidgets())
  const [editMode,   setEditMode]   = useState(false)
  const [showPanel,  setShowPanel]  = useState(false)
  const [dragState,  setDragState]  = useState<DragState | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)

  // 편집 시작 전 스냅샷 (취소용)
  const editSnapshot = useRef<WidgetCfg[]>([])
  const gridRef      = useRef<HTMLDivElement>(null)
  const serverSynced = useRef(false)

  // drag/resize 최신 상태를 클로저 없이 참조
  const dragRef   = useRef(dragState)
  const resizeRef = useRef(resizeState)
  const widgetsRef = useRef(widgets)
  dragRef.current    = dragState
  resizeRef.current  = resizeState
  widgetsRef.current = widgets

  // ── 데이터 로딩 ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const fetchUpcoming = () =>
      calendarApi.getUpcoming(20).then(setUpcomingEvents).catch(() => setUpcomingEvents([]))
    fetchUpcoming()
    window.addEventListener('calendarUpdated', fetchUpcoming)
    const t = setInterval(fetchUpcoming, 60_000)
    return () => { window.removeEventListener('calendarUpdated', fetchUpcoming); clearInterval(t) }
  }, [])

  useEffect(() => {
    if (serverSynced.current) return
    const token = localStorage.getItem('token')
    if (!token) return
    settingsApi.get().then(({ data }) => {
      if (serverSynced.current) return   // user already made changes, don't overwrite
      if (data.ui_home_widgets && Array.isArray(data.ui_home_widgets)) {
        const loaded = loadWidgets(data.ui_home_widgets)
        setWidgets(loaded)
        localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(loaded))
      }
      serverSynced.current = true
    }).catch(() => { serverSynced.current = true })
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [kisRes, recommendRes, newsRes, diaryRes] = await Promise.all([
          kisApi.getPortfolio().catch(() => [] as KISPortfolioAccount[]),
          recommendApi.list(),
          newsApi.list({ page: 1, page_size: 8 }),
          diaryApi.latest().catch(() => null),
        ])
        if (cancelled) return
        setKisAccounts(kisRes)
        setItemCount(kisRes.reduce((s, b) => s + b.holdings.length, 0))
        setTop3(flattenRecommends(recommendRes.data))
        setNews(newsRes.data.items)
        setDiary(diaryRes)
      } catch {
        try {
          const portfolioRes = await portfolioApi.list()
          if (!cancelled) setItemCount(portfolioRes.data.length)
        } catch { /* ignore */ }
        if (!cancelled) setError('데이터를 불러오지 못했습니다.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── 드래그 & 리사이즈 이벤트 ─────────────────────────────────────────────────

  // 그리드 셀 크기 계산
  const getGridMetrics = useCallback(() => {
    const el = gridRef.current
    if (!el) return { cellW: window.innerWidth / GRID_COLS, cellH: GRID_ROW_H }
    const rect = el.getBoundingClientRect()
    return {
      cellW: (rect.width + GRID_GAP) / GRID_COLS,
      cellH: GRID_ROW_H + GRID_GAP,
    }
  }, [])

  // document-level pointer move/up (drag)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const ds = dragRef.current
      if (!ds) return
      const { cellW, cellH } = { cellW: ds.cellW, cellH: ds.cellH }
      const dx = e.clientX - ds.startPx
      const dy = e.clientY - ds.startPy
      const colDelta = Math.round(dx / cellW)
      const rowDelta = Math.round(dy / cellH)

      const widget = widgetsRef.current.find(w => w.id === ds.widgetId)
      if (!widget) return
      const newX = Math.max(0, Math.min(GRID_COLS - widget.w, ds.origX + colDelta))
      const newY = Math.max(0, ds.origY + rowDelta)
      if (newX !== ds.targetX || newY !== ds.targetY) {
        setDragState(prev => prev ? { ...prev, targetX: newX, targetY: newY } : null)
      }
    }

    const onUp = () => {
      const ds = dragRef.current
      if (!ds) return
      setWidgets(prev => {
        const updated = placeWidget(prev, ds.widgetId, ds.targetX, ds.targetY)
        persistWidgets(updated)
        return updated
      })
      setDragState(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup',   onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup',   onUp)
    }
  }, [])

  // document-level pointer move/up (resize)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const rs = resizeRef.current
      if (!rs) return
      const dx = e.clientX - rs.startPx
      const dy = e.clientY - rs.startPy
      const wDelta = Math.round(dx / (rs.cellW * 0.7))
      const hDelta = Math.round(dy / ((GRID_ROW_H + GRID_GAP) * 0.55))
      const widget = widgetsRef.current.find(w => w.id === rs.widgetId)
      if (!widget) return
      const newW = Math.max(1, Math.min(GRID_COLS - widget.x, rs.origW + wDelta))
      const newH = Math.max(1, Math.min(8, rs.origH + hDelta))
      if (newW !== widget.w || newH !== widget.h) {
        setWidgets(prev => prev.map(w => w.id === rs.widgetId ? { ...w, w: newW, h: newH } : w))
      }
    }

    const onUp = () => {
      const rs = resizeRef.current
      if (!rs) return
      setWidgets(prev => {
        const compacted = compactWidgets(prev)
        persistWidgets(compacted)
        return compacted
      })
      setResizeState(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup',   onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup',   onUp)
    }
  }, [])

  // ── 편집 모드 ────────────────────────────────────────────────────────────────

  function enterEditMode() {
    serverSynced.current = true  // prevent in-flight server GET from overwriting during edit
    editSnapshot.current = JSON.parse(JSON.stringify(widgets))
    setEditMode(true)
  }

  function exitEditMode(save: boolean) {
    if (!save) {
      setWidgets(editSnapshot.current)
    } else {
      persistWidgets(widgets)
    }
    setEditMode(false)
    setShowPanel(false)
    setDragState(null)
    setResizeState(null)
  }

  // ── 드래그 시작 ──────────────────────────────────────────────────────────────

  function startDrag(e: React.PointerEvent, widgetId: string) {
    e.preventDefault()
    e.stopPropagation()
    const { cellW, cellH } = getGridMetrics()
    const widget = widgets.find(w => w.id === widgetId)
    if (!widget) return
    setDragState({
      widgetId,
      startPx: e.clientX,
      startPy: e.clientY,
      origX: widget.x,
      origY: widget.y,
      targetX: widget.x,
      targetY: widget.y,
      cellW,
      cellH,
    })
  }

  // ── 리사이즈 시작 ────────────────────────────────────────────────────────────

  function startResize(e: React.PointerEvent, widgetId: string) {
    e.preventDefault()
    e.stopPropagation()
    const { cellW } = getGridMetrics()
    const widget = widgets.find(w => w.id === widgetId)
    if (!widget) return
    setResizeState({
      widgetId,
      startPx: e.clientX,
      startPy: e.clientY,
      origW: widget.w,
      origH: widget.h,
      cellW,
    })
  }

  // ── 파생 값 ──────────────────────────────────────────────────────────────────

  const summary  = useMemo(() => calcKisSummary(kisAccounts), [kisAccounts])
  const greeting = useMemo(() => buildGreeting(now, summary, itemCount, !loading), [now, summary, itemCount, loading])
  const retirementAge      = useMemo(() => Number(localStorage.getItem('planner_retirement_age') ?? 55), [])
  const dYears             = retirementAge - (PLANNER_CURRENT_YEAR - PLANNER_BIRTH_YEAR)
  const retirementYear     = PLANNER_BIRTH_YEAR + retirementAge
  const upcomingMilestones = useMemo(() => PLANNER_MILESTONES.filter(m => m.year >= PLANNER_CURRENT_YEAR).slice(0, 3), [])

  const visibleWidgets = useMemo(() => widgets.filter(w => w.visible), [widgets])
  const maxRow = useMemo(() => visibleWidgets.reduce((m, w) => Math.max(m, w.y + w.h), 0), [visibleWidgets])

  // ── 카드 렌더러 ──────────────────────────────────────────────────────────────

  const renderCard = useCallback(function renderCard(w: WidgetCfg) {
    const { id } = w
    const minH   = w.h * GRID_ROW_H
    const widgetTitle = w.customTitle ?? WIDGET_META.find(m => m.id === id)?.label ?? id

    switch (id) {
      case 'portfolio':
        return (
          <Card icon={<Briefcase size={14} />} title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            right={!editMode ? (
              <button onClick={e => { e.stopPropagation(); navigate('/portfolio') }}
                className="text-2xs text-accent hover:underline flex items-center gap-0.5">
                상세 <ChevronRight size={10} />
              </button>
            ) : undefined}
            minH={minH} className="h-full"
          >
            {loading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-6 w-36 rounded" />
                <Skeleton className="h-4 w-24 rounded" />
                <Skeleton className="h-3 w-28 rounded" />
              </div>
            ) : itemCount === 0 ? (
              <p className="text-xs text-zinc-400 py-1">보유 종목이 없습니다.</p>
            ) : (
              <div className="space-y-0.5">
                <p className="text-xl tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(summary.totalValue)}
                </p>
                <p className={`text-sm tabular-nums ${summary.pnl >= 0 ? 'text-up' : 'text-down'}`}>
                  {formatPrice(summary.pnl)} ({formatPct(summary.pnlPct)})
                </p>
                <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1">
                  <span>오늘{' '}
                    <span className={`tabular-nums ${summary.dayPnl >= 0 ? 'text-up' : 'text-down'}`}>
                      {summary.dayPnl >= 0 ? '+' : ''}{Math.round(summary.dayPnl).toLocaleString('ko-KR')}원
                    </span>
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-zinc-400">{itemCount}개 종목</span>
                </div>
              </div>
            )}
          </Card>
        )

      case 'news': {
        const newsCount = w.h <= 1 ? 2 : w.h === 2 ? 5 : 8
        const visibleNews = news.slice(0, newsCount)
        return (
          <Card icon={<Newspaper size={14} />} title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            right={!editMode ? (
              <button onClick={e => { e.stopPropagation(); navigate('/news') }}
                className="text-2xs text-accent hover:underline flex items-center gap-0.5">
                상세 <ChevronRight size={10} />
              </button>
            ) : undefined}
            contentClassName="p-3 flex flex-col justify-center"
            minH={minH} className="h-full"
          >
            {loading ? (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 -mx-3 -mb-3">
                {Array.from({ length: newsCount }).map((_, i) => (
                  <div key={i} className="px-3 py-2.5">
                    <Skeleton className="h-4 w-full rounded" />
                  </div>
                ))}
              </div>
            ) : news.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center">뉴스가 없습니다.</p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 -mx-3 -mb-3">
                {visibleNews.map(item => (
                  <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/5 transition-colors">
                    <p className="flex-1 text-xs text-zinc-700 dark:text-zinc-300 line-clamp-1">{item.title}</p>
                    <div className="flex items-center gap-2 flex-shrink-0 text-2xs text-zinc-400 whitespace-nowrap">
                      <span>{item.source ?? ''}</span>
                      <span>{relativeTime(item.published_at)}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Card>
        )
      }

      case 'recommend':
        return (
          <Card icon={<Lightbulb size={14} />} title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            right={!editMode ? (
              <button onClick={e => { e.stopPropagation(); navigate('/recommend') }}
                className="text-2xs text-accent hover:underline flex items-center gap-0.5">
                상세 <ChevronRight size={10} />
              </button>
            ) : undefined}
            minH={minH} className="h-full"
          >
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24 rounded" />
                    <Skeleton className="h-4 w-14 rounded" />
                  </div>
                ))}
              </div>
            ) : top3.length === 0 ? (
              <p className="text-xs text-zinc-400 py-1">추천 데이터가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {top3.map(item => {
                  const strength  = item.strength ? STRENGTH_CONFIG[item.strength] : null
                  const changeCls = (item.change_pct ?? 0) > 0 ? 'text-up' : (item.change_pct ?? 0) < 0 ? 'text-down' : ''
                  return (
                    <div key={item.ticker} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-zinc-800 dark:text-zinc-200 truncate block">{item.name}</span>
                        <span className="text-2xs text-zinc-400">{item.ticker}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 text-xs tabular-nums">
                        {item.change_pct != null && (
                          <span className={changeCls}>{(item.change_pct >= 0 ? '+' : '') + item.change_pct.toFixed(2) + '%'}</span>
                        )}
                        {strength && <span className={`text-xs ${strength.cls}`}>{strength.stars}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )

      case 'planner':
        return (
          <Card icon={<CalendarClock size={14} />} title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            right={!editMode ? (
              <button onClick={e => { e.stopPropagation(); navigate('/planner') }}
                className="text-2xs text-accent hover:underline flex items-center gap-0.5">
                상세 <ChevronRight size={10} />
              </button>
            ) : undefined}
            minH={minH} className="h-full"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 text-center min-w-[60px]">
                <div className="text-2xl text-accent tabular-nums leading-none">D-{dYears}</div>
                <div className="text-2xs text-zinc-400 mt-0.5 whitespace-nowrap">{retirementAge}세 · {retirementYear}년</div>
              </div>
              <div className="flex-1 space-y-1.5">
                {upcomingMilestones.map(m => (
                  <div key={m.year} className="flex items-center justify-between gap-1">
                    <span className="text-2xs text-zinc-500 dark:text-zinc-400 truncate">{m.label}</span>
                    <span className="tag tag-zinc flex-shrink-0">D-{m.year - PLANNER_CURRENT_YEAR}년</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )

      case 'diary': {
        const rd = diary?.raw_data
        const dailyPnl = rd?.true_daily_pnl
        const cumPnl = rd?.pnl
        const cumPnlPct = rd?.pnl_pct
        const dailyCls = dailyPnl != null ? (dailyPnl >= 0 ? 'text-up' : 'text-down') : ''
        const cumCls = cumPnl != null ? (cumPnl >= 0 ? 'text-up' : 'text-down') : ''
        const diaryDateLabel = diary
          ? (() => { const [, m, d] = diary.diary_date.split('-'); return `${parseInt(m)}월 ${parseInt(d)}일` })()
          : null
        const fmtKrw = (v: number) =>
          Math.abs(v) >= 100_000_000
            ? `${(v / 100_000_000).toFixed(2)}억원`
            : `${Math.round(v).toLocaleString('ko-KR')}원`
        const dailyStr = dailyPnl != null
          ? `${dailyPnl >= 0 ? '▲' : '▼'} ${fmtKrw(Math.abs(dailyPnl))} 전일 대비`
          : null
        const cumStr = cumPnl != null && cumPnlPct != null
          ? `누적 ${cumPnl >= 0 ? '+' : ''}${fmtKrw(cumPnl)} (${cumPnlPct >= 0 ? '+' : ''}${cumPnlPct.toFixed(2)}%)`
          : null

        return (
          <Card icon={<BookOpen size={14} />} title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            minH={minH} className="h-full flex flex-col"
            contentClassName="p-4 flex-1 min-h-0 overflow-y-auto"
          >
            {loading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-3 w-5/6 rounded" />
                <Skeleton className="h-3 w-4/6 rounded" />
              </div>
            ) : !diary ? (
              <p className="text-xs text-zinc-400 py-1 text-center">
                아직 일기가 없습니다.<br />
                <span className="text-2xs">장이 있는 날 새벽에 자동으로 작성됩니다.</span>
              </p>
            ) : (
              <div className="space-y-1.5">
                {/* 날짜 + 수익률 헤더 */}
                <div className="flex items-baseline gap-2 flex-wrap">
                  {diaryDateLabel && (
                    <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 leading-tight shrink-0">
                      {diaryDateLabel}
                    </h3>
                  )}
                  {cumStr && (
                    <span className={`text-xs font-semibold tabular-nums ${cumCls}`}>{cumStr}</span>
                  )}
                </div>
                {/* 전일 대비 변동 (상승/하락만 — '수익/손실' 표현 배제) */}
                {dailyStr != null && (
                  <p className={`text-2xs tabular-nums ${dailyCls}`}>{dailyStr}</p>
                )}
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {diary.content}
                </p>
              </div>
            )}
          </Card>
        )
      }

      case 'shortcuts':
        return (
          <Card icon={<ChevronRight size={14} />} title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            minH={minH} className="h-full"
          >
            <div className="grid grid-cols-4 gap-2">
              {NAV_CARDS.map(card => (
                <button key={card.to} onClick={() => navigate(card.to)}
                  className="flex flex-col items-center gap-1.5 py-3 border border-zinc-200 dark:border-zinc-700 rounded-xl surface hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-accent/5 transition-colors">
                  <span className="text-zinc-400 dark:text-zinc-500">{card.icon}</span>
                  <span className="text-2xs text-zinc-500 dark:text-zinc-400">{card.label}</span>
                </button>
              ))}
            </div>
          </Card>
        )

      case 'photo':
        return (
          <PhotoWidget
            widgetW={w.w}
            widgetH={w.h}
            title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            minH={minH}
          />
        )

      case 'calendar':
        return (
          <CalendarWidget
            widgetW={w.w}
            widgetH={w.h}
            title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            minH={minH}
          />
        )

      case 'calendar-events': {
        const nowIso    = new Date().toISOString()
        const showCount = w.h <= 1 ? 2 : w.h === 2 ? 5 : 8
        const showDetails = w.h >= 2
        const upcoming = [...upcomingEvents]
          .filter(ev => ev.start_dt && ev.start_dt >= nowIso)
          .sort((a, b) => (a.start_dt ?? '').localeCompare(b.start_dt ?? ''))
          .slice(0, showCount)

        return (
          <Card icon={<CalendarClock size={14} />} title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            contentClassName="p-3 flex flex-col justify-center"
            minH={minH} className="h-full"
          >
            {upcoming.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center">
                {upcomingEvents.length === 0 ? '연동된 일정이 없습니다' : '예정된 일정이 없습니다'}
              </p>
            ) : (
              <div className="space-y-2 overflow-hidden">
                {upcoming.map(ev => {
                  const d    = new Date(ev.start_dt! + 'Z')
                  const kstD = new Date(d.getTime() + 9 * 3600 * 1000)
                  const dateStr = ev.all_day
                    ? `${kstD.getUTCMonth()+1}월 ${kstD.getUTCDate()}일`
                    : `${kstD.getUTCMonth()+1}/${kstD.getUTCDate()} ${String(kstD.getUTCHours()).padStart(2,'0')}:${String(kstD.getUTCMinutes()).padStart(2,'0')}`
                  const isToday = kstD.toDateString() === new Date(new Date().getTime() + 9*3600*1000).toDateString()
                  return (
                    <div key={ev.id} className="flex items-start gap-2.5">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isToday ? 'bg-up' : 'bg-accent'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-tight truncate">{ev.summary ?? '(제목 없음)'}</p>
                        <p className={`text-2xs mt-0.5 tabular-nums ${isToday ? 'text-up font-medium' : 'text-zinc-400'}`}>
                          {dateStr}{isToday ? ' · 오늘' : ''}
                        </p>
                        {showDetails && ev.location && (
                          <p className="text-2xs mt-0.5 text-zinc-400 truncate">📍 {ev.location}</p>
                        )}
                        {showDetails && ev.description && (
                          <p className="text-2xs mt-0.5 text-zinc-400 line-clamp-1">{ev.description}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )
      }

      case 'weather':
        return (
          <WeatherWidget
            widgetW={w.w}
            widgetH={w.h}
            title={widgetTitle}
            dragHandle={editMode ? <Move size={13} className="text-accent/60" /> : undefined}
            minH={minH}
          />
        )

      default:
        return null
    }
  }, [loading, editMode, itemCount, summary, kisAccounts, top3, news, diary, upcomingEvents, upcomingMilestones, dYears, retirementAge, retirementYear, navigate])

  // ── 숨겨진 위젯 추가 버튼 (편집 모드) ─────────────────────────────────────────

  const hiddenWidgets = useMemo(() => widgets.filter(w => !w.visible), [widgets])
  const nextY = maxRow

  function addWidget(id: string) {
    setWidgets(prev => {
      const next = prev.map(w => w.id === id ? { ...w, visible: true, x: 0, y: nextY } : w)
      persistWidgets(next)
      return next
    })
  }

  // DropGhost 계산 — 항상 존재하는 DOM 노드를 위한 visible 플래그
  const ghostWidget = dragState ? widgets.find(x => x.id === dragState.widgetId) : undefined

  // ── 렌더 ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3" translate="no">
      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 페이지 타이틀 */}
      <PageTitle
        sub={greeting.split(' ').slice(1).join(' ')}
        title="SWEET HOME"
      />

      {/* 툴바 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {editMode ? (
            <>
              {/* 위젯 표시 */}
              <button
                onClick={() => setShowPanel(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-2xs text-zinc-500 dark:text-zinc-400 surface hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 transition-colors"
              >
                <LayoutGrid size={12} /> 위젯 설정
              </button>
              {/* 기본값 복원 */}
              <button
                onClick={() => { setWidgets(DEFAULT_WIDGETS); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-2xs text-zinc-400 surface hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 transition-colors"
                title="기본 레이아웃으로 초기화"
              >
                초기화
              </button>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {editMode ? (
            <>
              <button
                onClick={() => exitEditMode(false)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-2xs text-zinc-500 surface border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <X size={12} /> 취소
              </button>
              <button
                onClick={() => exitEditMode(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-2xs text-white bg-accent hover:bg-accent/90 transition-colors font-medium"
              >
                <Check size={12} /> 저장
              </button>
            </>
          ) : (
            <button
              onClick={enterEditMode}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-2xs text-zinc-400 hover:text-accent surface hover:bg-accent/8 border border-zinc-200 dark:border-zinc-700 hover:border-accent/30 transition-colors"
            >
              <LayoutGrid size={12} />
              레이아웃 편집
            </button>
          )}
        </div>
      </div>

      {/* 편집 모드 안내 */}
      {editMode && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-accent/8 border border-accent/20 text-2xs text-accent/80">
          <Move size={12} />
          <span>헤더를 드래그해 이동 · 오른쪽 하단 핸들로 크기 조절 · 저장을 눌러 완료</span>
        </div>
      )}

      {/* 위젯 그리드 */}
      <div className="relative">
        {/* 편집 모드 그리드 오버레이 (absolute — CSS grid 밖에서 렌더링해 grid 자식 순서 안정화) */}
        {editMode && <GridOverlay key="grid-overlay" rows={maxRow} />}

        <div
          key={`grid-${editMode}`}
          ref={gridRef}
          translate="no"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
            gridAutoRows: GRID_ROW_H + 'px',
            gap: GRID_GAP + 'px',
          }}
        >
          {/* 드롭 존 고스트 — 항상 DOM에 존재해 insertBefore 에러 방지 */}
          <DropGhost
            key="drop-ghost"
            visible={!!ghostWidget}
            x={dragState?.targetX ?? 0}
            y={dragState?.targetY ?? 0}
            w={ghostWidget?.w ?? 1}
            h={ghostWidget?.h ?? 1}
          />

          {/* 위젯 셀 */}
          {visibleWidgets.map(w => (
            <WidgetCell
              key={w.id}
              widget={w}
              editMode={editMode}
              isDragging={dragState?.widgetId === w.id}
              onDragStart={e => startDrag(e, w.id)}
              onResizeStart={e => startResize(e, w.id)}
            >
              <WidgetErrorBoundary widgetId={w.id} resetKey={editMode}>
                {renderCard(w)}
              </WidgetErrorBoundary>
            </WidgetCell>
          ))}

          {/* 숨겨진 위젯 추가 (편집 모드) */}
          {editMode && hiddenWidgets.map(w => {
            const meta = WIDGET_META.find(m => m.id === w.id)
            return (
              <div
                key={w.id}
                style={{
                  gridColumn: `span 2`,
                  gridRow: `${nextY + 1} / span 1`,
                  minHeight: GRID_ROW_H + 'px',
                }}
                className="border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl flex flex-col items-center justify-center gap-2 text-zinc-400 hover:border-accent/40 hover:text-accent transition-colors cursor-pointer"
                onClick={() => addWidget(w.id)}
              >
                <Plus size={18} />
                <span className="text-xs">{meta?.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 위젯 표시 패널 */}
      {showPanel && (
        <WidgetPanel
          widgets={widgets}
          onChange={next => { serverSynced.current = true; setWidgets(next); persistWidgets(next) }}
          onClose={() => setShowPanel(false)}
        />
      )}
    </div>
  )
}

function Home() {
  return (
    <HomeErrorBoundary>
      <HomeContent />
    </HomeErrorBoundary>
  )
}

export default Home
