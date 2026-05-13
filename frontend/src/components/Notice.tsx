import React from 'react'

type NoticeVariant = 'accent' | 'amber' | 'zinc' | 'red'

interface NoticeProps {
  variant?: NoticeVariant
  children: React.ReactNode
  className?: string
  icon?: React.ReactNode
}

/**
 * 알림 박스 컴포넌트.
 * index.css의 .notice .notice-{variant} 유틸리티 클래스를 React 컴포넌트로 래핑.
 */
export default function Notice({ variant = 'zinc', children, className = '', icon }: NoticeProps) {
  return (
    <div className={`notice notice-${variant} ${className}`}>
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span>{children}</span>
    </div>
  )
}
