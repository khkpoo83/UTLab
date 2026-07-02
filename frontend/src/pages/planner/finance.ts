// Retirement-planner finance constants + pure calculation functions
// (roadmap Phase 3, P3-3). Extracted verbatim from pages/Planner.tsx to shrink
// that god-component. No React/state — pure numbers only.

// ─── 상수 ────────────────────────────────────────────────────────────────────

export const BIRTH_YEAR = 1983
export const BIRTH_MONTH = 4         // 4월생 (1-based)
const _now = new Date()
export const CURRENT_YEAR = _now.getFullYear()
export const CURRENT_MONTH = _now.getMonth() + 1  // 1-based
export const CURRENT_AGE = CURRENT_YEAR - BIRTH_YEAR - (CURRENT_MONTH < BIRTH_MONTH ? 1 : 0)
/** 현재까지 살아온 개월 수 (생일 기준 정밀 계산) */
export const CURRENT_AGE_MONTHS = (CURRENT_YEAR - BIRTH_YEAR) * 12 + (CURRENT_MONTH - BIRTH_MONTH)

/** 해당 나이가 되는 연도 */
export const ageToYear = (age: number) => BIRTH_YEAR + age
/** 해당 나이가 되는 연도.월 (예: "2031.04") */
export const ageToYearMonth = (age: number) => `${BIRTH_YEAR + age}.${String(BIRTH_MONTH).padStart(2, '0')}`

export const NPS_BASE = 1_584_470           // 기준: 2026-01-01 국민연금공단 예상수령액(65세)
export const NPS_BASE_DATE = '2026-01-01'   // ← 국민연금 앱에서 확인 후 업데이트
// 국민연금 가입 시작 (입사 첫 달) — 2010.04 확인 (카카오 스크린샷)
export const NPS_JOIN_YEAR = 2010
export const NPS_JOIN_MONTH = 4             // 4월 (1-based)

export const DC_IRP_CURRENT = 39_060_006    // 기준: 2026-03-31 하나증권 DC IRP 평가금액 (납입원금 36,571,032 / 수익률 6.81% / 가입: 2025-03-18 (주)액셈)
export const DC_IRP_DATE = '2026-03-31'     // ← 하나증권 앱에서 확인 후 업데이트

// 기준: 2026-03-01 각 보험사 앱 확인 (스크린샷 업로드로 업데이트 가능)
// monthlyContrib: 월 납입액(원), 0이면 완납 / paidOffYM: 납입완료 연월 "YYYY-MM"
export const PRIVATE_PENSIONS = [
  { name: '삼성 이글루 B1.2', current: 18_942_448, startAge: 56, monthlyContrib: 100_000, paidOffYM: '2027-02', date: '2026-03-01' },
  { name: '삼성 이글루 B1.5', current: 17_163_295, startAge: 56, monthlyContrib: 100_000, paidOffYM: '2028-03', date: '2026-03-01' },
  { name: '삼성 인다이NEW (연금저축)', current: 2_919_361, startAge: 60, monthlyContrib: 300_000, paidOffYM: '2035-02', date: '2026-03-01' },
  { name: '교보 Fund변액',    current: 21_835_480, startAge: 59, monthlyContrib: 0, paidOffYM: null, date: '2026-03-01' },
  // 삼성 2-Step변액 — 2026-04-01 해지 완료, 제거됨
]

export const HOUSING_PENSION_RATES: Record<number, number> = {
  50: 11.3, 51: 11.8, 52: 12.3, 53: 12.8, 54: 13.3,
  55: 15.3, 56: 15.9, 57: 16.5, 58: 17.2, 59: 17.9,
  60: 18.7, 61: 19.5, 62: 20.3, 63: 21.0, 64: 21.8,
  65: 23.0,
}

// 주담대: MORTGAGE_BALANCE_DEFAULT는 현재 잔액(원) - 원금(최초 대출액)이 아님
export const MORTGAGE_BALANCE_DEFAULT = 242_390_000  // 2026-03-01 기준 현재 잔여원금
export const MORTGAGE_BALANCE_DATE = '2026-03-01'
export const MORTGAGE_RATE_ANNUAL = 0.0253
export const MORTGAGE_MONTHS = 360  // 전체 대출 기간 (30년, 2020-03-09 개시)

export const DC_IRP_RATE_DEFAULT = 7.0    // % (조정 가능)
export const DC_IRP_MONTHLY_DEFAULT = 50  // 만원/월 (회사기여금 기본값, 조정 가능)

// ISA 2번째 계좌 (2026년 6월 개설 예정 - 국내주식 위주)
export const ISA2_START_OFFSET_MONTHS = 3 // 현재(3월)로부터 3개월 후 6월 개설

