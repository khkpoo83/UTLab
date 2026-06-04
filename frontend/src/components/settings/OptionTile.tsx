import React from 'react'

interface OptionTileProps {
  active: boolean
  onClick: () => void
  /** 상단 미리보기 노드 (아이콘/스와치/SVG 등) */
  preview?: React.ReactNode
  label?: React.ReactNode
  desc?: React.ReactNode
  /** 활성 테두리/텍스트 색 오버라이드 (색상 프리셋 등). 없으면 테마 accent */
  accentColor?: string
  title?: string
  className?: string
  /** 가로 배치 (아이콘/스와치 + 라벨 한 줄) */
  row?: boolean
  /** label/desc 구조 대신 완전 커스텀 콘텐츠 */
  children?: React.ReactNode
}

/**
 * 설정 전반의 단일 선택 타일.
 * 활성 표현을 한 종류로 통일: 항상 border-2 사용(레이아웃 시프트 방지),
 * 활성 시 accent 테두리 + 옅은 accent 배경 + accent 텍스트.
 */
export function OptionTile({
  active,
  onClick,
  preview,
  label,
  desc,
  accentColor,
  title,
  className = '',
  row = false,
  children,
}: OptionTileProps) {
  const style: React.CSSProperties = active
    ? {
        borderColor: accentColor ?? 'var(--c-accent)',
        backgroundColor: accentColor ? `${accentColor}14` : 'rgb(var(--c-accent-rgb) / 0.06)',
      }
    : {}

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={style}
      className={`flex transition-all border-2 rounded-xl bg-white dark:bg-zinc-900 ${
        row ? 'flex-row items-center gap-2 px-3 py-2' : 'flex-col items-center gap-1.5 py-2.5 px-2'
      } ${
        active
          ? ''
          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
      } ${className}`}
    >
      {preview}
      {children ?? (
        <span className="flex flex-col items-center gap-0.5 leading-tight">
          {label != null && (
            <span
              className={`text-xs font-medium text-center ${active ? '' : 'text-zinc-700 dark:text-zinc-300'}`}
              style={active ? { color: 'var(--c-accent)' } : {}}
            >
              {label}
            </span>
          )}
          {desc != null && (
            <span className="text-2xs text-zinc-400 dark:text-zinc-500 text-center leading-tight">{desc}</span>
          )}
        </span>
      )}
    </button>
  )
}

interface OptionGridProps {
  /** grid 컬럼 수 (기본 flex-wrap) */
  cols?: number
  className?: string
  children: React.ReactNode
}

/** 타일 배치 래퍼 — cols 지정 시 grid, 아니면 flex-wrap */
export function OptionGrid({ cols, className = '', children }: OptionGridProps) {
  if (cols) {
    return <div className={`grid gap-2 ${className}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>
  }
  return <div className={`flex flex-wrap gap-2 ${className}`}>{children}</div>
}

export default OptionTile
