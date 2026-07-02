import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, RefreshCw, CalendarDays, Plus, ChevronDown } from 'lucide-react'
import apiClient, { settingsApi } from '../api/client'
import { Card } from '../components/Card'
import type {
  CalEvent, GoogleCalendar, EventFormData, LaneCell, RecurScope,
} from './calendar/types'
import {
  evColor, toKstDateKey, toKstTime, kstLocalToUtcIso, addDays,
  isInRange, buildMonthLayout,
  buildRRule, defaultFormData, eventToFormData,
} from './calendar/helpers'
import { EventModal } from './calendar/EventModal'

// ── EventChip ─────────────────────────────────────────────────────────────────

function EventChip({
  ev, calendars, onClick,
  roundLeft = true, roundRight = true, bleedLeft = false, bleedRight = false, showLabel = true,
}: {
  ev: CalEvent
  calendars: GoogleCalendar[]
  onClick?: (ev: CalEvent, e: React.MouseEvent) => void
  // 연속(여러 날) 일정 막대용 — 칸 경계를 넘어 이어지는 모양 제어
  roundLeft?: boolean   // 왼쪽 모서리 둥글기 (막대 시작/주 시작)
  roundRight?: boolean  // 오른쪽 모서리 둥글기 (막대 끝/주 끝)
  bleedLeft?: boolean   // 왼쪽 칸 패딩까지 확장 (이전 칸과 연결)
  bleedRight?: boolean  // 오른쪽 칸 패딩까지 확장 (다음 칸과 연결)
  showLabel?: boolean   // 제목 표시 (시작일·주 시작일에만)
}) {
  const color = evColor(ev, calendars)
  const timeStr = ev.all_day ? null : (ev.start_dt ? toKstTime(ev.start_dt) : null)
  return (
    <div
      className="text-[10px] px-1 h-[17px] flex items-center truncate text-white leading-tight shadow-sm cursor-pointer hover:brightness-95 transition-all active:scale-[0.98]"
      style={{
        backgroundColor: color,
        borderTopLeftRadius: roundLeft ? 4 : 0,
        borderBottomLeftRadius: roundLeft ? 4 : 0,
        borderTopRightRadius: roundRight ? 4 : 0,
        borderBottomRightRadius: roundRight ? 4 : 0,
        marginLeft: bleedLeft ? -6 : 0,
        marginRight: bleedRight ? -6 : 0,
      }}
      title={ev.summary ?? '(제목 없음)'}
      onClick={e => { e.stopPropagation(); onClick?.(ev, e) }}
    >
      {showLabel && (
        <span className="truncate">
          {timeStr && <span className="opacity-80 mr-0.5">{timeStr}</span>}
          {ev.summary ?? '(제목 없음)'}
        </span>
      )}
    </div>
  )
}



// ── SelectedDatePanel (선택한 날짜의 일정) ─────────────────────────────────────

