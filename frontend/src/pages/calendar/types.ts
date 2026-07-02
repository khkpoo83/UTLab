// Shared Calendar types (roadmap Phase 3, P3-3). Extracted verbatim from
// pages/Calendar.tsx to shrink that god-component.

export interface GoogleCalendar {
  id: string
  name: string
  backgroundColor: string
  foregroundColor: string
  primary: boolean
  accessRole: string
}

export interface CalEvent {
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
  recurring_event_id?: string
}

// ── 월간 레인 레이아웃 ──
export interface LaneSeg {
  ev: CalEvent
  isStart: boolean // 이 칸이 이벤트의 시작일
  isEnd: boolean // 이 칸이 이벤트의 마지막 날
}
export interface LaneCell {
  lanes: (LaneSeg | null)[]
  total: number // 그 날의 전체 일정 수 (overflow 계산용)
}

// ── 반복(RRULE) / 이벤트 폼 ──
export type RecurFreq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type RecurEnd = 'NONE' | 'COUNT' | 'UNTIL'
export type RecurScope = 'this' | 'following' | 'all'

export interface EventFormData {
  summary: string
  description: string
  location: string
  all_day: boolean
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  calendar_id: string
  recur_freq: RecurFreq
  recur_interval: number
  recur_byday: string[] // ['MO','WE'] (WEEKLY일 때)
  recur_end: RecurEnd
  recur_count: number
  recur_until: string // YYYY-MM-DD
}
