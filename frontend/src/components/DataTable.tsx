import React, { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, closestCenter, PointerSensor,
  useSensor, useSensors, DragEndEvent, DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext, horizontalListSortingStrategy, arrayMove, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowUp, ArrowDown, ChevronsUpDown, Settings2, GripVertical, Search, X, Filter, ChevronDown,
} from 'lucide-react'
import Sparkline from './Sparkline'

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type CellType = 'text' | 'number' | 'pnl' | 'pnl-pct' | 'pct-bar' | 'sparkline'

export interface ColDef<T = Record<string, unknown>> {
  key: string
  label: string
  getValue?: (row: T) => unknown
  width?: number
  minWidth?: number
  sortable?: boolean
  resizable?: boolean
  align?: 'left' | 'right' | 'center'
  type?: CellType
  barMax?: number
  render?: (row: T) => React.ReactNode
  visible?: boolean
  /** 필터 타입 명시. false = 필터 없음. 미설정 = type/sortable 기반 자동 감지 */
  filterType?: 'text' | 'number' | false
}

export interface SortEntry { key: string; dir: 'asc' | 'desc' }

export interface DataTableProps<T = Record<string, unknown>> {
  id: string
  columns: ColDef<T>[]
  data: T[]
  rowKey: (row: T) => string | number
  onRowClick?: (row: T) => void
  selectedKey?: string | number
  loading?: boolean
  skeletonRows?: number
  emptyMessage?: string
  className?: string
  stickyHeader?: boolean
  sort?: SortEntry[]
  onSortChange?: (sort: SortEntry[]) => void
  /** 서버에서 불러온 컬럼 설정 (있으면 localStorage보다 우선 적용) */
  serverState?: PersistedState | null
  /** 컬럼 상태 변경 시 호출 (800ms 디바운스) - 서버 저장용 */
  onPersist?: (s: PersistedState) => void
}

// ── 내부 필터 타입 ────────────────────────────────────────────────────────────

type NumOp = '>=' | '<=' | '>' | '<' | '=' | '!='
const NUM_OPS: NumOp[] = ['>=', '<=', '>', '<', '=', '!=']
const OP_LABEL: Record<NumOp, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '=': '=', '!=': '≠' }
const OP_DESC: Record<NumOp, string>  = { '>=': '이상', '<=': '이하', '>': '초과', '<': '미만', '=': '같음', '!=': '다름' }

interface FilterEntry { value: string; operator: NumOp }

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFilterType(col: ColDef<any>): 'text' | 'number' | null {
  if (col.filterType === false) return null
  if (col.filterType) return col.filterType
  if (col.sortable === false) return null
  if (col.type === 'number' || col.type === 'pnl' || col.type === 'pnl-pct' || col.type === 'pct-bar') return 'number'
  return 'text'
}

function compareNum(n: number, fv: number, op: NumOp): boolean {
  switch (op) {
    case '>=': return n >= fv
    case '<=': return n <= fv
    case '>':  return n > fv
    case '<':  return n < fv
    case '=':  return n === fv
    case '!=': return n !== fv
  }
}

// ── 정렬 ──────────────────────────────────────────────────────────────────────

function nextSort(current: SortEntry[], key: string, multi: boolean): SortEntry[] {
  const idx = current.findIndex(s => s.key === key)
  if (!multi) {
    if (idx < 0) return [{ key, dir: 'asc' }]
    if (current[idx].dir === 'asc') return [{ key, dir: 'desc' }]
    return []
  }
  if (idx < 0) return [...current, { key, dir: 'asc' }]
  if (current[idx].dir === 'asc')
    return current.map((s, i) => i === idx ? { ...s, dir: 'desc' as const } : s)
  return current.filter((_, i) => i !== idx)
}

