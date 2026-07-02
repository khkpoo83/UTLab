// Retirement-planner mini charts (roadmap Phase 3, P3-3). Extracted verbatim
// from pages/Planner.tsx — pure presentational Recharts components driven by
// the finance calculations. getAccentRgb / AgeTick are module-internal helpers.
import {
  AreaChart, BarChart, Bar, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import {
  CHART_TOOLTIP_STYLE, CHART_TOOLTIP_LABEL_STYLE, CHART_TOOLTIP_ITEM_STYLE, CHART_CURSOR_STYLE,
} from '../../utils/chart'
import {
  ageToYear, ageToYearMonth, CURRENT_AGE, fmtEok,
  calcPrivatePensionMonthly, calcISAFuture, calcISA2Future, calcDcIrpAtAge,
  npsApplyReceiptAge, calcHousingPension, calcMortgageFutureBalance,
} from './finance'

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
export function PrivatePensionMiniChart({ ppDetails, rate }: { ppDetails: { current: number; startAge: number; monthlyContrib?: number; paidOffYM?: string | null }[]; rate: number }) {
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
export function ISAMiniChart({
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
export function DCMiniChart({ rate, retirementAge, monthlyContrib, currentBalance }: { rate: number; retirementAge: number; monthlyContrib: number; currentBalance: number }) {
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
export function NPSMiniChart({ selectedAge, effectiveBase65 }: { selectedAge: number; effectiveBase65: number }) {
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
export function HousingPensionMiniChart({ housePrice, selectedAge, mortgageBalance }: { housePrice: number; selectedAge: number; mortgageBalance?: number }) {
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
export function MortgageMiniChart({ currentBalance, remainingMonths }: { currentBalance: number; remainingMonths: number }) {
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
