// Event create/edit modal (roadmap Phase 3, P3-3). Extracted verbatim from
// pages/Calendar.tsx — a self-contained, props-driven modal (form state lives
// here; the page owns fetch/save/delete via callbacks).
import { useState, useEffect, useRef } from 'react'
import apiClient from '../../api/client'
import Modal, { ModalHeader } from '../../components/Modal'
import LocationPicker, { LatLon, geocodeFirst } from '../../components/LocationPicker'
import type { EventFormData, GoogleCalendar, RecurScope, RecurFreq, RecurEnd } from './types'
import {
  parseRRule, describeRecurrence,
  SCOPE_OPTS, FREQ_UNIT, WEEKDAY_CODES, WEEKDAY_LABELS, TIME_OPTIONS,
} from './helpers'

export function EventModal({
  mode, initialData, calendars, onClose, onSave, onDelete, recurringFetchGid,
}: {
  mode: 'create' | 'edit'
  initialData: EventFormData
  calendars: GoogleCalendar[]
  onClose: () => void
  onSave: (data: EventFormData, scope?: RecurScope) => Promise<void>
  onDelete?: (scope?: RecurScope) => Promise<void>
  recurringFetchGid?: string   // 반복 인스턴스면 마스터 RRULE을 조회할 google_event_id
}) {
  const [form, setForm] = useState<EventFormData>(initialData)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coords, setCoords] = useState<LatLon | null>(null)
  // 반복 일정 적용 범위 — 모달 안에서 선택, 저장/삭제 시 그 범위로 적용
  const [editScope, setEditScope] = useState<RecurScope>('this')
  // 편집 진입 당시 "실제로" 반복 시리즈였는지 — 범위 선택 노출 여부.
  // COUNT=1 등 사실상 단일인 경우는 비반복으로 간주 → 범위 선택 안 함.
  const [seriesRecurring, setSeriesRecurring] = useState(initialData.recur_freq !== 'NONE')
  const wasRecurring = seriesRecurring

  function set<K extends keyof EventFormData>(key: K, value: EventFormData[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  // 수정 진입 시: 저장된 장소 문자열을 지오코딩하여 지도 핀 복원
  const didGeocodeInit = useRef(false)
  useEffect(() => {
    if (didGeocodeInit.current) return
    didGeocodeInit.current = true
    if (initialData.location.trim()) {
      geocodeFirst(initialData.location).then(c => { if (c) setCoords(c) })
    }
  }, [initialData.location])

  // 수정 진입 시: 반복 인스턴스는 규칙이 비어있으므로 마스터에서 RRULE을 가져와 표시
  const didRecurInit = useRef(false)
  useEffect(() => {
    if (didRecurInit.current) return
    didRecurInit.current = true
    if (recurringFetchGid && form.recur_freq === 'NONE') {
      apiClient.get(`/api/calendar/events/${recurringFetchGid}/recurrence`)
        .then(({ data }) => {
          const parsed = parseRRule(data?.recurrence)
          if (parsed.recur_freq !== 'NONE') {
            // 진짜 반복 시리즈일 때만 규칙 프리필 + 범위 선택 활성화
            setForm(f => ({ ...f, ...parsed }))
            setSeriesRecurring(true)
          }
        })
        .catch(() => {})
    }
  }, [recurringFetchGid])

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

  function setFreq(freq: RecurFreq) {
    setForm(f => {
      const next = { ...f, recur_freq: freq }
      // 주간 선택 시 기본 요일 = 시작일 요일
      if (freq === 'WEEKLY' && f.recur_byday.length === 0) {
        const dow = new Date(f.start_date + 'T12:00:00').getDay()
        next.recur_byday = [WEEKDAY_CODES[dow]]
      }
      return next
    })
  }

  function toggleByday(code: string) {
    setForm(f => {
      const has = f.recur_byday.includes(code)
      const arr = has ? f.recur_byday.filter(d => d !== code) : [...f.recur_byday, code]
      const ordered = WEEKDAY_CODES.filter(c => arr.includes(c))
      return { ...f, recur_byday: ordered.length ? ordered : f.recur_byday }
    })
  }

  const writableCalendars = calendars.filter(c => c.accessRole !== 'reader' && c.accessRole !== 'freeBusyReader')

  async function handleSave() {
    if (!form.summary.trim()) { setError('제목을 입력하세요'); return }
    setSaving(true); setError(null)
    try { await onSave(form, wasRecurring ? editScope : undefined); onClose() }
    catch (e: any) { setError(e?.response?.data?.detail ?? '저장 실패') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!onDelete) return
    const msg = wasRecurring
      ? `'${SCOPE_OPTS.find(o => o.v === editScope)?.label}' 범위로 삭제할까요?`
      : '일정을 삭제할까요?'
    if (!confirm(msg)) return
    setDeleting(true); setError(null)
    try { await onDelete(wasRecurring ? editScope : undefined); onClose() }
    catch (e: any) { setError(e?.response?.data?.detail ?? '삭제 실패') }
    finally { setDeleting(false) }
  }

  const selectedCal = calendars.find(c => c.id === form.calendar_id)
  const inputCls = "w-full px-2.5 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-ink-5 rounded-lg outline-none focus:border-accent transition-colors"
  const toMins = (t: string) => parseInt(t.slice(0, 2)) * 60 + parseInt(t.slice(3, 5))
  const endBeforeStart = !form.all_day && form.end_date === form.start_date && toMins(form.end_time) <= toMins(form.start_time)

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl" bottomSheet={false}>
      <ModalHeader
        title={mode === 'create' ? '일정 추가' : '일정 수정'}
        onClose={onClose}
      />

      <div className="px-5 py-4 max-h-[75vh] overflow-y-auto">
        {error && (
          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2 mb-3">{error}</p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-5 gap-y-3">
          {/* ── 좌측: 폼 ── */}
          <div className="space-y-3">
            {/* 제목 */}
            <div>
              <label className="block text-xs text-ink-3 mb-1">제목 *</label>
              <input
                type="text"
                value={form.summary}
                onChange={e => set('summary', e.target.value)}
                placeholder="일정 제목"
                autoFocus
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-ink-5 rounded-lg outline-none focus:border-accent transition-colors"
              />
            </div>

            {/* 캘린더 선택 */}
            {writableCalendars.length > 1 && (
              <div>
                <label className="block text-xs text-ink-3 mb-1">캘린더</label>
                <div className="relative">
                  <select
                    value={form.calendar_id}
                    onChange={e => set('calendar_id', e.target.value)}
                    className="w-full pl-7 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-ink-5 rounded-lg outline-none focus:border-accent appearance-none cursor-pointer"
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
              <span className="text-sm text-ink-2 select-none">종일</span>
            </div>

            {/* 시작/종료 */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-ink-3 mb-1">시작</label>
                  <input type="date" value={form.start_date} onChange={e => handleStartDateChange(e.target.value)} className={inputCls} />
                  {!form.all_day && (
                    <select value={form.start_time} onChange={e => handleStartTimeChange(e.target.value)} className={`mt-1.5 ${inputCls} cursor-pointer`}>
                      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-ink-3 mb-1">종료</label>
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

            {/* 반복 */}
            <div>
              <label className="block text-xs text-ink-3 mb-1">반복</label>
              <div className="space-y-2">
                  <select
                    value={form.recur_freq}
                    onChange={e => setFreq(e.target.value as RecurFreq)}
                    className={`${inputCls} cursor-pointer`}
                  >
                    <option value="NONE">반복 안 함</option>
                    <option value="DAILY">매일</option>
                    <option value="WEEKLY">매주</option>
                    <option value="MONTHLY">매월</option>
                    <option value="YEARLY">매년</option>
                  </select>

                  {form.recur_freq !== 'NONE' && (
                    <div className="space-y-2 pl-0.5">
                      {/* 간격 */}
                      <div className="flex items-center gap-2 text-xs text-ink-3">
                        <span>매</span>
                        <input
                          type="number" min={1} max={99} value={form.recur_interval}
                          onChange={e => set('recur_interval', Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-16 px-2 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-800 border border-ink-5 rounded-lg outline-none focus:border-accent text-center"
                        />
                        <span>{FREQ_UNIT[form.recur_freq]}마다</span>
                      </div>

                      {/* 요일 (주간) */}
                      {form.recur_freq === 'WEEKLY' && (
                        <div className="flex gap-1">
                          {WEEKDAY_CODES.map((code, i) => {
                            const on = form.recur_byday.includes(code)
                            return (
                              <button
                                key={code} type="button" onClick={() => toggleByday(code)}
                                className={`w-7 h-7 rounded-full text-xs font-medium transition-colors ${
                                  on
                                    ? 'bg-accent text-white'
                                    : `bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-ink-3'}`
                                }`}
                              >{WEEKDAY_LABELS[i]}</button>
                            )
                          })}
                        </div>
                      )}

                      {/* 종료 조건 */}
                      <div className="flex items-center gap-2">
                        <select
                          value={form.recur_end}
                          onChange={e => set('recur_end', e.target.value as RecurEnd)}
                          className="px-2.5 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-ink-5 rounded-lg outline-none focus:border-accent cursor-pointer flex-shrink-0"
                        >
                          <option value="NONE">계속 반복</option>
                          <option value="COUNT">횟수 지정</option>
                          <option value="UNTIL">날짜까지</option>
                        </select>
                        {form.recur_end === 'COUNT' && (
                          <div className="flex items-center gap-1.5 text-xs text-ink-3">
                            <input
                              type="number" min={2} max={730} value={form.recur_count}
                              onChange={e => set('recur_count', Math.max(2, parseInt(e.target.value) || 2))}
                              className="w-16 px-2 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-800 border border-ink-5 rounded-lg outline-none focus:border-accent text-center"
                            />
                            <span>회</span>
                          </div>
                        )}
                        {form.recur_end === 'UNTIL' && (
                          <input
                            type="date" min={form.start_date} value={form.recur_until}
                            onChange={e => set('recur_until', e.target.value)}
                            className={`${inputCls} flex-1`}
                          />
                        )}
                      </div>

                      <p className="text-2xs text-ink-4">{describeRecurrence(form)}</p>
                    </div>
                  )}
                </div>
            </div>

            {/* 반복 적용 범위 — 반복 시리즈일 때만. 저장/삭제 시 이 범위로 적용 */}
            {wasRecurring && (
              <div>
                <label className="block text-xs text-ink-3 mb-1">적용 범위 (반복 일정)</label>
                <div className="grid grid-cols-3 gap-1">
                  {SCOPE_OPTS.map(o => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setEditScope(o.v)}
                      className={`py-1.5 text-xs rounded-lg border transition-colors ${
                        editScope === o.v
                          ? 'bg-accent text-white border-accent'
                          : 'border-ink-5 text-ink-2 hover:border-accent'
                      }`}
                    >{o.label}</button>
                  ))}
                </div>
                <p className="text-2xs text-ink-4 mt-1">
                  {SCOPE_OPTS.find(o => o.v === editScope)?.desc} · 저장/삭제 시 적용
                </p>
              </div>
            )}

            {/* 장소 (텍스트) */}
            <div>
              <label className="block text-xs text-ink-3 mb-1">장소</label>
              <input
                type="text"
                value={form.location}
                onChange={e => set('location', e.target.value)}
                placeholder="우측 지도에서 선택하거나 직접 입력"
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-ink-5 rounded-lg outline-none focus:border-accent transition-colors"
              />
            </div>

            {/* 설명 */}
            <div>
              <label className="block text-xs text-ink-3 mb-1">설명</label>
              <textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="선택 사항"
                rows={2}
                className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-ink-5 rounded-lg outline-none focus:border-accent resize-none transition-colors"
              />
            </div>
          </div>

          {/* ── 우측: 위치 지도 ── */}
          <div>
            <label className="block text-xs text-ink-3 mb-1">위치 지도</label>
            <LocationPicker
              value={form.location}
              coords={coords}
              onChange={(loc, c) => { set('location', loc); setCoords(c) }}
              height={300}
            />
          </div>
        </div>
      </div>

      {/* 하단 버튼 */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--divide)]">
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
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-ink-3 hover:text-ink-1 transition-colors">
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
  )
}
