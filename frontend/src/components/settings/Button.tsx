import React from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** 로딩 중이면 disabled + 라벨을 loadingLabel로 대체 */
  loading?: boolean
  loadingLabel?: string
  /** 좌측 아이콘 */
  icon?: React.ReactNode
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2 text-sm',
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-85 shadow-sm',
  secondary:
    'border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800',
  danger:
    'border border-red-300 dark:border-red-700 bg-white dark:bg-zinc-900 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30',
  ghost: 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200',
}

/** 설정 전반의 액션 버튼 — 스타일 단일화 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  icon,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`}
      {...props}
    >
      {icon}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  )
}

export default Button
