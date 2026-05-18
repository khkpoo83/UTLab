import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, RefreshCw, ExternalLink, CalendarDays, Plus, MapPin, Search, ChevronDown } from 'lucide-react'
import apiClient, { settingsApi } from '../api/client'
import { Card } from '../components/Card'
import Modal, { ModalHeader } from '../components/Modal'

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface GoogleCalendar {
  id: string
  name: string
  backgroundColor: string
  foregroundColor: string
  primary: boolean
  accessRole: string
}

interface CalEvent {
  id: number
  google_event_id: string
  calendar_id?: string
  summary?: string
  description?: string
  location?: string
  start_dt?: string
  end_dt?: string
  all_day: boolean
  status?: string
  html_link?: string
  color_id?: string
  recurrence?: string[]
}

const GCL_COLORS: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
  '5': '#f6c026', '6': '#f5511d', '7': '#039be5', '8': '#616161',
  '9': '#3f51b5', '10': '#0b8043', '11': '#d60000',
}

function evColor(ev: CalEvent, calendars: GoogleCalendar[]): string {
  if (ev.color_id && GCL_COLORS[ev.color_id]) return GCL_COLORS[ev.color_id]
  const cal = calendars.find(c => c.id === ev.calendar_id)
  if (cal) return cal.backgroundColor
  return 'rgb(var(--c-accent-rgb))'
}

// ── 날짜 유틸 ─────────────────────────────────────────────────────────────────

function toKstDateKey(isoUtc: string, allDay: boolean): string {
  if (allDay) return isoUtc.slice(0, 10)
  return new Date(isoUtc + 'Z').toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

function toKstTime(isoUtc: string): string {
  return new Date(isoUtc + 'Z').toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit',
  })
}

function kstLocalToUtcIso(kstLocal: string): string {
  return new Date(kstLocal + ':00+09:00').toISOString().replace(/\.\d{3}Z$/, '')
}

