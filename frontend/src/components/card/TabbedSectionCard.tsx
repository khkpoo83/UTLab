import { ReactNode } from 'react'

export interface TabItem {
  value: string
  label: string
}

interface TabbedSectionCardProps {
  eyebrow: string
  tabs: TabItem[]
  value: string
  onChange: (value: string) => void
  children: ReactNode
  density?: 'default' | 'compact'
}

export function TabbedSectionCard({
  eyebrow, tabs, value, onChange, children, density = 'default',
}: TabbedSectionCardProps) {
  const hPad = density === 'compact' ? '12px 18px' : '14px 22px'
  const bPad = density === 'compact' ? '16px 18px' : '24px 22px'

  return (
    <div style={{
      background: 'var(--paper)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      overflow: 'hidden',
    }}>
      {/* Header with tabs */}
      <div style={{
        padding: hPad,
        borderBottom: '1px solid var(--line)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div className="ut-eyebrow">{eyebrow}</div>
        <div style={{ display: 'inline-flex', gap: 2 }}>
          {tabs.map(t => (
            <button
              key={t.value}
              onClick={() => onChange(t.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
                background: value === t.value ? 'var(--ink-0)' : 'transparent',
                color: value === t.value ? 'var(--paper)' : 'var(--ink-3)',
                transition: 'all 0.12s ease',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: bPad }}>
        {children}
      </div>
    </div>
  )
}
