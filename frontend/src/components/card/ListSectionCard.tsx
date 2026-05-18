import { ReactNode } from 'react'

interface ListSectionHeader {
  eyebrow?: string
  title: string
  meta?: string
}

interface ListSectionCardProps<T> {
  header: ListSectionHeader
  items: T[]
  renderItem: (item: T, index: number) => ReactNode
  footer?: ReactNode
  density?: 'default' | 'compact'
}

export function ListSectionCard<T>({
  header, items, renderItem, footer, density = 'default',
}: ListSectionCardProps<T>) {
  const hPx = density === 'compact' ? '14px 18px' : '16px 22px'

  return (
    <div style={{
      background: 'var(--paper)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: hPx,
        borderBottom: '1px solid var(--line)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          {header.eyebrow && (
            <div className="ut-eyebrow" style={{ marginBottom: 4 }}>{header.eyebrow}</div>
          )}
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-0)' }}>
            {header.title}
          </div>
        </div>
        {header.meta && (
          <div className="ut-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {header.meta}
          </div>
        )}
      </div>

      {/* Items */}
      {items.map((item, i) => (
        <div key={i}>{renderItem(item, i)}</div>
      ))}

      {/* Footer */}
      {footer && (
        <div style={{
          padding: density === 'compact' ? '10px 18px' : '12px 22px',
          background: 'var(--cream)',
          borderTop: '1px solid var(--line)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {footer}
        </div>
      )}
    </div>
  )
}
