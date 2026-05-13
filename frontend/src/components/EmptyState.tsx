import React from 'react'

interface EmptyStateProps {
  message: string
  hint?: string
  className?: string
}

const EmptyState: React.FC<EmptyStateProps> = ({ message, hint, className = '' }) => (
  <div className={`flex flex-col items-center justify-center py-8 gap-1 ${className}`}>
    <p className="text-sm text-zinc-400">{message}</p>
    {hint && <p className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</p>}
  </div>
)

export default EmptyState
