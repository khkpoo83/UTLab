import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { StackedCardGroup, type StackedRow } from '../components/card/StackedCardGroup'
import { ListSectionCard } from '../components/card/ListSectionCard'
import { SectionCard } from '../components/card/SectionCard'
import { formatPrice, relativeTime } from '../utils/format'
import { STRENGTH_CONFIG } from '../constants/stock'
import {
  portfolioApi, kisApi, recommendApi, newsApi, diaryApi, settingsApi, calendarApi,
  KISPortfolioAccount, RecommendItem, NewsItem, DiaryEntry, CalendarEventItem,
} from '../api/client'

// ── 홈 서브타이틀 풀 ─────────────────────────────────────────────────────────

const HOME_SUBS = [
  'MY PORTFOLIO',
  'DAILY BRIEFING',
  'MARKET WATCH',
  'INVESTMENT LOG',
  'ASSET TRACKER',
  'FINANCIAL HQ',
  'PORTFOLIO DESK',
]

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

// 위젯 높이(h)에 들어가는 리스트 항목 수 계산 — 스크롤 없이 사이즈에 맞춤
function fitCount(h: number, rowPx: number, headerPx = 62, footerPx = 0): number {
  const avail = h * GRID_ROW_H + (h - 1) * GRID_GAP - headerPx - footerPx - 6 /* 여유 */
  return Math.max(1, Math.floor(avail / rowPx))
}

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
      className="absolute bottom-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-md cursor-nwse-resize z-30 touch-none select-none bg-white/90 dark:bg-zinc-900/90 border border-ink-5 shadow-sm hover:bg-accent/10 hover:border-accent/50 transition-colors"
      title="드래그로 크기 조절"
    >
      {/* 코너 리사이즈 아이콘: 왼쪽 상단 + 오른쪽 하단 L자 화살표 */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-ink-4">
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--divide)]">
          <div className="flex items-center gap-2">
            <LayoutGrid size={14} className="text-accent" />
            <span className="text-sm font-semibold text-ink-0">위젯 표시 설정</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-ink-4 hover:text-ink-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 py-2">
          {widgets.map(w => {
            const meta = WIDGET_META.find(m => m.id === w.id)
            if (!meta) return null
            return (
              <div key={w.id} className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <span className="text-ink-4 flex-shrink-0">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <input
                    key={w.id + '|' + (w.customTitle ?? '')}
                    defaultValue={w.customTitle ?? meta.label}
                    placeholder={meta.label}
                    onBlur={e => commitTitle(w.id, e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTitle(w.id, e.currentTarget.value) } }}
                    className="w-full text-sm text-ink-1 bg-transparent outline-none border-b border-transparent focus:border-accent/50 pb-px truncate"
                  />
                  {w.customTitle && w.customTitle !== meta.label && (
                    <p className="text-2xs text-ink-4 truncate">{meta.label}</p>
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

        <div className="px-4 py-3 border-t border-[var(--divide)] text-2xs text-ink-4 text-center">
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
          <p className="text-xs text-ink-4">위젯 오류</p>
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
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-ink-3">
          <p className="text-sm">레이아웃 오류가 발생했습니다.</p>
          {this.state.msg && (
            <p className="text-xs text-ink-4 max-w-sm text-center">{this.state.msg}</p>
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
  const homeSub  = useMemo(() => HOME_SUBS[Math.floor(Math.random() * HOME_SUBS.length)], [])
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
      case 'portfolio': {
        if (loading) {
          return (
            <div style={{
              background: 'var(--c-surface)', border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)', overflow: 'hidden', height: '100%',
            }}>
              <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)' }}>
                <Skeleton className="h-2.5 w-20 rounded mb-2" />
                <Skeleton className="h-5 w-40 rounded" />
              </div>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ padding: '14px 22px', borderBottom: i < 2 ? '1px solid var(--line-2)' : 'none' }}>
                  <Skeleton className="h-2.5 w-16 rounded mb-2" />
                  <Skeleton className="h-4 w-28 rounded" />
                </div>
              ))}
            </div>
          )
        }
        const pfBase: StackedRow[] = itemCount === 0 ? [{ label: '안내', value: '보유 종목이 없습니다.' }] : [
          {
            label: '평가손익',
            value: (summary.pnl >= 0 ? '+' : '') + formatPrice(summary.pnl),
            trail: (summary.pnlPct >= 0 ? '+' : '') + summary.pnlPct.toFixed(2) + '%',
            deltaTone: summary.pnl >= 0 ? 'up' : 'down',
          },
          {
            label: '오늘 손익',
            value: (summary.dayPnl >= 0 ? '+' : '') + Math.round(summary.dayPnl).toLocaleString('ko-KR') + '원',
            deltaTone: summary.dayPnl >= 0 ? 'up' : 'down',
          },
          { label: '보유 종목', value: `${itemCount}개` },
        ]
        // 높이 티어: 작음=핵심 1행 / 기본=3지표 / 큼=+보유 상위 종목
        let pfRows = pfBase
        if (itemCount > 0) {
          if (w.h <= 1) {
            pfRows = pfBase.slice(0, 1)
          } else if (w.h >= 3) {
            const need = fitCount(w.h, 68, 62) - pfBase.length
            if (need > 0) {
              const holdings: StackedRow[] = kisAccounts
                .flatMap(a => a.holdings)
                .sort((x, y) => (y.current_value ?? 0) - (x.current_value ?? 0))
                .slice(0, need)
                .map(h => ({
                  label: h.name,
                  value: (h.pnl_pct >= 0 ? '+' : '') + h.pnl_pct.toFixed(2) + '%',
                  trail: formatPrice(h.current_value),
                  deltaTone: h.pnl_pct >= 0 ? 'up' : 'down',
                }))
              pfRows = [...pfBase, ...holdings]
            }
          }
        }
        return (
          <StackedCardGroup
            header={{
              eyebrow: widgetTitle,
              title: itemCount === 0 ? '종목 없음' : formatPrice(summary.totalValue),
              action: !editMode ? { label: '상세', onClick: () => navigate('/portfolio') } : undefined,
            }}
            rows={pfRows}
            density={w.h <= 1 ? 'compact' : 'default'}
          />
        )
      }

      case 'news': {
        const newsCount = fitCount(w.h, w.h <= 1 ? 34 : 38, w.h <= 1 ? 58 : 66, w.h <= 1 ? 36 : 40)
        const visibleNews = news.slice(0, newsCount)
        type NewsListItem = NewsItem | null
        const newsItems: NewsListItem[] = loading
          ? Array.from({ length: newsCount }, () => null)
          : visibleNews
        return (
          <ListSectionCard
            header={{
              eyebrow: widgetTitle,
              title: '오늘의 뉴스',
              meta: loading ? undefined : `${visibleNews.length}건`,
            }}
            items={newsItems}
            renderItem={(item, i) => {
              if (!item) {
                return (
                  <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--line-2)' }}>
                    <Skeleton className="h-4 w-full rounded" />
                  </div>
                )
              }
              const isLast = i === newsItems.length - 1
              return (
                <a href={item.url} target="_blank" rel="noopener noreferrer" style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: w.h <= 1 ? '8px 18px' : '10px 22px',
                  borderBottom: isLast ? 'none' : '1px solid var(--line-2)',
                  textDecoration: 'none',
                }} className="hover:bg-accent/5 transition-colors">
                  <p style={{ flex: 1, fontSize: 13, color: 'var(--ink-1)', lineHeight: 1.4 }} className="line-clamp-1">
                    {item.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span className="ut-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{item.source ?? ''}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{relativeTime(item.published_at)}</span>
                  </div>
                </a>
              )
            }}
            footer={!editMode && !loading ? (
              <button onClick={() => navigate('/news')} style={{
                fontSize: 12, color: 'var(--ink-4)', cursor: 'pointer',
                background: 'none', border: 'none', padding: 0,
              }}>
                전체 뉴스 보기 →
              </button>
            ) : undefined}
            density="compact"
          />
        )
      }

      case 'recommend': {
        type RecListItem = RecommendItem | number
        const recCount = fitCount(w.h, w.h <= 1 ? 46 : 55, w.h <= 1 ? 58 : 66, w.h <= 1 ? 40 : 44)
        const recItems: RecListItem[] = loading ? [0, 1, 2] : top3.slice(0, recCount)
        return (
          <ListSectionCard
            header={{
              eyebrow: widgetTitle,
              title: 'AI 추천',
              meta: loading ? undefined : recItems.length > 0 ? `Top ${recItems.length}` : undefined,
            }}
            items={recItems}
            renderItem={(item, i) => {
              if (typeof item === 'number') {
                return (
                  <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--line-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Skeleton className="h-3.5 w-24 rounded mb-1.5" />
                      <Skeleton className="h-2.5 w-14 rounded" />
                    </div>
                    <Skeleton className="h-3.5 w-14 rounded" />
                  </div>
                )
              }
              const rec = item as RecommendItem
              const strength = rec.strength ? STRENGTH_CONFIG[rec.strength] : null
              const isUp   = (rec.change_pct ?? 0) > 0
              const isDown = (rec.change_pct ?? 0) < 0
              const isLast = i === recItems.length - 1
              return (
                <div style={{
                  padding: w.h <= 1 ? '8px 22px' : '11px 22px',
                  borderBottom: isLast ? 'none' : '1px solid var(--line-2)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span className="ut-mono" style={{ fontSize: 10, color: 'var(--ink-4)', minWidth: 18, flexShrink: 0 }}>
                    #{i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-0)' }} className="truncate">{rec.name}</div>
                    <div className="ut-mono" style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 1 }}>{rec.ticker}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {rec.change_pct != null && (
                      <span className={`ut-mono ${isUp ? 'ut-up' : isDown ? 'ut-down' : ''}`} style={{ fontSize: 12 }}>
                        {(rec.change_pct >= 0 ? '+' : '') + rec.change_pct.toFixed(2) + '%'}
                      </span>
                    )}
                    {strength && <span style={{ fontSize: 12 }} className={strength.cls}>{strength.stars}</span>}
                  </div>
                </div>
              )
            }}
            footer={!editMode && !loading ? (
              top3.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>추천 데이터가 없습니다.</span>
              ) : (
                <button onClick={() => navigate('/recommend')} style={{
                  fontSize: 12, color: 'var(--ink-4)', cursor: 'pointer',
                  background: 'none', border: 'none', padding: 0,
                }}>
                  전체 추천 보기 →
                </button>
              )
            ) : undefined}
            density={w.h <= 1 ? 'compact' : 'default'}
          />
        )
      }

      case 'planner': {
        const plBase: StackedRow[] = [
          { label: '목표 은퇴', value: `${retirementAge}세`, trail: `${retirementYear}년` },
          ...upcomingMilestones.map(m => ({
            label: m.label,
            value: `D-${m.year - PLANNER_CURRENT_YEAR}년`,
            trail: `${m.year}년 (${m.age}세)`,
          })),
        ]
        // 높이 티어: 작음=D-은퇴 1행 / 그 이상=들어가는 만큼
        const plRows = w.h <= 1 ? plBase.slice(0, 1) : plBase.slice(0, fitCount(w.h, 68, 62))
        return (
          <StackedCardGroup
            header={{
              eyebrow: widgetTitle,
              title: `D-${dYears}년`,
              action: !editMode ? { label: '플래너', onClick: () => navigate('/planner') } : undefined,
            }}
            rows={plRows}
            density={w.h <= 1 ? 'compact' : 'default'}
          />
        )
      }

      case 'diary': {
        const rd = diary?.raw_data
        const dailyPnl = rd?.true_daily_pnl
        const cumPnl = rd?.pnl
        const cumPnlPct = rd?.pnl_pct
        const diaryDateLabel = diary
          ? (() => { const [, m, d] = diary.diary_date.split('-'); return `${parseInt(m)}월 ${parseInt(d)}일` })()
          : '투자 일기'
        const fmtKrw = (v: number) =>
          Math.abs(v) >= 100_000_000
            ? `${(v / 100_000_000).toFixed(2)}억원`
            : `${Math.round(v).toLocaleString('ko-KR')}원`

        return (
          <SectionCard
            eyebrow={widgetTitle}
            title={diaryDateLabel}
            density={w.h <= 1 ? 'compact' : 'default'}
          >
            {loading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-3 w-5/6 rounded" />
                <Skeleton className="h-3 w-4/6 rounded" />
              </div>
            ) : !diary ? (
              <p style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', padding: '8px 0' }}>
                아직 일기가 없습니다.<br />
                <span style={{ fontSize: 11 }}>장이 있는 날 새벽에 자동으로 작성됩니다.</span>
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(cumPnl != null || dailyPnl != null) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', alignItems: 'baseline' }}>
                    {cumPnl != null && cumPnlPct != null && (
                      <span className={`ut-mono ${cumPnl >= 0 ? 'ut-up' : 'ut-down'}`} style={{ fontSize: 12, fontWeight: 600 }}>
                        누적 {cumPnl >= 0 ? '+' : ''}{fmtKrw(cumPnl)} ({cumPnlPct >= 0 ? '+' : ''}{cumPnlPct.toFixed(2)}%)
                      </span>
                    )}
                    {dailyPnl != null && (
                      <span className={`ut-mono ${dailyPnl >= 0 ? 'ut-up' : 'ut-down'}`} style={{ fontSize: 11, opacity: 0.8 }}>
                        {dailyPnl >= 0 ? '▲' : '▼'} {fmtKrw(Math.abs(dailyPnl))} 전일 대비
                      </span>
                    )}
                  </div>
                )}
                <p className="ut-body-sm" style={{
                  lineHeight: 1.65, whiteSpace: 'pre-wrap',
                }}>
                  {diary.content}
                </p>
              </div>
            )}
          </SectionCard>
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
                  className="flex flex-col items-center gap-1.5 py-3 hover:bg-accent/5 transition-colors"
                  style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: 'var(--c-surface)' }}>
                  <span style={{ color: 'var(--ink-4)' }}>{card.icon}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>{card.label}</span>
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
        const nowIso = new Date().toISOString()
        const showCount = fitCount(w.h, w.h <= 1 ? 50 : 54, w.h <= 1 ? 58 : 66)
        const upcoming = [...upcomingEvents]
          .filter(ev => ev.start_dt && ev.start_dt >= nowIso)
          .sort((a, b) => (a.start_dt ?? '').localeCompare(b.start_dt ?? ''))
          .slice(0, showCount)

        return (
          <ListSectionCard
            header={{
              eyebrow: widgetTitle,
              title: '다가오는 일정',
              meta: upcoming.length > 0 ? `${upcoming.length}건` : undefined,
            }}
            items={upcoming}
            renderItem={(ev, i) => {
              const d = new Date(ev.start_dt! + 'Z')
              const kstD = new Date(d.getTime() + 9 * 3600 * 1000)
              const dateStr = ev.all_day
                ? `${kstD.getUTCMonth()+1}월 ${kstD.getUTCDate()}일`
                : `${kstD.getUTCMonth()+1}/${kstD.getUTCDate()} ${String(kstD.getUTCHours()).padStart(2,'0')}:${String(kstD.getUTCMinutes()).padStart(2,'0')}`
              const isToday = kstD.toDateString() === new Date(new Date().getTime() + 9*3600*1000).toDateString()
              const isLast = i === upcoming.length - 1
              return (
                <div key={ev.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: w.h <= 1 ? '8px 18px' : '10px 22px',
                  borderBottom: isLast ? 'none' : '1px solid var(--line-2)',
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                    background: isToday ? 'var(--up)' : 'var(--dot)',
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 13, color: 'var(--ink-1)', lineHeight: 1.3 }} className="truncate">
                      {ev.summary ?? '(제목 없음)'}
                    </p>
                    <p className="ut-mono" style={{
                      fontSize: 11, marginTop: 2,
                      color: isToday ? 'var(--up)' : 'var(--ink-4)',
                      fontWeight: isToday ? 600 : 400,
                    }}>
                      {dateStr}{isToday ? ' · 오늘' : ''}
                    </p>
                  </div>
                </div>
              )
            }}
            footer={upcoming.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                {upcomingEvents.length === 0 ? '연동된 일정이 없습니다' : '예정된 일정이 없습니다'}
              </span>
            ) : undefined}
            density={w.h <= 1 ? 'compact' : 'default'}
          />
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
        sub={homeSub}
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
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-2xs text-ink-3 surface hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-ink-5 transition-colors"
              >
                <LayoutGrid size={12} /> 위젯 설정
              </button>
              {/* 기본값 복원 */}
              <button
                onClick={() => { setWidgets(DEFAULT_WIDGETS); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-2xs text-ink-4 surface hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-ink-5 transition-colors"
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
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-2xs text-ink-3 surface border border-ink-5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-2xs text-ink-4 hover:text-accent surface hover:bg-accent/8 border border-ink-5 hover:border-accent/30 transition-colors"
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
                className="border-2 border-dashed border-ink-5 rounded-xl flex flex-col items-center justify-center gap-2 text-ink-4 hover:border-accent/40 hover:text-accent transition-colors cursor-pointer"
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
