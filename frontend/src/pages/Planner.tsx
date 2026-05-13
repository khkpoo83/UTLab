import { useState, useMemo, useEffect } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SortableItem } from '../components/SortableItem'
import { GripVertical } from 'lucide-react'
import { kisApi, recommendApi, profileApi, UserProfile } from '../api/client'
import OcrUploadModal from '../components/OcrUploadModal'
import PlannerChat from '../components/PlannerChat'
import StepField from '../components/StepField'
import RangeSlider from '../components/RangeSlider'
import type { PlannerOcrItem, PlannerChatRequest } from '../api/client'
import ToggleChip from '../components/ToggleChip'
import {
  AreaChart,
  BarChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts'
import { CHART_TOOLTIP_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_ITEM_STYLE, CHART_CURSOR_STYLE } from '../utils/chart'

// ─── 상수 ────────────────────────────────────────────────────────────────────

const BIRTH_YEAR = 1983
const BIRTH_MONTH = 4         // 4월생 (1-based)
const _now = new Date()
const CURRENT_YEAR = _now.getFullYear()
const CURRENT_MONTH = _now.getMonth() + 1  // 1-based
const CURRENT_AGE = CURRENT_YEAR - BIRTH_YEAR - (CURRENT_MONTH < BIRTH_MONTH ? 1 : 0)
/** 현재까지 살아온 개월 수 (생일 기준 정밀 계산) */
const CURRENT_AGE_MONTHS = (CURRENT_YEAR - BIRTH_YEAR) * 12 + (CURRENT_MONTH - BIRTH_MONTH)

/** 해당 나이가 되는 연도 */
const ageToYear = (age: number) => BIRTH_YEAR + age
/** 해당 나이가 되는 연도.월 (예: "2031.04") */
const ageToYearMonth = (age: number) => `${BIRTH_YEAR + age}.${String(BIRTH_MONTH).padStart(2, '0')}`

const NPS_BASE = 1_584_470           // 기준: 2026-01-01 국민연금공단 예상수령액(65세)
const NPS_BASE_DATE = '2026-01-01'   // ← 국민연금 앱에서 확인 후 업데이트
// 국민연금 가입 시작 (입사 첫 달) — 2010.04 확인 (카카오 스크린샷)
const NPS_JOIN_YEAR = 2010
const NPS_JOIN_MONTH = 4             // 4월 (1-based)

const DC_IRP_CURRENT = 39_060_006    // 기준: 2026-03-31 하나증권 DC IRP 평가금액 (납입원금 36,571,032 / 수익률 6.81% / 가입: 2025-03-18 (주)액셈)
const DC_IRP_DATE = '2026-03-31'     // ← 하나증권 앱에서 확인 후 업데이트

// 기준: 2026-03-01 각 보험사 앱 확인 (스크린샷 업로드로 업데이트 가능)
// monthlyContrib: 월 납입액(원), 0이면 완납 / paidOffYM: 납입완료 연월 "YYYY-MM"
const PRIVATE_PENSIONS = [
  { name: '삼성 이글루 B1.2', current: 18_942_448, startAge: 56, monthlyContrib: 100_000, paidOffYM: '2027-02', date: '2026-03-01' },
  { name: '삼성 이글루 B1.5', current: 17_163_295, startAge: 56, monthlyContrib: 100_000, paidOffYM: '2028-03', date: '2026-03-01' },
  { name: '삼성 인다이NEW (연금저축)', current: 2_919_361, startAge: 60, monthlyContrib: 300_000, paidOffYM: '2035-02', date: '2026-03-01' },
  { name: '교보 Fund변액',    current: 21_835_480, startAge: 59, monthlyContrib: 0, paidOffYM: null, date: '2026-03-01' },
  // 삼성 2-Step변액 — 2026-04-01 해지 완료, 제거됨
]

const HOUSING_PENSION_RATES: Record<number, number> = {
  50: 11.3, 51: 11.8, 52: 12.3, 53: 12.8, 54: 13.3,
  55: 15.3, 56: 15.9, 57: 16.5, 58: 17.2, 59: 17.9,
  60: 18.7, 61: 19.5, 62: 20.3, 63: 21.0, 64: 21.8,
  65: 23.0,
}

// 주담대: MORTGAGE_BALANCE_DEFAULT는 현재 잔액(원) - 원금(최초 대출액)이 아님
const MORTGAGE_BALANCE_DEFAULT = 242_390_000  // 2026-03-01 기준 현재 잔여원금
const MORTGAGE_BALANCE_DATE = '2026-03-01'
const MORTGAGE_RATE_ANNUAL = 0.0253
const MORTGAGE_MONTHS = 360  // 전체 대출 기간 (30년, 2020-03-09 개시)

const DC_IRP_RATE_DEFAULT = 7.0    // % (조정 가능)
const DC_IRP_MONTHLY_DEFAULT = 50  // 만원/월 (회사기여금 기본값, 조정 가능)

// ISA 2번째 계좌 (2026년 6월 개설 예정 - 국내주식 위주)
const ISA2_START_OFFSET_MONTHS = 3 // 현재(3월)로부터 3개월 후 6월 개설

// ─── 금액 포맷 헬퍼 ──────────────────────────────────────────────────────────

/** 원 단위 숫자를 가독성 있게 표시: 1억 이상 → X.XX억, 미만 → X,XXX만원 */
function fmtEok(won: number): string {
  if (Math.abs(won) >= 1e8) return (won / 1e8).toFixed(2) + '억'
  return Math.round(won / 1e4).toLocaleString('ko-KR') + '만원'
}

// ─── 계산 함수들 ──────────────────────────────────────────────────────────────

function calcISAFuture(
  currentBalance: number,
  retirementAge: number,
  monthlyContrib: number,
  annualRate: number
): number {
  const months = Math.max(0, retirementAge * 12 - CURRENT_AGE_MONTHS)
  if (months === 0) return currentBalance
  const r = annualRate / 12
  const growthOfCurrent = currentBalance * Math.pow(1 + r, months)
  const contribFV = r === 0 ? monthlyContrib * months : monthlyContrib * ((Math.pow(1 + r, months) - 1) / r)
  return growthOfCurrent + contribFV
}

// 월 상환액: 현재 잔액(currentBalance)과 잔여 개월(remainingMonths)로 계산
function calcMortgagePaymentMonthly(currentBalance: number, remainingMonths: number): number {
  if (remainingMonths <= 0) return 0
  const r = MORTGAGE_RATE_ANNUAL / 12
  return currentBalance * r * Math.pow(1 + r, remainingMonths) / (Math.pow(1 + r, remainingMonths) - 1)
}

// 현재 잔액에서 k개월 후 잔액 (forward projection)
function calcMortgageFutureBalance(currentBalance: number, remainingMonths: number, monthsFromNow: number): number {
  if (monthsFromNow >= remainingMonths) return 0
  const r = MORTGAGE_RATE_ANNUAL / 12
  const monthlyPayment = calcMortgagePaymentMonthly(currentBalance, remainingMonths)
  const bal = currentBalance * Math.pow(1 + r, monthsFromNow) - monthlyPayment * ((Math.pow(1 + r, monthsFromNow) - 1) / r)
  return Math.max(0, bal)
}

function calcHousingPension(applyAge: number, housePriceWon: number, mortgageBalanceWon: number = 0): number {
  const clampedAge = Math.max(55, Math.min(65, applyAge))
  const rate = HOUSING_PENSION_RATES[clampedAge] ?? 15.3
  // 실제 규정: 주금공이 주담대 잔액 일시상환 후 남은 순자산 기준으로 연금 지급
  const effectiveEquityEok = Math.max(0, (housePriceWon - mortgageBalanceWon) / 1e8)
  return Math.round(effectiveEquityEok * rate * 10_000)
}

// 사적연금 소득세율 (연금소득세): 55~70세 5.5%, 70~80세 4.4%, 80세+ 3.3%
function calcPensionTaxRate(startAge: number, payoutYears: number): number {
  const endAge = startAge + payoutYears
  const bands = [
    { from: Math.max(55, startAge), to: Math.min(70, endAge), rate: 0.055 },
    { from: Math.max(70, startAge), to: Math.min(80, endAge), rate: 0.044 },
    { from: Math.max(80, startAge), to: endAge, rate: 0.033 },
  ]
  let totalMonths = 0
  let weightedTax = 0
  for (const b of bands) {
    if (b.to > b.from) {
      const months = (b.to - b.from) * 12
      totalMonths += months
      weightedTax += months * b.rate
    }
  }
  return totalMonths > 0 ? weightedTax / totalMonths : 0.055
}

function calcDcIrpAtAge(
  targetAge: number,
  retirementAge: number,
  annualRate: number,
  monthlyContrib: number,  // 만원/월 단위
  currentBalance: number,
): number {
  // Phase 1: 현재 ~ min(retirementAge, targetAge) 기여금 포함 성장
  const contributeUntil = Math.min(retirementAge, targetAge)
  const months1 = Math.max(0, Math.round(contributeUntil * 12 - CURRENT_AGE_MONTHS))
  const r = annualRate / 12
  const phase1 =
    currentBalance * Math.pow(1 + r, months1) +
    (months1 === 0 ? 0 : r === 0
      ? monthlyContrib * 10_000 * months1
      : monthlyContrib * 10_000 * (Math.pow(1 + r, months1) - 1) / r)

  // Phase 2: 퇴직 후 ~ targetAge 기여금 없이 복리만
  if (targetAge <= retirementAge) return phase1
  const months2 = Math.round((targetAge - contributeUntil) * 12)
  return phase1 * Math.pow(1 + r, months2)
}

function calcPersonalIrpAtAge(
  targetAge: number,
  monthlyContrib: number,
  annualRate: number,
  retirementAge: number,
  currentBalance: number = 0
): number {
  const contributeUntil = Math.min(targetAge, retirementAge)
  const months = Math.max(0, contributeUntil * 12 - CURRENT_AGE_MONTHS)
  const r = annualRate / 12
  const contributeYears = months / 12
  const currentGrowth = currentBalance * Math.pow(1 + annualRate, contributeYears)
  const contribFV = months === 0
    ? 0
    : r === 0
    ? monthlyContrib * months
    : monthlyContrib * ((Math.pow(1 + r, months) - 1) / r)
  const total = currentGrowth + contribFV
  const extraYears = Math.max(0, targetAge - contributeUntil)
  return total * Math.pow(1 + annualRate, extraYears)
}

function calcPrivatePensionAtStart(
  currentValue: number,
  growthRate: number,
  startAge: number,
  monthlyContrib: number = 0,
  paidOffYM: string | null = null,
): number {
  if (monthlyContrib > 0 && paidOffYM) {
    const [y, m] = paidOffYM.split('-').map(Number)
    // 납입완료 시점까지 남은 개월 수 (생일 기준)
    const paidOffFromBirth = (y - BIRTH_YEAR) * 12 + (m - BIRTH_MONTH)
    const remainContribMonths = Math.max(0, paidOffFromBirth - CURRENT_AGE_MONTHS)
    const r = growthRate / 12
    if (r === 0) {
      // 수익률 0%: 현재잔액 + 남은 납입예정액 단순합산
      return currentValue + monthlyContrib * remainContribMonths
    } else {
      // 납입기간 복리 FV
      const atPaidOff = currentValue * Math.pow(1 + r, remainContribMonths)
        + monthlyContrib * (Math.pow(1 + r, remainContribMonths) - 1) / r
      // 납입완료 → 개시 나이까지 추가 운용
      const startFromBirth = startAge * 12
      const monthsAfterPaidOff = Math.max(0, startFromBirth - paidOffFromBirth)
      return atPaidOff * Math.pow(1 + r, monthsAfterPaidOff)
    }
  }
  // 납입완료 상품: 현재잔액 복리 운용
  const yearsToStart = Math.max(0, startAge * 12 - CURRENT_AGE_MONTHS) / 12
  return currentValue * Math.pow(1 + growthRate, yearsToStart)
}

function calcPrivatePensionMonthly(
  currentValue: number,
  growthRate: number,
  startAge: number,
  payoutYears: number,
  monthlyContrib: number = 0,
  paidOffYM: string | null = null,
): number {
  const futureValue = calcPrivatePensionAtStart(currentValue, growthRate, startAge, monthlyContrib, paidOffYM)
  return futureValue / (payoutYears * 12)
}

function calcISA2Future(targetAge: number, monthlyContrib: number, annualRate: number): number {
  // 2026년 6월 개설 → 현재(2026년 3월)로부터 3개월 후 시작
  const months = Math.max(0, targetAge * 12 - CURRENT_AGE_MONTHS - ISA2_START_OFFSET_MONTHS)
  if (months <= 0) return 0
  const r = annualRate / 12
  return r === 0 ? monthlyContrib * months : monthlyContrib * ((Math.pow(1 + r, months) - 1) / r)
}

/** 가입 시작(NPS_JOIN)부터 targetAge까지 납부 개월 수
 *  퇴직/수령 시점은 항상 생일월(BIRTH_MONTH)이므로 정밀 계산
 */
function npsMonthsTo(targetAge: number): number {
  const months = (BIRTH_YEAR + targetAge - NPS_JOIN_YEAR) * 12 + (BIRTH_MONTH - NPS_JOIN_MONTH)
  return Math.max(0, months)
}

/** 국민연금 가입기간 급여 계수: 20년(240개월) 미만이면 비례, 이상이면 가산 */
function npsPeriodFactor(months: number): number {
  if (months >= 240) return 1.0 + 0.05 * (months - 240) / 12
  return months / 240
}

/** base65: 65세 기준 수령액 (임의계속 보정 후) → receiptAge 조정 적용 */
function npsApplyReceiptAge(base65: number, receiptAge: number): number {
  if (receiptAge < 65) return Math.round(base65 * (1 - 0.06 * (65 - receiptAge)))
  if (receiptAge > 65) return Math.round(base65 * (1 + 0.072 * (receiptAge - 65)))
  return Math.round(base65)
}

function calcISAMonthlyDrawdown(isaBalance: number, fromAge: number, toAge: number): number {
  const months = Math.max(1, (toAge - fromAge) * 12)
  return isaBalance / months
}

function calcIRPMonthly(irpBalance: number, payoutYears = 20): number {
  return irpBalance / (payoutYears * 12)
}


// ─── 서브 컴포넌트들 ──────────────────────────────────────────────────────────
// RangeSlider, StepField → src/components/RangeSlider.tsx, StepField.tsx 로 이전됨

function OptionTag({ label, color = 'zinc' }: { label: string; color?: string }) {
  return <span className={`tag tag-${color}`}>{label}</span>
}

// ─── 테마 헬퍼 ───────────────────────────────────────────────────────────────

function getAccentRgb(): string {
  if (typeof window === 'undefined') return '26 158 255'
  return getComputedStyle(document.documentElement).getPropertyValue('--c-accent-rgb').trim() || '26 158 255'
}

// 나이 축 커스텀 틱: "Xse" + "'YY" 2행 표시
function AgeTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  if (!payload) return null
  const yr = ageToYear(payload.value)
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text dy={10} textAnchor="middle" fill="#a1a1aa" fontSize={9}>{payload.value}세</text>
      <text dy={19} textAnchor="middle" fill="#d4d4d8" fontSize={8}>'{String(yr).slice(2)}</text>
    </g>
  )
}

