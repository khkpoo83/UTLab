// Home dashboard widget-grid model + pure layout logic (roadmap Phase 3, P3-3).
// Extracted verbatim from pages/Home.tsx to shrink that god-component. No JSX —
// types, persistence, and the DnD placement/compaction math only.
import { settingsApi, KISPortfolioAccount, RecommendItem, RecommendGroup } from '../../api/client'

export const GRID_COLS  = 4
export const GRID_ROW_H = 180   // px per row unit
export const GRID_GAP   = 12    // px (gap-3)

// 위젯 높이(h)에 들어가는 리스트 항목 수 계산 — 스크롤 없이 사이즈에 맞춤
export function fitCount(h: number, rowPx: number, headerPx = 62, footerPx = 0): number {
  const avail = h * GRID_ROW_H + (h - 1) * GRID_GAP - headerPx - footerPx - 6 /* 여유 */
  return Math.max(1, Math.floor(avail / rowPx))
}

export interface WidgetCfg {
  id: string
  visible: boolean
  x: number   // 0-based column start
  y: number   // 0-based row start
  w: number   // column span (1–GRID_COLS)
  h: number   // row span (1+)
  customTitle?: string
}

export interface DragState {
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

export interface ResizeState {
  widgetId: string
  startPx:  number
  startPy:  number
  origW:    number
  origH:    number
  cellW:    number
}

// 기본 레이아웃 (4열 그리드)
export const DEFAULT_WIDGETS: WidgetCfg[] = [
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

export const WIDGET_STORAGE_KEY = 'home_widgets_v4'

export function colsToX(size?: string): { x: number; w: number } {
  switch (size) {
    case 'quarter':       return { x: 0, w: 1 }
    case 'three-quarter': return { x: 0, w: 3 }
    case 'full':          return { x: 0, w: 4 }
    default:              return { x: 0, w: 2 }
  }
}

export function loadWidgets(serverData?: WidgetCfg[] | null): WidgetCfg[] {
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

export function persistWidgets(widgets: WidgetCfg[]) {
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(widgets))
  settingsApi.update({ ui_home_widgets: widgets }).catch(() => {})
}

// 위젯을 (nx, ny)에 배치 – 겹치는 위젯은 아래로 밀어냄
export function placeWidget(widgets: WidgetCfg[], id: string, nx: number, ny: number): WidgetCfg[] {
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
export function compactWidgets(widgets: WidgetCfg[]): WidgetCfg[] {
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

// ── 데이터 헬퍼 ──

export function calcKisSummary(kisAccounts: KISPortfolioAccount[]) {
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

export function flattenRecommends(groups: RecommendGroup[]): RecommendItem[] {
  const all: RecommendItem[] = []
  for (const g of groups)
    for (const item of g.items)
      if (!item.is_portfolio) all.push(item)
  const order: Record<string, number> = { strong: 0, normal: 1, watch: 2 }
  all.sort((a, b) => (order[a.strength ?? 'watch'] ?? 2) - (order[b.strength ?? 'watch'] ?? 2))
  return all.slice(0, 3)
}
