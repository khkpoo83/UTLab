import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// ── 유틸: 마지막 업데이트 시각 포맷 ─────────────────────────────────────────
export function fmtUpdated(d: Date | null | undefined): string {
  if (!d) return ''
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' 기준'
}

// ── Props ────────────────────────────────────────────────────────────────────
interface CardProps {
  /** localStorage 키 접두사 — collapsible 사용 시 필수 */
  id?: string
  /** 헤더 아이콘 */
  icon?: React.ReactNode
  /** 헤더 제목 */
  title: string
  /** 제목 옆 보조 텍스트 (업데이트 시각 등) */
  subtitle?: string
  /** 헤더 우측 커스텀 영역 */
  right?: React.ReactNode
  /** DnD 핸들 — SortableItem에서 주입 */
  dragHandle?: React.ReactNode
  /** true: 접기/펼치기 가능 (ChevronDown) */
  collapsible?: boolean
  /** collapsible일 때 초기 상태 (기본 true) */
  defaultOpen?: boolean
  /** 설정 시 카드 전체 클릭 가능 + ChevronRight 표시 */
  onClick?: () => void
  children: React.ReactNode
  className?: string
  /** 콘텐츠 영역 className (기본 'p-4') */
  contentClassName?: string
  /** 카드 최소 높이 (px) — 높이 조절용 */
  minH?: number
  /** 카드 루트 인라인 스타일 */
  style?: React.CSSProperties
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────
export function Card({
  id,
  icon,
  title,
  subtitle,
  right,
  dragHandle,
  collapsible = false,
  defaultOpen = true,
  onClick,
  children,
  className = '',
  contentClassName = 'px-6 py-5',
  minH,
  style,
}: CardProps) {
  const storageKey = id ? `cc_${id}` : null

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (!collapsible) return true
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey)
        return saved !== null ? saved === 'true' : defaultOpen
      } catch {}
    }
    return defaultOpen
  })

  const toggle = () => {
    const next = !isOpen
    setIsOpen(next)
    if (storageKey) {
      try { localStorage.setItem(storageKey, String(next)) } catch {}
    }
  }

  const headerStyle: React.CSSProperties = {
    padding: '14px 20px',
    borderBottom: isOpen ? '1px solid var(--line, #E8E7E2)' : 'none',
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    textAlign: 'left' as const,
  }

  const headerInner = (
    <>
      {/* 좌측: 드래그 핸들 + 아이콘 + 제목 + 보조 텍스트 */}
      <div className="flex items-center gap-2 min-w-0">
        {dragHandle}
        {icon && (
          <span style={{ color: 'var(--ink-4)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
        )}
        <span className="ut-eyebrow truncate" style={{ color: 'var(--ink-0)' }}>
          {title}
        </span>
        {subtitle && (
          <span className="ut-mono flex-shrink-0" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{subtitle}</span>
        )}
      </div>

      {/* 우측: 커스텀 영역 + 토글/네비게이션 화살표 */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {right && (
          <div
            className="flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {right}
          </div>
        )}
        {collapsible && (
          <ChevronDown
            size={15}
            style={{
              color: 'var(--ink-4)',
              flexShrink: 0,
              transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 200ms',
            }}
          />
        )}
        {!collapsible && onClick && (
          <ChevronRight size={12} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
        )}
      </div>
    </>
  )

  return (
    <div
      className={`card-surface overflow-hidden flex flex-col ${
        !collapsible && onClick ? 'cursor-pointer transition-colors' : ''
      } ${className}`}
      onClick={!collapsible && onClick ? onClick : undefined}
      style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        boxShadow: '0 1px 2px rgba(10,10,11,0.04)',
        ...(minH ? { minHeight: minH } : {}),
        ...style,
      }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          style={headerStyle}
        >
          {headerInner}
        </button>
      ) : (
        <div style={headerStyle}>
          {headerInner}
        </div>
      )}

      {isOpen && (
        <div className={`flex-1 ${contentClassName}`}>{children}</div>
      )}
    </div>
  )
}

export default Card
