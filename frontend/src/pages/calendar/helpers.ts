// Pure Calendar helpers — color, KST date/time, month-lane layout, and RRULE /
// event-form conversion (roadmap Phase 3, P3-3). Extracted verbatim from
// pages/Calendar.tsx. No React/state — pure functions + constants only.
import type {
  CalEvent,
  GoogleCalendar,
  EventFormData,
  LaneSeg,
  LaneCell,
  RecurFreq,
  RecurEnd,
  RecurScope,
} from './types'

const GCL_COLORS: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
  '5': '#f6c026', '6': '#f5511d', '7': '#039be5', '8': '#616161',
  '9': '#3f51b5', '10': '#0b8043', '11': '#d60000',
}

export function evColor(ev: CalEvent, calendars: GoogleCalendar[]): string {
  if (ev.color_id && GCL_COLORS[ev.color_id]) return GCL_COLORS[ev.color_id]
  const cal = calendars.find(c => c.id === ev.calendar_id)
  if (cal) return cal.backgroundColor
  return 'rgb(var(--c-accent-rgb))'
}

// ── 날짜 유틸 ──

export function toKstDateKey(isoUtc: string, allDay: boolean): string {
  if (allDay) return isoUtc.slice(0, 10)
  return new Date(isoUtc + 'Z').toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
}

export function toKstTime(isoUtc: string): string {
  return new Date(isoUtc + 'Z').toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit',
  })
}

export function kstLocalToUtcIso(kstLocal: string): string {
  return new Date(kstLocal + ':00+09:00').toISOString().replace(/\.\d{3}Z$/, '')
}

