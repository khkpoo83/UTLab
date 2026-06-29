/**
 * StepField — [레이블] ···· [− 값 +] 공통 스텝 입력 컴포넌트
 * Planner.tsx에서 추출하여 재사용 가능하도록 공통화.
 */
interface StepFieldProps {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  unit?: string
  hint?: string
}

export default function StepField({
  label, value, onChange, step = 10, min = 0, max = 9999, unit = '만원', hint,
}: StepFieldProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-ink-2">{label}</span>
        {hint && <p className="text-2xs text-ink-4 mt-0.5">{hint}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))}
          className="w-6 h-6 rounded-md surface-subtle border border-ink-5 text-ink-3 hover:bg-accent/10 hover:text-accent text-sm font-bold flex items-center justify-center transition-colors"
        >−</button>
        <input
          type="number" min={min} max={max} step={step} value={value}
          onChange={e => { const v = Math.min(max, Math.max(min, Number(e.target.value))); onChange(v) }}
          className="w-16 text-center px-1 py-0.5 rounded-md border border-ink-5 bg-white dark:bg-zinc-800 text-sm tabular-nums text-accent font-semibold focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))}
          className="w-6 h-6 rounded-md surface-subtle border border-ink-5 text-ink-3 hover:bg-accent/10 hover:text-accent text-sm font-bold flex items-center justify-center transition-colors"
        >+</button>
        <span className="text-xs text-ink-4 w-8">{unit}</span>
      </div>
    </div>
  )
}
