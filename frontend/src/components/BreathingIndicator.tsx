import React from 'react'
import { ChevronRight, ChevronDown, ChevronLeft, ChevronUp } from 'lucide-react'

interface Props {
  direction: 'right' | 'down' | 'left' | 'up'
  onClick: () => void
  label?: string
  variant?: 'dark' | 'light'
}

const ICON_MAP = {
  right: ChevronRight,
  down:  ChevronDown,
  left:  ChevronLeft,
  up:    ChevronUp,
}

const POSITION_STYLE: Record<string, React.CSSProperties> = {
  right: { right: '28px', top: '50%', transform: 'translateY(-50%)' },
  down:  { bottom: '28px', left: '50%', transform: 'translateX(-50%)' },
  left:  { left: '28px', top: '50%', transform: 'translateY(-50%)' },
  up:    { top: '28px', left: '50%', transform: 'translateX(-50%)' },
}

const BreathingIndicator: React.FC<Props> = ({ direction, onClick, label, variant = 'dark' }) => {
  const Icon = ICON_MAP[direction]
  const animClass = variant === 'light' ? `breathe-${direction}-light` : `breathe-${direction}`
  const iconColor  = variant === 'light' ? 'rgba(15,25,75,0.65)'   : 'rgba(188,214,255,0.7)'
  const labelColor = variant === 'light' ? 'rgba(15,25,75,0.40)'   : 'rgba(188,214,255,0.45)'

  return (
    <button
      onClick={onClick}
      aria-label={`${direction} 방향으로 이동`}
      style={{
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        background: 'none',
        border: 'none',
        padding: '20px',
        zIndex: 10,
        ...POSITION_STYLE[direction],
      }}
    >
      <span className={animClass} style={{ color: iconColor, display: 'flex' }}>
        <Icon size={36} strokeWidth={1.5} />
      </span>
      {label && (
        <span
          className={animClass}
          style={{ fontSize: '11px', color: labelColor, whiteSpace: 'nowrap', letterSpacing: '0.1em', textTransform: 'uppercase' }}
        >
          {label}
        </span>
      )}
    </button>
  )
}

export default BreathingIndicator
