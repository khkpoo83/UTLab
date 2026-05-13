import React from 'react'

interface WeightBadgeProps {
  weight: number
}

const WeightBadge: React.FC<WeightBadgeProps> = ({ weight }) => {
  if (weight === 0) return <span className="tag tag-red">미투자</span>
  if (weight < 10) return <span className="tag tag-tonal">저비중 ({weight.toFixed(1)}%)</span>
  return <span className="tag tag-accent">적정 ({weight.toFixed(1)}%)</span>
}

export default WeightBadge
