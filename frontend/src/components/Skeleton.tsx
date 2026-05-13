import React from 'react'

interface SkeletonProps {
  className?: string
  lines?: number
}

const Skeleton: React.FC<SkeletonProps> = ({ className = '', lines = 1 }) => {
  if (lines === 1) {
    return <div className={`skeleton ${className}`} />
  }
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`skeleton h-4 rounded ${i === lines - 1 ? 'w-3/4' : 'w-full'} ${className}`}
        />
      ))}
    </div>
  )
}

export const SkeletonRow: React.FC<{ cols?: number }> = ({ cols = 6 }) => (
  <tr>
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} className="py-2.5 px-3">
        <div className="skeleton h-4 rounded w-full" />
      </td>
    ))}
  </tr>
)

export default Skeleton
