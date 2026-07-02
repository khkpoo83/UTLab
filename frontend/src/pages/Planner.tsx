import { useState, useMemo, useEffect } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SortableItem } from '../components/SortableItem'
import { GripVertical } from 'lucide-react'
import { kisApi, profileApi, UserProfile } from '../api/client'
import OcrUploadModal from '../components/OcrUploadModal'
import PlannerChat from '../components/PlannerChat'
import StepField from '../components/StepField'
import RangeSlider from '../components/RangeSlider'
import type { PlannerOcrItem, PlannerChatRequest } from '../api/client'
import ToggleChip from '../components/ToggleChip'
import PageTitle from '../components/PageTitle'
import {
  BIRTH_YEAR, CURRENT_YEAR, CURRENT_MONTH, CURRENT_AGE,
  ageToYear, ageToYearMonth,
  NPS_BASE, NPS_BASE_DATE,
  DC_IRP_CURRENT, DC_IRP_DATE, PRIVATE_PENSIONS, HOUSING_PENSION_RATES,
  MORTGAGE_BALANCE_DEFAULT, MORTGAGE_BALANCE_DATE, MORTGAGE_RATE_ANNUAL, MORTGAGE_MONTHS,
  DC_IRP_RATE_DEFAULT, DC_IRP_MONTHLY_DEFAULT,
  fmtEok, calcMortgageFutureBalance, calcPensionTaxRate, calcISA2Future,
} from './planner/finance'
import {
  PrivatePensionMiniChart, ISAMiniChart, DCMiniChart, NPSMiniChart,
  HousingPensionMiniChart, MortgageMiniChart,
} from './planner/charts'
import { OptionTag, Accordion, AiStatusBadge } from './planner/components'
import { computePlannerSnapshot } from './planner/calc'


// ─── 서브 컴포넌트들 ──────────────────────────────────────────────────────────
// RangeSlider, StepField → src/components/RangeSlider.tsx, StepField.tsx 로 이전됨


// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

const PLANNER_CARD_IDS = ['planner_pp', 'planner_dc', 'planner_isa', 'planner_nps', 'planner_hp', 'planner_mortgage', 'planner_irp']
const PLANNER_CARD_TITLES: Record<string, string> = {
  planner_pp: '① 개인연금',
  planner_dc: '② 퇴직연금 DC',
  planner_isa: '③ ISA',
  planner_nps: '④ 국민연금',
  planner_hp: '⑤ 주택연금',
  planner_mortgage: '⑥ 주담대 현황',
  planner_irp: '⑦ 개인IRP',
}
const PLANNER_ORDER_KEY = 'planner_card_order'

function loadPlannerOrder(): string[] {
  try {
    const saved = localStorage.getItem(PLANNER_ORDER_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as string[]
      if (Array.isArray(parsed) && parsed.length === PLANNER_CARD_IDS.length &&
          PLANNER_CARD_IDS.every(id => parsed.includes(id))) return parsed
    }
  } catch {}
  return [...PLANNER_CARD_IDS]
}