function SelectedDatePanel({
  dateKey, events, calendars, onEventClick, onAdd,
}: {
  dateKey: string
  events: CalEvent[]
  calendars: GoogleCalendar[]
  onEventClick: (ev: CalEvent) => void
  onAdd: () => void
}) {
  const [, m, d] = dateKey.split('-').map(Number)
  const dow = DAYS[new Date(dateKey + 'T12:00:00').getDay()]
  const sorted = [...events].sort((a, b) => {
    if (a.all_day !== b.all_day) return a.all_day ? -1 : 1
    return (a.start_dt ?? '').localeCompare(b.start_dt ?? '')
  })

  return (
    <Card
      title={`${m}월 ${d}일 (${dow})`}
      icon={<CalendarDays size={14} />}
      right={
        <button onClick={onAdd} className="text-xs text-accent hover:underline flex items-center gap-0.5">
          <Plus size={12} /> 추가
        </button>
      }
    >
      {sorted.length === 0 ? (
        <div className="text-xs text-ink-4 py-2 text-center">일정 없음</div>
      ) : (
        <div className="divide-y divide-[var(--divide)] -my-1">
          {sorted.map(ev => {
            const color = evColor(ev, calendars)
            return (
              <button
                key={ev.id}
                onClick={() => onEventClick(ev)}
                className="w-full flex items-start gap-2 py-1.5 text-left px-1 -mx-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
              >
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-1 truncate">{ev.summary ?? '(제목 없음)'}</div>
                  <div className="text-xs text-ink-4 mt-0.5">
                    {ev.all_day ? '종일' : (ev.start_dt ? toKstTime(ev.start_dt) : '')}
                    {ev.location && ` · ${ev.location}`}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── CalGridCells ──────────────────────────────────────────────────────────────

function CalGridCells({
  year, month, cellLayout, selectedDate,
  onDateSelect, onNavigatePrev, onNavigateNext,
  onEventClick, onDateDoubleClick, onDateShiftClick,
  onDragStart, onDragOver,
  dragRange,
  calendars, todayKey,
}: {
  year: number; month: number
  cellLayout: Record<string, LaneCell>
  selectedDate: string | null
  onDateSelect: (key: string | null) => void
  onNavigatePrev: (dateKey: string) => void
  onNavigateNext: (dateKey: string) => void
  onEventClick: (ev: CalEvent) => void
  onDateDoubleClick: (dateKey: string) => void
  onDateShiftClick: (dateKey: string) => void
  onDragStart: (dateKey: string) => void
  onDragOver: (dateKey: string) => void
  dragRange: { start: string; end: string } | null
  calendars: GoogleCalendar[]
  todayKey: string
}) {
  const firstDow   = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const pYear = month === 0 ? year - 1 : year
  const pMon  = month === 0 ? 11 : month - 1
  const nYear = month === 11 ? year + 1 : year
  const nMon  = month === 11 ? 0 : month + 1
  const pLast = new Date(year, month, 0).getDate()
  const trail = (7 - (firstDow + daysInMonth) % 7) % 7

  const pk = (d: number) => `${pYear}-${String(pMon + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const nk = (d: number) => `${nYear}-${String(nMon + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const fadedNum = (dow: number) => `w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium mb-1 opacity-[0.18] ${
    dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-ink-1'
  }`

  const fadedCellBase = 'h-[112px] overflow-hidden border-b border-r border-ink-5/60 p-1.5 cursor-pointer transition-colors select-none bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/30'

  return (
    <div className="grid grid-cols-7">
      {/* 이번 달 첫 주 — 지난달 말일들 (격자 틀 안에서만 표시) */}
      {Array.from({ length: firstDow }).map((_, i) => {
        const day = pLast - firstDow + 1 + i
        return (
          <div
            key={`fp${i}`}
            onClick={() => onNavigatePrev(pk(day))}
            className={fadedCellBase}
          >
            <div className={fadedNum(i)}>{day}</div>
          </div>
        )
      })}

      {/* 이번 달 */}
      {Array.from({ length: daysInMonth }).map((_, i) => {
        const day = i + 1
        const dow = (firstDow + i) % 7
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        const cell = cellLayout[dateKey]
        // 표시할 레인: 상위 3개. 끝쪽 빈 레인은 잘라내되 사이의 빈 레인은 스페이서로 유지(정렬)
        const capped = (cell?.lanes ?? []).slice(0, 3)
        let lastIdx = -1
        capped.forEach((s, idx) => { if (s) lastIdx = idx })
        const renderLanes = capped.slice(0, lastIdx + 1)
        const shown = renderLanes.filter(Boolean).length
        const overflow = (cell?.total ?? 0) - shown
        const isToday = dateKey === todayKey
        const isSel   = dateKey === selectedDate
        const isDragHL = isInRange(dateKey, dragRange)
        const isSun   = dow === 0
        const isSat   = dow === 6
        return (
          <div
            key={day}
            onMouseDown={e => { if (e.button === 0) onDragStart(dateKey) }}
            onMouseEnter={() => onDragOver(dateKey)}
            onClick={e => {
              if (e.shiftKey && selectedDate && selectedDate !== dateKey) {
                onDateShiftClick(dateKey)
              } else {
                onDateSelect(isSel ? null : dateKey)
              }
            }}
            onDoubleClick={e => { e.preventDefault(); onDateDoubleClick(dateKey) }}
            className={`h-[112px] overflow-hidden border-b border-r border-ink-5/60 p-1.5 cursor-pointer transition-colors select-none ${
              isDragHL
                ? 'bg-accent/20 dark:bg-accent/25'
                : isSel
                  ? 'bg-accent/10 dark:bg-accent/15 shadow-[inset_0_0_0_1px_rgba(var(--c-accent-rgb)/0.25)]'
                  : isToday
                    ? 'bg-[#FAFAF7] dark:bg-zinc-800/60'
                    : isSun
                      ? 'bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50/70 dark:hover:bg-red-950/20'
                      : isSat
                        ? 'bg-blue-50/30 dark:bg-blue-950/10 hover:bg-blue-50/60 dark:hover:bg-blue-950/20'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
            } ${isToday && !isDragHL ? 'shadow-[inset_0_0_0_2px_#0A0A0B] dark:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.25)]' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium ${
                isToday ? 'text-[#0A0A0B] dark:text-white font-bold'
                : isSun ? 'text-red-400'
                : isSat ? 'text-blue-400'
                : 'text-ink-2'
              }`} style={isToday ? { fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 800 } : {}}>
                {day}
              </div>
              {isToday && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dot)', display: 'inline-block' }} />
              )}
            </div>
            <div className="space-y-0.5">
              {renderLanes.map((seg, idx) => {
                if (!seg) return <div key={`sp${idx}`} className="h-[17px]" />
                return (
                  <EventChip
                    key={seg.ev.id}
                    ev={seg.ev}
                    calendars={calendars}
                    onClick={onEventClick}
                    roundLeft={seg.isStart || dow === 0}
                    roundRight={seg.isEnd || dow === 6}
                    bleedLeft={!seg.isStart && dow !== 0}
                    bleedRight={!seg.isEnd && dow !== 6}
                    showLabel={seg.isStart || dow === 0}
                  />
                )
              })}
              {overflow > 0 && <div className="text-[10px] text-ink-4 pl-1">+{overflow}개 더</div>}
            </div>
          </div>
        )
      })}

      {/* 이번 달 마지막 주 빈칸 */}
      {Array.from({ length: trail }).map((_, i) => {
        const day = i + 1
        const dow = (firstDow + daysInMonth + i) % 7
        return (
          <div
            key={`fn${i}`}
            onClick={() => onNavigateNext(nk(day))}
            className={fadedCellBase}
          >
            <div className={fadedNum(dow)}>{day}</div>
          </div>
        )
      })}

    </div>
  )
}

// ── TodayCard ─────────────────────────────────────────────────────────────────

function TodayCard({ events, calendars }: { events: CalEvent[]; calendars: GoogleCalendar[] }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  const todayEvents = events
    .filter(ev => {
      if (!ev.start_dt) return false
      return toKstDateKey(ev.start_dt, ev.all_day) === today
    })
    .sort((a, b) => (a.start_dt ?? '').localeCompare(b.start_dt ?? ''))

  const dateStr = new Date().toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul',
  })

  return (
    <div style={{
      background: '#0a0a0b', color: '#fff',
      borderRadius: 16, padding: '20px 24px',
    }}>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 6, letterSpacing: '0.10em', textTransform: 'uppercase', fontWeight: 700 }}>
        TODAY
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: todayEvents.length ? 16 : 0 }}>
        {dateStr}
      </div>
      {todayEvents.length === 0 ? (
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', marginTop: 8 }}>오늘 일정 없음</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {todayEvents.map(ev => {
            const timeStr = ev.all_day ? '종일' : (ev.start_dt ? toKstTime(ev.start_dt) : '')
            const color = evColor(ev, calendars)
            return (
              <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 3, height: 28, borderRadius: 2, background: color, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{ev.summary ?? '(제목 없음)'}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{timeStr}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── MiniCalendar ──────────────────────────────────────────────────────────────

function MiniCalendar({ year, month, events }: { year: number; month: number; events: CalEvent[] }) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const eventDays = new Set(
    events
      .map(ev => ev.start_dt ? toKstDateKey(ev.start_dt, ev.all_day) : '')
      .filter(Boolean)
  )
  const mn = new Date(year, month).toLocaleString('ko-KR', { month: 'long' })

  return (
    <div style={{ padding: '16px 20px', background: 'var(--mist)', borderRadius: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 10 }}>
        {mn} 미리보기
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: 10, textAlign: 'center' }}>
        {['일','월','화','수','목','금','토'].map((d, i) => (
          <div key={d} style={{
            color: i === 0 ? '#f87171' : i === 6 ? '#60a5fa' : 'var(--ink-4)',
            padding: '2px 0', fontWeight: 600,
          }}>{d}</div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const hasEvent = eventDays.has(dateKey)
          const dow = (firstDay + i) % 7
          return (
            <div key={day} style={{
              padding: '3px 0',
              color: dow === 0 ? '#f87171' : dow === 6 ? '#60a5fa' : 'var(--ink-2)',
              position: 'relative',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              {day}
              {hasEvent && (
                <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--c-accent)' }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── CalendarFilterDropdown ────────────────────────────────────────────────────

function CalendarFilterDropdown({
  calendars, selectedIds, onToggle,
}: {
  calendars: GoogleCalendar[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [dropPos, setDropPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  if (!calendars.length) return null

  const activeCount = selectedIds.size
  const totalCount = calendars.length

  function handleToggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const dropWidth = 200
      const left = rect.left + dropWidth > window.innerWidth - 16
        ? Math.max(8, rect.right - dropWidth)
        : rect.left
      setDropPos({ top: rect.bottom + 6, left })
    }
    setOpen(p => !p)
  }

  return (
    <div>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
          open
            ? 'bg-accent text-white border-accent'
            : 'bg-white dark:bg-zinc-900 border-ink-5 text-ink-2 hover:border-accent hover:text-accent'
        }`}
        title="캘린더 선택"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: open ? 'rgba(255,255,255,0.8)' : 'var(--c-accent)' }}
        />
        캘린더
        {activeCount < totalCount && (
          <span className={`tabular-nums ${open ? 'text-white/70' : 'text-ink-4'}`}>
            {activeCount}/{totalCount}
          </span>
        )}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-ink-5 rounded-xl shadow-xl p-2 min-w-[180px]"
            style={{ top: dropPos.top, left: dropPos.left }}
          >
            {calendars.map(cal => {
              const active = selectedIds.has(cal.id)
              return (
                <button
                  key={cal.id}
                  onClick={() => onToggle(cal.id)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span
                    className={`flex-shrink-0 w-3 h-3 rounded-sm border-2 transition-all ${active ? 'border-transparent' : 'border-ink-5 bg-transparent'}`}
                    style={active ? { backgroundColor: cal.backgroundColor } : {}}
                  />
                  <span className={`text-sm flex-1 truncate transition-colors ${active ? 'text-ink-1' : 'text-ink-4'}`}>
                    {cal.name}
                  </span>
                  {cal.primary && (
                    <span className="text-[10px] text-ink-4 flex-shrink-0">기본</span>
                  )}
                </button>
              )
            })}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// ── 메인 CalendarPage ─────────────────────────────────────────────────────────

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']

function LiveCountdown({ targetISO }: { targetISO: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ms = new Date(targetISO).getTime() - now
  if (ms <= 0) return <span className="ut-mono" style={{ fontWeight: 700 }}>00:00:00</span>
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return (
    <span className="ut-mono" style={{ fontWeight: 700 }}>
      {String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
    </span>
  )
}

type ModalState =
  | { type: 'none' }
  | { type: 'create'; date: string; endDate?: string }
  | { type: 'edit'; event: CalEvent }

export default function CalendarPage() {
  const today = new Date()
  const todayKey = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })

  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [exitView, setExitView] = useState<{ year: number; month: number } | null>(null)
  const [transDir, setTransDir] = useState<'up' | 'down' | null>(null)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(today.getFullYear())
  const [pickerStep, setPickerStep] = useState<'decade' | 'months'>('months')
  const [decadeStart, setDecadeStart] = useState(today.getFullYear() - 5)
  const pickerBtnRef = useRef<HTMLButtonElement>(null)
  const [pickerPos, setPickerPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const [events, setEvents] = useState<CalEvent[]>([])
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [selectedCalIds, setSelectedCalIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  // 캘린더 필터 초기화 완료 여부 (설정 로드 후 1회만 적용)
  const filterInitRef = useRef(false)
  const hiddenCalIdsRef = useRef<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(todayKey)
  const [modal, setModal] = useState<ModalState>({ type: 'none' })

  // 드래그 선택 상태 (ref 기반 — mousedown 시 리렌더 없음)
  const dragStartRef = useRef<string | null>(null)
  const dragEndRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)
  const [dragRange, setDragRange] = useState<{ start: string; end: string } | null>(null)

  // 연결 상태 확인 + 숨긴 캘린더 ID 설정 로드
  useEffect(() => {
    apiClient.get('/api/calendar/status')
      .then(({ data }) => setConnected(data.connected))
      .catch(() => setConnected(false))
    settingsApi.get()
      .then(r => { hiddenCalIdsRef.current = r.data.ui_calendar_hidden_ids ?? [] })
      .catch(() => {})
  }, [])

  // 캘린더 목록 로드
  useEffect(() => {
    if (!connected) return
    apiClient.get('/api/calendar/calendars')
      .then(({ data }: { data: GoogleCalendar[] }) => {
        setCalendars(data)
        if (!filterInitRef.current) {
          filterInitRef.current = true
          const hidden = new Set(hiddenCalIdsRef.current)
          // 숨긴 목록에 없는 것만 선택 (저장된 게 없으면 전체 선택)
          setSelectedCalIds(new Set(data.filter(c => !hidden.has(c.id)).map(c => c.id)))
        }
      })
      .catch(() => {})
  }, [connected])

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const lastDay = new Date(year, month + 1, 0).getDate()
      const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      const { data } = await apiClient.get('/api/calendar/events', { params: { from_date: from, to_date: to } })
      setEvents(data)
    } catch {}
    finally { setLoading(false) }
  }, [year, month])

  useEffect(() => {
    if (connected) fetchEvents()
  }, [connected, fetchEvents])

  useEffect(() => {
    if (!connected) return
    window.addEventListener('calendarUpdated', fetchEvents)
    const t = setInterval(fetchEvents, 30_000)
    return () => { window.removeEventListener('calendarUpdated', fetchEvents); clearInterval(t) }
  }, [connected, fetchEvents])

  // NEXT UP 전용 — 보고 있는 달과 무관하게 항상 "오늘 이후" 다가오는 일정 조회
  const [upcoming, setUpcoming] = useState<CalEvent[]>([])
  useEffect(() => {
    if (!connected) return
    const load = () => apiClient.get('/api/calendar/events/upcoming', { params: { limit: 50 } })
      .then(({ data }) => setUpcoming(data)).catch(() => {})
    load()
    window.addEventListener('calendarUpdated', load)
    const t = setInterval(load, 60_000)
    return () => { window.removeEventListener('calendarUpdated', load); clearInterval(t) }
  }, [connected])

  // 전역 mouseup — 드래그 종료 (ref 사용으로 stale closure 없음)
  useEffect(() => {
    function handleMouseUp() {
      const start = dragStartRef.current
      const end = dragEndRef.current
      if (start && end && isDraggingRef.current) {
        const [s, e] = start <= end ? [start, end] : [end, start]
        setModal({ type: 'create', date: s, endDate: e })
      }
      dragStartRef.current = null
      dragEndRef.current = null
      setDragRange(null)
      setTimeout(() => { isDraggingRef.current = false }, 10)
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const ANIM_MS = 300

  function triggerNav(fromY: number, fromM: number, toY: number, toM: number) {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    const dir = toY * 12 + toM > fromY * 12 + fromM ? 'up' : 'down'
    setExitView({ year: fromY, month: fromM })
    setTransDir(dir)
    setYear(toY); setMonth(toM)
    exitTimerRef.current = setTimeout(() => setExitView(null), ANIM_MS)
  }

  const prevMonth = () => triggerNav(year, month, month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)
  const nextMonth = () => triggerNav(year, month, month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)

  // 마우스 휠 위/아래 → 달 이동 (구글 캘린더 웹처럼). 한 번에 한 달, 애니메이션 동안 잠금
  const gridWrapRef = useRef<HTMLDivElement>(null)
  const wheelLockRef = useRef(false)
  const wheelAccumRef = useRef(0)
  const handleWheel = useCallback((e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return  // 가로 스크롤 무시
    e.preventDefault()
    if (wheelLockRef.current) return
    // 방향 바뀌면 누적 초기화
    if ((wheelAccumRef.current > 0) !== (e.deltaY > 0)) wheelAccumRef.current = 0
    wheelAccumRef.current += e.deltaY
    if (Math.abs(wheelAccumRef.current) < 24) return
    const goNext = wheelAccumRef.current > 0
    wheelAccumRef.current = 0
    wheelLockRef.current = true
    const toY = goNext ? (month === 11 ? year + 1 : year) : (month === 0 ? year - 1 : year)
    const toM = goNext ? (month === 11 ? 0 : month + 1) : (month === 0 ? 11 : month - 1)
    triggerNav(year, month, toY, toM)
    setTimeout(() => { wheelLockRef.current = false }, ANIM_MS + 80)
  }, [year, month])

  useEffect(() => {
    const el = gridWrapRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const goToday = () => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    setExitView(null); setTransDir(null)
    setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDate(todayKey)
    setPickerOpen(false)
  }

  function goToYearMonth(y: number, m: number) {
    if (y === year && m === month) { setPickerOpen(false); return }
    triggerNav(year, month, y, m)
    setPickerOpen(false)
  }

  function navigatePrev(dateKey: string) {
    triggerNav(year, month, month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)
    setSelectedDate(dateKey)
  }
  function navigateNext(dateKey: string) {
    triggerNav(year, month, month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)
    setSelectedDate(dateKey)
  }

  function toggleCalendar(id: string) {
    setSelectedCalIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size === 1) return prev
        next.delete(id)
      } else {
        next.add(id)
      }
      // 숨긴 ID 목록 = 전체 캘린더 중 selectedIds에 없는 것
      const hiddenIds = calendars.filter(c => !next.has(c.id)).map(c => c.id)
      hiddenCalIdsRef.current = hiddenIds
      settingsApi.update({ ui_calendar_hidden_ids: hiddenIds }).catch(() => {})
      return next
    })
  }

  function handleDateShiftClick(dateKey: string) {
    if (!selectedDate) { setSelectedDate(dateKey); return }
    const [start, end] = selectedDate <= dateKey ? [selectedDate, dateKey] : [dateKey, selectedDate]
    setModal({ type: 'create', date: start, endDate: end })
  }

  function handleDragStart(dateKey: string) {
    if (isDraggingRef.current) return
    dragStartRef.current = dateKey
    dragEndRef.current = null
    // 상태 업데이트 없음 → 리렌더 없음 (클릭만 할 때 깜빡임 방지)
  }

  function handleDragOver(dateKey: string) {
    if (!dragStartRef.current) return
    if (dateKey === dragStartRef.current) {
      dragEndRef.current = null
      isDraggingRef.current = false
      if (dragRange) setDragRange(null)
      return
    }
    isDraggingRef.current = true
    dragEndRef.current = dateKey
    const [s, e] = dragStartRef.current <= dateKey
      ? [dragStartRef.current, dateKey]
      : [dateKey, dragStartRef.current]
    setDragRange(prev => prev?.start === s && prev?.end === e ? prev : { start: s, end: e })
  }

  const filteredEvents = events.filter(ev =>
    !ev.calendar_id || selectedCalIds.has(ev.calendar_id)
  )

  const eventsByDate = filteredEvents.reduce<Record<string, CalEvent[]>>((acc, ev) => {
    if (!ev.start_dt) return acc
    const startKey = toKstDateKey(ev.start_dt, ev.all_day)
    if (!acc[startKey]) acc[startKey] = []
    acc[startKey].push(ev)
    // 종일 복수일 이벤트: 포함된 모든 날짜에 추가
    if (ev.all_day && ev.end_dt) {
      const endExcl = ev.end_dt.slice(0, 10) // Google Calendar exclusive end
      let cur = addDays(startKey, 1)
      while (cur < endExcl) {
        if (!acc[cur]) acc[cur] = []
        acc[cur].push(ev)
        cur = addDays(cur, 1)
      }
    }
    return acc
  }, {})

  // 여러 날 일정을 이어지는 막대로 그리기 위한 레인 배치
  const cellLayout = buildMonthLayout(filteredEvents)

  const primaryCalId = calendars.find(c => c.primary)?.id ?? 'primary'

  function buildEventBody(form: EventFormData) {
    const rrule = buildRRule(form)
    const recurrence = rrule ? [rrule] : undefined
    if (form.all_day) {
      return {
        summary: form.summary,
        description: form.description || undefined,
        location: form.location || undefined,
        all_day: true,
        start: form.start_date,
        end: form.end_date || form.start_date,
        calendar_id: form.calendar_id || primaryCalId,
        recurrence,
      }
    }
    return {
      summary: form.summary,
      description: form.description || undefined,
      location: form.location || undefined,
      all_day: false,
      start: kstLocalToUtcIso(`${form.start_date}T${form.start_time}`),
      end:   kstLocalToUtcIso(`${form.end_date}T${form.end_time}`),
      calendar_id: form.calendar_id || primaryCalId,
      recurrence,
    }
  }

  function buildUpdateBody(form: EventFormData) {
    const rrule = buildRRule(form)
    const recurrence = rrule ? [rrule] : undefined
    if (form.all_day) {
      return {
        summary: form.summary,
        description: form.description,
        location: form.location,
        all_day: true,
        start: form.start_date,
        end: form.end_date || form.start_date,
        recurrence,
      }
    }
    return {
      summary: form.summary,
      description: form.description,
      location: form.location,
      all_day: false,
      start: kstLocalToUtcIso(`${form.start_date}T${form.start_time}`),
      end:   kstLocalToUtcIso(`${form.end_date}T${form.end_time}`),
      recurrence,
    }
  }

  // 특정 캘린더만 증분 동기화 (반복 일정 생성/수정/삭제 후 빠른 반영)
  async function syncOne(calendarId?: string) {
    try {
      await apiClient.post('/api/calendar/sync/incremental', null, {
        params: calendarId ? { calendar_id: calendarId } : {},
      })
    } catch {}
  }

  async function handleCreate(form: EventFormData) {
    const body = buildEventBody(form)
    await apiClient.post('/api/calendar/events', body)
    // 반복 이벤트는 마스터 1건만 저장되므로 증분 동기화로 occurrence 펼침
    if (body.recurrence) { await syncOne(body.calendar_id) }
    await fetchEvents()
  }

  async function handleUpdate(ev: CalEvent, form: EventFormData, scope?: RecurScope) {
    const body = buildUpdateBody(form)
    // 단일 occurrence 반복 인스턴스(COUNT=1 등)에 반복 규칙을 새로 지정 → 마스터 재정의(redefine).
    // 인스턴스 ID로 요청해야 백엔드가 캘린더를 정확히 해석하고, scope로 마스터를 수정함.
    const effScope: string | undefined =
      scope ?? ((ev.recurring_event_id && body.recurrence) ? 'redefine' : undefined)
    await apiClient.patch(
      `/api/calendar/events/${ev.google_event_id}`,
      body,
      { params: effScope ? { scope: effScope } : {} },
    )
    // 반복/범위 변경은 시리즈 재구성 → 해당 캘린더만 증분 동기화 (full_sync 대비 빠름)
    if (effScope || body.recurrence) { await syncOne(ev.calendar_id) }
    await fetchEvents()
  }

  async function handleDelete(ev: CalEvent, scope?: RecurScope) {
    // 단일 occurrence 반복 인스턴스 삭제 → 시리즈(마스터) 삭제(scope=all, 캘린더는 인스턴스에서 해석)
    const effScope: string | undefined = scope ?? (ev.recurring_event_id ? 'all' : undefined)
    await apiClient.delete(`/api/calendar/events/${ev.google_event_id}`, { params: effScope ? { scope: effScope } : {} })
    if (effScope) { await syncOne(ev.calendar_id) }
    await fetchEvents()
  }

  if (connected === false) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <CalendarDays size={44} className="text-ink-5" />
        <p className="text-sm text-ink-3">Google 캘린더가 연결되지 않았습니다.</p>
        <a href="/settings" className="text-sm text-accent hover:underline">설정에서 연결하기 →</a>
      </div>
    )
  }

  // 다음 일정 (비종일·미래) — 항상 오늘 기준 upcoming + 선택 캘린더 필터
  const nextEvent = upcoming
    .filter(e => (!e.calendar_id || selectedCalIds.has(e.calendar_id)) && !e.all_day && e.start_dt)
    .map(e => ({ ev: e, startDate: new Date(e.start_dt! + 'Z') }))
    .filter(e => e.startDate > new Date())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null

  const monthEventCount = Object.values(eventsByDate)
    .reduce((s, arr) => s + arr.length, 0)

  // 다음달 계산
  const nextMonthYear = month === 11 ? year + 1 : year
  const nextMonthMonth = month === 11 ? 0 : month + 1

  return (
    <div className="space-y-4">
      {/* ── Editorial Month Header (전체 너비) ─── */}
      <div style={{
        paddingBottom: 20, borderBottom: '1px solid var(--line)',
        fontFamily: 'var(--font-sans)',
      }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="ut-eyebrow" style={{ marginBottom: 10 }}>
                CALENDAR · KST · {MONTHS_EN[month].slice(0,3).toUpperCase()} {year}
              </div>
              <h1 style={{
                fontFamily: 'var(--font-sans)', fontWeight: 800,
                fontSize: 'clamp(40px, 6vw, 80px)',
                color: 'var(--ink-0)', letterSpacing: '-0.04em', lineHeight: 0.95, margin: 0,
              }}>
                <span className="ut-mono" style={{ fontWeight: 800 }}>{year}</span>{' '}
                <span style={{ fontWeight: 500, color: 'var(--ink-3)' }}>{MONTHS_EN[month].slice(0, 3)}</span>
                <span style={{ color: 'var(--dot)' }}>.</span>
              </h1>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
                <span>
                  오늘 — <span className="ut-mono" style={{ color: 'var(--ink-0)', fontWeight: 600 }}>
                    {today.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' })}
                  </span>
                </span>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--ink-5)', display: 'inline-block' }} />
                <span>이번 달 <span className="ut-mono" style={{ color: 'var(--ink-0)', fontWeight: 600 }}>{monthEventCount}건</span></span>
              </div>
            </div>
            {/* 우측: 내비게이션 + 캘린더 필터 */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-ink-3 transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={goToday} className="chip text-xs px-2.5 py-1">오늘</button>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-ink-3 transition-colors">
                <ChevronRight size={16} />
              </button>
              <div style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />
              <CalendarFilterDropdown
                calendars={calendars}
                selectedIds={selectedCalIds}
                onToggle={toggleCalendar}
              />
              <div style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />
              {/* 년월 이동 피커 */}
              <div className="relative">
                <button
                  ref={pickerBtnRef}
                  onClick={() => {
                    if (!pickerOpen && pickerBtnRef.current) {
                      const r = pickerBtnRef.current.getBoundingClientRect()
                      setPickerPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
                    }
                    setPickerYear(year); setDecadeStart(year - 5); setPickerStep('months'); setPickerOpen(p => !p)
                  }}
                  className={`chip text-xs px-2.5 py-1 tabular-nums ${pickerOpen ? 'chip-active' : ''}`}
                  title="년월 이동"
                >이동</button>
                {pickerOpen && createPortal(
                  <>
                    <div className="fixed inset-0 z-[9990]" onClick={() => setPickerOpen(false)} />
                    <div className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-ink-5 rounded-xl shadow-xl p-3 w-56"
                      style={{ top: pickerPos.top, right: pickerPos.right }}>
                      {pickerStep === 'decade' ? (
                        <>
                          {/* 연대(12년) 헤더 */}
                          <div className="flex items-center justify-between mb-2.5">
                            <button onClick={() => setDecadeStart(s => s - 12)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-ink-3 transition-colors">
                              <ChevronLeft size={14} />
                            </button>
                            <span className="text-sm font-semibold text-ink-1 tabular-nums">{decadeStart}–{decadeStart + 11}</span>
                            <button onClick={() => setDecadeStart(s => s + 12)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-ink-3 transition-colors">
                              <ChevronRight size={14} />
                            </button>
                          </div>
                          {/* 연도 그리드 */}
                          <div className="grid grid-cols-4 gap-1">
                            {Array.from({ length: 12 }, (_, k) => decadeStart + k).map(y => {
                              const isCur = y === year
                              return (
                                <button
                                  key={y}
                                  onClick={() => { setPickerYear(y); setPickerStep('months') }}
                                  className={`py-1.5 text-xs rounded-lg tabular-nums transition-colors ${
                                    isCur ? 'bg-accent text-white font-medium' : 'text-ink-2 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                  }`}
                                >{y}</button>
                              )
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          {/* 월 헤더 (연도 클릭 → 연대 단계) */}
                          <div className="flex items-center justify-between mb-2.5">
                            <button onClick={() => setPickerYear(y => y - 1)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-ink-3 transition-colors">
                              <ChevronLeft size={14} />
                            </button>
                            <button
                              onClick={() => { setDecadeStart(pickerYear - 5); setPickerStep('decade') }}
                              className="flex items-center gap-0.5 text-sm font-semibold text-ink-1 tabular-nums px-2 py-0.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                              title="연도 선택"
                            >{pickerYear}년 <ChevronDown size={12} /></button>
                            <button onClick={() => setPickerYear(y => y + 1)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-ink-3 transition-colors">
                              <ChevronRight size={14} />
                            </button>
                          </div>
                          {/* 월 그리드 */}
                          <div className="grid grid-cols-4 gap-1">
                            {MONTHS.map((m, i) => {
                              const isCurrent = pickerYear === year && i === month
                              return (
                                <button
                                  key={i}
                                  onClick={() => goToYearMonth(pickerYear, i)}
                                  className={`py-1.5 text-xs rounded-lg transition-colors ${
                                    isCurrent
                                      ? 'bg-accent text-white font-medium'
                                      : 'text-ink-2 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                  }`}
                                >{m}</button>
                              )
                            })}
                          </div>
                        </>
                      )}
                      {/* 빠른 점프: 오늘 */}
                      <button
                        onClick={() => { goToYearMonth(today.getFullYear(), today.getMonth()) }}
                        className="mt-2 w-full text-center text-xs text-accent hover:underline py-1"
                      >오늘로</button>
                    </div>
                  </>,
                  document.body
                )}
              </div>
              <button
                onClick={() => setModal({ type: 'create', date: selectedDate ?? todayKey })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
              >
                <Plus size={13} /> 일정 추가
              </button>
              <button
                onClick={fetchEvents} disabled={loading}
                className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-ink-4 transition-colors"
                title="새로고침"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>

      {/* ── NEXT UP 카운트다운 바 (전체 너비) ─── */}
      {nextEvent && (
        <div style={{
          padding: '14px 20px',
          background: 'var(--ink-0)', color: 'var(--paper)',
          borderRadius: 'var(--r-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--dot)', flexShrink: 0 }} className="ut-dot-pulse" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.55)' }}>NEXT UP</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{nextEvent.ev.summary || '(제목 없음)'}</span>
            <span className="ut-mono" style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              {nextEvent.startDate.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>남은 시간</span>
            <span style={{ fontSize: 17, color: 'var(--dot)' }}>
              <LiveCountdown targetISO={nextEvent.ev.start_dt!} />
            </span>
          </div>
        </div>
      )}

      {/* ── 2컬럼: 캘린더 그리드 | 사이드 패널 ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 items-start">
        {/* 캘린더 그리드 */}
        <Card title="" className="!p-0 overflow-hidden">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-[var(--divide)] bg-zinc-50/80 dark:bg-zinc-800/50">
            {DAYS.map((d, i) => (
              <div key={d} className={`py-2 text-center text-xs font-semibold tracking-wide ${
                i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-ink-3'
              }`}>{d}</div>
            ))}
          </div>
          {/* 날짜 셀 */}
          <div ref={gridWrapRef} className="relative overflow-hidden">
            {exitView && (
              <div className={`absolute inset-x-0 top-0 z-10 pointer-events-none ${
                transDir === 'up' ? 'cal-exit-up' : 'cal-exit-down'
              }`}>
                <CalGridCells
                  year={exitView.year} month={exitView.month}
                  cellLayout={{}} selectedDate={null}
                  onDateSelect={() => {}} onNavigatePrev={() => {}} onNavigateNext={() => {}}
                  onEventClick={() => {}} onDateDoubleClick={() => {}} onDateShiftClick={() => {}}
                  onDragStart={() => {}} onDragOver={() => {}} dragRange={null}
                  calendars={calendars} todayKey={todayKey}
                />
              </div>
            )}
            <div
              key={`${year}-${month}`}
              className={transDir === 'up' ? 'cal-enter-up' : transDir === 'down' ? 'cal-enter-down' : ''}
            >
              <CalGridCells
                year={year} month={month}
                cellLayout={cellLayout} selectedDate={selectedDate}
                onDateSelect={dateKey => { if (!isDraggingRef.current) setSelectedDate(dateKey) }}
                onNavigatePrev={navigatePrev} onNavigateNext={navigateNext}
                onEventClick={ev => setModal({ type: 'edit', event: ev })}
                onDateDoubleClick={dateKey => setModal({ type: 'create', date: dateKey })}
                onDateShiftClick={handleDateShiftClick}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                dragRange={dragRange}
                calendars={calendars} todayKey={todayKey}
              />
            </div>
          </div>
          {/* 조작 힌트 */}
          <div className="px-3 py-1.5 border-t border-[var(--divide)] flex gap-4">
            <span className="text-[10px] text-ink-4">더블클릭 → 일정 추가</span>
            <span className="text-[10px] text-ink-4">날짜 선택 후 Shift+클릭 → 기간 일정 추가</span>
          </div>
        </Card>

        {/* 사이드 패널 */}
        <aside className="space-y-3">
          <TodayCard events={filteredEvents} calendars={calendars} />
          <MiniCalendar year={nextMonthYear} month={nextMonthMonth} events={filteredEvents} />
          <SelectedDatePanel
            dateKey={selectedDate ?? todayKey}
            events={eventsByDate[selectedDate ?? todayKey] ?? []}
            calendars={calendars}
            onEventClick={ev => setModal({ type: 'edit', event: ev })}
            onAdd={() => setModal({ type: 'create', date: selectedDate ?? todayKey })}
          />
        </aside>
      </div>

      {/* 모달 */}
      {modal.type === 'create' && (
        <EventModal
          mode="create"
          initialData={defaultFormData(modal.date, primaryCalId, modal.endDate)}
          calendars={calendars}
          onClose={() => setModal({ type: 'none' })}
          onSave={handleCreate}
        />
      )}
      {modal.type === 'edit' && (
        <EventModal
          mode="edit"
          initialData={eventToFormData(modal.event)}
          calendars={calendars}
          onClose={() => setModal({ type: 'none' })}
          onSave={(form, scope) => handleUpdate(modal.event, form, scope)}
          onDelete={scope => handleDelete(modal.event, scope)}
          recurringFetchGid={
            (modal.event.recurring_event_id || (modal.event.recurrence && modal.event.recurrence.length))
              ? modal.event.google_event_id
              : undefined
          }
        />
      )}
    </div>
  )
}