// ─── 미니 차트 컴포넌트들 ─────────────────────────────────────────────────────

// 개인연금: 수령기간별 월수령액 바 차트
function PrivatePensionMiniChart({ ppDetails, rate }: { ppDetails: { current: number; startAge: number; monthlyContrib?: number; paidOffYM?: string | null }[]; rate: number }) {
  const data = [10, 15, 20, 25].map(yr => ({
    label: `${yr}년`,
    monthly: Math.round(ppDetails.reduce((s, pp) =>
      s + calcPrivatePensionMonthly(pp.current, rate / 100, pp.startAge, yr, pp.monthlyContrib ?? 0, pp.paidOffYM ?? null), 0) / 10000),
  }))
  return (
    <div className="h-[72px] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 4 }} barSize={28}>
          <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            formatter={(v: number) => [`${v}만원/월`, '월수령액']}
            contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: 10, padding: '4px 8px' }}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={CHART_CURSOR_STYLE}
          />
          <Bar dataKey="monthly" radius={[3, 3, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={`rgba(var(--c-accent-rgb) / ${0.5 + i * 0.15})`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ISA: 2계좌 잔액 추이 라인 차트
function ISAMiniChart({
  isa1Balance, isa1Monthly, isa1Rate,
  isa2Monthly, isa2Rate, retirementAge,
}: {
  isa1Balance: number; isa1Monthly: number; isa1Rate: number;
  isa2Monthly: number; isa2Rate: number; retirementAge: number;
}) {
  const data = []
  for (let age = CURRENT_AGE; age <= retirementAge; age++) {
    const isa1 = Math.round(calcISAFuture(isa1Balance, age, isa1Monthly, isa1Rate) / 1e6) / 100
    const isa2 = Math.round(calcISA2Future(age, isa2Monthly, isa2Rate) / 1e6) / 100
    data.push({ age, isa1, isa2 })
  }
  const _isaRgb = getAccentRgb()
  const isa1Stroke = `rgb(${_isaRgb})`
  const isa1Fill = `rgba(${_isaRgb.replace(/ /g, ',')},0.15)`
  const isa2Stroke = `rgba(${_isaRgb.replace(/ /g, ',')},0.6)`
  const isa2Fill = `rgba(${_isaRgb.replace(/ /g, ',')},0.10)`
  return (
    <div className="h-[72px] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 10, left: 4 }}>
          <XAxis dataKey="age" tick={<AgeTick />} tickLine={false} axisLine={false} interval={Math.floor(data.length / 4)} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            labelFormatter={(age) => `만 ${age}세 · ${ageToYearMonth(age as number)}`}
            formatter={(v: number, name: string) => [fmtEok(v * 1e8), name === 'isa1' ? 'ISA①' : 'ISA②(신규)']}
            contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: 10, padding: '4px 8px' }}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={CHART_CURSOR_STYLE}
          />
          <Area type="monotone" dataKey="isa1" name="ISA①" stroke={isa1Stroke} fill={isa1Fill} strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="isa2" name="ISA②" stroke={isa2Stroke} fill={isa2Fill} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// 퇴직연금 DC: 나이별 잔액 추이
function DCMiniChart({ rate, retirementAge, monthlyContrib, currentBalance }: { rate: number; retirementAge: number; monthlyContrib: number; currentBalance: number }) {
  const data = []
  for (let age = CURRENT_AGE; age <= 65; age += 1) {
    data.push({ age, bal: Math.round(calcDcIrpAtAge(age, retirementAge, rate / 100, monthlyContrib, currentBalance) / 1e6) / 100 })
  }
  const _dcRgb = getAccentRgb()
  const dcStroke = `rgb(${_dcRgb})`
  const dcFill = `rgba(${_dcRgb.replace(/ /g, ',')},0.15)`
  return (
    <div className="h-[72px] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 10, left: 4 }}>
          <XAxis dataKey="age" tick={<AgeTick />} tickLine={false} axisLine={false} interval={4} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            labelFormatter={(age) => `만 ${age}세 · ${ageToYearMonth(age as number)}`}
            formatter={(v: number) => [fmtEok(v * 1e8), '예상잔액']}
            contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: 10, padding: '4px 8px' }}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={CHART_CURSOR_STYLE}
          />
          <ReferenceLine x={60} stroke={dcStroke} strokeOpacity={0.5} strokeDasharray="3 2" strokeWidth={1} />
          <Area type="monotone" dataKey="bal" stroke={dcStroke} fill={dcFill} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// 국민연금: 수령나이별 월수령액 바 차트
function NPSMiniChart({ selectedAge, effectiveBase65 }: { selectedAge: number; effectiveBase65: number }) {
  const ages = [60, 62, 65, 67, 70]
  const data = ages.map(age => ({
    age: `${age}세 '${String(ageToYear(age)).slice(2)}`,
    ageNum: age,
    monthly: Math.round(npsApplyReceiptAge(effectiveBase65, age) / 10000),
    selected: age === selectedAge,
  }))
  return (
    <div className="h-[72px] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 4 }} barSize={24}>
          <XAxis dataKey="age" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            labelFormatter={(_, payload) => {
              const ageNum = payload?.[0]?.payload?.ageNum
              return ageNum != null ? `만 ${ageNum}세 · ${ageToYearMonth(ageNum)}` : ''
            }}
            formatter={(v: number) => [`${v}만원/월`, '예상수령액']}
            contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: 10, padding: '4px 8px' }}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={CHART_CURSOR_STYLE}
          />
          <Bar dataKey="monthly" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.selected ? 'rgb(var(--c-accent-rgb))' : 'rgba(var(--c-accent-rgb)/0.35)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// 주택연금: 신청나이별 월수령액 차트 (만 55세~65세, 1세 단위)
function HousingPensionMiniChart({ housePrice, selectedAge, mortgageBalance }: { housePrice: number; selectedAge: number; mortgageBalance?: number }) {
  const ages = Array.from({ length: 11 }, (_, i) => 55 + i) // 55~65세
  const data = ages.map(age => ({
    age: `${age}세 '${String(ageToYear(age)).slice(2)}`,
    ageNum: age,
    monthly: Math.round(calcHousingPension(age, housePrice * 1e8, mortgageBalance ?? 0) / 10000),
    selected: age === selectedAge,
  }))
  return (
    <div className="h-[72px] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 4 }} barSize={20}>
          <XAxis dataKey="age" tick={{ fontSize: 8 }} tickLine={false} axisLine={false} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            labelFormatter={(_, payload) => {
              const ageNum = payload?.[0]?.payload?.ageNum
              return ageNum != null ? `만 ${ageNum}세 · ${ageToYearMonth(ageNum)}` : ''
            }}
            formatter={(v: number) => [`${v}만원/월`, '월수령액(종신)']}
            contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: 10, padding: '4px 8px' }}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={CHART_CURSOR_STYLE}
          />
          <Bar dataKey="monthly" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => {
              const _hpRgb = getAccentRgb()
              const selColor = `rgb(${_hpRgb})`
              const unselColor = `rgba(${_hpRgb.replace(/ /g, ',')},0.35)`
              return <Cell key={i} fill={d.selected ? selColor : unselColor} />
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// 주담대: 현재 잔액에서 forward projection 차트
function MortgageMiniChart({ currentBalance, remainingMonths }: { currentBalance: number; remainingMonths: number }) {
  const data = []
  const totalYears = Math.ceil(remainingMonths / 12)
  for (let yr = 0; yr <= totalYears; yr += 2) {
    const age = CURRENT_AGE + yr
    const bal = Math.round(calcMortgageFutureBalance(currentBalance, remainingMonths, yr * 12) / 1e6) / 100
    data.push({ age, bal })
  }
  return (
    <div className="h-[72px] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 10, left: 4 }}>
          <XAxis dataKey="age" tick={<AgeTick />} tickLine={false} axisLine={false} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            labelFormatter={(age) => `만 ${age}세 · ${ageToYearMonth(age as number)}`}
            formatter={(v: number) => [fmtEok(v * 1e8), '잔여원금']}
            contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: 10, padding: '4px 8px' }}
            labelStyle={CHART_TOOLTIP_LABEL_STYLE}
            itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            cursor={CHART_CURSOR_STYLE}
          />
          {(() => { const rgb = getAccentRgb(); return (
            <Area type="monotone" dataKey="bal" stroke={`rgb(${rgb})`} fill={`rgba(${rgb.replace(/ /g, ',')},0.12)`} strokeWidth={1.5} dot={false} />
          )})()}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// 아코디언 섹션 wrapper
interface AccordionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
  badge?: React.ReactNode
  tags?: React.ReactNode
  dragHandle?: React.ReactNode
}

function Accordion({ title, defaultOpen = false, children, badge, tags, dragHandle }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${
          open
            ? 'bg-accent/5 dark:bg-accent/10 border-b border-zinc-100 dark:border-zinc-700'
            : 'surface-subtle hover:bg-zinc-100 dark:hover:bg-zinc-700'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {dragHandle}
          <span className={`text-sm flex-shrink-0 ${open ? 'text-zinc-800 dark:text-zinc-100 font-medium' : 'text-zinc-700 dark:text-zinc-300'}`}>{title}</span>
          {badge}
        </div>
        <svg
          className={`w-4 h-4 transition-transform flex-shrink-0 ml-2 ${open ? 'rotate-0 text-accent' : '-rotate-90 text-zinc-400'}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {tags && open && (
        <div className="px-4 pt-2.5 pb-1 flex flex-wrap gap-1.5 border-b border-zinc-100 dark:border-zinc-700">
          {tags}
        </div>
      )}
      {open && (
        <div className="px-4 pb-4 pt-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── AI 상태 배지 ─────────────────────────────────────────────────────────────

function AiStatusBadge() {
  const [status, setStatus]     = useState<'loading' | 'available' | 'limited' | 'error'>('loading')
  const [rpd, setRpd]           = useState('')
  const [countdown, setCountdown] = useState(0)  // 쿨다운 남은 초

  const fetchStatus = () => {
    recommendApi.aiStatus()
      .then(res => {
        const s = res.data
        if (s.rate_limited) {
          setStatus('limited')
          setCountdown(s.rate_limit_seconds_remaining)
          setRpd('')
        } else if (s.rpd_used >= s.rpd_limit) {
          setStatus('limited')
          setCountdown(0)
          setRpd(`일일 한도 소진 (${s.rpd_used}/${s.rpd_limit})`)
        } else {
          setStatus('available')
          setCountdown(0)
          setRpd(`오늘 ${s.rpd_used}/${s.rpd_limit} 사용`)
        }
      })
      .catch(() => { setStatus('error'); setRpd('') })
  }

  // 최초 + 30초마다 상태 갱신
  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 30_000)
    return () => clearInterval(id)
  }, [])

  // 쿨다운 1초 카운트다운
  useEffect(() => {
    if (countdown <= 0) return
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { fetchStatus(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [countdown > 0])

  if (status === 'loading') return null

  const cfg = {
    available: { dot: 'bg-accent', text: 'text-accent', label: 'AI 사용 가능' },
    limited:   { dot: 'bg-[color:var(--tag-amber-fg)]', text: 'text-[color:var(--tag-amber-fg)]', label: 'AI 한도 제한' },
    error:     { dot: 'bg-zinc-400',  text: 'text-zinc-500',                       label: 'AI 상태 불명' },
  }[status]

  const detail = countdown > 0
    ? `${Math.ceil(countdown / 60)}분 ${countdown % 60}초 후 재개`
    : rpd

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg surface-subtle border border-zinc-200 dark:border-zinc-700">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${status === 'available' ? 'animate-pulse' : ''}`} />
      <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
      <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-auto tabular-nums">{detail}</span>
    </div>
  )
}

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
  const calc = useMemo(() => {
    const retirementYear = BIRTH_YEAR + retirementAge
    const dYears = retirementAge - CURRENT_AGE
    const housePriceWon = housePrice * 1e8

    const isaAtRetirement = calcISAFuture(isaBalance, retirementAge, isaMonthly * 10_000, isaRate / 100)

    // dcIrpBalance 상태 기반 (OCR로 갱신 가능), dcMonthly 기여금 반영
    // 수령 가능 나이: 만 55세 이상 (IRP 규정). 은퇴 나이가 55세 이상이면 은퇴 즉시 수령 가능
    const dcReceiptAge = Math.max(55, retirementAge)
    const dcIrpAtRetire = calcDcIrpAtAge(retirementAge, retirementAge, dcRate / 100, dcMonthly, dcIrpBalance)
    const dcIrpAtReceipt = calcDcIrpAtAge(dcReceiptAge, retirementAge, dcRate / 100, dcMonthly, dcIrpBalance)
    const dcIrpMonthly = calcIRPMonthly(dcIrpAtReceipt, dcPayoutYears)

    // NPS: 퇴직 시점까지 실제 납부 개월 기반 수령액 계산
    // npsBase (OCR 앱값) = 60세까지 납부 가정 65세 수령 예상액
    const npsMonthsAt60 = npsMonthsTo(60)
    const npsMonthsAtRetire = npsMonthsTo(retirementAge)
    const p60 = npsPeriodFactor(npsMonthsAt60)
    const pRetire = npsPeriodFactor(npsMonthsAtRetire)
    // 임의계속 없을 때: 퇴직까지만 납부 → 65세 수령액
    const npsAtRetire65 = p60 > 0 ? Math.round(npsBase * pRetire / p60) : Math.round(npsBase)

    const personalIrpAt60 = calcPersonalIrpAtAge(
      60,
      personalIrpMonthly * 10_000,
      personalIrpRate / 100,
      retirementAge,
      personalIrpBalance,
    )
    const personalIrpMonthlyReceipt = calcIRPMonthly(personalIrpAt60)

    const hpAge = housePensionTiming === 'retire' ? retirementAge : Number(housePensionTiming)
    const effectiveHpAge = Math.max(55, Math.min(65, hpAge)) // 최소 만 55세 (정책 기준)
    const housePensionMonthly = calcHousingPension(effectiveHpAge, housePriceWon, mortgageCurrentBalance)

    // 주담대: 대출 개시일로 잔여 개월 계산 (현재 잔액은 별도 state)
    let mortgageElapsedMonths = 0
    if (mortgageStartDate) {
      const start = new Date(mortgageStartDate)
      const now = new Date(CURRENT_YEAR, 2, 1) // 2026-03-01 기준
      mortgageElapsedMonths = Math.max(0,
        (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
      )
    }
    // 현재 잔액은 state에서 직접 사용 (개시일로 재계산하지 않음)
    // 잔액이 0이면 이미 완납 — 잔여기간 0으로 처리 (완납 예정 나이 = 현재 나이)
    const mortgageRemainingMonths = mortgageCurrentBalance <= 0
      ? 0
      : Math.max(0, MORTGAGE_MONTHS - mortgageElapsedMonths)
    const mortgagePaymentMonthly = calcMortgagePaymentMonthly(mortgageCurrentBalance, mortgageRemainingMonths)
    const mortgagePaidOffAge = CURRENT_AGE + Math.ceil(mortgageRemainingMonths / 12)
    const mortgageBalanceDateDisplay = mortgageBalanceDate

    // 임의계속가입 시 65세 수령액 보정 (backend build_nps_voluntary_table 동일 로직)
    let npsEffective65 = npsAtRetire65
    if (retirementAge < 65 && npsVoluntaryCont && npsVoluntaryMonthly > 0) {
      const pNorm = npsMonthsAtRetire / 240 || 0.01
      const careerIncome만 = Math.min(1000, Math.max(100, Math.round(npsAtRetire65 / 10000 / (0.4 * pNorm))))
      const recovery만 = npsBase / 10000 - npsAtRetire65 / 10000
      const voluntaryIncome만 = npsVoluntaryMonthly / 0.09   // 월납부액 → 소득월액 환산
      const bonus만 = recovery만 * Math.min(1, voluntaryIncome만 / careerIncome만)
      npsEffective65 = Math.round((npsAtRetire65 / 10000 + bonus만) * 10000)
    }
    const npsMonthly = npsApplyReceiptAge(npsEffective65, npsReceiptAge)

    // 임의계속가입 최적 납부액 계산
    const npsOptimalMonthly = (() => {
      if (retirementAge >= 65 || !npsVoluntaryCont) return 0
      const pNorm = npsMonthsAtRetire / 240 || 0.01
      const careerIncome = Math.min(1000, Math.max(100, Math.round(npsAtRetire65 / 10000 / (0.4 * pNorm))))
      return Math.ceil(careerIncome * 0.09)
    })()

    const ppDetails = PRIVATE_PENSIONS.map((pp, i) => {
      const effectiveCurrent = ppBalances[i] ?? pp.current
      const startAge = ppStartAges[i] ?? pp.startAge
      return {
        ...pp,
        current: effectiveCurrent,
        startAge,
        startYear: ageToYear(startAge),
        monthly: calcPrivatePensionMonthly(effectiveCurrent, privatePensionRate / 100, startAge, payoutYears, pp.monthlyContrib ?? 0, pp.paidOffYM ?? null),
        atStart: calcPrivatePensionAtStart(effectiveCurrent, privatePensionRate / 100, startAge, pp.monthlyContrib ?? 0, pp.paidOffYM ?? null),
      }
    })
    const ppTotalMonthly = ppDetails.reduce((sum, p) => sum + p.monthly, 0)
    const ppFirstStartAge = Math.min(...ppDetails.map(p => p.startAge))

    const isaMonthlyDrawdown = calcISAMonthlyDrawdown(isaAtRetirement, retirementAge, npsReceiptAge)

    return {
      retirementYear,
      dYears,
      isaAtRetirement,
      dcReceiptAge,
      dcIrpAtRetire,
      dcIrpAtReceipt,
      dcIrpMonthly,
      personalIrpAt60,
      personalIrpMonthlyReceipt,
      housePensionMonthly,
      effectiveHpAge,
      currentMortgage: mortgageCurrentBalance,
      mortgageRemainingMonths,
      mortgagePaymentMonthly,
      mortgagePaidOffAge,
      mortgageBalanceDateDisplay,
      mortgageElapsedMonths,
      npsAtRetire65,
      npsEffective65,
      npsMonthly,
      npsOptimalMonthly,
      ppDetails,
      ppTotalMonthly,
      ppFirstStartAge,
      isaMonthlyDrawdown,
      housePriceWon,
    }
  }, [
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
        <h2 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">은퇴 나이 설정</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-accent tabular-nums">만 {retirementAge}세</span>
          <span className="text-xs text-zinc-400">{calc.retirementYear}년 · D-{calc.dYears}년</span>
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
                    isSelected ? 'text-accent font-bold' : 'text-zinc-400 dark:text-zinc-500'
                  }`}>{age}</span>
                  <span className={`text-[7px] tabular-nums transition-all ${
                    isSelected ? 'text-accent/70' : 'text-zinc-400 dark:text-zinc-500'
                  }`}>'{String(ageToYear(age)).slice(2)}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
      {/* 목표 월 생활비 */}
      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
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
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-2xs font-medium surface-subtle border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
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
        <h1 className="text-xl text-zinc-800 dark:text-zinc-100">은퇴 플래너</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {userProfile?.display_name ? `${userProfile.display_name} · ` : ''}
          개인화된 은퇴 시뮬레이터 ·{' '}
          {userProfile?.birth_date
            ? `${userProfile.birth_date.slice(0,7)}생 · 만 ${userProfile.age}세`
            : `1983년 4월생 · 만 ${CURRENT_AGE}세`}
          {' '}({CURRENT_YEAR}.{String(CURRENT_MONTH).padStart(2,'0')})
        </p>
      </div>

      {/* 상단 은퇴나이 슬라이더 (전체폭) */}
      <div className="mb-6">
        {retirementSlider}
      </div>


      {/* 2컬럼 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── 왼쪽 컬럼: 내 노후 자금 현황 ── */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 px-1">내 노후 자금 현황</h2>

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
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">수익률 가정</span>
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
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">수령기간</span>
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
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    수령기간별 합산 월수령액
                    <span className="ml-1 text-zinc-500 dark:text-zinc-400">(수익률 {privatePensionRate}% · 납입예정액 포함)</span>
                  </p>
                  <OcrBtn item="private_pension" title="개인연금 잔액" hint="각 보험사 앱의 적립금(평가금액) 화면을 업로드하세요. 상품명과 금액을 인식합니다." />
                </div>
                <PrivatePensionMiniChart ppDetails={calc.ppDetails} rate={privatePensionRate} />
              </div>
              {/* ── 상품별 카드 (2열) ── */}
              <p className="text-xs text-zinc-400 dark:text-zinc-500">기준: 각 상품 {PRIVATE_PENSIONS[0].date}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {calc.ppDetails.map((pp, i) => (
                <div key={i} className="card-inner p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{pp.name}</span>
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
                      <div className="text-xs text-zinc-400 mt-0.5">
                        현재 {Math.round(pp.current / 10000).toLocaleString()}만원
                        {pp.atStart > pp.current && (
                          <span className="ml-1 text-zinc-500 dark:text-zinc-400">→ 개시시 {fmtEok(pp.atStart)} 예상</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-2xs text-zinc-400 flex-shrink-0">개시</span>
                        <button onClick={() => updatePpStartAge(i, -1)} className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded surface-subtle border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-accent/10 hover:text-accent text-xs">−</button>
                        <div className="flex-1 text-center min-w-0">
                          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums whitespace-nowrap leading-tight">{pp.startAge}세 ~ {pp.startAge + payoutYears}세</div>
                          <div className="text-2xs text-zinc-400 tabular-nums leading-tight">{ageToYear(pp.startAge)} ~ {ageToYear(pp.startAge + payoutYears)}년</div>
                        </div>
                        <button onClick={() => updatePpStartAge(i, +1)} className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded surface-subtle border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-accent/10 hover:text-accent text-xs">+</button>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-accent tabular-nums">{Math.round(pp.monthly / 10000)}만원/월</div>
                      <div className="text-2xs text-zinc-400 tabular-nums">세후 {Math.round(pp.monthly / 10000 * (1 - calcPensionTaxRate(pp.startAge, payoutYears)))}만원</div>
                      <div className="text-xs text-zinc-400 tabular-nums">개시시 {fmtEok(pp.atStart)}</div>
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
                    ? <>ISA로 대체 필요 <span className="text-zinc-400">(주택연금은 만 55세 이후 가능)</span></>
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
                      <span key={i} className="ml-2 text-zinc-500 dark:text-zinc-400">
                        {pp.name.replace('삼성 ', '')} {Math.round(pp.monthlyContrib / 10000)}만({pp.paidOffYM}완납)
                      </span>
                    ))}
                    <span className="ml-2 font-semibold text-zinc-700 dark:text-zinc-300">합계 {Math.round(totalContrib / 10000)}만원/월</span>
                  </div>
                )
              })()}
              <div className="flex justify-between items-center pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{PRIVATE_PENSIONS.length}개 상품 합산 월수령액</span>
                <div className="text-right">
                  <div className="text-base text-accent tabular-nums">{Math.round(calc.ppTotalMonthly / 10000)}만원/월</div>
                  <div className="text-xs text-zinc-400">세후 약 {Math.round(calc.ppTotalMonthly / 10000 * (1 - calcPensionTaxRate(calc.ppFirstStartAge, payoutYears)))}만원</div>
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
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">수익률 프리셋</span>
                  <div className="flex gap-1">
                    {[{label:'보수적', v:3},{label:'중간', v:5},{label:'공격적', v:7}].map(p => (
                      <ToggleChip key={p.v} size="xs" active={dcRate === p.v}
                        onClick={() => { setDcRate(p.v); localStorage.setItem('planner_dc_rate', String(p.v)) }}
                      >{p.label} {p.v}%</ToggleChip>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">수령기간</span>
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
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">나이별 예상잔액 추이 (60세 수령 기준선)</p>
                  <OcrBtn item="dc_irp" title="퇴직연금DC 잔액" hint="하나증권 앱의 퇴직연금(DC) 잔액 화면을 업로드하세요. 총 평가금액과 수익률을 인식합니다." />
                </div>
                <DCMiniChart rate={dcRate} retirementAge={retirementAge} monthlyContrib={dcMonthly} currentBalance={dcIrpBalance} />
              </div>
              {/* ── 결과 ── */}
              <div className="card-inner p-3 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    현재 잔액
                    <span className="ml-1 text-zinc-500 dark:text-zinc-400">({dcIrpDate} 기준)</span>
                    {dcIrpBalance !== DC_IRP_CURRENT && <span className="ml-1 tag tag-tonal text-2xs">갱신됨</span>}
                  </span>
                  <span className="text-sm text-accent tabular-nums">{Math.round(dcIrpBalance / 1e4).toLocaleString()}만원</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{calc.dcReceiptAge}세({ageToYearMonth(calc.dcReceiptAge)}) 예상 잔액</span>
                  <span className="text-sm text-accent tabular-nums">{fmtEok(calc.dcIrpAtReceipt)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">월 수령액 ({dcPayoutYears}년)</span>
                  <div className="text-right">
                    <div className="text-sm text-accent tabular-nums">{Math.round(calc.dcIrpMonthly / 10000)}만원/월</div>
                    <div className="text-2xs text-zinc-400 tabular-nums">세후 {Math.round(calc.dcIrpMonthly / 10000 * (1 - calcPensionTaxRate(calc.dcReceiptAge, dcPayoutYears)))}만원</div>
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
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-accent/10 border border-accent/30 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="tag tag-tonal text-2xs">ISA ①</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">기존 계좌 · 해외ETF 위주</span>
                    {isaLoaded && <span className="ml-auto text-xs text-accent tabular-nums font-semibold">{Math.round(isaBalance / 10000).toLocaleString()}만원</span>}
                  </div>
                  {isaActualPnlPct !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">현재 계좌 누적 수익률</span>
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
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">신규 · 국내 배당주 위주 (2026년 6월 예정)</span>
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
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">나이별 ISA 잔액 추이 (파란=①해외ETF, 초록=②배당주)</p>
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
                  <span className="text-zinc-500">ISA① {retirementAge - CURRENT_AGE}년 운용 후 예상 (만 {retirementAge}세, {ageToYearMonth(retirementAge)})</span>
                  <span className="text-accent tabular-nums">{fmtEok(calc.isaAtRetirement)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">ISA② {retirementAge - CURRENT_AGE}년 운용 후 예상 (만 {retirementAge}세, {ageToYearMonth(retirementAge)})</span>
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
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-2">수령 시점</label>
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
                  <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">임의계속가입 ({retirementAge}~65세, {ageToYear(retirementAge)}~{ageToYear(65)})</span>
                        <p className="text-2xs text-zinc-400 mt-0.5">{65 - retirementAge}년 납부 가능 — 수령액 증가</p>
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
                          <p className={`text-2xs mt-0.5 ${npsVoluntaryMonthly >= calc.npsOptimalMonthly ? 'text-accent' : 'text-zinc-400'}`}>
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
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">수령나이별 월수령액 (선택 강조)</p>
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
                      <span className="text-zinc-400"> ({unavailable.join(', ')}은 공백기 시작 시점 불가)</span>
                    )}
                  </div>
                )
              })()}
              {/* ── 결과 ── */}
              <div className="card-inner p-3 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500">
                    앱 확인값 (60세 납부 기준)
                    <span className="ml-1 text-zinc-500 dark:text-zinc-400">({npsDate} 기준)</span>
                    {npsBase !== NPS_BASE && <span className="ml-1 tag tag-tonal text-2xs">갱신됨</span>}
                  </span>
                  <span className="text-xs text-zinc-700 dark:text-zinc-300 tabular-nums">{Math.round(npsBase / 10000)}만원/월</span>
                </div>
                {retirementAge < 60 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500">{retirementAge}세({ageToYearMonth(retirementAge)}) 퇴직, 임의계속 없음</span>
                    <span className="text-xs text-zinc-500 tabular-nums">{Math.round(calc.npsAtRetire65 / 10000)}만원/월</span>
                  </div>
                )}
                {retirementAge < 65 && npsVoluntaryCont && calc.npsEffective65 !== calc.npsAtRetire65 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500">임의계속가입 후 65세({ageToYear(65)}) 기준</span>
                    <span className="text-xs text-zinc-500 tabular-nums">{Math.round(calc.npsEffective65 / 10000)}만원/월</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500">{npsReceiptAge}세({ageToYearMonth(npsReceiptAge)}) 수령 시</span>
                  <span className="text-sm text-accent tabular-nums">{Math.round(calc.npsMonthly / 10000)}만원/월</span>
                </div>
                {npsReceiptAge < 65 && <p className="text-xs" style={{ color: 'var(--tag-amber-fg)' }}>조기수령 {(65 - npsReceiptAge) * 6}% 감액</p>}
                {npsReceiptAge > 65 && <p className="text-xs" style={{ color: 'var(--tag-green-fg)' }}>연기수령 +{((npsReceiptAge - 65) * 7.2).toFixed(1)}% 가산</p>}
                {retirementAge < 65 && !npsVoluntaryCont && (
                  <p className="text-xs text-zinc-400">임의계속가입 미신청 → {Math.round(calc.npsAtRetire65 / 10000)}만원/월 ({Math.round((1 - calc.npsAtRetire65 / npsBase) * 100)}% 감소)</p>
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
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">신청 시점 (만 55세 이상)</label>
                    <button
                      onClick={() => setHousePensionTiming('retire')}
                      className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${housePensionTiming === 'retire' ? 'bg-accent' : 'surface-subtle border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-200'}`}
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
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">신청나이별 월수령액 · 시가(KB시세/실거래가) {housePrice}억 기준</p>
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
                  <span className="text-zinc-500">{calc.effectiveHpAge}세({ageToYearMonth(calc.effectiveHpAge)}) 신청 시 월수령액</span>
                  <span className="text-accent tabular-nums font-semibold">{Math.round(calc.housePensionMonthly / 10000)}만원/월</span>
                </div>
                <div className="text-zinc-400">
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
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                잔액 {fmtEok(calc.currentMortgage)}
              </span>
            }
          >
            <div className="space-y-2">
              {/* 그래프 맨 위 */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">나이별 잔여 원금 추이 (현재 잔액 기준)</p>
                  <OcrBtn item="mortgage" title="주담대 대출 현황" hint="은행 앱의 대출 상세 화면을 업로드하세요. 현재 잔여원금과 대출 개시일을 인식합니다." />
                </div>
                <MortgageMiniChart currentBalance={mortgageCurrentBalance} remainingMonths={calc.mortgageRemainingMonths} />
              </div>

              {/* 설정 2열 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">현재 잔여원금</span>
                    <span className="text-2xs text-zinc-400">({mortgageBalanceDate})</span>
                    {mortgageCurrentBalance !== MORTGAGE_BALANCE_DEFAULT && <span className="tag tag-tonal text-2xs">갱신됨</span>}
                  </div>
                  <StepField
                    label={`≈ ${fmtEok(mortgageCurrentBalance)}`}
                    value={Math.round(mortgageCurrentBalance / 10000)} step={500} min={0} max={100000} unit="만원"
                    onChange={v => setMortgageCurrentBalance(v * 10000)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
                    대출 개시일
                  </label>
                  <input
                    type="date"
                    value={mortgageStartDate}
                    onChange={e => setMortgageStartDate(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-xs tabular-nums text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-accent"
                  />
                  {mortgageStartDate && (
                    <p className="text-xs text-zinc-400 mt-0.5">경과 {calc.mortgageElapsedMonths}개월 · 잔여 {calc.mortgageRemainingMonths}개월</p>
                  )}
                </div>
              </div>

              {/* 결과 2열 */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="card-inner px-3 py-2">
                  <div className="text-zinc-500 dark:text-zinc-400 mb-0.5">월 상환액</div>
                  <div className="text-zinc-700 dark:text-zinc-300 tabular-nums font-semibold">{Math.round(calc.mortgagePaymentMonthly / 10000)}만원/월</div>
                </div>
                <div className="card-inner px-3 py-2">
                  <div className="text-zinc-500 dark:text-zinc-400 mb-0.5">완납 예정</div>
                  <div className="text-accent tabular-nums font-semibold">{calc.mortgagePaidOffAge}세 ({BIRTH_YEAR + calc.mortgagePaidOffAge}년)</div>
                </div>
              </div>
              {calc.mortgagePaidOffAge > retirementAge && (
                <div className="notice notice-amber text-xs">
                  내 은퇴(만 {retirementAge}세, {ageToYearMonth(retirementAge)}) 후에도 <strong>{calc.mortgagePaidOffAge - retirementAge}년({calc.mortgagePaidOffAge}세까지)</strong> 상환 계속 —
                  월 {Math.round(calc.mortgagePaymentMonthly / 10000)}만원 지출 유지
                </div>
              )}
              <div className="text-xs text-zinc-400 surface-subtle rounded-lg px-3 py-2">
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
                ? <span className="text-xs text-zinc-400">미개설</span>
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
                    <span className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">포트폴리오 연동 잔액 (IRP)</span>
                    <span className="text-sm text-accent tabular-nums">
                      {Math.round(personalIrpBalance / 10000).toLocaleString()}만원
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">운용 수익률 (자동)</span>
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
                <div className="card-inner px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                  미개설 — 포트폴리오에 IRP 계좌 추가 시 자동연동됩니다.
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
                  월납입액 (만원)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={5}
                  value={personalIrpMonthly}
                  onChange={e => setPersonalIrpMonthly(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm tabular-nums text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-accent"
                />
              </div>
              {(irpLoaded || personalIrpMonthly > 0) && (
                <div className="card-inner p-3 space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500">60세({ageToYear(60)}) 예상잔액</span>
                    <span className="text-xs text-accent tabular-nums">
                      {fmtEok(calc.personalIrpAt60)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500">월 수령액 (20년)</span>
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
                <div className="shadow-xl rounded-xl border border-zinc-200 dark:border-zinc-700 pointer-events-none card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 surface-subtle">
                    <GripVertical size={13} className="text-zinc-300 dark:text-zinc-600" />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
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
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 px-1">AI 은퇴 시나리오</h2>
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
