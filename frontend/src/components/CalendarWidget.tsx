import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import Card from './Card'
import { calendarApi, CalendarEventItem } from '../api/client'

const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
const DOW_NAMES   = ['일','월','화','수','목','금','토']

function toKstDateStr(iso: string): string {
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  const kst = new Date(d.getTime() + 9 * 3600 * 1000)
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth()+1).padStart(2,'0')}-${String(kst.getUTCDate()).padStart(2,'0')}`
}

function toKstDate(iso: string): Date {
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  return new Date(d.getTime() + 9 * 3600 * 1000)
}

// ── EventTooltip ──────────────────────────────────────────────────────────────
// createPortal로 document.body에 렌더 → dnd-kit transform 영향 없음

function EventTooltip({ events, anchorRect }: { events: CalendarEventItem[]; anchorRect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const tipW = ref.current.offsetWidth
    const tipH = ref.current.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = anchorRect.left + anchorRect.width / 2 - tipW / 2
    let top  = anchorRect.bottom + 6
    if (left + tipW > vw - 8) left = vw - tipW - 8
    if (left < 8) left = 8
    if (top + tipH > vh - 8) top = anchorRect.top - tipH - 6
    setPos({ left, top })
  }, [anchorRect])

  const content = (
    <div
      ref={ref}
      className="fixed z-[9999] rounded-xl shadow-xl p-2.5 min-w-[160px] max-w-[220px] pointer-events-none"
      style={pos
        ? { left: pos.left, top: pos.top, opacity: 1, background: 'var(--c-surface)', border: '1px solid var(--line)' }
        : { left: 0, top: 0, opacity: 0, background: 'var(--c-surface)', border: '1px solid var(--line)' }}
    >
      <div className="space-y-1.5">
        {events.slice(0, 5).map(ev => {
          const kst = ev.start_dt ? new Date(ev.start_dt + (ev.start_dt.endsWith('Z') ? '' : 'Z')) : null
          const kstH = kst ? Math.floor((kst.getTime() / 3600000 + 9) % 24) : null
          const kstM = kst ? kst.getUTCMinutes() : null
          const timeStr = ev.all_day ? '종일'
            : (kstH != null ? `${String(kstH).padStart(2, '0')}:${String(kstM).padStart(2, '0')}` : '')
          return (
            <div key={ev.id} className="flex items-start gap-1.5 min-w-0">
              <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 bg-accent" />
              <div className="min-w-0">
                <p className="text-xs leading-tight truncate" style={{ color: 'var(--ink-1)' }}>
                  {ev.summary ?? '(제목 없음)'}
                </p>
                {timeStr && <p className="text-2xs tabular-nums" style={{ color: 'var(--ink-4)' }}>{timeStr}</p>}
              </div>
            </div>
          )
        })}
        {events.length > 5 && (
          <p className="text-2xs pl-3" style={{ color: 'var(--ink-4)' }}>+{events.length - 5}개 더</p>
        )}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

// ── CalGrid ───────────────────────────────────────────────────────────────────

function CalGrid({
  year, month, todayStr, eventsByDate, selectedDate, onSelect, compact = false,
}: {
  year: number; month: number
  todayStr: string; eventsByDate: Record<string, CalendarEventItem[]>
  selectedDate: string; onSelect: (d: string) => void
  compact?: boolean
}) {
  const firstDow    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const [tooltip, setTooltip] = useState<{ events: CalendarEventItem[]; rect: DOMRect } | null>(null)

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-7 mb-0.5">
        {DOW_NAMES.map((d, i) => (
          <div
            key={d}
            className={`text-center font-semibold ${compact ? 'text-2xs py-0.5' : 'text-xs py-1'} ${
              i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : ''
            }`}
            style={i !== 0 && i !== 6 ? { color: 'var(--ink-4)' } : undefined}
          >{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1 content-between">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} />
          const dow      = (firstDow + day - 1) % 7
          const dateStr  = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const isToday    = dateStr === todayStr
          const isSelected = !isToday && dateStr === selectedDate
          const dayEvents  = eventsByDate[dateStr] ?? []
          const hasEvent   = dayEvents.length > 0
          return (
            <div
              key={idx}
              className="flex flex-col items-center"
              onMouseEnter={hasEvent ? e => setTooltip({ events: dayEvents, rect: e.currentTarget.getBoundingClientRect() }) : undefined}
              onMouseLeave={hasEvent ? () => setTooltip(null) : undefined}
            >
              <button
                onClick={() => onSelect(dateStr)}
                className={`${compact ? 'w-6 h-6 text-2xs' : 'w-7 h-7 text-xs'} flex items-center justify-center rounded-full font-medium transition-colors ${
                  isToday    ? 'bg-accent text-white font-bold' :
                  isSelected ? 'bg-accent/20 text-accent dark:bg-accent/30 font-semibold' :
                  dow === 0  ? 'text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' :
                  dow === 6  ? 'text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' :
                               'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
                style={!isToday && !isSelected && dow !== 0 && dow !== 6 ? { color: 'var(--ink-1)' } : undefined}
              >{day}</button>
              {hasEvent && (
                <div className={`w-1 h-1 rounded-full mt-0.5 ${isToday ? 'bg-white/70' : 'bg-accent/60'}`} />
              )}
            </div>
          )
        })}
      </div>
      {tooltip && <EventTooltip events={tooltip.events} anchorRect={tooltip.rect} />}
    </div>
  )
}

