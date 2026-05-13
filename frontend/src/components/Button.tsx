import React from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'tint'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  loadingText?: string
  icon?: React.ReactNode
  iconRight?: React.ReactNode
  fullWidth?: boolean
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:   'bg-accent text-white hover:opacity-85',
  secondary: 'surface border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-800 dark:hover:text-zinc-100',
  ghost:     'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200',
  danger:    'surface border border-red-300 dark:border-red-700 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30',
  tint:      'bg-accent/10 text-accent hover:bg-accent/20',
}

const SIZE: Record<ButtonSize, string> = {
  xs: 'px-2 py-0.5 text-2xs rounded gap-1',
  sm: 'h-6 px-2.5 text-xs rounded-lg gap-1.5',
  md: 'px-3 py-1.5 text-xs rounded-lg gap-1.5',
  lg: 'px-4 py-2 text-sm rounded-lg gap-2',
}

const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingText,
  icon,
  iconRight,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...props
}) => (
  <button
    {...props}
    disabled={disabled || loading}
    className={[
      'inline-flex items-center justify-center font-medium transition-colors',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      VARIANT[variant],
      SIZE[size],
      fullWidth ? 'w-full' : '',
      className,
    ].filter(Boolean).join(' ')}
  >
    {icon && <span className="flex-shrink-0">{icon}</span>}
    {loading ? (loadingText ?? children) : children}
    {iconRight && <span className="flex-shrink-0">{iconRight}</span>}
  </button>
)

export default Button