function utcIsoToKstLocal(isoUtc: string): string {
  const d = new Date(isoUtc + 'Z')
  const kst = new Date(d.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 16)
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

function allDayEndForDisplay(endDt: string): string {
  return addDays(endDt.slice(0, 10), -1)
}

function isInRange(dateKey: string, range: { start: string; end: string } | null): boolean {
  if (!range) return false
  return dateKey >= range.start && dateKey <= range.end
}

// ── EventChip ─────────────────────────────────────────────────────────────────

function EventChip({
  ev, calendars, onClick,
}: {
  ev: CalEvent
  calendars: GoogleCalendar[]
  onClick?: (ev: CalEvent, e: React.MouseEvent) => void
}) {
  const color = evColor(ev, calendars)
  const timeStr = ev.all_day ? null : (ev.start_dt ? toKstTime(ev.start_dt) : null)
  return (
    <div
      className="text-[10px] px-1 py-0.5 rounded truncate text-white leading-tight shadow-sm cursor-pointer hover:brightness-90 transition-all active:scale-95"
      style={{ backgroundColor: color, borderLeft: `2.5px solid color-mix(in srgb, ${color} 60%, #000)` }}
      title={ev.summary ?? '(제목 없음)'}
      onClick={e => { e.stopPropagation(); onClick?.(ev, e) }}
    >
      {timeStr && <span className="opacity-80 mr-0.5">{timeStr}</span>}
      {ev.summary ?? '(제목 없음)'}
    </div>
  )
}


// ── EventFormData ─────────────────────────────────────────────────────────────

interface EventFormData {
  summary: string
  description: string
  location: string
  all_day: boolean
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  calendar_id: string
}

function defaultFormData(date?: string | null, primaryCalId?: string, endDate?: string | null): EventFormData {
  const base = date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  const now = new Date()
  const rawM = now.getMinutes()
  const snapH = rawM < 30 ? now.getHours() : now.getHours() + 1
  const snapM = rawM < 30 ? 30 : 0
  const startH = snapH % 24
  const endH = (snapH + 1) % 24
  const isRange = endDate && endDate !== base
  return {
    summary: '',
    description: '',
    location: '',
    all_day: isRange ? true : false,
    start_date: base,
    start_time: `${String(startH).padStart(2, '0')}:${String(snapM).padStart(2, '0')}`,
    end_date: endDate ?? base,
    end_time: `${String(endH).padStart(2, '0')}:${String(snapM).padStart(2, '0')}`,
    calendar_id: primaryCalId ?? 'primary',
  }
}

function eventToFormData(ev: CalEvent): EventFormData {
  const startLocal = ev.start_dt ? utcIsoToKstLocal(ev.start_dt) : ''
  const endLocal   = ev.end_dt   ? utcIsoToKstLocal(ev.end_dt)   : ''
  const endDateDisplay = ev.all_day && ev.end_dt
    ? allDayEndForDisplay(ev.end_dt)
    : endLocal.slice(0, 10)
  return {
    summary:     ev.summary     ?? '',
    description: ev.description ?? '',
    location:    ev.location    ?? '',
    all_day:     ev.all_day,
    start_date:  ev.all_day ? (ev.start_dt?.slice(0, 10) ?? '') : startLocal.slice(0, 10),
    start_time:  ev.all_day ? '09:00' : startLocal.slice(11, 16),
    end_date:    endDateDisplay,
    end_time:    ev.all_day ? '10:00' : endLocal.slice(11, 16),
    calendar_id: ev.calendar_id ?? 'primary',
  }
}

// ── LocationSearchModal ───────────────────────────────────────────────────────

interface NominatimResult {
  place_id: string
  display_name: string
}

function LocationSearchModal({
  onSelect, onClose,
}: {
  onSelect: (address: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NominatimResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function search() {
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&accept-language=ko`,
        { headers: { 'Accept-Language': 'ko' } }
      )
      const data: NominatimResult[] = await res.json()
      setResults(data)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidth="max-w-sm" bottomSheet={false}>
      <ModalHeader title="장소 검색" onClose={onClose} />
      <div className="px-4 pb-4 pt-3 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="장소 이름이나 주소 입력..."
            autoFocus
            className="flex-1 px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-accent transition-colors"
          />
          <button
            onClick={search}
            disabled={loading}
            className="px-3 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <Search size={14} />
          </button>
        </div>
        <div className="space-y-0.5 max-h-64 overflow-y-auto -mx-1 px-1">
          {loading && (
            <p className="text-xs text-zinc-400 text-center py-4">검색 중...</p>
          )}
          {!loading && searched && results.length === 0 && (
            <p className="text-xs text-zinc-400 text-center py-4">검색 결과 없음</p>
          )}
          {results.map(r => (
            <button
              key={r.place_id}
              onClick={() => onSelect(r.display_name)}
              className="w-full text-left px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg transition-colors leading-snug"
            >
              {r.display_name}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ── EventModal ────────────────────────────────────────────────────────────────

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

function EventModal({
  mode, initialData, calendars, onClose, onSave, onDelete,
}: {
  mode: 'create' | 'edit'
  initialData: EventFormData
  calendars: GoogleCalendar[]
  onClose: () => void
  onSave: (data: EventFormData) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [form, setForm] = useState<EventFormData>(initialData)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationSearchOpen, setLocationSearchOpen] = useState(false)

  function set<K extends keyof EventFormData>(key: K, value: EventFormData[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function handleStartTimeChange(newTime: string) {
    setForm(f => {
      const toMins = (t: string) => parseInt(t.slice(0, 2)) * 60 + parseInt(t.slice(3, 5))
      const startMins = toMins(newTime)
      const endMins = toMins(f.end_time)
      const duration = endMins - startMins
      const newEndMins = Math.min(duration > 0 ? startMins + duration : startMins + 60, 23 * 60 + 30)
      const snapped = Math.round(newEndMins / 30) * 30
      const nh = Math.floor(snapped / 60)
      const nm = snapped % 60
      return {
        ...f,
        start_time: newTime,
        end_time: `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`,
      }
    })
  }

  function handleStartDateChange(newDate: string) {
    setForm(f => ({
      ...f,
      start_date: newDate,
      end_date: f.end_date === f.start_date ? newDate : f.end_date,
    }))
  }

  function toggleAllDay() {
    const next = !form.all_day
    if (next) {
      setForm(f => ({ ...f, all_day: true, end_date: f.start_date }))
    } else {
      setForm(f => ({ ...f, all_day: false }))
    }
  }

  const writableCalendars = calendars.filter(c => c.accessRole !== 'reader' && c.accessRole !== 'freeBusyReader')

  async function handleSave() {
    if (!form.summary.trim()) { setError('제목을 입력하세요'); return }
    setSaving(true); setError(null)
    try { await onSave(form); onClose() }
    catch (e: any) { setError(e?.response?.data?.detail ?? '저장 실패') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!onDelete) return
    if (!confirm('일정을 삭제할까요?')) return
    setDeleting(true); setError(null)
    try { await onDelete(); onClose() }
    catch (e: any) { setError(e?.response?.data?.detail ?? '삭제 실패') }
    finally { setDeleting(false) }
  }

  const selectedCal = calendars.find(c => c.id === form.calendar_id)
  const inputCls = "w-full px-2.5 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-accent transition-colors"
  const toMins = (t: string) => parseInt(t.slice(0, 2)) * 60 + parseInt(t.slice(3, 5))
  const endBeforeStart = !form.all_day && form.end_date === form.start_date && toMins(form.end_time) <= toMins(form.start_time)

  return (
    <>
      <Modal onClose={onClose} maxWidth="max-w-md" bottomSheet={false}>
        <ModalHeader
          title={mode === 'create' ? '일정 추가' : '일정 수정'}
          onClose={onClose}
        />

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {error && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* 제목 */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">제목 *</label>
            <input
              type="text"
              value={form.summary}
              onChange={e => set('summary', e.target.value)}
              placeholder="일정 제목"
              autoFocus
              className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* 캘린더 선택 */}
          {writableCalendars.length > 1 && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">캘린더</label>
              <div className="relative">
                <select
                  value={form.calendar_id}
                  onChange={e => set('calendar_id', e.target.value)}
                  className="w-full pl-7 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-accent appearance-none cursor-pointer"
                >
                  {writableCalendars.map(cal => (
                    <option key={cal.id} value={cal.id}>{cal.name}</option>
                  ))}
                </select>
                <span
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full pointer-events-none"
                  style={{ backgroundColor: selectedCal?.backgroundColor ?? 'rgb(var(--c-accent-rgb))' }}
                />
              </div>
            </div>
          )}

          {/* 종일 토글 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleAllDay}
              role="switch"
              aria-checked={form.all_day}
              className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                form.all_day ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  form.all_day ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-zinc-600 dark:text-zinc-400 select-none">종일</span>
          </div>

          {/* 시작/종료 */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">시작</label>
                <input type="date" value={form.start_date} onChange={e => handleStartDateChange(e.target.value)} className={inputCls} />
                {!form.all_day && (
                  <select value={form.start_time} onChange={e => handleStartTimeChange(e.target.value)} className={`mt-1.5 ${inputCls} cursor-pointer`}>
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">종료</label>
                <input type="date" value={form.end_date} min={form.start_date} onChange={e => set('end_date', e.target.value)} className={inputCls} />
                {!form.all_day && (
                  <select value={form.end_time} onChange={e => set('end_time', e.target.value)} className={`mt-1.5 ${inputCls} cursor-pointer ${endBeforeStart ? 'border-red-400 dark:border-red-500' : ''}`}>
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
            </div>
            {endBeforeStart && (
              <p className="text-xs text-red-500">종료 시간이 시작 시간보다 이릅니다</p>
            )}
          </div>

          {/* 장소 */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">장소</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.location}
                onChange={e => set('location', e.target.value)}
                placeholder="선택 사항"
                className="flex-1 px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-accent transition-colors"
              />
              <button
                type="button"
                onClick={() => setLocationSearchOpen(true)}
                className="px-2.5 py-2 text-zinc-400 hover:text-accent bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:border-accent transition-colors"
                title="지도에서 장소 검색"
              >
                <MapPin size={15} />
              </button>
            </div>
          </div>

          {/* 설명 */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">설명</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="선택 사항"
              rows={2}
              className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-accent resize-none transition-colors"
            />
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-100 dark:border-zinc-800">
          <div>
            {mode === 'edit' && onDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? '삭제 중...' : '삭제'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors">
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </Modal>

      {locationSearchOpen && (
        <LocationSearchModal
          onSelect={addr => { set('location', addr); setLocationSearchOpen(false) }}
          onClose={() => setLocationSearchOpen(false)}
        />
      )}
    </>
  )
}

// ── UpcomingPanel ─────────────────────────────────────────────────────────────

function UpcomingPanel({ calendars }: { calendars: GoogleCalendar[] }) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchUpcoming = useCallback(() => {
    apiClient.get('/api/calendar/events/upcoming', { params: { limit: 5 } })
      .then(({ data }) => setEvents(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchUpcoming()
    window.addEventListener('calendarUpdated', fetchUpcoming)
    const t = setInterval(fetchUpcoming, 30_000)
    return () => { window.removeEventListener('calendarUpdated', fetchUpcoming); clearInterval(t) }
  }, [fetchUpcoming])

  if (loading) return <div className="text-xs text-zinc-400 py-1">로딩 중...</div>
  if (!events.length) return <div className="text-xs text-zinc-400 py-1">다가오는 일정 없음</div>

  return (
    <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50 -my-1">
      {events.map(ev => {
        const color = evColor(ev, calendars)
        return (
          <div key={ev.id} className="flex items-start gap-2 py-1.5">
            <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: color }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-700 dark:text-zinc-200 truncate">{ev.summary ?? '(제목 없음)'}</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                {ev.all_day ? '종일' : (ev.start_dt ? toKstTime(ev.start_dt) : '')}
                {ev.location && ` · ${ev.location}`}
              </div>
            </div>
            {ev.html_link && (
              <a href={ev.html_link} target="_blank" rel="noopener noreferrer"
                className="opacity-0 hover:opacity-100 text-zinc-400 hover:text-accent transition-all flex-shrink-0 mt-0.5">
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── CalGridCells ──────────────────────────────────────────────────────────────

function CalGridCells({
  year, month, eventsByDate, selectedDate,
  onDateSelect, onNavigatePrev, onNavigateNext,
  onEventClick, onDateDoubleClick, onDateShiftClick,
  onDragStart, onDragOver,
  dragRange,
  calendars, todayKey,
}: {
  year: number; month: number
  eventsByDate: Record<string, CalEvent[]>
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
    dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-zinc-700 dark:text-zinc-300'
  }`

  const fadedCellBase = 'h-[112px] overflow-hidden border-b border-r border-zinc-200/60 dark:border-zinc-700/60 p-1.5 cursor-pointer transition-colors select-none bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/30'

  return (
    <div className="grid grid-cols-7">
      {/* 전달 마지막 주 */}
      {Array.from({ length: 7 }).map((_, i) => {
        const day = pLast - firstDow - 6 + i
        return (
          <div
            key={`ep${i}`}
            onClick={() => onNavigatePrev(pk(day))}
            className={fadedCellBase}
          >
            <div className={fadedNum(i)}>{day}</div>
          </div>
        )
      })}

      {/* 전달/현재달 구분선 */}
      <div className="col-span-7 h-[2px] bg-zinc-300/40 dark:bg-zinc-600/40" />

      {/* 이번 달 첫 주 빈칸 */}
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
        const dayEvs = eventsByDate[dateKey] ?? []
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
            className={`h-[112px] overflow-hidden border-b border-r border-zinc-200/60 dark:border-zinc-700/60 p-1.5 cursor-pointer transition-colors select-none ${
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
                : 'text-zinc-600 dark:text-zinc-300'
              }`} style={isToday ? { fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 800 } : {}}>
                {day}
              </div>
              {isToday && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dot)', display: 'inline-block' }} />
              )}
            </div>
            <div className="space-y-0.5">
              {dayEvs.slice(0, 3).map(ev => (
                <EventChip key={ev.id} ev={ev} calendars={calendars} onClick={onEventClick} />
              ))}
              {dayEvs.length > 3 && <div className="text-[10px] text-zinc-400 pl-1">+{dayEvs.length - 3}개 더</div>}
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

      {/* 현재달/다음달 구분선 */}
      <div className="col-span-7 h-[2px] bg-zinc-300/40 dark:bg-zinc-600/40" />

      {/* 다음달 첫 주 */}
      {Array.from({ length: 7 }).map((_, i) => {
        const day = trail + 1 + i
        return (
          <div
            key={`en${i}`}
            onClick={() => onNavigateNext(nk(day))}
            className={fadedCellBase}
          >
            <div className={fadedNum(i)}>{day}</div>
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
            : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-accent hover:text-accent'
        }`}
        title="캘린더 선택"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: open ? 'rgba(255,255,255,0.8)' : 'var(--c-accent)' }}
        />
        캘린더
        {activeCount < totalCount && (
          <span className={`tabular-nums ${open ? 'text-white/70' : 'text-zinc-400'}`}>
            {activeCount}/{totalCount}
          </span>
        )}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl p-2 min-w-[180px]"
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
                    className={`flex-shrink-0 w-3 h-3 rounded-sm border-2 transition-all ${active ? 'border-transparent' : 'border-zinc-300 dark:border-zinc-600 bg-transparent'}`}
                    style={active ? { backgroundColor: cal.backgroundColor } : {}}
                  />
                  <span className={`text-sm flex-1 truncate transition-colors ${active ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400 dark:text-zinc-500'}`}>
                    {cal.name}
                  </span>
                  {cal.primary && (
                    <span className="text-[10px] text-zinc-400 flex-shrink-0">기본</span>
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

  const primaryCalId = calendars.find(c => c.primary)?.id ?? 'primary'

  function buildEventBody(form: EventFormData) {
    if (form.all_day) {
      return {
        summary: form.summary,
        description: form.description || undefined,
        location: form.location || undefined,
        all_day: true,
        start: form.start_date,
        end: form.end_date || form.start_date,
        calendar_id: form.calendar_id || primaryCalId,
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
    }
  }

  function buildUpdateBody(form: EventFormData) {
    if (form.all_day) {
      return {
        summary: form.summary,
        description: form.description,
        location: form.location,
        all_day: true,
        start: form.start_date,
        end: form.end_date || form.start_date,
      }
    }
    return {
      summary: form.summary,
      description: form.description,
      location: form.location,
      all_day: false,
      start: kstLocalToUtcIso(`${form.start_date}T${form.start_time}`),
      end:   kstLocalToUtcIso(`${form.end_date}T${form.end_time}`),
    }
  }

  async function handleCreate(form: EventFormData) {
    await apiClient.post('/api/calendar/events', buildEventBody(form))
    await fetchEvents()
  }

  async function handleUpdate(ev: CalEvent, form: EventFormData) {
    await apiClient.patch(`/api/calendar/events/${ev.google_event_id}`, buildUpdateBody(form))
    await fetchEvents()
  }

  async function handleDelete(ev: CalEvent) {
    await apiClient.delete(`/api/calendar/events/${ev.google_event_id}`)
    await fetchEvents()
  }

  if (connected === false) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <CalendarDays size={44} className="text-zinc-300 dark:text-zinc-600" />
        <p className="text-sm text-zinc-500">Google 캘린더가 연결되지 않았습니다.</p>
        <a href="/settings" className="text-sm text-accent hover:underline">설정에서 연결하기 →</a>
      </div>
    )
  }

  // 다음 일정 (비종일, 미래)
  const nextEvent = filteredEvents
    .filter(e => !e.all_day && e.start_dt)
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
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button onClick={goToday} className="chip text-xs px-2.5 py-1">오늘</button>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
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
                  onClick={() => { setPickerYear(year); setPickerOpen(p => !p) }}
                  className={`chip text-xs px-2.5 py-1 tabular-nums ${pickerOpen ? 'chip-active' : ''}`}
                  title="년월 이동"
                >이동</button>
                {pickerOpen && (
                  <>
                    <div className="fixed inset-0 z-[90]" onClick={() => setPickerOpen(false)} />
                    <div className="absolute top-full right-0 mt-1.5 z-[100] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl p-3 w-52">
                      <div className="flex items-center justify-between mb-2.5">
                        <button onClick={() => setPickerYear(y => y - 1)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
                          <ChevronLeft size={14} />
                        </button>
                        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">{pickerYear}년</span>
                        <button onClick={() => setPickerYear(y => y + 1)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
                          <ChevronRight size={14} />
                        </button>
                      </div>
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
                                  : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              }`}
                            >{m}</button>
                          )
                        })}
                      </div>
                    </div>
                  </>
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
                className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors"
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
          <div className="grid grid-cols-7 border-b border-zinc-200/70 dark:border-zinc-700/70 bg-zinc-50/80 dark:bg-zinc-800/50">
            {DAYS.map((d, i) => (
              <div key={d} className={`py-2 text-center text-xs font-semibold tracking-wide ${
                i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-zinc-500 dark:text-zinc-400'
              }`}>{d}</div>
            ))}
          </div>
          {/* 날짜 셀 */}
          <div className="relative overflow-hidden">
            {exitView && (
              <div className={`absolute inset-x-0 top-0 z-10 pointer-events-none ${
                transDir === 'up' ? 'cal-exit-up' : 'cal-exit-down'
              }`}>
                <CalGridCells
                  year={exitView.year} month={exitView.month}
                  eventsByDate={{}} selectedDate={null}
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
                eventsByDate={eventsByDate} selectedDate={selectedDate}
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
          <div className="px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800 flex gap-4">
            <span className="text-[10px] text-zinc-400">더블클릭 → 일정 추가</span>
            <span className="text-[10px] text-zinc-400">날짜 선택 후 Shift+클릭 → 기간 일정 추가</span>
          </div>
        </Card>

        {/* 사이드 패널 */}
        <aside className="space-y-3">
          <TodayCard events={filteredEvents} calendars={calendars} />
          <MiniCalendar year={nextMonthYear} month={nextMonthMonth} events={filteredEvents} />
          <Card title="다가오는 일정" icon={<CalendarDays size={14} />}>
            <UpcomingPanel calendars={calendars} />
          </Card>
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
          onSave={form => handleUpdate(modal.event, form)}
          onDelete={() => handleDelete(modal.event)}
        />
      )}
    </div>
  )
}
