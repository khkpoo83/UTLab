import ToggleChip from './ToggleChip'

interface ChipOption<T extends string | number = string> {
  label: string
  value: T
}

interface ChipGroupProps<T extends string | number = string> {
  options: ChipOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  size?: 'xs' | 'sm' | 'md'
  pill?: boolean
}

export default function ChipGroup<T extends string | number = string>({
  options,
  value,
  onChange,
  className = '',
  size = 'md',
  pill = false,
}: ChipGroupProps<T>) {
  return (
    <div className={`flex gap-1.5 flex-wrap ${className}`}>
      {options.map((opt) => (
        <ToggleChip
          key={String(opt.value)}
          active={value === opt.value}
          size={size}
          pill={pill}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </ToggleChip>
      ))}
    </div>
  )
}
