export interface StackedRow {
  label: string
  value: string
  trail?: string
  deltaTone?: 'up' | 'down'
}

interface StackedCardGroupProps {
  header: {
    eyebrow: string
    title: string
    action?: { label: string; onClick: () => void }
  }
  rows: StackedRow[]
  tone?: 'paper' | 'ink'
  density?: 'default' | 'compact'
}

export function StackedCardGroup({
  header, rows, tone = 'paper', density = 'default',
}: StackedCardGroupProps) {
  const isInk = tone === 'ink'
  const rPad = density === 'compact' ? '10px 18px' : '14px 22px'

  return (
    <div style={{
      background: 'var(--c-surface)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      overflow: 'hidden',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header — tone=ink → inverted */}
      <div style={{
        padding: density === 'compact' ? '12px 18px' : '16px 22px',
        borderBottom: '1px solid var(--line)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: isInk ? 'var(--ink-0)' : 'var(--c-surface)',
        color: isInk ? 'var(--paper)' : 'var(--ink-0)',
        flexShrink: 0,
      }}>
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 4,
            color: isInk ? 'rgba(255,255,255,0.55)' : 'var(--ink-4)',
          }}>
            {header.eyebrow}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{header.title}</div>
        </div>
        {header.action && (
          <button
            onClick={header.action.onClick}
            className="ut-btn ut-btn-sm"
            style={isInk ? {
              background: 'rgba(255,255,255,0.10)',
              color: 'var(--paper)',
              border: '1px solid rgba(255,255,255,0.20)',
            } : {}}
          >
            {header.action.label} →
          </button>
        )}
      </div>

      {/* Rows — 높이 티어로 개수를 맞추므로 스크롤 없이 클립 */}
      {rows.map((r, i) => (
        <div key={r.label} style={{
          padding: rPad,
          borderBottom: i < rows.length - 1 ? '1px solid var(--line-2)' : 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div className="ut-eyebrow" style={{ marginBottom: 4 }}>{r.label}</div>
            <div className="ut-mono" style={{
              fontSize: 16, fontWeight: 700,
              color: r.deltaTone === 'up' ? 'var(--up)'
                   : r.deltaTone === 'down' ? 'var(--down)'
                   : 'var(--ink-0)',
            }}>
              {r.value}
            </div>
          </div>
          {r.trail && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'right' }}>
              {r.trail}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