// ── DateEvents ────────────────────────────────────────────────────────────────

function DateEvents({
  events, selectedDate, showDetails = true,
}: {
  events: CalendarEventItem[]; selectedDate: string; showDetails?: boolean
}) {
  const parts = selectedDate.split('-').map(Number)
  const [, m, d] = parts

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <p className="text-2xs font-semibold mb-2 shrink-0" style={{ color: 'var(--ink-4)' }}>
        {m}월 {d}일 일정
      </p>
      {events.length === 0 ? (
        <p className="text-xs text-center py-3" style={{ color: 'var(--ink-4)' }}>일정 없음</p>
      ) : (
        <div className="space-y-2.5 overflow-y-auto flex-1 min-h-0 pr-0.5">
          {events.map(ev => {
            const kst     = ev.start_dt ? toKstDate(ev.start_dt) : null
            const timeStr = ev.all_day ? '종일'
              : kst ? `${String(kst.getUTCHours()).padStart(2,'0')}:${String(kst.getUTCMinutes()).padStart(2,'0')}`
              : ''
            return (
              <div key={ev.id} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight truncate" style={{ color: 'var(--ink-1)' }}>
                    {ev.summary ?? '(제목 없음)'}
                  </p>
                  <p className="text-2xs mt-0.5 tabular-nums" style={{ color: 'var(--ink-4)' }}>{timeStr}</p>
                  {showDetails && ev.location && (
                    <p className="text-2xs mt-0.5 truncate" style={{ color: 'var(--ink-4)' }}>📍 {ev.location}</p>
                  )}
                  {showDetails && ev.description && (
                    <p className="text-2xs mt-0.5 line-clamp-1" style={{ color: 'var(--ink-4)' }}>{ev.description}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── CalendarWidget ────────────────────────────────────────────────────────────

export default function CalendarWidget({
  widgetW, widgetH, title, dragHandle, minH,
}: {
  widgetW: number; widgetH: number; title?: string; dragHandle?: React.ReactNode; minH?: number
}) {
  const today    = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  const [calMonth,       setCalMonth]       = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [selectedDate,   setSelectedDate]   = useState(todayStr)
  const [calEvents,      setCalEvents]      = useState<CalendarEventItem[]>([])
  const [flatTooltip,    setFlatTooltip]    = useState<{ events: CalendarEventItem[]; rect: DOMRect } | null>(null)
  const [needsReconnect, setNeedsReconnect] = useState(false)

  // 마운트 시 캘린더 연결 상태 확인
  useEffect(() => {
    calendarApi.status().then(s => {
      if (s.connected && s.needs_reconnect) setNeedsReconnect(true)
    }).catch(() => {})
  }, [])

  const { year, month } = calMonth

  const fetchEvents = useCallback(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    calendarApi.getEvents({
      from_date: `${year}-${pad(month + 1)}-01`,
      to_date:   `${year}-${pad(month + 1)}-${pad(daysInMonth)}`,
    }).then(setCalEvents).catch(() => setCalEvents([]))
  }, [year, month])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  // push 수신 또는 60초 폴링 시 자동 갱신
  useEffect(() => {
    window.addEventListener('calendarUpdated', fetchEvents)
    const t = setInterval(fetchEvents, 60_000)
    return () => { window.removeEventListener('calendarUpdated', fetchEvents); clearInterval(t) }
  }, [fetchEvents])

  const eventsByDate = calEvents.reduce<Record<string, CalendarEventItem[]>>((acc, ev) => {
    if (!ev.start_dt) return acc
    const key = toKstDateStr(ev.start_dt)
    ;(acc[key] ??= []).push(ev)
    return acc
  }, {})
  const selectedEvents = eventsByDate[selectedDate] ?? []

  const w = widgetW
  const h = widgetH

  const layout =
    h === 1 && w === 1 ? 'tiny'   :
    h === 1            ? 'flat'   :
    w === 1            ? 'narrow' :
    w === 2            ? 'wide'   :
    h === 2            ? 'medium' :
                         'full'

  const prevMonth = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCalMonth(p => { const d = new Date(p.year, p.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })
  }
  const nextMonth = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCalMonth(p => { const d = new Date(p.year, p.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })
  }

  const MonthHeader = ({ xs = false }: { xs?: boolean }) => (
    <div className="flex items-center justify-between shrink-0">
      <button onClick={prevMonth}
        className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        style={{ color: 'var(--ink-4)' }}
      ><ChevronLeft size={xs ? 12 : 14} /></button>
      <span className={`${xs ? 'text-xs' : 'text-sm'} font-semibold`} style={{ color: 'var(--ink-0)' }}>
        {year}년 {MONTH_NAMES[month]}
      </span>
      <button onClick={nextMonth}
        className="p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        style={{ color: 'var(--ink-4)' }}
      ><ChevronRight size={xs ? 12 : 14} /></button>
    </div>
  )

  // flat: current week days
  const todayDow = today.getDay()
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() - todayDow + i)
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    return { date: d, dateStr: ds, dow: i }
  })

  return (
    <Card
      icon={<Calendar size={14} />}
      title={title ?? '캘린더'}
      dragHandle={dragHandle}
      minH={minH}
      className="h-full flex flex-col"
      contentClassName="p-3 flex-1 min-h-0 overflow-hidden"
    >
      {/* ── 토큰 만료 배너 ── */}
      {needsReconnect && (
        <div className="flex items-center gap-1.5 px-2 py-1 mb-2 rounded-lg text-2xs bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/50">
          <span className="flex-1">Google 캘린더 재연결이 필요합니다</span>
          <a href="/settings" className="font-semibold underline whitespace-nowrap">설정 이동</a>
        </div>
      )}
      {/* ── tiny: 1×1 ── */}
      {layout === 'tiny' && (
        <div className="flex flex-col items-center justify-center h-full gap-1">
          <span className="text-3xl font-thin tabular-nums leading-none" style={{ color: 'var(--ink-0)' }}>
            {today.getDate()}
          </span>
          <span className="text-xs" style={{ color: 'var(--ink-4)' }}>{MONTH_NAMES[today.getMonth()]}</span>
          {selectedEvents.length > 0 && (
            <span className="tag tag-tonal text-2xs">{selectedEvents.length}개 일정</span>
          )}
        </div>
      )}

      {/* ── flat: h=1, w≥2 — month header + this week ── */}
      {layout === 'flat' && (
        <div className="flex items-center gap-2 h-full overflow-hidden">
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={prevMonth}
              className="p-0.5 rounded transition-colors"
              style={{ color: 'var(--ink-4)' }}
            ><ChevronLeft size={12} /></button>
            <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--ink-1)' }}>
              {year}년 {MONTH_NAMES[month]}
            </span>
            <button onClick={nextMonth}
              className="p-0.5 rounded transition-colors"
              style={{ color: 'var(--ink-4)' }}
            ><ChevronRight size={12} /></button>
          </div>
          <div className="h-8 w-px shrink-0" style={{ background: 'var(--line)' }} />
          <div className="flex flex-1 min-w-0 overflow-hidden">
            {weekDays.map(({ date, dateStr, dow }) => {
              const isToday    = dateStr === todayStr
              const isSelected = !isToday && dateStr === selectedDate
              const dayEvs     = eventsByDate[dateStr] ?? []
              const hasEv      = dayEvs.length > 0
              return (
                <div
                  key={dateStr}
                  style={{ flex: '0 0 calc(100% / 7)' }}
                  className="flex flex-col items-center gap-0.5"
                  onMouseEnter={hasEv ? e => setFlatTooltip({ events: dayEvs, rect: e.currentTarget.getBoundingClientRect() }) : undefined}
                  onMouseLeave={hasEv ? () => setFlatTooltip(null) : undefined}
                >
                  <span
                    className={`text-2xs ${dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : ''}`}
                    style={dow !== 0 && dow !== 6 ? { color: 'var(--ink-4)' } : undefined}
                  >
                    {DOW_NAMES[dow]}
                  </span>
                  <button
                    onClick={() => setSelectedDate(dateStr)}
                    className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-medium transition-colors ${
                      isToday    ? 'bg-accent text-white font-bold' :
                      isSelected ? 'bg-accent/20 text-accent font-semibold' :
                      dow === 0  ? 'text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' :
                      dow === 6  ? 'text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-800' :
                                   'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                    style={!isToday && !isSelected && dow !== 0 && dow !== 6 ? { color: 'var(--ink-1)' } : undefined}
                  >{date.getDate()}</button>
                  {hasEv && <div className={`w-1 h-1 rounded-full ${isToday ? 'bg-white/70' : 'bg-accent/60'}`} />}
                </div>
              )
            })}
          </div>
          {flatTooltip && <EventTooltip events={flatTooltip.events} anchorRect={flatTooltip.rect} />}
        </div>
      )}

      {/* ── narrow: w=1, h≥2 — 달력 + 하단 일정(h≥3) ── */}
      {layout === 'narrow' && (
        <div className="flex flex-col gap-2 h-full overflow-hidden">
          <MonthHeader />
          <div className={h >= 3 ? 'shrink-0' : 'flex-1 min-h-0'}>
            <CalGrid
              year={year} month={month} todayStr={todayStr}
              eventsByDate={eventsByDate} selectedDate={selectedDate}
              onSelect={setSelectedDate} compact={h <= 2}
            />
          </div>
          {h >= 3 && (
            <div className="flex-1 min-h-0 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
              <DateEvents events={selectedEvents} selectedDate={selectedDate} showDetails={false} />
            </div>
          )}
        </div>
      )}

      {/* ── wide: w=2, h≥2 — 달력 좌 | 선택 날짜 일정 우 ── */}
      {layout === 'wide' && (
        <div className="flex gap-3 h-full overflow-hidden">
          <div className="flex flex-col gap-2 shrink-0" style={{ width: '55%' }}>
            <MonthHeader />
            <div className="flex-1 min-h-0">
              <CalGrid
                year={year} month={month} todayStr={todayStr}
                eventsByDate={eventsByDate} selectedDate={selectedDate}
                onSelect={setSelectedDate}
              />
            </div>
          </div>
          <div className="flex-1 min-w-0 border-l pl-3 overflow-hidden" style={{ borderColor: 'var(--line)' }}>
            <DateEvents events={selectedEvents} selectedDate={selectedDate} showDetails={h >= 3} />
          </div>
        </div>
      )}

      {/* ── medium: w≥3, h=2 — 달력 좌 | 선택 날짜 일정 우 (넓게) ── */}
      {layout === 'medium' && (
        <div className="flex gap-3 h-full overflow-hidden">
          <div className="flex flex-col gap-2 shrink-0" style={{ width: '50%' }}>
            <MonthHeader xs />
            <div className="flex-1 min-h-0">
              <CalGrid
                year={year} month={month} todayStr={todayStr}
                eventsByDate={eventsByDate} selectedDate={selectedDate}
                onSelect={setSelectedDate} compact
              />
            </div>
          </div>
          <div className="flex-1 min-w-0 border-l pl-3 overflow-hidden" style={{ borderColor: 'var(--line)' }}>
            <DateEvents events={selectedEvents} selectedDate={selectedDate} showDetails />
          </div>
        </div>
      )}

      {/* ── full: w≥3, h≥3 — 달력 좌 | 선택 날짜 일정 우 (풀) ── */}
      {layout === 'full' && (
        <div className="flex gap-4 h-full overflow-hidden">
          <div className="flex flex-col gap-2 shrink-0" style={{ width: '52%' }}>
            <MonthHeader />
            <div className="flex-1 min-h-0">
              <CalGrid
                year={year} month={month} todayStr={todayStr}
                eventsByDate={eventsByDate} selectedDate={selectedDate}
                onSelect={setSelectedDate}
              />
            </div>
          </div>
          <div className="flex-1 min-w-0 border-l pl-4 overflow-hidden" style={{ borderColor: 'var(--line)' }}>
            <DateEvents events={selectedEvents} selectedDate={selectedDate} showDetails />
          </div>
        </div>
      )}
    </Card>
  )
}
