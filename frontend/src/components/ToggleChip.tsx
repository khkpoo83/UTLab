import React from 'react'

export type ChipSize = 'xs' | 'sm' | 'md'

export interface ToggleChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  size?: ChipSize
  pill?: boolean       // rounded-full (섹터 필터 등) vs rounded-lg (기본)
  icon?: React.ReactNode
  count?: number | string
}

const SIZE: Record<ChipSize, string> = {
  xs: 'px-2 py-0.5 text-xs gap-1',
  sm: 'h-6 px-2.5 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-xs gap-1.5',
}

const ACTIVE   = 'bg-accent border border-transparent'
const INACTIVE = 'surface border border-ink-5 text-ink-3 hover:border-ink-5 hover:text-ink-1'

const ToggleChip: React.FC<ToggleChipProps> = ({
  active = false,
  size = 'md',
  pill = false,
  icon,
  count,
  children,
  className = '',
  style,
  ...props
}) => (
  <button
    {...props}
    style={active ? { color: 'white', ...style } : style}
    className={[
      'inline-flex items-center justify-center font-medium transition-colors',
      SIZE[size],
      pill ? 'rounded-full' : 'rounded-lg',
      active ? ACTIVE : INACTIVE,
      className,
    ].filter(Boolean).join(' ')}
  >
    {icon && <span className="flex-shrink-0">{icon}</span>}
    {children}
    {count != null && (
      <span className="opacity-60">({count})</span>
    )}
  </button>
)

export default ToggleChip