export default function Planner() {
  // OCR 모달 상태
  const [ocrModal, setOcrModal] = useState<{ item: PlannerOcrItem; title: string; hint: string } | null>(null)

  // 업데이트 가능한 상수들 (OCR로 갱신 가능, localStorage 유지)
  const [dcIrpBalance, setDcIrpBalance] = useState(() => { const s = localStorage.getItem('planner_dc_irp_balance'); return s !== null ? Number(s) : DC_IRP_CURRENT })
  const [dcIrpDate, setDcIrpDate] = useState(() => localStorage.getItem('planner_dc_irp_date') ?? DC_IRP_DATE)
  const [npsBase, setNpsBase] = useState(() => { const s = localStorage.getItem('planner_nps_base'); return s !== null ? Number(s) : NPS_BASE })
  const [npsDate, setNpsDate] = useState(() => localStorage.getItem('planner_nps_date') ?? NPS_BASE_DATE)
  const [mortgageCurrentBalance, setMortgageCurrentBalance] = useState(() => { const s = localStorage.getItem('planner_mortgage_balance'); return s !== null ? Number(s) : MORTGAGE_BALANCE_DEFAULT }) // 현재 잔여원금
  const [mortgageBalanceDate, setMortgageBalanceDate] = useState(() => localStorage.getItem('planner_mortgage_balance_date') ?? MORTGAGE_BALANCE_DATE)
  const [mortgageStartDate, setMortgageStartDate] = useState<string>(() => localStorage.getItem('planner_mortgage_start_date') ?? '2020-03-09') // 대출 개시일 (잔여기간 계산용)
  const [ppBalances, setPpBalances] = useState<Record<number, number>>(() => { try { const s = localStorage.getItem('planner_pp_balances'); return s ? JSON.parse(s) : {} } catch { return {} } })

  // ISA 포트폴리오 연동
  const [isaBalance, setIsaBalance] = useState<number>(0)
  const [isaLoaded, setIsaLoaded] = useState(false)
  const [isaRate, setIsaRate] = useState(() => Number(localStorage.getItem('planner_isa1_rate') || 10.7))
  const [isaActualPnlPct, setIsaActualPnlPct] = useState<number | null>(null) // API 누적 수익률 (표시용)

  // 개인IRP 포트폴리오 연동
  const [personalIrpBalance, setPersonalIrpBalance] = useState<number>(0)
  const [irpLoaded, setIrpLoaded] = useState(false)
  const [personalIrpRate, setPersonalIrpRate] = useState(7.0)

  // 프로필 (생년월일·은퇴나이 자동 연동)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    profileApi.get().then(p => {
      setUserProfile(p)
      // localStorage에 값이 없으면 프로필 은퇴 나이로 초기화
      if (!localStorage.getItem('planner_retirement_age') && p.retire_age) {
        setRetirementAge(p.retire_age)
      }
    }).catch(() => {})
  }, [])


  // 은퇴 나이
  const [retirementAge, setRetirementAge] = useState(() =>
    Number(localStorage.getItem('planner_retirement_age') ?? 55)
  )
  // 카드 순서 (드래그앤드랍)
  const [plannerCardOrder, setPlannerCardOrder] = useState(loadPlannerOrder)
  const [activePlannerCardId, setActivePlannerCardId] = useState<string | null>(null)
  const plannerSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  function handlePlannerCardDragEnd(event: DragEndEvent) {
    setActivePlannerCardId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    setPlannerCardOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id as string), prev.indexOf(over.id as string))
      localStorage.setItem(PLANNER_ORDER_KEY, JSON.stringify(next))
      return next
    })
  }

  const updateRetirementAge = (age: number) => {
    setRetirementAge(age)
    localStorage.setItem('planner_retirement_age', String(age))
  }

  // ISA 설정
  const [isaMonthly, setIsaMonthly] = useState(() => Number(localStorage.getItem('planner_isa1_monthly') || 100))
  // ISA 2번째 계좌 (2026년 6월 예정 - 국내주식)
  const [isa2Monthly, setIsa2Monthly] = useState(() => Number(localStorage.getItem('planner_isa2_monthly') || 100))
  const [isa2Rate, setIsa2Rate] = useState(() => Number(localStorage.getItem('planner_isa2_rate') ?? 9.0))

  // DC 월 기여금 (회사+본인)
  const [dcMonthly, setDcMonthly] = useState(() =>
    Number(localStorage.getItem('planner_dc_monthly') ?? DC_IRP_MONTHLY_DEFAULT)
  )

  // 개인 IRP
  const [personalIrpMonthly, setPersonalIrpMonthly] = useState(() => Number(localStorage.getItem('planner_personal_irp_monthly') ?? 0))

  // 은퇴 후 목표 월 생활비
  const [monthlyExpenseGoal, setMonthlyExpenseGoal] = useState(() =>
    Number(localStorage.getItem('planner_expense_goal') ?? 300)
  )

  // 국민연금 수령 나이 / 임의계속가입
  const [npsReceiptAge, setNpsReceiptAge] = useState(() => Number(localStorage.getItem('planner_nps_receipt_age') ?? 65))
  const [npsVoluntaryCont, setNpsVoluntaryCont] = useState(() => { const s = localStorage.getItem('planner_nps_voluntary_cont'); return s !== null ? s === 'true' : true })   // 임의계속가입 여부 (은퇴<60세 시)
  const [npsVoluntaryMonthly, setNpsVoluntaryMonthly] = useState(() => Number(localStorage.getItem('planner_nps_voluntary_monthly') ?? 20)) // 임의계속가입 월납부액 (만원)

  // 주택
  const [housePrice, setHousePrice] = useState(() => { const s = localStorage.getItem('planner_house_price'); return s !== null ? Number(s) : 6.5 })
  const [housePensionTiming, setHousePensionTiming] = useState<'retire' | number>(() => { const s = localStorage.getItem('planner_house_pension_timing'); return (!s || s === 'retire') ? 'retire' : Number(s) })

  // 퇴직DC 수익률 / 수령기간
  const [dcRate, setDcRate] = useState(() => Number(localStorage.getItem('planner_dc_rate') ?? DC_IRP_RATE_DEFAULT))
  const [dcPayoutYears, setDcPayoutYears] = useState(() => Number(localStorage.getItem('planner_dc_payout_years') ?? 20))

  // 개인연금 수령기간
  const [payoutYears, setPayoutYears] = useState(() => Number(localStorage.getItem('planner_payout_years') ?? 20))

  // 개인연금 수익률 (보수적 기본값 1.5% — 원금보장+최저보증이율 반영)
  const [privatePensionRate, setPrivatePensionRate] = useState<number>(() => {
    const saved = localStorage.getItem('planner_pp_rate')
    return saved !== null ? parseFloat(saved) : 1.5
  })

  // 개인연금 수령 개시 나이 (상품별, 가입시 설정값에서 변경 가능)
  const [ppStartAges, setPpStartAges] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('planner_pp_start_ages')
      if (saved) {
        const parsed = JSON.parse(saved) as number[]
        if (Array.isArray(parsed) && parsed.length === PRIVATE_PENSIONS.length) return parsed
      }
    } catch {}
    return PRIVATE_PENSIONS.map(p => p.startAge)
  })

  const updatePpStartAge = (i: number, delta: number) => {
    setPpStartAges(prev => {
      const next = prev.map((age, idx) => idx === i ? Math.max(55, Math.min(80, age + delta)) : age)
      localStorage.setItem('planner_pp_start_ages', JSON.stringify(next))
      return next
    })
  }

  // 상태 변경 시 localStorage 자동 저장
  useEffect(() => {
    localStorage.setItem('planner_dc_irp_balance', String(dcIrpBalance))
    localStorage.setItem('planner_dc_irp_date', dcIrpDate)
    localStorage.setItem('planner_nps_base', String(npsBase))
    localStorage.setItem('planner_nps_date', npsDate)
    localStorage.setItem('planner_mortgage_balance', String(mortgageCurrentBalance))
    localStorage.setItem('planner_mortgage_balance_date', mortgageBalanceDate)
    localStorage.setItem('planner_mortgage_start_date', mortgageStartDate)
    localStorage.setItem('planner_pp_balances', JSON.stringify(ppBalances))
    localStorage.setItem('planner_nps_receipt_age', String(npsReceiptAge))
    localStorage.setItem('planner_nps_voluntary_cont', String(npsVoluntaryCont))
    localStorage.setItem('planner_nps_voluntary_monthly', String(npsVoluntaryMonthly))
    localStorage.setItem('planner_house_price', String(housePrice))
    localStorage.setItem('planner_house_pension_timing', String(housePensionTiming))
    localStorage.setItem('planner_dc_rate', String(dcRate))
    localStorage.setItem('planner_dc_payout_years', String(dcPayoutYears))
    localStorage.setItem('planner_payout_years', String(payoutYears))
    localStorage.setItem('planner_personal_irp_monthly', String(personalIrpMonthly))
    localStorage.setItem('planner_expense_goal', String(monthlyExpenseGoal))
  }, [dcIrpBalance, dcIrpDate, npsBase, npsDate, mortgageCurrentBalance, mortgageBalanceDate, mortgageStartDate, ppBalances, npsReceiptAge, npsVoluntaryCont, npsVoluntaryMonthly, housePrice, housePensionTiming, dcRate, dcPayoutYears, payoutYears, personalIrpMonthly, monthlyExpenseGoal])

  // KIS API로 ISA / 연금저축 잔액 자동 조회
  useEffect(() => {
    kisApi.getAccounts()
      .then(async accounts => {
        const isaAcc = accounts.find(a => a.account_type === 'ISA')
        const pensionAcc = accounts.find(a => a.account_type === 'PENSION')

        if (isaAcc) {
          try {
            const data = await kisApi.getAccountBalance(isaAcc.account_no)
            setIsaBalance(data.total_eval_amount ?? 0)
            const rawPnl = data.total_pnl_pct ?? 10.7
            setIsaActualPnlPct(rawPnl)  // 누적 수익률 (표시용, 미변환)
            const clipped = Math.max(5, Math.min(15, rawPnl))
            setIsaRate(clipped)
            setIsaLoaded(data.total_eval_amount > 0 || (data.holdings?.length ?? 0) > 0)
          } catch { setIsaLoaded(false) }
        }

        if (pensionAcc) {
          try {
            const data = await kisApi.getAccountBalance(pensionAcc.account_no)
            setPersonalIrpBalance(data.total_eval_amount ?? 0)
            const clipped = Math.max(3, Math.min(12, data.total_pnl_pct ?? 7.0))
            setPersonalIrpRate(clipped)
            setIrpLoaded(data.total_eval_amount > 0 || (data.holdings?.length ?? 0) > 0)
          } catch { setIrpLoaded(false) }
        }
      })
      .catch(() => {
        setIsaLoaded(false)
        setIrpLoaded(false)
      })
  }, [])

  // 계산
  const calc = useMemo(() => computePlannerSnapshot({
    retirementAge, isaBalance, isaMonthly, isaRate, dcRate, dcMonthly, dcIrpBalance, dcPayoutYears,
    npsBase, npsReceiptAge, npsVoluntaryCont, npsVoluntaryMonthly,
    personalIrpMonthly, personalIrpRate, personalIrpBalance,
    housePrice, housePensionTiming, mortgageCurrentBalance, mortgageStartDate, mortgageBalanceDate,
    payoutYears, privatePensionRate, ppStartAges, ppBalances,
  }), [
    retirementAge, isaBalance, isaMonthly, isaRate,
    personalIrpMonthly, personalIrpRate, personalIrpBalance,
    npsReceiptAge, npsVoluntaryCont, npsVoluntaryMonthly, housePrice, housePensionTiming,
    dcPayoutYears, payoutYears, privatePensionRate, ppStartAges,
    mortgageStartDate, mortgageCurrentBalance, ppBalances, dcIrpBalance, npsBase, dcMonthly, dcRate,
  ])

  // AI 채팅 요청 데이터
  const chatRequest: PlannerChatRequest = {
    retirement_age: retirementAge,
    current_age: userProfile?.age ?? CURRENT_AGE,
    birth_year: userProfile?.birth_year ?? BIRTH_YEAR,
    current_year: CURRENT_YEAR,
    isa1_balance: isaBalance,
    isa1_monthly: isaMonthly * 10_000,
    isa1_rate: isaRate,               // % 단위 (백엔드에서 /100 처리)
    isa2_monthly: isa2Monthly * 10_000,
    isa2_rate: isa2Rate,              // % 단위
    dc_irp_balance: dcIrpBalance,
    dc_irp_rate: dcRate,      // % 단위
    dc_irp_monthly: dcMonthly * 10_000,  // 원 단위로 변환
    dc_receipt_age: calc.dcReceiptAge,   // max(55, retirementAge)
    dc_payout_years: dcPayoutYears,
    nps_base_monthly: npsBase,
    nps_receipt_age: npsReceiptAge,
    nps_voluntary_cont: retirementAge < 65 ? npsVoluntaryCont : null,
    nps_voluntary_monthly: retirementAge < 65 && npsVoluntaryCont ? npsVoluntaryMonthly * 10_000 : 0,
    house_price: housePrice,
    mortgage_start_date: mortgageStartDate || undefined,
    mortgage_total_months: MORTGAGE_MONTHS,
    mortgage_balance: calc.currentMortgage,
    mortgage_balance_at_retire: calcMortgageFutureBalance(
      calc.currentMortgage,
      calc.mortgageRemainingMonths,
      Math.round((retirementAge - CURRENT_AGE) * 12)
    ),
    mortgage_monthly: calc.mortgagePaymentMonthly,
    mortgage_paid_off_age: calc.mortgagePaidOffAge,
    private_pensions: calc.ppDetails.map(pp => ({
      name: pp.name,
      balance: pp.current,
      start_age: pp.startAge,
      monthly_20yr: pp.monthly,
      monthly_contrib: pp.monthlyContrib ?? 0,
      paid_off_ym: pp.paidOffYM ?? null,
    })),
    payout_years: payoutYears,
    monthly_expense_goal: monthlyExpenseGoal * 10_000,
    question: '',
  }

  // 은퇴 나이 슬라이더 (공통, 전체폭)
  const retirementSlider = (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-ink-1">은퇴 나이 설정</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-accent tabular-nums">만 {retirementAge}세</span>
          <span className="text-xs text-ink-4">{calc.retirementYear}년 · D-{calc.dYears}년</span>
        </div>
      </div>
      {/* 슬라이더 */}
      <input
        type="range"
        min={50}
        max={65}
        step={1}
        value={retirementAge}
        onChange={e => updateRetirementAge(Number(e.target.value))}
        list="retirement-ages"
        className="age-slider w-full cursor-pointer"
        style={{ '--slider-pct': `calc(${(retirementAge - 50) / 15} * (100% - 22px) + 11px)` } as React.CSSProperties}
      />
      <datalist id="retirement-ages">
        {Array.from({ length: 16 }, (_, i) => 50 + i).map(a => (
          <option key={a} value={a} />
        ))}
      </datalist>
      {/* 나이 눈금 레이블 */}
      <div className="relative mt-1" style={{ height: 30 }}>
        {Array.from({ length: 16 }, (_, i) => 50 + i).map(age => {
          // 썸 width 22px → 양끝 오프셋 11px 보정: 실제 thumb 위치 = frac*(100%-22px)+11px
          const frac = (age - 50) / 15
          const isSelected = age === retirementAge
          const showLabel = age % 5 === 0 || isSelected
          return (
            <button
              key={age}
              onClick={() => updateRetirementAge(age)}
              title={`만 ${age}세 · ${ageToYearMonth(age)}`}
              className="absolute -translate-x-1/2 flex flex-col items-center gap-0.5 transition-all"
              style={{ left: `calc(${frac} * (100% - 22px) + 11px)` }}
            >
              <span className={`block w-0.5 rounded-full transition-all ${
                isSelected ? 'h-2 bg-accent' : age % 5 === 0 ? 'h-1.5 bg-zinc-300 dark:bg-zinc-600' : 'h-1 bg-zinc-200 dark:bg-zinc-700'
              }`} />
              {showLabel && (
                <div className="flex flex-col items-center leading-none">
                  <span className={`text-[9px] tabular-nums font-medium transition-all ${
                    isSelected ? 'text-accent font-bold' : 'text-ink-4'
                  }`}>{age}</span>
                  <span className={`text-[7px] tabular-nums transition-all ${
                    isSelected ? 'text-accent/70' : 'text-ink-4'
                  }`}>'{String(ageToYear(age)).slice(2)}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
      {/* 목표 월 생활비 */}
      <div className="mt-3 pt-3 border-t border-[var(--divide)]">
        <StepField
          label="은퇴 후 목표 월 생활비"
          hint="세후 실수령액과 비교하여 공백기·흑적자 판단에 활용"
          value={monthlyExpenseGoal} step={10} min={50} max={1000} unit="만원"
          onChange={v => { setMonthlyExpenseGoal(v); localStorage.setItem('planner_expense_goal', String(v)) }}
        />
      </div>
    </div>
  )

  // OCR 적용 핸들러
  const handleOcrApply = (data: Record<string, number | string | null>) => {
    if (!ocrModal) return
    const { item } = ocrModal
    if (item === 'dc_irp') {
      if (data.balance != null) setDcIrpBalance(data.balance as number)
      if (data.date != null) setDcIrpDate(data.date as string)
    } else if (item === 'nps') {
      if (data.monthly_65 != null) setNpsBase(data.monthly_65 as number)
      if (data.date != null) setNpsDate(data.date as string)
    } else if (item === 'mortgage') {
      if (data.start_date != null) setMortgageStartDate(data.start_date as string)
      if (data.balance != null) { setMortgageCurrentBalance(data.balance as number); setMortgageBalanceDate(new Date().toISOString().slice(0, 10)) }
    } else if (item === 'private_pension') {
      // 상품명 매칭으로 특정 개인연금 잔액 업데이트
      if (data.balance != null && data.product_name != null) {
        const idx = PRIVATE_PENSIONS.findIndex(p =>
          (data.product_name as string).includes(p.name.split(' ')[1] ?? '')
        )
        if (idx >= 0) {
          setPpBalances(prev => ({ ...prev, [idx]: data.balance as number }))
        }
      }
    }
  }

  // OCR 버튼 공통 컴포넌트
  const OcrBtn = ({ item, title, hint }: { item: PlannerOcrItem; title: string; hint: string }) => (
    <button
      onClick={() => setOcrModal({ item, title, hint })}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-2xs font-medium surface-subtle border border-ink-5 text-ink-3 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      스크린샷 업데이트
    </button>
  )

  return (
    <>
    {ocrModal && (
      <OcrUploadModal
        item={ocrModal.item}
        title={ocrModal.title}
        hint={ocrModal.hint}
        onApply={handleOcrApply}
        onClose={() => setOcrModal(null)}
      />
    )}
    <div className="pb-10">
      {/* 헤더 */}
      <div className="pt-2 pb-4">
        <PageTitle
          sub="retirement"
          title="Planner"
          subtitle={userProfile?.birth_date
            ? `${userProfile.birth_date.slice(0,7)} · 만 ${userProfile.age}세`
            : `만 ${CURRENT_AGE}세 · ${CURRENT_YEAR}.${String(CURRENT_MONTH).padStart(2,'0')}`
          }
        />
      </div>

      {/* 상단 은퇴나이 슬라이더 (전체폭) */}
      <div className="mb-6">
        {retirementSlider}
      </div>


      {/* 2컬럼 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── 왼쪽 컬럼: 내 노후 자금 현황 ── */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-ink-1 px-1">내 노후 자금 현황</h2>

          <DndContext
            sensors={plannerSensors}
            collisionDetection={closestCenter}
            onDragStart={e => setActivePlannerCardId(e.active.id as string)}
            onDragEnd={handlePlannerCardDragEnd}
          >
            <SortableContext items={plannerCardOrder} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-3">
          {/* ① 개인연금 */}
          <SortableItem id="planner_pp" order={plannerCardOrder.indexOf('planner_pp')}>{(dragHandle) => (
          <Accordion
            title={`① 개인연금 (${PRIVATE_PENSIONS.length}개 상품)`}
            defaultOpen={true}
            dragHandle={dragHandle}
            badge={
              <span className="text-xs text-accent font-semibold tabular-nums">
                합산 {Math.round(calc.ppTotalMonthly / 10000)}만원/월
              </span>
            }
            tags={
              <>
                <OptionTag label="수령기간 조정 가능" color="accent" />
                <OptionTag label="수령시기 조정가능" color="accent" />
                <OptionTag label="종신형 전환가능" color="zinc" />
              </>
            }
          >
            <div className="space-y-3">
              {/* ── 설정 ── */}
              <div className="card-inner p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-2">수익률 가정</span>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {([0, 1, 1.5, 2, 3] as number[]).map(r => (
                      <ToggleChip key={r} size="xs"
                        active={privatePensionRate === r}
                        onClick={() => { setPrivatePensionRate(r); localStorage.setItem('planner_pp_rate', String(r)) }}
                      >{r}%</ToggleChip>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-2">수령기간</span>
                  <div className="flex gap-1">
                    {[10, 15, 20, 25].map(yr => (
                      <ToggleChip key={yr} size="xs"
                        active={payoutYears === yr}
                        onClick={() => setPayoutYears(yr)}
                      >{yr}년</ToggleChip>
                    ))}
                  </div>
                </div>
              </div>
              {/* ── 그래프 ── */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs text-ink-4">
                    수령기간별 합산 월수령액
                    <span className="ml-1 text-ink-3">(수익률 {privatePensionRate}% · 납입예정액 포함)</span>
                  </p>
                  <OcrBtn item="private_pension" title="개인연금 잔액" hint="각 보험사 앱의 적립금(평가금액) 화면을 업로드하세요. 상품명과 금액을 인식합니다." />
                </div>
                <PrivatePensionMiniChart ppDetails={calc.ppDetails} rate={privatePensionRate} />
              </div>
              {/* ── 상품별 카드 (2열) ── */}
              <p className="text-xs text-ink-4">기준: 각 상품 {PRIVATE_PENSIONS[0].date}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {calc.ppDetails.map((pp, i) => (
                <div key={i} className="card-inner p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-ink-0">{pp.name}</span>
                        {pp.monthlyContrib === 0
                          ? <span className="tag tag-green">완납</span>
                          : <span className="tag tag-amber">납입중</span>
                        }
                        {ppBalances[i] != null && <span className="tag tag-tonal text-2xs">갱신됨</span>}
                      </div>
                      {pp.monthlyContrib > 0 && pp.paidOffYM && (
                        <div className="text-xs text-[color:var(--tag-amber-fg)] mt-0.5">
                          {Math.round(pp.monthlyContrib / 10000)}만원/월 · {pp.paidOffYM} 완납예정
                        </div>
                      )}
                      <div className="text-xs text-ink-4 mt-0.5">
                        현재 {Math.round(pp.current / 10000).toLocaleString()}만원
                        {pp.atStart > pp.current && (
                          <span className="ml-1 text-ink-3">→ 개시시 {fmtEok(pp.atStart)} 예상</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-2xs text-ink-4 flex-shrink-0">개시</span>
                        <button onClick={() => updatePpStartAge(i, -1)} className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded surface-subtle border border-ink-5 text-ink-3 hover:bg-accent/10 hover:text-accent text-xs">−</button>
                        <div className="flex-1 text-center min-w-0">
                          <div className="text-xs font-semibold text-ink-1 tabular-nums whitespace-nowrap leading-tight">{pp.startAge}세 ~ {pp.startAge + payoutYears}세</div>
                          <div className="text-2xs text-ink-4 tabular-nums leading-tight">{ageToYear(pp.startAge)} ~ {ageToYear(pp.startAge + payoutYears)}년</div>
                        </div>
                        <button onClick={() => updatePpStartAge(i, +1)} className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded surface-subtle border border-ink-5 text-ink-3 hover:bg-accent/10 hover:text-accent text-xs">+</button>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-accent tabular-nums">{Math.round(pp.monthly / 10000)}만원/월</div>
                      <div className="text-2xs text-ink-4 tabular-nums">세후 {Math.round(pp.monthly / 10000 * (1 - calcPensionTaxRate(pp.startAge, payoutYears)))}만원</div>
                      <div className="text-xs text-ink-4 tabular-nums">개시시 {fmtEok(pp.atStart)}</div>
                    </div>
                  </div>
                </div>
              ))}
              </div>
              {/* ── 코멘트 ── */}
              {retirementAge < calc.ppFirstStartAge && (
                <div className="notice notice-amber text-xs">
                  내 은퇴 나이(만 {retirementAge}세, {ageToYearMonth(retirementAge)})가 개인연금 첫 수령({calc.ppFirstStartAge}세)보다 빠릅니다.
                  공백기 <strong>{calc.ppFirstStartAge - retirementAge}년</strong> 동안 개인연금 수령 불가 —{' '}
                  {retirementAge < 55
                    ? <>ISA로 대체 필요 <span className="text-ink-4">(주택연금은 만 55세 이후 가능)</span></>
                    : 'ISA 또는 주택연금으로 대체 필요'
                  }
                </div>
              )}
              {(() => {
                const activeContribs = calc.ppDetails.filter(pp => pp.monthlyContrib > 0)
                if (activeContribs.length === 0) return null
                const totalContrib = activeContribs.reduce((s, pp) => s + pp.monthlyContrib, 0)
                return (
                  <div className="notice notice-zinc text-xs">
                    <span className="font-semibold">납입 중 고정 지출</span>
                    {activeContribs.map((pp, i) => (
                      <span key={i} className="ml-2 text-ink-3">
                        {pp.name.replace('삼성 ', '')} {Math.round(pp.monthlyContrib / 10000)}만({pp.paidOffYM}완납)
                      </span>
                    ))}
                    <span className="ml-2 font-semibold text-ink-1">합계 {Math.round(totalContrib / 10000)}만원/월</span>
                  </div>
                )
              })()}
              <div className="flex justify-between items-center pt-2 border-t border-[var(--divide)]">
                <span className="text-xs font-semibold text-ink-2">{PRIVATE_PENSIONS.length}개 상품 합산 월수령액</span>
                <div className="text-right">
                  <div className="text-base text-accent tabular-nums">{Math.round(calc.ppTotalMonthly / 10000)}만원/월</div>
                  <div className="text-xs text-ink-4">세후 약 {Math.round(calc.ppTotalMonthly / 10000 * (1 - calcPensionTaxRate(calc.ppFirstStartAge, payoutYears)))}만원</div>
                </div>
              </div>
            </div>
          </Accordion>
          )}</SortableItem>

          {/* ② 퇴직연금 DC */}
          <SortableItem id="planner_dc" order={plannerCardOrder.indexOf('planner_dc')}>{(dragHandle) => (
          <Accordion
            title="② 퇴직연금 DC - 회사IRP (하나증권)"
            dragHandle={dragHandle}
            badge={
              <span className="text-xs text-accent font-semibold tabular-nums">
                {calc.dcReceiptAge}세({ageToYear(calc.dcReceiptAge)}) {Math.round(calc.dcIrpMonthly / 10000)}만원/월
              </span>
            }
            tags={
              <>
                <OptionTag label={`만 55세+ 수령가능`} color="accent" />
                <OptionTag label="일시금 전환가능" color="zinc" />
                <OptionTag label="분리과세" color="tonal" />
              </>
            }
          >
            <div className="space-y-3">
              {/* ── 설정 ── */}
              <div className="card-inner p-3 space-y-2">
                <StepField
                  label="현재 월 기여금 (회사+본인)"
                  hint="현재 납부 중인 금액 — 퇴직까지 유지 가정"
                  value={dcMonthly} step={5} min={0} max={600} unit="만원"
                  onChange={v => { setDcMonthly(v); localStorage.setItem('planner_dc_monthly', String(v)) }}
                />
                <StepField label="운용 수익률 (연)" value={dcRate} step={0.5} min={0.5} max={15} unit="%"
                  onChange={v => { setDcRate(v); localStorage.setItem('planner_dc_rate', String(v)) }} />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-3">수익률 프리셋</span>
                  <div className="flex gap-1">
                    {[{label:'보수적', v:3},{label:'중간', v:5},{label:'공격적', v:7}].map(p => (
                      <ToggleChip key={p.v} size="xs" active={dcRate === p.v}
                        onClick={() => { setDcRate(p.v); localStorage.setItem('planner_dc_rate', String(p.v)) }}
                      >{p.label} {p.v}%</ToggleChip>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-ink-2">수령기간</span>
                  <div className="flex gap-1">
                    {[10, 15, 20, 25, 30].map(yr => (
                      <ToggleChip key={yr} size="xs" active={dcPayoutYears === yr}
                        onClick={() => { setDcPayoutYears(yr); localStorage.setItem('planner_dc_payout_years', String(yr)) }}
                      >{yr}년</ToggleChip>
                    ))}
                  </div>
                </div>
              </div>
              {/* ── 그래프 ── */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs text-ink-4">나이별 예상잔액 추이 (60세 수령 기준선)</p>
                  <OcrBtn item="dc_irp" title="퇴직연금DC 잔액" hint="하나증권 앱의 퇴직연금(DC) 잔액 화면을 업로드하세요. 총 평가금액과 수익률을 인식합니다." />
                </div>
                <DCMiniChart rate={dcRate} retirementAge={retirementAge} monthlyContrib={dcMonthly} currentBalance={dcIrpBalance} />
              </div>
              {/* ── 결과 ── */}
              <div className="card-inner p-3 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-3">
                    현재 잔액
                    <span className="ml-1 text-ink-3">({dcIrpDate} 기준)</span>
                    {dcIrpBalance !== DC_IRP_CURRENT && <span className="ml-1 tag tag-tonal text-2xs">갱신됨</span>}
                  </span>
                  <span className="text-sm text-accent tabular-nums">{Math.round(dcIrpBalance / 1e4).toLocaleString()}만원</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-3">{calc.dcReceiptAge}세({ageToYearMonth(calc.dcReceiptAge)}) 예상 잔액</span>
                  <span className="text-sm text-accent tabular-nums">{fmtEok(calc.dcIrpAtReceipt)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-3">월 수령액 ({dcPayoutYears}년)</span>
                  <div className="text-right">
                    <div className="text-sm text-accent tabular-nums">{Math.round(calc.dcIrpMonthly / 10000)}만원/월</div>
                    <div className="text-2xs text-ink-4 tabular-nums">세후 {Math.round(calc.dcIrpMonthly / 10000 * (1 - calcPensionTaxRate(calc.dcReceiptAge, dcPayoutYears)))}만원</div>
                  </div>
                </div>
              </div>
              {/* ── 코멘트 ── */}
              {retirementAge < 55 && (
                <div className="notice notice-zinc text-xs">
                  은퇴(만 {retirementAge}세) 시 IRP 이전 → <strong>만 55세까지 {55 - retirementAge}년간 운용만</strong> (수령 불가) → 55세부터 수령 개시
                </div>
              )}
              {retirementAge >= 55 && retirementAge < 60 && (
                <div className="notice notice-zinc text-xs">
                  은퇴(만 {retirementAge}세) 시 IRP 이전 → <strong>즉시 수령 가능</strong> (만 55세 이상이므로)
                </div>
              )}
              <p className="notice notice-amber">
                자동조회 불가 — 하나증권 앱 스크린샷 업로드로 잔액을 업데이트하세요.
              </p>
            </div>
          </Accordion>
          )}</SortableItem>

          {/* ③ ISA (2계좌 운용) */}
          <SortableItem id="planner_isa" order={plannerCardOrder.indexOf('planner_isa')}>{(dragHandle) => (
          <Accordion
            title="③ ISA (2계좌 운용)"
            defaultOpen={true}
            dragHandle={dragHandle}
            badge={
              <span className="text-xs text-accent font-semibold tabular-nums">
                은퇴시 합산 {fmtEok(calc.isaAtRetirement + calcISA2Future(retirementAge, isa2Monthly * 10_000, isa2Rate / 100))}
              </span>
            }
            tags={
              <>
                <OptionTag label="비과세 한도200만" color="accent" />
                <OptionTag label="만기후 연금전환" color="accent" />
                <OptionTag label="①해외ETF/②국내배당주" color="zinc" />
                <OptionTag label="6월 2계좌 예정" color="green" />
              </>
            }
          >
            <div className="space-y-3">
              {/* ── 설정 ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-lg bg-accent/10 border border-accent/30 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="tag tag-tonal text-2xs">ISA ①</span>
                    <span className="text-xs text-ink-3">기존 계좌 · 해외ETF 위주</span>
                    {isaLoaded && <span className="ml-auto text-xs text-accent tabular-nums font-semibold">{Math.round(isaBalance / 10000).toLocaleString()}만원</span>}
                  </div>
                  {isaActualPnlPct !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-3">현재 계좌 누적 수익률</span>
                      <span className={`text-xs font-semibold tabular-nums ${isaActualPnlPct >= 0 ? 'text-up' : 'text-down'}`}>
                        {isaActualPnlPct >= 0 ? '+' : ''}{isaActualPnlPct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  <StepField label="연수익률 가정" hint="시뮬레이션용" value={isaRate} step={0.5} min={1} max={15} unit="%"
                    onChange={v => { setIsaRate(v); localStorage.setItem('planner_isa1_rate', String(v)) }} />
                  <StepField label="월 납입" value={isaMonthly} step={5} min={0} max={334} unit="만원"
                    onChange={v => { setIsaMonthly(v); localStorage.setItem('planner_isa1_monthly', String(v)) }} />
                </div>
                <div className="rounded-lg bg-accent/10 border border-accent/30 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="tag tag-tonal text-2xs">ISA ②</span>
                    <span className="text-xs text-ink-3">신규 · 국내 배당주 위주 (2026년 6월 예정)</span>
                  </div>
                  <StepField label="연수익률 가정" hint="시뮬레이션용" value={isa2Rate} step={0.5} min={1} max={15} unit="%"
                    onChange={v => { setIsa2Rate(v); localStorage.setItem('planner_isa2_rate', String(v)) }} />
                  <StepField label="월 납입" value={isa2Monthly} step={5} min={0} max={334} unit="만원"
                    onChange={v => { setIsa2Monthly(v); localStorage.setItem('planner_isa2_monthly', String(v)) }} />
                </div>
              </div>
              <div className="notice notice-accent text-xs">
                💡 ISA 만기 시 연금계좌로 전환하면 전환액의 <strong>10% (최대 300만원)</strong> 추가 세액공제 혜택
              </div>
              <div className="notice notice-zinc text-xs">
                연 납입한도 2,000만원 (미사용분 이월 가능) · 의무가입 3년 (중도해지 시 세제혜택 반환) · 중개형 국내주식 비과세
              </div>
              {/* ── 그래프 ── */}
              <div>
                <p className="text-xs text-ink-4 mb-0.5">나이별 ISA 잔액 추이 (파란=①해외ETF, 초록=②배당주)</p>
                <ISAMiniChart
                  isa1Balance={isaBalance}
                  isa1Monthly={isaMonthly * 10_000}
                  isa1Rate={isaRate / 100}
                  isa2Monthly={isa2Monthly * 10_000}
                  isa2Rate={isa2Rate / 100}
                  retirementAge={retirementAge}
                />
              </div>
              {/* ── 결과 ── */}
              <div className="card-inner p-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-ink-3">ISA① {retirementAge - CURRENT_AGE}년 운용 후 예상 (만 {retirementAge}세, {ageToYearMonth(retirementAge)})</span>
                  <span className="text-accent tabular-nums">{fmtEok(calc.isaAtRetirement)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-ink-3">ISA② {retirementAge - CURRENT_AGE}년 운용 후 예상 (만 {retirementAge}세, {ageToYearMonth(retirementAge)})</span>
                  <span className="text-accent tabular-nums">{fmtEok(calcISA2Future(retirementAge, isa2Monthly * 10_000, isa2Rate / 100))}</span>
                </div>
              </div>
            </div>
          </Accordion>
          )}</SortableItem>

          {/* ④ 국민연금 */}
          <SortableItem id="planner_nps" order={plannerCardOrder.indexOf('planner_nps')}>{(dragHandle) => (
          <Accordion
            title="④ 국민연금"
            dragHandle={dragHandle}
            badge={
              <span className="text-xs text-accent font-semibold tabular-nums">
                {Math.round(calc.npsMonthly / 10000)}만원/월
              </span>
            }
            tags={
              <>
                <OptionTag label="60~70세 수령선택" color="accent" />
                <OptionTag label="조기감액 6%/년" color="tonal" />
                <OptionTag label="연기가산 7.2%/년" color="green" />
              </>
            }
          >
            <div className="space-y-3">
              {/* ── 설정 ── */}
              <div className="card-inner p-3 space-y-2.5">
                <div>
                  <label className="text-xs font-medium text-ink-2 block mb-2">수령 시점</label>
                  <RangeSlider
                    value={npsReceiptAge}
                    min={60}
                    max={70}
                    unit="세"
                    onChange={setNpsReceiptAge}
                    label={npsReceiptAge < 65 ? `${(65 - npsReceiptAge) * 6}% 감액` : npsReceiptAge > 65 ? `+${((npsReceiptAge - 65) * 7.2).toFixed(1)}% 가산` : '정상수령'}
                  />
                </div>
                {retirementAge < 65 && (
                  <div className="space-y-2 pt-2 border-t border-[var(--divide)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium text-ink-1">임의계속가입 ({retirementAge}~65세, {ageToYear(retirementAge)}~{ageToYear(65)})</span>
                        <p className="text-2xs text-ink-4 mt-0.5">{65 - retirementAge}년 납부 가능 — 수령액 증가</p>
                      </div>
                      <button
                        onClick={() => setNpsVoluntaryCont(v => !v)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${npsVoluntaryCont ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${npsVoluntaryCont ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    {npsVoluntaryCont && (
                      <>
                        <StepField
                          label={`월 납부액 (최대 ${65 - retirementAge}년간)`}
                          hint="지역가입자 기준 — 본인 전액 부담 (하한 4만·상한 55만)"
                          value={npsVoluntaryMonthly} step={1} min={4} max={55} unit="만원"
                          onChange={v => { setNpsVoluntaryMonthly(v); localStorage.setItem('planner_nps_voluntary_monthly', String(v)) }}
                        />
                        {calc.npsOptimalMonthly > 0 && (
                          <p className={`text-2xs mt-0.5 ${npsVoluntaryMonthly >= calc.npsOptimalMonthly ? 'text-accent' : 'text-ink-4'}`}>
                            {npsVoluntaryMonthly >= calc.npsOptimalMonthly
                              ? `✓ 최적 납부액(${calc.npsOptimalMonthly}만원/월) 이상 — 최대 효과`
                              : `최적 납부액: ${calc.npsOptimalMonthly}만원/월 (이상 납부 시 최대 효과, 이후 증가 없음)`
                            }
                          </p>
                        )}
                        <div className="notice notice-zinc text-2xs mt-1">
                          <strong>국민연금법 기준 (2026년)</strong> · 소득월액 하한 39만원 → 최소 4만원/월 · 상한 617만원 → 최대 55만원/월 (보험료율 9%)<br/>
                          최적 납부액({calc.npsOptimalMonthly}만원) 초과 납부해도 수령액 추가 증가 없음 — 재직 시 소득 대비 이미 최대 보상 구간 도달
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              {/* ── 그래프 ── */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs text-ink-4">수령나이별 월수령액 (선택 강조)</p>
                  <OcrBtn item="nps" title="국민연금 예상수령액" hint="국민연금 앱 '내 연금 알아보기' 화면을 업로드하세요. 65세 기준 예상 월수령액을 인식합니다." />
                </div>
                <NPSMiniChart selectedAge={npsReceiptAge} effectiveBase65={calc.npsEffective65} />
              </div>
              {/* ── 코멘트 ── */}
              {retirementAge < npsReceiptAge && (() => {
                const canPP = retirementAge >= calc.ppFirstStartAge
                const canHP = retirementAge >= 55
                const sources = ['ISA', ...(canPP ? ['개인연금'] : []), ...(canHP ? ['주택연금'] : [])]
                const unavailable = [...(!canPP ? [`개인연금(${calc.ppFirstStartAge}세 이후)`] : []), ...(!canHP ? ['주택연금(55세 이후)'] : [])]
                return (
                  <div className="notice notice-amber text-xs">
                    내 은퇴(만 {retirementAge}세, {ageToYearMonth(retirementAge)})~국민연금 수령({npsReceiptAge}세, {ageToYearMonth(npsReceiptAge)}) 공백 <strong>{npsReceiptAge - retirementAge}년</strong> —{' '}
                    {sources.join('·')}으로 보완 필요
                    {unavailable.length > 0 && (
                      <span className="text-ink-4"> ({unavailable.join(', ')}은 공백기 시작 시점 불가)</span>
                    )}
                  </div>
                )
              })()}
              {/* ── 결과 ── */}
              <div className="card-inner p-3 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-3">
                    앱 확인값 (60세 납부 기준)
                    <span className="ml-1 text-ink-3">({npsDate} 기준)</span>
                    {npsBase !== NPS_BASE && <span className="ml-1 tag tag-tonal text-2xs">갱신됨</span>}
                  </span>
                  <span className="text-xs text-ink-1 tabular-nums">{Math.round(npsBase / 10000)}만원/월</span>
                </div>
                {retirementAge < 60 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-ink-3">{retirementAge}세({ageToYearMonth(retirementAge)}) 퇴직, 임의계속 없음</span>
                    <span className="text-xs text-ink-3 tabular-nums">{Math.round(calc.npsAtRetire65 / 10000)}만원/월</span>
                  </div>
                )}
                {retirementAge < 65 && npsVoluntaryCont && calc.npsEffective65 !== calc.npsAtRetire65 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-ink-3">임의계속가입 후 65세({ageToYear(65)}) 기준</span>
                    <span className="text-xs text-ink-3 tabular-nums">{Math.round(calc.npsEffective65 / 10000)}만원/월</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-3">{npsReceiptAge}세({ageToYearMonth(npsReceiptAge)}) 수령 시</span>
                  <span className="text-sm text-accent tabular-nums">{Math.round(calc.npsMonthly / 10000)}만원/월</span>
                </div>
                {npsReceiptAge < 65 && <p className="text-xs" style={{ color: 'var(--tag-amber-fg)' }}>조기수령 {(65 - npsReceiptAge) * 6}% 감액</p>}
                {npsReceiptAge > 65 && <p className="text-xs" style={{ color: 'var(--tag-green-fg)' }}>연기수령 +{((npsReceiptAge - 65) * 7.2).toFixed(1)}% 가산</p>}
                {retirementAge < 65 && !npsVoluntaryCont && (
                  <p className="text-xs text-ink-4">임의계속가입 미신청 → {Math.round(calc.npsAtRetire65 / 10000)}만원/월 ({Math.round((1 - calc.npsAtRetire65 / npsBase) * 100)}% 감소)</p>
                )}
              </div>
            </div>
          </Accordion>
          )}</SortableItem>

          {/* ⑤ 주택연금 */}
          <SortableItem id="planner_hp" order={plannerCardOrder.indexOf('planner_hp')}>{(dragHandle) => (
          <Accordion
            title="⑤ 주택연금"
            dragHandle={dragHandle}
            badge={
              <span className="text-xs text-accent font-semibold tabular-nums">
                {Math.round(calc.housePensionMonthly / 10000)}만원/월
              </span>
            }
            tags={
              <>
                <OptionTag label="만 55세~ 가입가능" color="tonal" />
                <OptionTag label="종신지급" color="green" />
                <OptionTag label="배우자 승계" color="zinc" />
                <OptionTag label="수령시기 선택" color="tonal" />
              </>
            }
          >
            <div className="space-y-3">
              {/* ── 설정 ── */}
              <div className="card-inner p-3 space-y-2.5">
                <StepField
                  label="집값 시가"
                  hint="KB시세·실거래가 기준 — 공시가격 아님"
                  value={housePrice} step={0.5} min={1} max={30} unit="억원"
                  onChange={v => { setHousePrice(v); localStorage.setItem('planner_house_price', String(v)) }}
                />
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-ink-2">신청 시점 (만 55세 이상)</label>
                    <button
                      onClick={() => setHousePensionTiming('retire')}
                      className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${housePensionTiming === 'retire' ? 'bg-accent' : 'surface-subtle border border-ink-5 text-ink-3 hover:bg-zinc-200'}`}
                      style={housePensionTiming === 'retire' ? { color: 'white' } : undefined}
                    >{retirementAge < 55 ? `55세(${ageToYear(55)}, 최소)` : '퇴직 즉시'}</button>
                  </div>
                  <RangeSlider
                    value={typeof housePensionTiming === 'number' ? housePensionTiming : Math.max(55, retirementAge)}
                    min={55}
                    max={65}
                    unit="세"
                    onChange={v => setHousePensionTiming(v)}
                  />
                </div>
              </div>
              {/* ── 그래프 ── */}
              <div>
                <p className="text-xs text-ink-4 mb-0.5">신청나이별 월수령액 · 시가(KB시세/실거래가) {housePrice}억 기준</p>
                <HousingPensionMiniChart housePrice={housePrice} selectedAge={calc.effectiveHpAge} mortgageBalance={mortgageCurrentBalance} />
              </div>
              {/* ── 코멘트 ── */}
              {retirementAge < 55 && (
                <div className="notice notice-amber text-xs">
                  내 은퇴 나이(만 {retirementAge}세, {ageToYearMonth(retirementAge)})는 주택연금 최소 가입 연령(만 55세) 미만입니다.
                  <strong>55세까지 {55 - retirementAge}년 대기</strong> 후 신청 가능
                </div>
              )}
              {mortgageCurrentBalance > 0 && (
                <div className="notice notice-amber text-xs">
                  주금공이 주담대 {fmtEok(mortgageCurrentBalance)} 일시상환 후 순자산({fmtEok(housePrice * 1e8 - mortgageCurrentBalance)}) 기준으로 연금 산정
                </div>
              )}
              {/* ── 결과 ── */}
              <div className="card-inner p-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-ink-3">{calc.effectiveHpAge}세({ageToYearMonth(calc.effectiveHpAge)}) 신청 시 월수령액</span>
                  <span className="text-accent tabular-nums font-semibold">{Math.round(calc.housePensionMonthly / 10000)}만원/월</span>
                </div>
                <div className="text-ink-4">
                  {mortgageCurrentBalance > 0
                    ? `순자산 ${((housePrice * 1e8 - mortgageCurrentBalance) / 1e8).toFixed(2)}억 × ${HOUSING_PENSION_RATES[calc.effectiveHpAge] ?? 15.3}만/억 (주담대 일시상환 후)`
                    : `시가 ${housePrice}억 × ${HOUSING_PENSION_RATES[calc.effectiveHpAge] ?? 15.3}만/억 (종신정액형)`
                  }
                </div>
              </div>
            </div>
          </Accordion>
          )}</SortableItem>

          {/* ⑥ 주담대 현황 */}
          <SortableItem id="planner_mortgage" order={plannerCardOrder.indexOf('planner_mortgage')}>{(dragHandle) => (
          <Accordion
            title="⑥ 주담대 현황"
            dragHandle={dragHandle}
            badge={
              <span className="text-xs tabular-nums text-ink-3">
                잔액 {fmtEok(calc.currentMortgage)}
              </span>
            }
          >
            <div className="space-y-2">
              {/* 그래프 맨 위 */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs text-ink-4">나이별 잔여 원금 추이 (현재 잔액 기준)</p>
                  <OcrBtn item="mortgage" title="주담대 대출 현황" hint="은행 앱의 대출 상세 화면을 업로드하세요. 현재 잔여원금과 대출 개시일을 인식합니다." />
                </div>
                <MortgageMiniChart currentBalance={mortgageCurrentBalance} remainingMonths={calc.mortgageRemainingMonths} />
              </div>

              {/* 설정 2열 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="text-xs font-medium text-ink-2">현재 잔여원금</span>
                    <span className="text-2xs text-ink-4">({mortgageBalanceDate})</span>
                    {mortgageCurrentBalance !== MORTGAGE_BALANCE_DEFAULT && <span className="tag tag-tonal text-2xs">갱신됨</span>}
                  </div>
                  <StepField
                    label={`≈ ${fmtEok(mortgageCurrentBalance)}`}
                    value={Math.round(mortgageCurrentBalance / 10000)} step={500} min={0} max={100000} unit="만원"
                    onChange={v => setMortgageCurrentBalance(v * 10000)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink-2 block mb-1">
                    대출 개시일
                  </label>
                  <input
                    type="date"
                    value={mortgageStartDate}
                    onChange={e => setMortgageStartDate(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-ink-5 bg-white dark:bg-zinc-800 text-xs tabular-nums text-ink-0 focus:outline-none focus:border-accent"
                  />
                  {mortgageStartDate && (
                    <p className="text-xs text-ink-4 mt-0.5">경과 {calc.mortgageElapsedMonths}개월 · 잔여 {calc.mortgageRemainingMonths}개월</p>
                  )}
                </div>
              </div>

              {/* 결과 2열 */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="card-inner px-3 py-2">
                  <div className="text-ink-3 mb-0.5">월 상환액</div>
                  <div className="text-ink-1 tabular-nums font-semibold">{Math.round(calc.mortgagePaymentMonthly / 10000)}만원/월</div>
                </div>
                <div className="card-inner px-3 py-2">
                  <div className="text-ink-3 mb-0.5">완납 예정</div>
                  <div className="text-accent tabular-nums font-semibold">{calc.mortgagePaidOffAge}세 ({BIRTH_YEAR + calc.mortgagePaidOffAge}년)</div>
                </div>
              </div>
              {calc.mortgagePaidOffAge > retirementAge && (
                <div className="notice notice-amber text-xs">
                  내 은퇴(만 {retirementAge}세, {ageToYearMonth(retirementAge)}) 후에도 <strong>{calc.mortgagePaidOffAge - retirementAge}년({calc.mortgagePaidOffAge}세까지)</strong> 상환 계속 —
                  월 {Math.round(calc.mortgagePaymentMonthly / 10000)}만원 지출 유지
                </div>
              )}
              <div className="text-xs text-ink-4 surface-subtle rounded-lg px-3 py-2">
                <span className="tag tag-tonal mr-1">고정금리</span>
                {(MORTGAGE_RATE_ANNUAL * 100).toFixed(2)}% · 전체 {MORTGAGE_MONTHS}개월 (30년, 2020-03-09 개시)
              </div>
            </div>
          </Accordion>
          )}</SortableItem>

          {/* ⑦ 개인IRP (미개설 - 하단 배치) */}
          <SortableItem id="planner_irp" order={plannerCardOrder.indexOf('planner_irp')}>{(dragHandle) => (
          <Accordion
            title="⑦ 개인IRP (미개설)"
            dragHandle={dragHandle}
            badge={
              !irpLoaded
                ? <span className="text-xs text-ink-4">미개설</span>
                : <span className="text-xs text-accent font-semibold tabular-nums">
                    60세({ageToYear(60)}) {Math.round(calc.personalIrpMonthlyReceipt / 10000)}만원/월
                  </span>
            }
            tags={
              <>
                <OptionTag label="세액공제 연300만" color="accent" />
                <OptionTag label="연금저축포함 年1800만한도" color="zinc" />
                <OptionTag label="중개형 운용중" color="accent" />
              </>
            }
          >
            <div className="space-y-3">
              {irpLoaded ? (
                <div className="rounded-lg bg-accent/10 p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-ink-2 font-medium">포트폴리오 연동 잔액 (IRP)</span>
                    <span className="text-sm text-accent tabular-nums">
                      {Math.round(personalIrpBalance / 10000).toLocaleString()}만원
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-ink-3">운용 수익률 (자동)</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-accent tabular-nums">
                        {personalIrpRate.toFixed(1)}%
                      </span>
                      <button
                        onClick={() => setPersonalIrpRate(r => Math.min(12, r + 0.5))}
                        className="text-xs px-1.5 py-0.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20"
                      >+</button>
                      <button
                        onClick={() => setPersonalIrpRate(r => Math.max(3, r - 0.5))}
                        className="text-xs px-1.5 py-0.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20"
                      >−</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card-inner px-3 py-2 text-xs text-ink-3">
                  미개설 — 포트폴리오에 IRP 계좌 추가 시 자동연동됩니다.
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-ink-2 block mb-1.5">
                  월납입액 (만원)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={5}
                  value={personalIrpMonthly}
                  onChange={e => setPersonalIrpMonthly(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-ink-5 bg-white dark:bg-zinc-800 text-sm tabular-nums text-ink-0 focus:outline-none focus:border-accent"
                />
              </div>
              {(irpLoaded || personalIrpMonthly > 0) && (
                <div className="card-inner p-3 space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-ink-3">60세({ageToYear(60)}) 예상잔액</span>
                    <span className="text-xs text-accent tabular-nums">
                      {fmtEok(calc.personalIrpAt60)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-ink-3">월 수령액 (20년)</span>
                    <span className="text-xs text-accent tabular-nums">
                      {Math.round(calc.personalIrpMonthlyReceipt / 10000)}만원/월
                    </span>
                  </div>
                </div>
              )}
            </div>
          </Accordion>
          )}</SortableItem>
              </div>
            </SortableContext>
            <DragOverlay>
              {activePlannerCardId && (
                <div className="shadow-xl rounded-xl border border-ink-5 pointer-events-none card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 surface-subtle">
                    <GripVertical size={13} className="text-ink-5" />
                    <span className="text-sm text-ink-1">
                      {PLANNER_CARD_TITLES[activePlannerCardId]}
                    </span>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>

        {/* ── 오른쪽 컬럼: AI 은퇴 시나리오 ── */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-ink-1 px-1">AI 은퇴 시나리오</h2>
          <AiStatusBadge />
          <div className="card p-4">
            <PlannerChat request={chatRequest} />
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
