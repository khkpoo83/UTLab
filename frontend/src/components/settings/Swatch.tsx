import { Check } from 'lucide-react'

interface SwatchProps {
  color: string
  active: boolean
  onClick: () => void
  title?: string
}

/** 색상 선택 단일 스와치 — 색상류 선택 통일 */
export function Swatch({ color, active, onClick, title }: SwatchProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
      style={{
        backgroundColor: color,
        boxShadow: active
          ? `0 0 0 2px var(--c-surface), 0 0 0 4px ${color}`
          : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
      }}
    >
      {active && <Check size={15} className="text-white drop-shadow" strokeWidth={3} />}
    </button>
  )
}

interface SwatchRowProps {
  value: string
  colors: { label: string; hex: string }[]
  onChange: (hex: string) => void
}

export function SwatchRow({ value, colors, onChange }: SwatchRowProps) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {colors.map(({ label, hex }) => (
        <Swatch key={hex} color={hex} active={value === hex} onClick={() => onChange(hex)} title={label} />
      ))}
    </div>
  )
}

export default Swatch
