import { ReactNode } from 'react'

interface StepCardProps {
  step: number
  totalSteps: number
  title: string
  subtitle?: string
  progress: number      // 0–100
  children: ReactNode
  onPrev?: () => void
  onNext?: () => void
}

export function StepCard({
  step, totalSteps, title, subtitle,
  progress, children, onPrev, onNext,
}: StepCardProps) {
  return (
    <div style={{
      background: 'var(--paper)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 22px',
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <span className="ut-mono" style={{
          fontSize: 10, fontWeight: 700, color: 'var(--paper)',
          background: 'var(--ink-0)', padding: '3px 8px',
          borderRadius: 999, letterSpacing: '0.08em', flexShrink: 0,
        }}>
          STEP {String(step).padStart(2, '0')} / {String(totalSteps).padStart(2, '0')}
        </span>
        <span style={{ fontSize: 13, color: 'var(--ink-1)', fontWeight: 600 }}>{title}</span>
        {subtitle && (
          <>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{subtitle}</span>
          </>
        )}
      </div>

      {/* Progress strip */}
      <div style={{ display: 'flex', height: 3, background: 'var(--line-2)' }}>
        <div style={{ width: `${progress}%`, background: 'var(--ink-0)', transition: 'width 0.3s ease' }} />
      </div>

      {/* Body */}
      <div style={{ padding: '22px 22px 18px' }}>
        {children}
      </div>

      {/* Footer nav */}
      {(onPrev || onNext) && (
        <div style={{
          padding: '12px 22px',
          background: 'var(--cream)',
          borderTop: '1px solid var(--line)',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <button
            className="ut-btn ut-btn-ghost ut-btn-sm"
            onClick={onPrev}
            disabled={!onPrev}
            style={{ opacity: onPrev ? 1 : 0.4 }}
          >
            ← 이전
          </button>
          <button
            className="ut-btn ut-btn-primary ut-btn-sm"
            onClick={onNext}
            disabled={!onNext}
          >
            다음 →
          </button>
        </div>
      )}
    </div>
  )
}