function applySorts<T>(rows: T[], sorts: SortEntry[], colMap: Map<string, ColDef<T>>): T[] {
  if (!sorts.length) return rows
  return [...rows].sort((a, b) => {
    for (const { key, dir } of sorts) {
      const col = colMap.get(key)
      const av = col?.getValue ? col.getValue(a) : (a as Record<string, unknown>)[key]
      const bv = col?.getValue ? col.getValue(b) : (b as Record<string, unknown>)[key]
      let cmp = 0
      if (av == null && bv != null) cmp = 1
      else if (av != null && bv == null) cmp = -1
      else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else if (av != null && bv != null) cmp = String(av).localeCompare(String(bv), 'ko')
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
    }
    return 0
  })
}

// ── 필터 ──────────────────────────────────────────────────────────────────────

function applyFilters<T>(
  rows: T[],
  filters: Record<string, FilterEntry>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colMap: Map<string, ColDef<any>>,
): T[] {
  const active = Object.entries(filters).filter(([, f]) => f.value.trim())
  if (!active.length) return rows
  return rows.filter(row => {
    for (const [key, f] of active) {
      const col = colMap.get(key)
      const raw = col?.getValue ? col.getValue(row) : (row as Record<string, unknown>)[key]
      const ft = col ? getFilterType(col) : null
      if (ft === 'text') {
        if (!String(raw ?? '').toLowerCase().includes(f.value.toLowerCase())) return false
      } else if (ft === 'number') {
        const fv = Number(f.value)
        if (!isNaN(fv) && !compareNum(Number(raw ?? 0), fv, f.operator)) return false
      }
    }
    return true
  })
}

// ── localStorage ──────────────────────────────────────────────────────────────

export interface PersistedState { colOrder: string[]; colWidths: Record<string, number>; hiddenKeys: string[] }

function loadState(id: string): PersistedState | null {
  try { return JSON.parse(localStorage.getItem(`dt_${id}`) ?? 'null') } catch { return null }
}
function saveState(id: string, s: PersistedState) {
  try { localStorage.setItem(`dt_${id}`, JSON.stringify(s)) } catch {}
}

// ── pct-bar 셀 ───────────────────────────────────────────────────────────────
// 프로그레스 바 스타일: 내부에 숫자 표시, 채움 비율에 따라 텍스트 가시성 조정

function PctBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(Math.abs(value) / max * 100, 100)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 0, overflow: 'hidden' }}>
      <span className="ut-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-0)' }}>
        {value.toFixed(1)}%
      </span>
      <div style={{ width: '100%', height: 4, background: 'var(--cream)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ink-1)', borderRadius: 2 }} />
      </div>
    </div>
  )
}

// ── 셀 렌더러 ────────────────────────────────────────────────────────────────

function CellContent<T>({ col, row }: { col: ColDef<T>; row: T }) {
  if (col.render) return <>{col.render(row)}</>
  const raw = (row as Record<string, unknown>)[col.key]

  switch (col.type) {
    case 'pnl': {
      const n = raw as number | null | undefined
      if (n == null) return <span style={{ color: 'var(--ink-4)' }}>-</span>
      return (
        <span className="ut-mono" style={{ fontWeight: 600, color: n >= 0 ? 'var(--up)' : 'var(--down)', fontSize: 13 }}>
          <span style={{ fontSize: 9, marginRight: 2 }}>{n >= 0 ? '▲' : '▼'}</span>
          {Math.abs(n).toLocaleString('ko-KR')}
        </span>
      )
    }
    case 'pnl-pct': {
      const n = raw as number | null | undefined
      if (n == null) return <span style={{ color: 'var(--ink-4)' }}>-</span>
      return (
        <span className="ut-mono" style={{ fontWeight: 600, color: n >= 0 ? 'var(--up)' : 'var(--down)', fontSize: 13 }}>
          <span style={{ fontSize: 9, marginRight: 2 }}>{n >= 0 ? '▲' : '▼'}</span>
          {Math.abs(n).toFixed(2)}%
        </span>
      )
    }
    case 'pct-bar': {
      const n = raw as number | null | undefined
      if (n == null) return <span className="text-zinc-400">-</span>
      return <PctBar value={n} max={col.barMax} />
    }
    case 'sparkline':
      return <Sparkline data={(raw as number[]) ?? []} />
    case 'number': {
      const n = raw as number | null | undefined
      if (n == null) return <span className="text-zinc-400">-</span>
      return <span className="tabular-nums">{n.toLocaleString('ko-KR')}</span>
    }
    default:
      return <span>{raw == null ? '-' : String(raw)}</span>
  }
}

