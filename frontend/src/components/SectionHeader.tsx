import React from 'react'

interface SectionHeaderProps {
  title: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  count?: number
  right?: React.ReactNode
  className?: string
}

/** 섹션 행 헤더 (아이콘 + 제목 + 뱃지/개수 + 우측 액션) */
export default function SectionHeader({
  title,
  icon,
  badge,
  count,
  right,
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`flex items-center justify-between mb-3 ${className}`}>
      <div className="flex items-center gap-2">
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</h3>
        {badge && <span>{badge}</span>}
        {count !== undefined && (
          <span className="tag tag-zinc">{count}</span>
        )}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  )
}
