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
  contentClassName = 'p-4',
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

  // 헤더 배경: 열려 있거나 비-collapsible이면 accent 틴트
  const isActive = !collapsible || isOpen
  const headerBg = isActive
    ? 'bg-accent/5 dark:bg-accent/10 border-b border-zinc-100 dark:border-zinc-700'
    : 'bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700'

  const headerInner = (
    <>
      {/* 좌측: 드래그 핸들 + 아이콘 + 제목 + 보조 텍스트 */}
      <div className="flex items-center gap-2 min-w-0">
        {dragHandle}
        {icon && (
          <span className="text-zinc-400 dark:text-zinc-500 flex-shrink-0">{icon}</span>
        )}
        <span className="card-header-text text-sm font-semibold text-zinc-700 dark:text-zinc-300 truncate">
          {title}
        </span>
        {subtitle && (
          <span className="card-header-sub text-2xs text-zinc-400 flex-shrink-0">{subtitle}</span>
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
            className={`transition-transform duration-200 flex-shrink-0 ${
              isOpen
                ? 'rotate-0 text-accent'
                : '-rotate-90 text-zinc-400 dark:text-zinc-500'
            }`}
          />
        )}
        {!collapsible && onClick && (
          <ChevronRight size={12} className="text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
        )}
      </div>
    </>
  )

  return (
    <div
      className={`card-surface border rounded-xl overflow-hidden shadow-sm dark:shadow-zinc-950/40 flex flex-col ${
        !collapsible && onClick
          ? 'cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors'
          : ''
      } ${className}`}
      onClick={!collapsible && onClick ? onClick : undefined}
      style={{ ...(minH ? { minHeight: minH } : {}), ...style }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          className={`w-full flex items-center justify-between gap-2 px-4 py-3 text-left transition-colors ${headerBg}`}
        >
          {headerInner}
        </button>
      ) : (
        <div className={`flex items-center justify-between gap-2 px-4 py-3 ${headerBg}`}>
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