export function utcIsoToKstLocal(isoUtc: string): string {
  const d = new Date(isoUtc + 'Z')
  const kst = new Date(d.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 16)
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

export function allDayEndForDisplay(endDt: string): string {
  return addDays(endDt.slice(0, 10), -1)
}

export function isInRange(dateKey: string, range: { start: string; end: string } | null): boolean {
  if (!range) return false
  return dateKey >= range.start && dateKey <= range.end
}

// ── 월간 레인 레이아웃 ──
// 여러 날 종일 일정을 칸 경계를 넘어 "이어지는 막대"로 그리기 위한 배치 계산.

/** 이벤트의 (포함) 마지막 날짜 키. 종일 복수일만 시작일보다 뒤가 될 수 있음 */
export function eventInclusiveEnd(ev: CalEvent): string {
  const startKey = toKstDateKey(ev.start_dt!, ev.all_day)
  if (ev.all_day && ev.end_dt) {
    const last = allDayEndForDisplay(ev.end_dt)
    return last < startKey ? startKey : last
  }
  return startKey
}

export function buildMonthLayout(events: CalEvent[]): Record<string, LaneCell> {
  const ranged = events
    .filter(e => e.start_dt)
    .map(e => ({ ev: e, startKey: toKstDateKey(e.start_dt!, e.all_day), endKey: eventInclusiveEnd(e) }))
  const spanning = ranged.filter(e => e.endKey > e.startKey)
  const single   = ranged.filter(e => e.endKey === e.startKey)

  // 그리디 레인 배정: 시작 빠른 순, 같으면 긴 것 먼저 → 위쪽 레인 고정
  spanning.sort((a, b) => a.startKey.localeCompare(b.startKey) || b.endKey.localeCompare(a.endKey))
  const laneEnd: string[] = []  // 레인별 현재 점유 이벤트의 마지막 날짜
  const laneOf = new Map<typeof spanning[number], number>()
  for (const s of spanning) {
    let lane = 0
    while (lane < laneEnd.length && laneEnd[lane] >= s.startKey) lane++
    laneEnd[lane] = s.endKey
    laneOf.set(s, lane)
  }

  const cells: Record<string, (LaneSeg | null)[]> = {}
  const ensure = (k: string) => (cells[k] ??= [])

  // spanning 이벤트를 고정 레인에 모든 날 배치
  for (const s of spanning) {
    const lane = laneOf.get(s)!
    let cur = s.startKey
    while (cur <= s.endKey) {
      const arr = ensure(cur)
      while (arr.length <= lane) arr.push(null)
      arr[lane] = { ev: s.ev, isStart: cur === s.startKey, isEnd: cur === s.endKey }
      cur = addDays(cur, 1)
    }
  }

  // single 이벤트를 그 날의 가장 낮은 빈 레인에 채움 (종일 먼저, 그다음 시각 순)
  const singleByDay: Record<string, typeof single> = {}
  for (const s of single) (singleByDay[s.startKey] ??= []).push(s)
  for (const k in singleByDay) {
    const arr = ensure(k)
    const list = singleByDay[k].sort((a, b) => {
      if (a.ev.all_day !== b.ev.all_day) return a.ev.all_day ? -1 : 1
      return (a.ev.start_dt ?? '').localeCompare(b.ev.start_dt ?? '')
    })
    for (const s of list) {
      let lane = 0
      while (arr[lane] != null) lane++
      arr[lane] = { ev: s.ev, isStart: true, isEnd: true }
    }
  }

  const out: Record<string, LaneCell> = {}
  for (const k in cells) {
    out[k] = { lanes: cells[k], total: cells[k].filter(Boolean).length }
  }
  return out
}

// ── 반복 규칙 스코프 옵션 ──
export const SCOPE_OPTS: { v: RecurScope; label: string; desc: string }[] = [
  { v: 'this',      label: '이 일정만',  desc: '고른 날짜 하루만' },
  { v: 'following', label: '이후 일정',  desc: '이 날부터 뒤로 전부 (이전은 그대로)' },
  { v: 'all',       label: '모든 일정',  desc: '지난 것까지 반복 전체' },
]

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
export const FREQ_UNIT: Record<string, string> = { DAILY: '일', WEEKLY: '주', MONTHLY: '개월', YEARLY: '년' }

export { WEEKDAY_CODES, WEEKDAY_LABELS }

export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

/** EventFormData → Google recurrence 배열 (반복 없으면 null) */
export function buildRRule(form: EventFormData): string | null {
  if (form.recur_freq === 'NONE') return null
  // "1회 반복"은 단일 일정과 같음 → 반복 규칙 없음 (구글도 단일로 표시)
  if (form.recur_end === 'COUNT' && form.recur_count <= 1) return null
  const parts = [`FREQ=${form.recur_freq}`]
  if (form.recur_interval > 1) parts.push(`INTERVAL=${form.recur_interval}`)
  if (form.recur_freq === 'WEEKLY' && form.recur_byday.length) {
    parts.push(`BYDAY=${form.recur_byday.join(',')}`)
  }
  if (form.recur_end === 'COUNT' && form.recur_count > 0) {
    parts.push(`COUNT=${form.recur_count}`)
  } else if (form.recur_end === 'UNTIL' && form.recur_until) {
    const ymd = form.recur_until.replace(/-/g, '')
    parts.push(form.all_day ? `UNTIL=${ymd}` : `UNTIL=${ymd}T235959Z`)
  }
  return `RRULE:${parts.join(';')}`
}

/** Google recurrence 배열 → EventFormData 반복 필드 (수정 진입 시 프리필) */
export function parseRRule(recurrence?: string[] | null): Pick<EventFormData, 'recur_freq' | 'recur_interval' | 'recur_byday' | 'recur_end' | 'recur_count' | 'recur_until'> {
  const base = { recur_freq: 'NONE' as RecurFreq, recur_interval: 1, recur_byday: [] as string[], recur_end: 'NONE' as RecurEnd, recur_count: 10, recur_until: '' }
  const rule = recurrence?.find(r => r.startsWith('RRULE:'))
  if (!rule) return base
  const fields = Object.fromEntries(
    rule.replace('RRULE:', '').split(';').map(kv => kv.split('=') as [string, string])
  )
  const freq = (fields.FREQ ?? 'NONE') as RecurFreq
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return base
  const out = { ...base, recur_freq: freq }
  if (fields.INTERVAL) out.recur_interval = Math.max(1, parseInt(fields.INTERVAL) || 1)
  if (fields.BYDAY) out.recur_byday = fields.BYDAY.split(',').filter(d => WEEKDAY_CODES.includes(d))
  if (fields.COUNT) {
    const c = parseInt(fields.COUNT) || 0
    if (c <= 1) return base   // 1회 이하 = 반복 아님 (구글도 단일로 표시)
    out.recur_end = 'COUNT'; out.recur_count = c
  }
  else if (fields.UNTIL) {
    out.recur_end = 'UNTIL'
    const m = fields.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/)
    if (m) out.recur_until = `${m[1]}-${m[2]}-${m[3]}`
  }
  return out
}

/** 반복 규칙 사람이 읽는 요약 */
export function describeRecurrence(form: EventFormData): string {
  if (form.recur_freq === 'NONE') return '반복 안 함'
  const unit = { DAILY: '일', WEEKLY: '주', MONTHLY: '개월', YEARLY: '년' }[form.recur_freq]
  let s = form.recur_interval > 1 ? `${form.recur_interval}${unit}마다` : { DAILY: '매일', WEEKLY: '매주', MONTHLY: '매월', YEARLY: '매년' }[form.recur_freq]
  if (form.recur_freq === 'WEEKLY' && form.recur_byday.length) {
    const days = form.recur_byday.map(c => WEEKDAY_LABELS[WEEKDAY_CODES.indexOf(c)]).join('·')
    s += ` ${days}요일`
  }
  if (form.recur_end === 'COUNT' && form.recur_count > 0) s += ` · ${form.recur_count}회`
  else if (form.recur_end === 'UNTIL' && form.recur_until) s += ` · ~${form.recur_until}`
  return s
}

export function defaultFormData(date?: string | null, primaryCalId?: string, endDate?: string | null): EventFormData {
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
    recur_freq: 'NONE',
    recur_interval: 1,
    recur_byday: [],
    recur_end: 'NONE',
    recur_count: 10,
    recur_until: '',
  }
}

export function eventToFormData(ev: CalEvent): EventFormData {
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
    ...parseRRule(ev.recurrence),
  }
}
