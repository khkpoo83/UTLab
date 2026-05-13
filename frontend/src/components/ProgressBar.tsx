interface ProgressBarProps {
  /** 0~100 */
  value: number
  height?: 'sm' | 'md'
  /** 값에 따라 opacity 변화 (AI 사용량 등에 활용) */
  dimWhenLow?: boolean
  className?: string
}

/**
 * 진행률 바 컴포넌트.
 * - 배경: bg-zinc-100 dark:bg-zinc-800
 * - 채움: bg-accent (dimWhenLow 시 opacity 가변)
 */
export default function ProgressBar({ value, height = 'sm', dimWhenLow = false, className = '' }: ProgressBarProps) {
  const h = height === 'sm' ? 'h-1' : 'h-2'
  const pct = Math.min(100, Math.max(0, value))
  const opacityCls = dimWhenLow
    ? pct > 66 ? 'opacity-100' : pct > 33 ? 'opacity-70' : 'opacity-40'
    : 'opacity-100'

  return (
    <div className={`${h} bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden ${className}`}>
      <div
        className={`${h} rounded-full bg-accent transition-all duration-500 ${opacityCls}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