// ─── 금액 포맷 헬퍼 ──────────────────────────────────────────────────────────

/** 원 단위 숫자를 가독성 있게 표시: 1억 이상 → X.XX억, 미만 → X,XXX만원 */
export function fmtEok(won: number): string {
  if (Math.abs(won) >= 1e8) return (won / 1e8).toFixed(2) + '억'
  return Math.round(won / 1e4).toLocaleString('ko-KR') + '만원'
}

// ─── 계산 함수들 ──────────────────────────────────────────────────────────────

export function calcISAFuture(
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
export function calcMortgagePaymentMonthly(currentBalance: number, remainingMonths: number): number {
  if (remainingMonths <= 0) return 0
  const r = MORTGAGE_RATE_ANNUAL / 12
  return currentBalance * r * Math.pow(1 + r, remainingMonths) / (Math.pow(1 + r, remainingMonths) - 1)
}

// 현재 잔액에서 k개월 후 잔액 (forward projection)
export function calcMortgageFutureBalance(currentBalance: number, remainingMonths: number, monthsFromNow: number): number {
  if (monthsFromNow >= remainingMonths) return 0
  const r = MORTGAGE_RATE_ANNUAL / 12
  const monthlyPayment = calcMortgagePaymentMonthly(currentBalance, remainingMonths)
  const bal = currentBalance * Math.pow(1 + r, monthsFromNow) - monthlyPayment * ((Math.pow(1 + r, monthsFromNow) - 1) / r)
  return Math.max(0, bal)
}

export function calcHousingPension(applyAge: number, housePriceWon: number, mortgageBalanceWon: number = 0): number {
  const clampedAge = Math.max(55, Math.min(65, applyAge))
  const rate = HOUSING_PENSION_RATES[clampedAge] ?? 15.3
  // 실제 규정: 주금공이 주담대 잔액 일시상환 후 남은 순자산 기준으로 연금 지급
  const effectiveEquityEok = Math.max(0, (housePriceWon - mortgageBalanceWon) / 1e8)
  return Math.round(effectiveEquityEok * rate * 10_000)
}

// 사적연금 소득세율 (연금소득세): 55~70세 5.5%, 70~80세 4.4%, 80세+ 3.3%
export function calcPensionTaxRate(startAge: number, payoutYears: number): number {
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

export function calcDcIrpAtAge(
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

export function calcPersonalIrpAtAge(
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

export function calcPrivatePensionAtStart(
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

export function calcPrivatePensionMonthly(
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

export function calcISA2Future(targetAge: number, monthlyContrib: number, annualRate: number): number {
  // 2026년 6월 개설 → 현재(2026년 3월)로부터 3개월 후 시작
  const months = Math.max(0, targetAge * 12 - CURRENT_AGE_MONTHS - ISA2_START_OFFSET_MONTHS)
  if (months <= 0) return 0
  const r = annualRate / 12
  return r === 0 ? monthlyContrib * months : monthlyContrib * ((Math.pow(1 + r, months) - 1) / r)
}

/** 가입 시작(NPS_JOIN)부터 targetAge까지 납부 개월 수
 *  퇴직/수령 시점은 항상 생일월(BIRTH_MONTH)이므로 정밀 계산
 */
export function npsMonthsTo(targetAge: number): number {
  const months = (BIRTH_YEAR + targetAge - NPS_JOIN_YEAR) * 12 + (BIRTH_MONTH - NPS_JOIN_MONTH)
  return Math.max(0, months)
}

/** 국민연금 가입기간 급여 계수: 20년(240개월) 미만이면 비례, 이상이면 가산 */
export function npsPeriodFactor(months: number): number {
  if (months >= 240) return 1.0 + 0.05 * (months - 240) / 12
  return months / 240
}

/** base65: 65세 기준 수령액 (임의계속 보정 후) → receiptAge 조정 적용 */
export function npsApplyReceiptAge(base65: number, receiptAge: number): number {
  if (receiptAge < 65) return Math.round(base65 * (1 - 0.06 * (65 - receiptAge)))
  if (receiptAge > 65) return Math.round(base65 * (1 + 0.072 * (receiptAge - 65)))
  return Math.round(base65)
}

export function calcISAMonthlyDrawdown(isaBalance: number, fromAge: number, toAge: number): number {
  const months = Math.max(1, (toAge - fromAge) * 12)
  return isaBalance / months
}

export function calcIRPMonthly(irpBalance: number, payoutYears = 20): number {
  return irpBalance / (payoutYears * 12)
}