// ── 필터 셀 ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FilterCell<T = any>({
  col, filter, onFilter, suggestions,
}: {
  col: ColDef<T>
  filter: FilterEntry | undefined
  onFilter: (key: string, update: Partial<FilterEntry> | null) => void
  suggestions: string[]
}) {
  const ft = getFilterType(col)
  const [showSugg, setShowSugg] = useState(false)
  const [showOpMenu, setShowOpMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const value    = filter?.value ?? ''
  const operator = (filter?.operator ?? '>=') as NumOp
  const hasValue = value.trim() !== ''

  const matched = useMemo(() => {
    if (ft !== 'text' || !value) return []
    return suggestions
      .filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase())
      .slice(0, 8)
  }, [ft, value, suggestions])

  const cellCls = 'border-b border-r border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 last:border-r-0'

  if (!ft) {
    return <td className={`${cellCls} px-2 py-1`} />
  }

  if (ft === 'number') {
    return (
      <td className={`${cellCls} px-1.5 py-1 relative`}>
        {/* 숫자 컬럼은 데이터 셀처럼 오른쪽 정렬 — 연산자 버튼이 오른쪽 끝에 */}
        <div className="flex items-center justify-end gap-1 min-w-0">
          {hasValue && (
            <button onMouseDown={() => onFilter(col.key, null)}
              className="shrink-0 text-zinc-300 hover:text-zinc-500 dark:hover:text-zinc-400 transition-colors">
              <X size={10} />
            </button>
          )}
          <input
            type="number"
            step="any"
            value={value}
            onChange={e => onFilter(col.key, { operator, value: e.target.value })}
            placeholder="숫자"
            className="flex-1 min-w-0 text-2xs text-right bg-transparent border-0 outline-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          {/* 연산자 선택 버튼 */}
          <div className="relative shrink-0">
            <button
              onMouseDown={e => { e.preventDefault(); setShowOpMenu(v => !v) }}
              onBlur={() => setTimeout(() => setShowOpMenu(false), 120)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-accent/40 bg-white dark:bg-zinc-900 text-accent text-2xs font-bold hover:bg-accent/10 transition-colors leading-none"
              title="비교 조건 선택"
            >
              {OP_LABEL[operator]}
              <ChevronDown size={8} className="opacity-60" />
            </button>
            {showOpMenu && (
              <div className="absolute right-0 top-full mt-0.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg z-30 overflow-hidden min-w-[90px]">
                {NUM_OPS.map(op => (
                  <button
                    key={op}
                    onMouseDown={() => { onFilter(col.key, { operator: op, value }); setShowOpMenu(false) }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                      op === operator
                        ? 'bg-accent/10 text-accent font-semibold'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <span className="font-bold w-4 text-center tabular-nums">{OP_LABEL[op]}</span>
                    <span className="text-zinc-400 dark:text-zinc-500">{OP_DESC[op]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
    )
  }

  // text
  return (
    <td className={`${cellCls} px-1.5 py-1 relative`}>
      <div className="flex items-center gap-1 min-w-0">
        <Search size={10} className="shrink-0 text-zinc-300 dark:text-zinc-600" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => { onFilter(col.key, { operator, value: e.target.value }); setShowSugg(true) }}
          onFocus={() => setShowSugg(true)}
          onBlur={() => setTimeout(() => setShowSugg(false), 120)}
          placeholder="검색"
          className="flex-1 min-w-0 text-2xs bg-transparent border-0 outline-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
        />
        {hasValue && (
          <button onMouseDown={() => onFilter(col.key, null)}
            className="shrink-0 text-zinc-300 hover:text-zinc-500 dark:hover:text-zinc-400 transition-colors">
            <X size={10} />
          </button>
        )}
      </div>
      {showSugg && matched.length > 0 && (
        <div className="absolute left-0 top-full mt-0.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg z-30 w-48 py-1 overflow-hidden">
          {matched.map(s => (
            <button
              key={s}
              onMouseDown={() => { onFilter(col.key, { operator, value: s }); setShowSugg(false) }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-accent/10 truncate"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </td>
  )
}

// ── 정렬 가능 헤더 셀 ─────────────────────────────────────────────────────────

const DEFAULT_COL_W = 120

function SortableTh<T>({
  col, sortEntry, sortIndex, onSort, effectiveWidth, onResizeStart, stickyHeader,
}: {
  col: ColDef<T>
  sortEntry: SortEntry | undefined
  sortIndex: number
  onSort: (key: string, multi: boolean) => void
  effectiveWidth: number
  onResizeStart: (key: string, e: React.PointerEvent) => void
  stickyHeader: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: col.key })

  const isSortable  = col.sortable !== false
  const isResizable = col.resizable !== false
  const align = col.align ?? (
    col.type === 'number' || col.type === 'pnl' || col.type === 'pnl-pct' || col.type === 'pct-bar'
      ? 'right' : 'left'
  )

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: effectiveWidth,
    minWidth: col.minWidth ?? 60,
    position: 'relative',
    opacity: isDragging ? 0.25 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <th
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group whitespace-nowrap select-none touch-none ${isSortable ? 'sortable' : ''} ${stickyHeader ? 'sticky top-0 z-10' : ''}`}
      onClick={isSortable ? (e) => onSort(col.key, e.shiftKey) : undefined}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        <GripVertical size={10} className="text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-70 shrink-0 transition-opacity" />
        <span className="truncate">{col.label}</span>
        {isSortable && (
          <span className="flex items-center gap-0.5 shrink-0 ml-0.5">
            {sortEntry ? (
              <>
                {sortEntry.dir === 'asc'
                  ? <ArrowUp size={11} className="text-accent" />
                  : <ArrowDown size={11} className="text-accent" />}
                {sortIndex > 0 && (
                  <span className="text-2xs font-bold text-accent leading-none">{sortIndex + 1}</span>
                )}
              </>
            ) : (
              <ChevronsUpDown size={11} className="text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </span>
        )}
      </div>
      {/* 리사이즈 핸들 */}
      {isResizable && (
        <div
          className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-col-resize"
          onPointerDown={e => { e.stopPropagation(); onResizeStart(col.key, e) }}
          onClick={e => e.stopPropagation()}
        >
          <div className="w-px h-4 bg-zinc-300 dark:bg-zinc-500" />
        </div>
      )}
    </th>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function DataTable<T = Record<string, unknown>>({
  id, columns, data, rowKey, onRowClick, selectedKey,
  loading = false, skeletonRows = 5,
  emptyMessage = '데이터가 없습니다.',
  className = '', stickyHeader = false,
  sort: controlledSort, onSortChange,
  serverState, onPersist,
}: DataTableProps<T>) {

  // ── 컬럼 상태 ────────────────────────────────────────────────────────────
  const saved       = useRef(loadState(id))
  const allKeys     = columns.map(c => c.key)

  const initOrder = (): string[] => {
    const s = saved.current?.colOrder ?? []
    if (!s.length) return allKeys
    // 저장된 키 중 현재 컬럼에 있는 것만 유지, 새 컬럼은 끝에 추가
    const valid = s.filter((k: string) => allKeys.includes(k))
    const missing = allKeys.filter(k => !s.includes(k))
    return [...valid, ...missing]
  }
  const initWidths = (): Record<string, number> => {
    const d: Record<string, number> = {}
    columns.forEach(c => { if (c.width) d[c.key] = c.width })
    return { ...d, ...(saved.current?.colWidths ?? {}) }
  }
  const initHidden = (): string[] =>
    saved.current?.hiddenKeys ?? columns.filter(c => c.visible === false).map(c => c.key)

  const [colOrder,    setColOrder]    = useState<string[]>(initOrder)
  const [colWidths,   setColWidths]   = useState<Record<string, number>>(initWidths)
  const [hiddenKeys,  setHiddenKeys]  = useState<string[]>(initHidden)
  const [showColMenu, setShowColMenu] = useState(false)
  const [activeColKey, setActiveColKey] = useState<string | null>(null)
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null)
  const [showFilter,  setShowFilter]  = useState(false)
  const [filters,     setFilters]     = useState<Record<string, FilterEntry>>({})

  // ── 정렬 상태 ────────────────────────────────────────────────────────────
  const [internalSort, setInternalSort] = useState<SortEntry[]>([])
  const sortState   = controlledSort ?? internalSort
  const setSortState = onSortChange ?? setInternalSort

  // ── 리사이즈: 오른쪽 경계 드래그 → 해당 컬럼 너비만 변경 ──────────────────
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null)

  const handleResizeStart = useCallback((key: string, e: React.PointerEvent) => {
    e.preventDefault()
    const startW = colWidths[key] ?? columns.find(c => c.key === key)?.width ?? DEFAULT_COL_W
    resizingRef.current = { key, startX: e.clientX, startW }

    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return
      const { key: k, startX, startW: sW } = resizingRef.current
      const min = columns.find(c => c.key === k)?.minWidth ?? 60
      // 왼쪽은 고정, 오른쪽 경계만 이동 → sW + (현재X - 시작X)
      setColWidths(prev => ({ ...prev, [k]: Math.max(min, sW + ev.clientX - startX) }))
    }
    const onUp = () => {
      resizingRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [colWidths, columns])

  // ── serverState 적용 (서버에서 불러온 설정이 도착하면 한 번만 적용) ──────
  const serverStateApplied = useRef(false)
  useLayoutEffect(() => {
    if (!serverState || serverStateApplied.current) return
    serverStateApplied.current = true
    const s = serverState.colOrder ?? []
    const valid = s.filter((k: string) => allKeys.includes(k))
    const missing = allKeys.filter(k => !s.includes(k))
    setColOrder([...valid, ...missing])
    setColWidths(prev => ({ ...prev, ...(serverState.colWidths ?? {}) }))
    setHiddenKeys(serverState.hiddenKeys ?? columns.filter(c => c.visible === false).map(c => c.key))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverState])

  // ── persist ────────────────────────────────────────────────────────────
  const onPersistRef = useRef(onPersist)
  useEffect(() => { onPersistRef.current = onPersist }, [onPersist])

  useEffect(() => {
    saveState(id, { colOrder, colWidths, hiddenKeys })
    const timer = setTimeout(() => {
      onPersistRef.current?.({ colOrder, colWidths, hiddenKeys })
    }, 800)
    return () => clearTimeout(timer)
  }, [id, colOrder, colWidths, hiddenKeys])

  // ── 컬럼 DnD ────────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleColDragStart(e: DragStartEvent) {
    setActiveColKey(e.active.id as string)
    const pe = e.activatorEvent as PointerEvent
    setDragCursor({ x: pe.clientX, y: pe.clientY })
  }
  function handleColDragEnd(e: DragEndEvent) {
    setActiveColKey(null)
    setDragCursor(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    setColOrder(prev => arrayMove(prev, prev.indexOf(active.id as string), prev.indexOf(over.id as string)))
  }
  function handleColDragCancel() { setActiveColKey(null); setDragCursor(null) }

  // 드래그 중 커서 추적
  useEffect(() => {
    if (!activeColKey) return
    const onMove = (e: PointerEvent) => setDragCursor({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [activeColKey])

  // ── 필터 조작 ────────────────────────────────────────────────────────────
  function handleFilter(key: string, update: Partial<FilterEntry> | null) {
    setFilters(prev => {
      if (!update) { const n = { ...prev }; delete n[key]; return n }
      const base: FilterEntry = prev[key] ?? { operator: '>=' as NumOp, value: '' }
      return { ...prev, [key]: { ...base, ...update } as FilterEntry }
    })
  }

  // ── 파생 데이터 ──────────────────────────────────────────────────────────
  const colMap = useMemo(() => new Map(columns.map(c => [c.key, c])), [columns])
  const visibleKeys = colOrder.filter(k => !hiddenKeys.includes(k))
  const visibleCols = visibleKeys.map(k => colMap.get(k)!).filter(Boolean) as ColDef<T>[]

  // 각 컬럼의 실제 너비 (항상 명시 — table-layout: fixed를 위해)
  const effectiveWidths = useMemo(() =>
    Object.fromEntries(visibleCols.map(c => [c.key, colWidths[c.key] ?? c.width ?? DEFAULT_COL_W]))
  , [visibleCols, colWidths])

  const tableWidth = useMemo(() =>
    visibleCols.reduce((s, c) => s + effectiveWidths[c.key], 0)
  , [visibleCols, effectiveWidths])

  // 자동완성 후보: 텍스트 필터 컬럼 × 데이터 유니크값
  const textSuggestions = useMemo(() => {
    const result: Record<string, string[]> = {}
    for (const col of visibleCols) {
      if (getFilterType(col) !== 'text') continue
      const vals = new Set<string>()
      for (const row of data) {
        const raw = col.getValue ? col.getValue(row) : (row as Record<string, unknown>)[col.key]
        if (raw != null) vals.add(String(raw))
      }
      result[col.key] = [...vals].sort().slice(0, 60)
    }
    return result
  }, [data, visibleCols])

  const filteredRows = useMemo(() =>
    applyFilters(data, filters, colMap as Map<string, ColDef<T>>)
  , [data, filters, colMap])

  const sortedRows = useMemo(() =>
    applySorts(filteredRows, sortState, colMap as Map<string, ColDef<T>>)
  , [filteredRows, sortState, colMap])

  const activeFilterCount = Object.values(filters).filter(f => f.value.trim()).length
  const activeCol = activeColKey ? colMap.get(activeColKey) : null

  // ── 렌더 ────────────────────────────────────────────────────────────────
  return (
    <div className={className}>

      {/* 툴바 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800 min-h-[32px]">
        {/* 좌: 정렬 표시 OR 기본 힌트 */}
        <div className="flex items-center gap-2 min-w-0">
          {sortState.length > 1 ? (
            <>
              <span className="text-2xs text-zinc-400 truncate">
                {sortState.map((s, i) => (
                  <span key={s.key} className="inline-flex items-center gap-0.5">
                    {i > 0 && <span className="text-zinc-300 dark:text-zinc-600 mx-1">›</span>}
                    <span className="text-accent font-medium">{columns.find(c => c.key === s.key)?.label}</span>
                    <span>{s.dir === 'asc' ? '↑' : '↓'}</span>
                  </span>
                ))}
              </span>
              <button onClick={() => setSortState([])}
                className="shrink-0 text-2xs text-zinc-400 hover:text-accent transition-colors">
                초기화
              </button>
            </>
          ) : (
            <span className="ut-eyebrow" style={{ fontSize: 9, color: 'var(--ink-5)' }}>Shift+클릭 → 다중 정렬</span>
          )}
        </div>

        {/* 우: 필터 토글 + 컬럼 설정 */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 필터 버튼 */}
          <button
            onClick={() => setShowFilter(v => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-2xs transition-colors ${
              showFilter || activeFilterCount > 0
                ? 'bg-accent/10 text-accent'
                : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700'
            }`}
            title="필터"
          >
            <Filter size={12} />
            {activeFilterCount > 0 && (
              <span className="font-semibold">{activeFilterCount}</span>
            )}
          </button>

          {/* 컬럼 설정 */}
          <div className="relative">
            <button
              onClick={() => setShowColMenu(v => !v)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              title="컬럼 설정"
            >
              <Settings2 size={13} />
            </button>
            {showColMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg z-20 w-40 py-1.5 overflow-hidden">
                  <p className="text-2xs text-zinc-400 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800">
                    컬럼 표시 / 숨기기
                  </p>
                  {columns.map(col => (
                    <label key={col.key}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-3 h-3 accent-[color:var(--c-accent)]"
                        checked={!hiddenKeys.includes(col.key)}
                        onChange={e =>
                          setHiddenKeys(prev =>
                            e.target.checked ? prev.filter(k => k !== col.key) : [...prev, col.key]
                          )
                        }
                      />
                      <span className="text-xs text-zinc-700 dark:text-zinc-300">{col.label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleColDragStart}
        onDragEnd={handleColDragEnd}
        onDragCancel={handleColDragCancel}
      >
        <SortableContext items={visibleKeys} strategy={horizontalListSortingStrategy}>
          <div className="overflow-x-auto">
            <table
              className="data-table"
              style={{ tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}
            >
              <thead>
                {/* 헤더 행 */}
                <tr>
                  {visibleCols.map(col => (
                    <SortableTh
                      key={col.key}
                      col={col}
                      sortEntry={sortState.find(s => s.key === col.key)}
                      sortIndex={sortState.findIndex(s => s.key === col.key)}
                      onSort={(key, multi) => setSortState(nextSort(sortState, key, multi))}
                      effectiveWidth={effectiveWidths[col.key]}
                      onResizeStart={handleResizeStart}
                      stickyHeader={stickyHeader}
                    />
                  ))}
                </tr>
                {/* 필터 행 */}
                {showFilter && (
                  <tr>
                    {visibleCols.map(col => (
                      <FilterCell
                        key={col.key}
                        col={col}
                        filter={filters[col.key]}
                        onFilter={handleFilter}
                        suggestions={textSuggestions[col.key] ?? []}
                      />
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: skeletonRows }).map((_, i) => (
                    <tr key={i}>
                      {visibleCols.map(col => (
                        <td key={col.key}>
                          <div className="h-3.5 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleCols.length} className="text-center py-10 text-sm text-zinc-400">
                      {activeFilterCount > 0 ? (
                        <span>
                          필터 결과 없음
                          <button onClick={() => setFilters({})}
                            className="ml-2 text-accent hover:underline">
                            필터 초기화
                          </button>
                        </span>
                      ) : emptyMessage}
                    </td>
                  </tr>
                ) : (
                  sortedRows.map(row => {
                    const key  = rowKey(row)
                    const selected = selectedKey != null && key === selectedKey
                    return (
                      <tr
                        key={key}
                        className={selected ? 'selected' : ''}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                      >
                        {visibleCols.map(col => {
                          const align = col.align ?? (
                            col.type === 'number' || col.type === 'pnl' ||
                            col.type === 'pnl-pct' || col.type === 'pct-bar'
                              ? 'right' : 'left'
                          )
                          return (
                            <td key={col.key}
                              className={
                                align === 'right' ? 'text-right' :
                                align === 'center' ? 'text-center' : ''
                              }
                            >
                              <CellContent col={col} row={row} />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </SortableContext>

        {/* 컬럼 드래그 오버레이 — 커서 좌표 직접 추적 */}
        {activeCol && dragCursor && createPortal(
          <div
            style={{
              position: 'fixed',
              left: dragCursor.x + 14,
              top: dragCursor.y - 14,
              pointerEvents: 'none',
              zIndex: 9999,
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-zinc-900 border border-accent/70 rounded-lg shadow-xl text-xs font-semibold text-zinc-700 dark:text-zinc-200 select-none"
          >
            <GripVertical size={11} className="text-accent/60 shrink-0" />
            <span>{activeCol.label}</span>
          </div>,
          document.body,
        )}
      </DndContext>

      {/* 필터 활성 시 하단 요약 */}
      {activeFilterCount > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800 bg-accent/5">
          <span className="text-2xs text-zinc-500">
            {filteredRows.length} / {data.length}개 표시
          </span>
          <button onClick={() => setFilters({})}
            className="text-2xs text-accent hover:underline">
            필터 전체 초기화
          </button>
        </div>
      )}
    </div>
  )
}

export default DataTable
