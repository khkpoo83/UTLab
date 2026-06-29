interface SettingRowProps {
  title: string
  desc?: string
  /** 우측 컨트롤 (토글/버튼 등) */
  control: React.ReactNode
  className?: string
}

/** 제목/설명(좌) + 컨트롤(우) 한 줄 설정 행 */
export function SettingRow({ title, desc, control, className = '' }: SettingRowProps) {
  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-1">{title}</p>
        {desc && <p className="text-2xs text-ink-4 mt-0.5">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{control}</div>
    </div>
  )
}

export default SettingRow
