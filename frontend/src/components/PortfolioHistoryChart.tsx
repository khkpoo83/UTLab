import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ComposedChart, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { portfolioApi, investmentMarksApi, InvestmentMark } from '../api/client'

interface PortfolioHistoryChartProps {
  accountNo?: string
  todayPnlPct?: number
  todayValue?: number
  todayCost?: number
  todayCash?: number
  period?: 7 | 30 | 90 | 180 | 365
  /** 외부에서 수익률/금액 보기를 제어할 때 사용. 지정 시 내부 "금액" 토글 버튼 숨김 */
  showSource?: boolean
}

// ── 뷰포트 인식 툴팁 ──────────────────────────────────────────────────────
// Recharts 기본 툴팁은 plot 영역(140px) 안으로만 클램프하므로, 내용이 길면
// 차트보다 커져 Summary 카드 밖으로 삐져나간다. 커서 좌표를 받아 body 포털에
// fixed 로 띄우고, 화면 경계에 닿으면 위/옆으로 뒤집어 항상 화면 안에 둔다.
interface TipState { payload: any; label: any; cx: number; cy: number }
export interface SmartTooltipHandle { set: (t: TipState) => void; clear: () => void }

const SmartTooltip = forwardRef<SmartTooltipHandle, { render: (p: any, l: any) => React.ReactNode }>(
  ({ render }, ref) => {
    const [tip, setTip] = useState<TipState | null>(null)
    useImperativeHandle(ref, () => ({ set: setTip, clear: () => setTip(null) }), [])

    const boxRef = useRef<HTMLDivElement | null>(null)
    const [size, setSize] = useState({ w: 160, h: 120 })
    useLayoutEffect(() => {
      if (!boxRef.current) return
      const r = boxRef.current.getBoundingClientRect()
      if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) {
        setSize({ w: r.width, h: r.height })
      }
    }, [tip, size.w, size.h])

    if (!tip) return null
    const node = render(tip.payload, tip.label)
    if (!node) return null

    const PAD = 14
    let left = tip.cx + PAD
    let top = tip.cy + PAD
    if (left + size.w > window.innerWidth - 8) left = tip.cx - size.w - PAD
    if (left < 8) left = 8
    if (top + size.h > window.innerHeight - 8) top = tip.cy - size.h - PAD
    if (top < 8) top = 8

    return createPortal(
      <div ref={boxRef} style={{ position: 'fixed', left, top, zIndex: 10000, pointerEvents: 'none' }}>
        {node}
      </div>,
      document.body,
    )
  },
)
SmartTooltip.displayName = 'SmartTooltip'

