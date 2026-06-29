/**
 * RangeSlider — 나이/값 범위 슬라이더 공통 컴포넌트
 * Planner.tsx의 AgeRangeSlider에서 추출하여 일반화.
 *
 * - 현재 값이 슬라이더 위 floating 뱃지로 표시
 * - 눈금 클릭으로 값 직접 이동
 * - accent 색상 테마 적용
 */
interface RangeSliderProps {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  /** floating 뱃지에 붙는 레이블 (예: "세") */
  label?: string
  /** 눈금 표시 간격 (기본: 5) */
  tickInterval?: number
  /** 단위 문자열 (기본: "") */
  unit?: string
}

export default function RangeSlider({
  value, min, max, onChange, label, tickInterval = 5, unit = '',
}: RangeSliderProps) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div>
      {/* 선택된 값 — 슬라이더 위, 썸 위치에 floating */}
      <div className="relative h-6 mb-0.5">
        <span
          className="absolute -translate-x-1/2 px-1.5 py-0.5 rounded bg-accent text-white text-xs font-semibold tabular-nums whitespace-nowrap"
          style={{ left: `${pct}%` }}
        >
          {value}{unit}{label ? ` (${label})` : ''}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="age-slider w-full cursor-pointer"
        style={{ '--slider-pct': `${pct}%` } as React.CSSProperties}
      />
      {/* 눈금자 */}
      <div className="relative mt-1" style={{ height: 18 }}>
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(v => {
          const p = ((v - min) / (max - min)) * 100
          const isSel = v === value
          const showTick = v === min || v === max || v % tickInterval === 0
          const showLabel = (v === min || v === max || v % tickInterval === 0) && !isSel
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              title={`${v}${unit}`}
              className="absolute -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${p}%` }}
            >
              {(showTick || isSel) && (
                <span className={`block w-0.5 rounded-full ${isSel ? 'h-2.5 bg-accent' : 'h-1.5 bg-zinc-300 dark:bg-zinc-600'}`} />
              )}
              {showLabel && (
                <span className="text-2xs tabular-nums text-ink-4">{v}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
