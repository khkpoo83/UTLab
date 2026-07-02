// Retirement-planner snapshot computation (roadmap Phase 3, P3-3 deep decomposition).
// Extracted verbatim from the Planner `calc = useMemo(...)` body into a pure,
// testable function. The page calls it inside useMemo with the same deps.
import {
  BIRTH_YEAR, CURRENT_AGE, CURRENT_YEAR, MORTGAGE_MONTHS, PRIVATE_PENSIONS, ageToYear,
  calcISAFuture, calcDcIrpAtAge, calcIRPMonthly, npsMonthsTo, npsPeriodFactor,
  calcPersonalIrpAtAge, calcHousingPension, calcMortgagePaymentMonthly, npsApplyReceiptAge,
  calcPrivatePensionMonthly, calcPrivatePensionAtStart, calcISAMonthlyDrawdown,
} from './finance'

export interface PlannerCalcInputs {
  retirementAge: number
  isaBalance: number
  isaMonthly: number
  isaRate: number
  dcRate: number
  dcMonthly: number
  dcIrpBalance: number
  dcPayoutYears: number
  npsBase: number
  npsReceiptAge: number
  npsVoluntaryCont: boolean
  npsVoluntaryMonthly: number
  personalIrpMonthly: number
  personalIrpRate: number
  personalIrpBalance: number
  housePrice: number
  housePensionTiming: 'retire' | number
  mortgageCurrentBalance: number
  mortgageStartDate: string
  mortgageBalanceDate: string
  payoutYears: number
  privatePensionRate: number
  ppStartAges: number[]
  ppBalances: Record<number, number>
}

export function computePlannerSnapshot(input: PlannerCalcInputs) {
  const {
    retirementAge, isaBalance, isaMonthly, isaRate, dcRate, dcMonthly, dcIrpBalance, dcPayoutYears,
    npsBase, npsReceiptAge, npsVoluntaryCont, npsVoluntaryMonthly,
    personalIrpMonthly, personalIrpRate, personalIrpBalance,
    housePrice, housePensionTiming, mortgageCurrentBalance, mortgageStartDate, mortgageBalanceDate,
    payoutYears, privatePensionRate, ppStartAges, ppBalances,
  } = input
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
}