// 금액 축 compact 포맷
const fmtAmt = (v: number): string => {
  if (!v) return '0'
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`
  return `${Math.round(v / 1e4)}만`
}

const PortfolioHistoryChart: React.FC<PortfolioHistoryChartProps> = ({
  accountNo, todayPnlPct, todayValue, todayCost, todayCash, period: externalPeriod,
  showSource: externalShowSource,
}) => {
  const [rawData, setRawData] = useState<any[]>([])
  const [internalPeriod, setInternalPeriod] = useState<7 | 30 | 90 | 180 | 365>(30)
  const period = externalPeriod ?? internalPeriod
  const setPeriod = (p: 7 | 30 | 90 | 180 | 365) => { if (!externalPeriod) setInternalPeriod(p) }
  const [loading, setLoading] = useState(true)
  const [internalShowSource, setInternalShowSource] = useState(false)
  const showSource = externalShowSource ?? internalShowSource
  const setShowSource = (v: boolean) => { if (externalShowSource === undefined) setInternalShowSource(v) }
  const [activeLegend, setActiveLegend] = useState<string | null>(null)
  const [marks, setMarks] = useState<InvestmentMark[]>([])
  const [showMarkModal, setShowMarkModal] = useState(false)
  const [modalDate, setModalDate] = useState('')
  const [modalTitle, setModalTitle] = useState('')
  const [markSaving, setMarkSaving] = useState(false)
  const modalTitleRef = useRef<HTMLInputElement>(null)
  const lastClickRef = useRef<{ label: string; time: number } | null>(null)
  const sourceChartRef = useRef<HTMLDivElement>(null)
  const smartTipRef = useRef<SmartTooltipHandle>(null)

  // 금액 보기를 벗어나면 레이어 선택 해제
  useEffect(() => {
    if (!showSource) setActiveLegend(null)
  }, [showSource])

  // 차트 영역 바깥 클릭 시 activeLegend 리셋.
  // mousedown 사용: Recharts가 바 클릭 직후 리렌더로 클릭된 <rect> 노드를 DOM에서
  // 제거하기 때문에, click+contains 방식은 e.target이 분리된 노드가 되어 "바깥"으로
  // 오판한다. mousedown은 그 리렌더 이전에 발생하므로 contains 판정이 정확하다.
  useEffect(() => {
    if (activeLegend === null) return
    const handler = (e: MouseEvent) => {
      if (sourceChartRef.current && !sourceChartRef.current.contains(e.target as Node)) {
        setActiveLegend(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeLegend])

  const fetchMarks = (days: number) => {
    const to = new Date()
    const from = new Date(to)
    from.setDate(to.getDate() - days)
    investmentMarksApi.list({
      from_date: from.toISOString().slice(0, 10),
      to_date: to.toISOString().slice(0, 10),
    }).then(setMarks).catch(() => {})
  }

  useEffect(() => {
    setLoading(true)
    portfolioApi.history(period, accountNo).then(res => {
      setRawData(res.data)
    }).catch(() => {}).finally(() => setLoading(false))
    fetchMarks(period)
  }, [period, accountNo])

  // 오늘 실시간 순입금 (당일 바 net_deposits용)
  const [todayNetDep, setTodayNetDep] = useState<number | null>(null)

  useEffect(() => {
    setTodayNetDep(null)
    portfolioApi.todayNetDeposits(accountNo).then(res => {
      setTodayNetDep(res.data.net_deposits)
    }).catch(() => {})
  }, [accountNo])


  useEffect(() => {
    const handler = () => fetchMarks(period)
    window.addEventListener('calendarUpdated', handler)
    const timer = setInterval(() => fetchMarks(period), 60_000)
    return () => {
      window.removeEventListener('calendarUpdated', handler)
      clearInterval(timer)
    }
  }, [period])

  useEffect(() => {
    if (showMarkModal) setTimeout(() => modalTitleRef.current?.focus(), 50)
  }, [showMarkModal])

  const handleAddMark = async () => {
    if (!modalTitle.trim()) return
    setMarkSaving(true)
    try {
      const created = await investmentMarksApi.create({ date: modalDate, title: modalTitle.trim() })
      setMarks(prev => [...prev, created].sort((a, b) => a.date.localeCompare(b.date)))
      setShowMarkModal(false)
      setModalTitle('')
    } catch {
      // ignore
    } finally {
      setMarkSaving(false)
    }
  }

  const handleDeleteMark = async (id: number) => {
    await investmentMarksApi.delete(id).catch(() => {})
    setMarks(prev => prev.filter(m => m.id !== id))
  }

  // 더블클릭 감지
  const handleChartClick = (data: any) => {
    if (!data?.activeLabel) return
    const now = Date.now()
    const last = lastClickRef.current
    if (last && last.label === data.activeLabel && now - last.time < 400) {
      const fullDate = rawData.find((d: any) => d.date.slice(5) === data.activeLabel)?.date
        ?? new Date().toISOString().slice(0, 10)
      setModalDate(fullDate)
      setModalTitle('')
      setShowMarkModal(true)
      lastClickRef.current = null
    } else {
      lastClickRef.current = { label: data.activeLabel, time: now }
    }
  }

  if (loading) return <div className="h-36 skeleton rounded" />

  const todayStr = new Date().toISOString().slice(5, 10)
  const base = rawData.map((d: any) => ({
    date: d.date.slice(5),
    pnl_pct: Math.round(d.pnl_pct * 100) / 100,
    total_value: (d.total_value as number) || null,
    total_cost:  (d.total_cost  as number) || null,
  }))
  if (todayPnlPct !== undefined && (base.length === 0 || base[base.length - 1].date !== todayStr)) {
    base.push({
      date: todayStr,
      pnl_pct: Math.round(todayPnlPct * 100) / 100,
      total_value: todayValue ?? null,
      total_cost:  todayCost  ?? null,
    })
  }

  const marksByDate = new Map<string, string>()
  for (const m of marks) {
    const mmdd = m.date.slice(5)
    if (!marksByDate.has(mmdd)) marksByDate.set(mmdd, m.title)
  }

  // 가로 스크롤 태그 목록
  const tagList = marks.length > 0 && (
    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'nowrap', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
      {marks.map(mark => (
        <span key={mark.id} className="tag tag-amber"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, flexShrink: 0 }}>
          <span style={{ fontSize: 10, opacity: 0.65 }}>{mark.date.slice(5)}</span>
          {mark.title}
          {mark.google_event_id && <span title="구글캘린더 동기화됨" style={{ fontSize: 9, opacity: 0.5 }}>G</span>}
          <button onClick={() => handleDeleteMark(mark.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 12, opacity: 0.5, lineHeight: 1, color: 'inherit' }}
            title="삭제">×</button>
        </span>
      ))}
    </div>
  )

  // 이벤트 추가 모달
  const markModal = showMarkModal && createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--overlay-bg)', backdropFilter: 'var(--overlay-filter)', WebkitBackdropFilter: 'var(--overlay-filter)' }}
      onClick={() => setShowMarkModal(false)}
    >
      <div
        className="panel-surface border rounded-2xl shadow-2xl"
        style={{ width: '100%', maxWidth: 360, margin: '0 16px', padding: 20 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-0)', margin: 0 }}>투자 이벤트 추가</h3>
          <button onClick={() => setShowMarkModal(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>캘린더</div>
            <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-4)' }}>📅 투자</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>날짜</div>
            <input type="date" value={modalDate} onChange={e => setModalDate(e.target.value)}
              style={{ width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-0)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>제목</div>
            <input ref={modalTitleRef} type="text" placeholder="예: 삼성전자 추가매수" value={modalTitle}
              onChange={e => setModalTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddMark() }}
              maxLength={60}
              style={{ width: '100%', fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink-0)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => setShowMarkModal(false)}
            style={{ flex: 1, fontSize: 13, padding: '8px 0', borderRadius: 10, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer' }}>취소</button>
          <button onClick={handleAddMark} disabled={markSaving || !modalTitle.trim()}
            style={{ flex: 1, fontSize: 13, padding: '8px 0', borderRadius: 10, background: 'var(--dot)', color: '#fff', border: 'none', cursor: markSaving || !modalTitle.trim() ? 'not-allowed' : 'pointer', opacity: markSaving || !modalTitle.trim() ? 0.5 : 1, fontWeight: 600 }}>
            {markSaving ? '저장 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )

  if (!base.length) return (
    <div>
      {tagList}{markModal}
      <p className="text-2xs text-ink-4 text-center py-4">히스토리 없음 · KIS 동기화 후 적립됩니다</p>
    </div>
  )

  if (base.length === 1) {
    const pnl = base[0].pnl_pct
    return (
      <div>
        {tagList}{markModal}
        <div className="py-4 text-center">
          <p className={`text-2xl font-bold tabular-nums ${pnl >= 0 ? 'text-up' : 'text-down'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
          </p>
          <p className="text-2xs text-ink-4 mt-1">오늘 기준 · 매일 동기화 후 히스토리 적립</p>
        </div>
      </div>
    )
  }

  const chartData = base.map((d, i) => ({
    date: d.date,
    pnl_pct: d.pnl_pct,
    day_chg: i === 0 ? null : Math.round((d.pnl_pct - base[i - 1].pnl_pct) * 100) / 100,
    markTitle: marksByDate.get(d.date) || null,
    total_value: d.total_value,
    total_cost:  d.total_cost,
  }))

  // ── 출처별 스택 바 데이터 (위치 기반 4-레이어) ──────────────────────────────
  // 불변식: E = Vh + Cash (평가자산 = 보유평가 + 예수금)
  // D_eff = D (순입금 직접 사용); 추적 불완전(D < C×5%) 시 D_eff = C → 전액 원금 보수 처리
  // 4-레이어(아래→위): 원금(투자분) / 재투자(주식) / 미실현 / 예수금

  // 오늘 bar용: 마지막 히스토리의 realized_pnl proxy
  const lastRawR = rawData.length > 0 ? (rawData[rawData.length - 1]?.realized_pnl ?? 0) : 0

  const sourceChartData = base.map((d, i) => {
    const isToday  = d.date === todayStr
    const rawEntry: any = isToday ? null : rawData[Math.min(i, rawData.length - 1)]
    const tv = d.total_value ?? 0  // Vh: 보유평가
    const tc = d.total_cost  ?? 0  // C: 원가
    const mark = marksByDate.get(d.date) || null

    if (tv <= 0 && tc <= 0) {
      return { date: d.date, p_bar: 0, r_bar: 0, u_bar: 0, c_bar: 0, equity: 0, net_deposits: 0, realized_pnl: 0, unrealized_pnl: 0, total_value: 0, total_cost: 0, cash_balance: 0, markTitle: mark, resid_flag: false, D_eff: 0, loss: 0 }
    }

    const cash = isToday
      ? (todayCash ?? 0)
      : (rawEntry?.cash_balance ?? 0)
    const E = tv + cash  // 평가자산

    const D = isToday
      ? (todayNetDep !== null ? todayNetDep : (rawData.length > 0 ? (rawData[rawData.length - 1]?.net_deposits ?? 0) : 0))
      : (rawEntry?.net_deposits ?? 0)

    const R = isToday ? lastRawR : (rawEntry?.realized_pnl ?? 0)
    const U = tv - tc  // 미실현손익

    // 추적 불완전(D < C×5%) 시 D_eff = C: ISA 초기값·추적 공백기 오표시 방지
    const tracking_ok = tc <= 0 || D >= tc * 0.05
    const D_eff = Math.max(0, tracking_ok ? D : tc)

    // eff_C: 손실 구간(Vh<C)에서 바 합계가 E를 초과하지 않도록 C를 Vh로 캡
    const eff_C = Math.min(tc, tv)  // = C in profit, Vh in loss

    // 4-레이어 (합 = eff_C + max(0,U) + cash = Vh + Cash = E)
    const p_bar = Math.max(0, Math.round(Math.min(D_eff, eff_C)))      // 원금(투자분)
    const r_bar = Math.max(0, Math.round(eff_C - Math.min(D_eff, eff_C)))  // 재투자(주식)
    const u_bar = Math.max(0, Math.round(U))                             // 미실현 (0 if loss)
    const c_bar = Math.max(0, Math.round(cash))                          // 예수금(노는돈)

    const loss = Math.max(0, -U)  // 평가손실 (U<0일 때, 툴팁 표시용)

    // 입출금 미추적 감지 플래그 (원금·재투자 수치가 근사값임을 표시)
    const resid_flag = !tracking_ok

    return {
      date: d.date,
      p_bar, r_bar, u_bar, c_bar,
      equity: Math.round(E),
      net_deposits: Math.round(D),
      realized_pnl: Math.round(R),
      unrealized_pnl: Math.round(U),
      total_value: tv, total_cost: tc,
      cash_balance: Math.round(cash),
      markTitle: mark,
      resid_flag,
      D_eff: Math.round(D_eff),
      loss: Math.round(loss),
    }
  })

  // Y축 도메인: 필터 시 해당 레이어 기준(작은 영역 확대), 전체 시 equity 기준
  const srcVals = sourceChartData.flatMap(d => [d.equity, d.net_deposits]).filter(v => v > 0)
  const fullSrcMax = srcVals.length > 0 ? Math.max(...srcVals) * 1.06 : 1
  const srcDomain: [number, number] = activeLegend !== null
    ? (() => {
        const vals = sourceChartData.map(d => (d as any)[activeLegend] ?? 0).filter((v: number) => v > 0)
        const mx = vals.length > 0 ? Math.max(...vals) * 1.15 : 1
        return [0, mx]
      })()
    : [0, fullSrcMax]

  // 막대 영역 클릭 → 해당 레이어만 표시(토글). 차트 밖 클릭은 위 useEffect가 해제.
  const toggleLayer = (key: string) => {
    setActiveLegend(prev => (prev === key ? null : key))
  }

  // ── 좌측 Y축 (pnl_pct) 도메인 ─────────────────────────────────────────────
  const pnlValues = chartData.map(d => d.pnl_pct)
  const yMin = Math.min(...pnlValues)
  const yMax = Math.max(...pnlValues)
  const yPad = Math.max((yMax - yMin) * 0.12, 0.3)

  const dayValues = chartData.map(d => d.day_chg ?? 0)
  const dayAbsMax = Math.max(...dayValues.map(Math.abs), 0.1)

  const domainMax = yMax <= 0 ? (yMax - yMin) * 0.25 + yPad : yMax + yPad
  const domainMinNaive = yMin >= 0 ? -(yPad * 0.4) : yMin - yPad

  const barMax = Math.max(dayAbsMax * 5, (domainMax - domainMinNaive) * 0.25)
  const barMinAligned = barMax * domainMinNaive / domainMax
  const barMin = Math.min(barMinAligned, -dayAbsMax)
  const domainMin = barMin < barMinAligned ? barMin * domainMax / barMax : domainMinNaive
  const dayDomain: [number, number] = [barMin, barMax]

  // ── 색상 ──────────────────────────────────────────────────────────────────
  const cs = getComputedStyle(document.documentElement)
  const isDark    = document.documentElement.classList.contains('dark')
  const INK0      = cs.getPropertyValue('--ink-0').trim() || '#0A0A0B'
  const INK2      = cs.getPropertyValue('--ink-2').trim() || '#3C3C40'
  const INK3      = cs.getPropertyValue('--ink-3').trim() || '#6B6A65'
  const INK4      = cs.getPropertyValue('--ink-4').trim() || '#A8A6A0'
  const DOT_COLOR = cs.getPropertyValue('--dot').trim()   || '#F59E0B'
  const GRID_COLOR = isDark ? '#3f3f46' : '#d1d5db'
  const AXIS_COLOR = isDark ? '#52525b' : '#9ca3af' // 축 실선
  const fadeId = `ink0Fade_${accountNo ?? 'total'}`

  // ── 4-레이어 색상 ─────────────────────────────────────────────────────────
  const accentRgbRaw = cs.getPropertyValue('--c-accent-rgb').trim()
  const accentRgb = accentRgbRaw.replace(/\s+/g, ', ')
  // 1. 원금(투자분): neutral gray
  const SRC_PRINCIPAL = INK4
  const SRC_PRINCIPAL_OPACITY = 0.32
  // 2. 재투자(주식): accent
  const SRC_REINVEST = accentRgb ? `rgba(${accentRgb}, 0.80)` : (isDark ? 'rgba(96,165,250,0.80)' : 'rgba(59,130,246,0.80)')
  const SRC_REINVEST_OPACITY = 1
  // 3. 미실현: amber/gold (floating gain)
  const SRC_UNREALIZED = DOT_COLOR
  const SRC_UNREALIZED_OPACITY = 0.48
  // 4. 예수금: soft emerald (idle cash)
  const SRC_CASH = isDark ? 'rgba(52,211,153,0.55)' : 'rgba(16,185,129,0.55)'
  const SRC_CASH_OPACITY = 1

  // 레이어별 색상/불투명도 (단일 레이어 선택 시 baseline부터 재구성하는 데 사용)
  const LAYER_STYLE: Record<string, { fill: string; opacity: number; radius?: [number, number, number, number] }> = {
    p_bar: { fill: SRC_PRINCIPAL, opacity: SRC_PRINCIPAL_OPACITY },
    r_bar: { fill: SRC_REINVEST, opacity: SRC_REINVEST_OPACITY },
    u_bar: { fill: SRC_UNREALIZED, opacity: SRC_UNREALIZED_OPACITY },
    c_bar: { fill: SRC_CASH, opacity: SRC_CASH_OPACITY },
  }

  // y축 눈금: 금액·수익률 모드 모두 좌측 정렬로 통일 (왼쪽 끝에서 시작)
  const renderYTick = (format: (v: number) => string, boldZero = false) =>
    (props: { x: number; y: number; payload: { value: number } }) => {
      const { y, payload } = props
      const isZero = boldZero && Math.abs(payload.value) < 0.001
      return (
        <text x={3} y={y} dy={3} textAnchor="start" fontSize={9}
          fill={isZero ? INK2 : INK4} fontWeight={isZero ? 700 : 400}>
          {format(payload.value)}
        </text>
      )
    }

  // ── 커스텀 툴팁 ────────────────────────────────────────────────────────────
  const tooltipBox: React.CSSProperties = {
    background: 'var(--tooltip-bg)',
    border: '1px solid var(--tooltip-border)',
    borderRadius: 10,
    padding: '9px 11px',
    boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
    minWidth: 140,
  }
  const ttDate: React.CSSProperties = { fontSize: 10, color: 'var(--tooltip-label)', marginBottom: 5 }
  const ttRow = (color: string, lbl: string, val: string, opacity = 1) => (
    <div key={lbl} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 11, lineHeight: 1.65, color: 'var(--tooltip-text)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {color
          ? <span style={{ width: 7, height: 7, borderRadius: 2, background: color, opacity, display: 'inline-block', flexShrink: 0 }} />
          : <span style={{ width: 7, flexShrink: 0 }} />}
        <span style={{ color: 'var(--tooltip-label)' }}>{lbl}</span>
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{val}</span>
    </div>
  )

  // 수익률 차트 툴팁: 누적 수익률을 큰 글씨로
  const pnlTipBox = (p: any, label: any) => {
    if (!p) return null
    const pct = p.pnl_pct as number
    const up = pct >= 0
    const dayChg = p.day_chg as number | null
    return (
      <div style={tooltipBox}>
        <div style={ttDate}>{label}{p.markTitle ? `  📌 ${p.markTitle}` : ''}</div>
        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: up ? 'var(--c-up)' : 'var(--c-down)' }}>
          {up ? '+' : ''}{pct.toFixed(2)}%
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--tooltip-label)', marginTop: 1, marginBottom: dayChg != null ? 6 : 0 }}>누적 수익률</div>
        {dayChg != null && ttRow('', '일별 등락', `${dayChg >= 0 ? '+' : ''}${dayChg.toFixed(2)}%`)}
      </div>
    )
  }

  // 출처별 스택 바 툴팁: 평가자산을 큰 글씨로
  const sourceTipBox = (p: any, label: any) => {
    if (!p || !(p.equity > 0)) return null
    const rows: React.ReactNode[] = []
    if (p.p_bar > 0) rows.push(ttRow(SRC_PRINCIPAL, '원금(투자분)', fmtAmt(p.p_bar), SRC_PRINCIPAL_OPACITY))
    if (p.r_bar > 0) rows.push(ttRow(SRC_REINVEST, '재투자(주식)', fmtAmt(p.r_bar), SRC_REINVEST_OPACITY))
    if (p.u_bar > 0) rows.push(ttRow(SRC_UNREALIZED, '미실현', `+${fmtAmt(p.u_bar)}`, SRC_UNREALIZED_OPACITY))
    if (p.loss > 0)  rows.push(ttRow('var(--c-down)', '평가손실', `-${fmtAmt(p.loss)}`))
    if (p.cash_balance > 0) rows.push(ttRow(SRC_CASH, '예수금', fmtAmt(p.cash_balance), SRC_CASH_OPACITY))
    return (
      <div style={tooltipBox}>
        <div style={ttDate}>{label}{p.markTitle ? `  📌 ${p.markTitle}` : ''}{p.resid_flag ? '  ⚠️' : ''}</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-0)' }}>
          {fmtAmt(p.equity)}
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--tooltip-label)', marginTop: 1, marginBottom: 6 }}>평가자산</div>
        {rows}
        {(p.net_deposits > 0 || p.realized_pnl !== 0) && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--tooltip-border)' }}>
            {p.net_deposits > 0 && ttRow('', '순입금', fmtAmt(p.net_deposits))}
            {p.realized_pnl !== 0 && ttRow('', '실현손익', `${p.realized_pnl > 0 ? '+' : ''}${fmtAmt(p.realized_pnl)}`)}
          </div>
        )}
      </div>
    )
  }

  const chartDateSet = new Set(chartData.map(d => d.date))
  const visibleMarks = marks.filter(m => chartDateSet.has(m.date.slice(5)))

  // 차트 hover → 포털 툴팁에 커서 좌표 전달 (부모 리렌더 없이 imperative 갱신)
  const tipRender = showSource ? sourceTipBox : pnlTipBox
  const handleTipMove = (state: any, e: any) => {
    if (state?.isTooltipActive && state.activePayload?.length && e) {
      smartTipRef.current?.set({
        payload: state.activePayload[0].payload,
        label: state.activeLabel,
        cx: e.clientX,
        cy: e.clientY,
      })
    } else {
      smartTipRef.current?.clear()
    }
  }
  const handleTipLeave = () => smartTipRef.current?.clear()

  return (
    <div>
      {/* 헤더: 기간 버튼(좌) + 금액 토글(우). 둘 다 외부 제어 시 헤더 자체를 숨김 */}
      {(!externalPeriod || externalShowSource === undefined) && (
        <div className="flex justify-between items-center mb-2">
          <div className="flex gap-1">
            {!externalPeriod && ([7, 30, 90, 180, 365] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`text-2xs px-1.5 py-0.5 rounded ${period === p
                  ? 'bg-zinc-200 dark:bg-zinc-700 text-ink-1 font-medium'
                  : 'text-ink-4 hover:text-ink-2'}`}>
                {p === 7 ? '7일' : p === 30 ? '1개월' : p === 90 ? '3개월' : p === 180 ? '6개월' : '1년'}
              </button>
            ))}
          </div>
          {externalShowSource === undefined && (
            <button
              onClick={() => { if (showSource) setActiveLegend(null); setShowSource(!showSource) }}
              className={`text-2xs px-1.5 py-0.5 rounded ${showSource
                ? 'bg-zinc-200 dark:bg-zinc-700 text-ink-1 font-medium'
                : 'text-ink-4 hover:text-ink-2'}`}
            >
              금액
            </button>
          )}
        </div>
      )}

      <div ref={sourceChartRef}>
      {showSource ? (
        /* ── 출처별 스택 바 차트 ────────────────────────────────────────── */
        <ResponsiveContainer width="100%" height={140}>
          <ComposedChart data={sourceChartData} margin={{ top: 14, right: 4, left: 0, bottom: 0 }}
          onMouseMove={handleTipMove} onMouseLeave={handleTipLeave}>
            {/* 격자 제거: 엷은 가로 가이드 실선만 (세로 없음) */}
            <CartesianGrid stroke={GRID_COLOR} strokeOpacity={0.22} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: INK4 }} tickLine={false} axisLine={{ stroke: AXIS_COLOR }} interval="preserveStartEnd" />
            <YAxis yAxisId="src" axisLine={{ stroke: AXIS_COLOR }} tickLine={false} width={38} domain={srcDomain} tickCount={4} tick={renderYTick(fmtAmt)} />
            {visibleMarks.map(mark => (
              <ReferenceLine key={mark.id} x={mark.date.slice(5)} yAxisId="src" strokeOpacity={0}
                label={(props: any) => {
                  const vb = props.viewBox; if (!vb) return <g />
                  const { x, y, height } = vb
                  const gradId = `msrc_${mark.id}`
                  const fadeEndY = y + height * 0.58
                  return (
                    <g>
                      <defs>
                        <linearGradient id={gradId} x1={x} y1={y} x2={x} y2={fadeEndY} gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stopColor={DOT_COLOR} stopOpacity="0.55" />
                          <stop offset="100%" stopColor={DOT_COLOR} stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <line x1={x} y1={y} x2={x} y2={fadeEndY} stroke={`url(#${gradId})`} strokeWidth={0.8} strokeDasharray="3 3" />
                      <polygon points={`${x},${y + 2} ${x - 5},${y - 6} ${x + 5},${y - 6}`} fill={DOT_COLOR} opacity={0.85} />
                      <title>{mark.title}</title>
                    </g>
                  )
                }}
              />
            ))}
            {activeLegend === null ? (
              <>
                {/* 원금(투자분) — 하단 neutral */}
                <Bar yAxisId="src" dataKey="p_bar" stackId="src" fill={SRC_PRINCIPAL} fillOpacity={SRC_PRINCIPAL_OPACITY} isAnimationActive={false} cursor="pointer" onClick={() => toggleLayer('p_bar')} />
                {/* 재투자(주식) — accent */}
                <Bar yAxisId="src" dataKey="r_bar" stackId="src" fill={SRC_REINVEST} fillOpacity={SRC_REINVEST_OPACITY} isAnimationActive={false} cursor="pointer" onClick={() => toggleLayer('r_bar')} />
                {/* 미실현 — amber (이익 구간만) */}
                <Bar yAxisId="src" dataKey="u_bar" stackId="src" fill={SRC_UNREALIZED} fillOpacity={SRC_UNREALIZED_OPACITY} isAnimationActive={false} cursor="pointer" onClick={() => toggleLayer('u_bar')} />
                {/* 예수금(노는돈) — emerald (최상단) */}
                <Bar yAxisId="src" dataKey="c_bar" stackId="src" fill={SRC_CASH} fillOpacity={SRC_CASH_OPACITY} isAnimationActive={false} cursor="pointer" onClick={() => toggleLayer('c_bar')} radius={[2, 2, 0, 0]} />
              </>
            ) : (
              /* 단일 레이어 선택 — baseline(0)부터 해당 영역만으로 바 그래프 재구성 */
              <Bar yAxisId="src" dataKey={activeLegend} fill={LAYER_STYLE[activeLegend].fill} fillOpacity={LAYER_STYLE[activeLegend].opacity} isAnimationActive={false} cursor="pointer" onClick={() => toggleLayer(activeLegend)} radius={[2, 2, 0, 0]} />
            )}
            <Tooltip content={() => null} cursor={{ fill: INK4, fillOpacity: 0.08 }} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
      /* ── 수익률 차트 ───────────────────────────────────────────────────── */
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart
          data={chartData}
          margin={{ top: 14, right: 4, left: 0, bottom: 0 }}
          onClick={handleChartClick}
          onMouseMove={handleTipMove}
          onMouseLeave={handleTipLeave}
        >
          <defs>
            <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={INK0} stopOpacity="0.08" />
              <stop offset="100%" stopColor={INK0} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {/* 격자 제거: 엷은 가로 가이드 실선만 (세로 없음) */}
          <CartesianGrid stroke={GRID_COLOR} strokeOpacity={0.22} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: INK4 }} tickLine={false} axisLine={{ stroke: AXIS_COLOR }} interval="preserveStartEnd" />

          {/* 좌측 Y축: 수익률 */}
          <YAxis
            yAxisId="left" axisLine={{ stroke: AXIS_COLOR }} tickLine={false} width={38}
            domain={[domainMin, domainMax]}
            tick={renderYTick(v => `${v.toFixed(1)}%`, true)}
          />
          <YAxis yAxisId="bar" hide domain={dayDomain} />

          <ReferenceLine y={0} yAxisId="left" stroke={INK3} strokeWidth={1} strokeOpacity={0.5} />

          {/* 투자 이벤트 마커 */}
          {visibleMarks.map(mark => (
            <ReferenceLine
              key={mark.id}
              x={mark.date.slice(5)}
              yAxisId="left"
              strokeOpacity={0}
              label={(props: any) => {
                const vb = props.viewBox
                if (!vb) return <g />
                const { x, y, height } = vb
                const gradId = `mf_${mark.id}`
                const fadeEndY = y + height * 0.58
                return (
                  <g>
                    <defs>
                      <linearGradient id={gradId} x1={x} y1={y} x2={x} y2={fadeEndY} gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor={DOT_COLOR} stopOpacity="0.55" />
                        <stop offset="100%" stopColor={DOT_COLOR} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <line x1={x} y1={y} x2={x} y2={fadeEndY}
                      stroke={`url(#${gradId})`} strokeWidth={0.8} strokeDasharray="3 3" />
                    <polygon points={`${x},${y + 2} ${x - 5},${y - 6} ${x + 5},${y - 6}`}
                      fill={DOT_COLOR} opacity={0.85} />
                    <title>{mark.title}</title>
                  </g>
                )
              }}
            />
          ))}

          <Tooltip content={() => null} cursor={{ stroke: INK4, strokeOpacity: 0.3, strokeWidth: 1 }} />

          {/* Bar, Area는 마지막에 — 금액 라인 위에 렌더링 */}
          <Bar yAxisId="bar" dataKey="day_chg" barSize={8} radius={[2, 2, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={(d.day_chg ?? 0) >= 0 ? INK2 : INK3} fillOpacity={(d.day_chg ?? 0) >= 0 ? 0.30 : 0.20} />
            ))}
          </Bar>
          <Area
            yAxisId="left" type="monotone" dataKey="pnl_pct"
            stroke={INK0} strokeWidth={1.8} fill={`url(#${fadeId})`} fillOpacity={1}
            isAnimationActive={false}
            dot={(props: any) => {
              if (props.index !== chartData.length - 1) return <g key={props.index} />
              return <circle key={props.index} cx={props.cx} cy={props.cy} r={3} fill={DOT_COLOR} stroke="none" />
            }}
            activeDot={{ r: 3, fill: DOT_COLOR, strokeWidth: 0 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      )}

      {/* 출처별 범례 (위치 기반 4-레이어) */}
      {showSource && (() => {
        const legendItems = [
          { key: 'p_bar', color: SRC_PRINCIPAL, opacity: SRC_PRINCIPAL_OPACITY, label: '원금(투자분)',
            tooltip: `입금한 돈으로 현재 보유 중인 주식 분. min(순입금D, 원가C)로 계산.\n손실 구간에서는 현재 평가가치로 상한이 걸립니다.` },
          { key: 'r_bar', color: SRC_REINVEST, opacity: SRC_REINVEST_OPACITY, label: '재투자(주식)',
            tooltip: `번 돈(이익)으로 재매수한 주식 분. max(0, 원가C − 순입금D).\n입금액을 초과해 주식에 투자된 금액 = 수익 재투자분입니다.` },
          { key: 'u_bar', color: SRC_UNREALIZED, opacity: SRC_UNREALIZED_OPACITY, label: '미실현',
            tooltip: `아직 실현하지 않은 시세차익 (Vh − C). 이익 구간에서만 표시.\n손실 구간에서는 0으로 처리되고 툴팁에 손실액이 표기됩니다.` },
          { key: 'c_bar', color: SRC_CASH, opacity: SRC_CASH_OPACITY, label: '예수금(노는돈)',
            tooltip: `현재 계좌에 있는 예수금 (KIS d2_entra). 주식에 투자되지 않고 대기 중인 현금.\n익절 후 미재투자, 입금 후 미구매분이 여기에 잡힙니다.` },
        ]
        const hasWarn = sourceChartData.some(d => d.resid_flag)
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {legendItems.map(({ key, color, opacity, label, tooltip }) => {
                const isActive = activeLegend === key
                const isDimmed = activeLegend !== null && !isActive
                return (
                  <span
                    key={key}
                    title={tooltip}
                    onClick={(e) => { e.stopPropagation(); setActiveLegend(prev => prev === key ? null : key) }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      fontSize: 10, cursor: 'pointer', userSelect: 'none',
                      color: isDimmed ? 'var(--ink-4)' : 'var(--ink-3)',
                      opacity: isDimmed ? 0.38 : 1,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: 2,
                      background: color, opacity: isDimmed ? 0.3 : opacity,
                      display: 'inline-block', flexShrink: 0,
                      outline: isActive ? `1.5px solid ${color}` : 'none',
                      outlineOffset: 1,
                    }} />
                    {label}
                    {!isActive && (
                      <span style={{ fontSize: 8, opacity: 0.4, border: '1px solid currentColor', borderRadius: '50%', width: 9, height: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>?</span>
                    )}
                  </span>
                )
              })}
            </div>
            {hasWarn && (
              <div style={{ marginTop: 3, fontSize: 9, color: 'var(--ink-4)', opacity: 0.7 }}>
                ⚠️ 입출금 추적 불완전 계좌 포함 — 원금·재투자 수치는 근사값
              </div>
            )}
          </div>
        )
      })()}
      </div>

      {tagList}
      {markModal}
      <SmartTooltip ref={smartTipRef} render={tipRender} />
    </div>
  )
}

export default PortfolioHistoryChart
