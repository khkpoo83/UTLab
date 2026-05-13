interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

export function LoadingSpinner({ size = 'md', className = '', label }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-2',
  }
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <div
        className={`${sizeClasses[size]} rounded-full border-zinc-200 dark:border-zinc-700 border-t-accent animate-spin`}
        role="status"
        aria-label={label ?? '로딩 중'}
      />
      {label && <span className="text-xs text-zinc-400">{label}</span>}
    </div>
  )
}

interface ErrorMessageProps {
  message?: string
  detail?: string
  onRetry?: () => void
  className?: string
}

export function ErrorMessage({
  message = '오류가 발생했습니다.',
  detail,
  onRetry,
  className = '',
}: ErrorMessageProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-8 text-center ${className}`}>
      <svg
        className="w-8 h-8 text-zinc-300 dark:text-zinc-600"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        />
      </svg>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
      {detail && <p className="text-xs text-zinc-400 dark:text-zinc-500">{detail}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 hover:border-zinc-400 transition-colors"
        >
          다시 시도
        </button>
      )}
    </div>
  )
}
