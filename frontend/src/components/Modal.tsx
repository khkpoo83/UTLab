import React from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  onClose: () => void
  children: React.ReactNode
  /** 최대 너비 클래스 (기본: max-w-md) */
  maxWidth?: string
  /** 모바일에서 하단 시트로 표시 (기본: true) */
  bottomSheet?: boolean
  className?: string
}

/**
 * 공통 모달 — Portal로 document.body에 렌더링 (backdrop-filter 스태킹 컨텍스트 우회)
 * 오버레이 스타일: data-overlay 속성 → CSS 변수 --overlay-bg / --overlay-filter
 */
export default function Modal({ onClose, children, maxWidth = 'max-w-md', bottomSheet = true, className = '' }: ModalProps) {
  return createPortal(
    <div
      className={`fixed inset-0 z-[200] flex ${bottomSheet ? 'items-end sm:items-center' : 'items-center'} justify-center`}
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'var(--overlay-filter)', WebkitBackdropFilter: 'var(--overlay-filter)' }}
      onClick={onClose}
    >
      <div
        className={`
          w-full ${maxWidth} mx-0 sm:mx-4
          panel-surface border
          ${bottomSheet ? 'rounded-t-2xl sm:rounded-2xl' : 'rounded-2xl'}
          shadow-2xl overflow-hidden
          max-h-[90vh] overflow-y-auto
          ${className}
        `}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

interface ModalHeaderProps {
  title: string
  subtitle?: string
  onClose: () => void
}

export function ModalHeader({ title, subtitle, onClose }: ModalHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-0">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
        {subtitle && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{subtitle}</p>}
      </div>
      <button
        onClick={onClose}
        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors flex-shrink-0 mt-0.5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
