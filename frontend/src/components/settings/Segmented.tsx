interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
}

interface SegmentedProps<T extends string> {
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
  /** 가로 꽉 채우기 (각 세그먼트 균등 분할) */
  full?: boolean
}

/** 2~5지선다 통일 컨트롤 — 토글 트랙 위 알약형 세그먼트 */
export function Segmented<T extends string>({ value, options, onChange, full = false }: SegmentedProps<T>) {
  return (
    <div className={`inline-flex p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 gap-0.5 ${full ? 'w-full' : ''}`}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${full ? 'flex-1' : ''} ${
              active
                ? 'bg-white dark:bg-zinc-900 shadow-sm'
                : 'text-ink-3 hover:text-ink-1'
            }`}
            style={active ? { color: 'var(--c-accent)' } : {}}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default Segmented
