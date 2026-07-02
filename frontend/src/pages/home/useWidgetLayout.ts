// Home dashboard widget layout + DnD interaction (roadmap Phase 3, P3-3 deep
// decomposition). Extracted verbatim from HomeContent — widget state, server
// layout sync, pointer drag/resize, edit mode, and derived ordering. The page
// keeps only the renderCard switch + JSX and consumes this hook.
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { settingsApi } from '../../api/client'
import {
  GRID_COLS, GRID_ROW_H, GRID_GAP, DEFAULT_WIDGETS, WIDGET_STORAGE_KEY,
  loadWidgets, persistWidgets, placeWidget, compactWidgets,
} from './widgetGrid'
import type { WidgetCfg, DragState, ResizeState } from './widgetGrid'

const MOBILE_QUERY = '(max-width: 639px)'
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

export function useWidgetLayout() {
  const [widgets,    setWidgets]    = useState<WidgetCfg[]>(() => loadWidgets())
  const [editMode,   setEditMode]   = useState(false)
  const isMobile = useIsMobile()
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

  // ── 서버 위젯 레이아웃 동기화 ────────────────────────────────────────────────
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

  // ── 드래그 & 리사이즈 이벤트 ─────────────────────────────────────────────────
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
  const visibleWidgets = useMemo(() => widgets.filter(w => w.visible), [widgets])
  const maxRow = useMemo(() => visibleWidgets.reduce((m, w) => Math.max(m, w.y + w.h), 0), [visibleWidgets])
  // 모바일 단일 컬럼 스택 순서 = 레이아웃 위치(위→아래, 좌→우) 그대로
  const orderedWidgets = useMemo(
    () => (isMobile ? [...visibleWidgets].sort((a, b) => (a.y - b.y) || (a.x - b.x)) : visibleWidgets),
    [isMobile, visibleWidgets],
  )
  const hiddenWidgets = useMemo(() => widgets.filter(w => !w.visible), [widgets])
  // 편집 모드는 데스크탑 전용 — 모바일로 전환되면 편집 이탈
  useEffect(() => {
    if (isMobile && editMode) setEditMode(false)
  }, [isMobile, editMode])

  function addWidget(id: string) {
    const nextY = maxRow
    setWidgets(prev => {
      const next = prev.map(w => w.id === id ? { ...w, visible: true, x: 0, y: nextY } : w)
      persistWidgets(next)
      return next
    })
  }

  // 레이아웃 초기화 (기본값으로) — 편집 모드 리셋 버튼
  const resetWidgets = () => setWidgets(DEFAULT_WIDGETS)
  // 위젯 패널에서 표시/순서 변경 → 서버동기화 플래그 + 저장
  const applyWidgets = (next: WidgetCfg[]) => {
    serverSynced.current = true
    setWidgets(next)
    persistWidgets(next)
  }

  return {
    widgets, editMode, showPanel, setShowPanel, dragState, resizeState, gridRef, isMobile,
    orderedWidgets, maxRow, hiddenWidgets,
    startDrag, startResize, enterEditMode, exitEditMode, addWidget, resetWidgets, applyWidgets,
  }
}
