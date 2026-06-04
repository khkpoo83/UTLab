export interface StatItem {
  label: string
  value: string
  suffix?: string
  delta?: string
  deltaTone?: 'up' | 'down' | 'neutral'
  valueClassName?: string   // e.g. blur class for privacy mode
}

interface StatGroupCardProps {
  stats: StatItem[]
  density?: 'default' | 'compact'
}

const DELTA_COLOR: Record<string, string> = {
  up:      'var(--up)',
  down:    'var(--down)',
  neutral: 'var(--ink-4)',
}

export function StatGroupCard({ stats, density = 'default' }: StatGroupCardProps) {
  const py = density === 'compact' ? 14 : 20
  const px = density === 'compact' ? 16 : 24
  const valSize = density === 'compact' ? 20 : 26

  return (
    <div style={{
      background: 'var(--c-surface)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      display: 'grid',
      gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
      height: '100%',
    }}>
      {stats.map((s, i) => (
        <div key={s.label} style={{
          padding: `${py}px ${px}px`,
          borderLeft: i > 0 ? '1px solid var(--line-2)' : 'none',
        }}>
          <div className="ut-eyebrow" style={{ marginBottom: 10 }}>{s.label}</div>
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
            <span className={`ut-mono${s.valueClassName ? ` ${s.valueClassName}` : ''}`} style={{
              fontSize: valSize, fontWeight: 800,
              color: s.deltaTone && !s.delta ? DELTA_COLOR[s.deltaTone] : 'var(--ink-0)',
              letterSpacing: '-0.03em', lineHeight: 1,
            }}>
              {s.value}
            </span>
            {s.suffix && (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.suffix}</span>
            )}
          </div>
          {s.delta && (
            <div className="ut-mono" style={{
              marginTop: 8, fontSize: 12, fontWeight: 600,
              color: DELTA_COLOR[s.deltaTone ?? 'neutral'],
            }}>
              {s.delta}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
