import React from 'react'
import { formatPrice, formatPct } from '../utils/format'

interface PnlTextProps {
  value: number | null
  pct?: number | null
  size?: 'sm' | 'base' | 'lg'
}

const PnlText: React.FC<PnlTextProps> = ({ value, pct, size = 'sm' }) => {
  const cls = (value ?? 0) > 0 ? 'text-up' : (value ?? 0) < 0 ? 'text-down' : 'text-flat'
  const sizeClass = size === 'lg' ? 'text-base' : size === 'base' ? 'text-sm' : 'text-sm'
  return (
    <span className={`tabular-nums ${cls} ${sizeClass}`}>
      {value != null ? formatPrice(value) : '-'}
      {pct != null && (
        <span className="ml-1 text-2xs">({formatPct(pct)})</span>
      )}
    </span>
  )
}

export default PnlText
