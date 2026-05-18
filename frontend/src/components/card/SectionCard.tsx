import { ReactNode } from 'react'

interface SectionCardProps {
  eyebrow: string
  title: string
  count?: number
  action?: { label: string; onClick: () => void }
  children: ReactNode
  tone?: 'paper' | 'cream' | 'ink'
  density?: 'default' | 'compact'
}

const BG: Record<string, string> = {
  paper: 'var(--paper)',
  cream: 'var(--cream)',
  ink:   'var(--ink-0)',
}
const TEXT_TITLE: Record<string, string> = {
  paper: 'var(--ink-0)',
  cream: 'var(--ink-0)',
  ink:   'var(--paper)',
}
const TEXT_BODY: Record<string, string> = {
  paper: 'var(--ink-3)',
  cream: 'var(--ink-3)',
  ink:   'rgba(255,255,255,0.65)',
}

export function SectionCard({
  eyebrow, title, count, action, children,
  tone = 'paper', density = 'default',
}: SectionCardProps) {
  const px = density === 'compact' ? 16 : 24
  const py = density === 'compact' ? 14 : 20

  return (
    <div style={{
      background: BG[tone],
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      padding: `${py}px ${px}px`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline',
        justifyContent: 'space-between', marginBottom: 14,
      }}>
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
          <span className="ut-eyebrow" style={tone === 'ink' ? { color: 'rgba(255,255,255,0.5)' } : {}}>
            {eyebrow}
          </span>
          {count != null && (
            <span className="ut-mono" style={{ fontSize: 11, color: tone === 'ink' ? 'rgba(255,255,255,0.45)' : 'var(--ink-4)' }}>
              {count}
            </span>
          )}
        </div>
        {action && (
          <button
            onClick={action.onClick}
            style={{
              fontSize: 12, color: TEXT_BODY[tone],
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            {action.label} →
          </button>
        )}
      </div>
      <div style={{
        fontSize: 28, fontWeight: 700, color: TEXT_TITLE[tone],
        letterSpacing: '-0.025em', lineHeight: 1.15, marginBottom: 6,
        fontFamily: 'var(--font-sans)',
      }}>
        {title}<span style={{ color: 'var(--dot)' }}>.</span>
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  )
}
