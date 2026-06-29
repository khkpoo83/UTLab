interface RangeFieldProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /** 우측 값 표시 (없으면 value 그대로) */
  display?: React.ReactNode
  /** 라벨 폭 (px) */
  labelWidth?: number
}

/** label + range 슬라이더 + 값 표시 한 세트 */
export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  display,
  labelWidth = 64,
}: RangeFieldProps) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-ink-3 flex-shrink-0" style={{ width: labelWidth }}>
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        style={{ cursor: 'pointer', accentColor: 'var(--c-accent)' }}
      />
      <span className="text-xs text-ink-4 w-12 text-right tabular-nums">{display ?? value}</span>
    </div>
  )
}

export default RangeField
