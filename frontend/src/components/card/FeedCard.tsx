interface FeedMeta {
  date: string
  readTime?: string
  views?: number
}

interface FeedCardProps {
  tag?: string
  ageLabel?: string
  category?: string
  title: string
  excerpt?: string
  meta?: FeedMeta
  onClick?: () => void
  tone?: 'paper' | 'cream' | 'ink'
  density?: 'default' | 'compact'
}

const BG: Record<string, string> = {
  paper: 'var(--c-surface)',
  cream: 'var(--c-surface-subtle)',
  ink:   'var(--ink-0)',
}

export function FeedCard({
  tag, ageLabel, category, title, excerpt, meta,
  onClick, tone = 'paper', density = 'default',
}: FeedCardProps) {
  const isInk = tone === 'ink'
  const hPad = density === 'compact' ? '10px 16px' : '14px 20px'
  const bPad = density === 'compact' ? '12px 16px 14px' : '18px 20px 20px'

  return (
    <div
      onClick={onClick}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        background: BG[tone],
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* Tag bar */}
      {(tag || ageLabel || category) && (
        <div style={{
          padding: hPad,
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid var(--line-2)',
        }}>
          {tag && (
            <>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot)' }} />
              <span style={{
                fontSize: 11, fontWeight: 700, color: 'var(--dot)', letterSpacing: '0.10em',
              }}>{tag}</span>
            </>
          )}
          {ageLabel && (
            <span style={{ fontSize: 11, color: isInk ? 'rgba(255,255,255,0.45)' : 'var(--ink-4)' }}>
              · {ageLabel}
            </span>
          )}
          {category && (
            <>
              <div style={{ flex: 1 }} />
              <span className="ut-mono" style={{
                fontSize: 11, color: isInk ? 'rgba(255,255,255,0.45)' : 'var(--ink-4)',
              }}>{category}</span>
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ padding: bPad }}>
        <div style={{
          fontSize: density === 'compact' ? 15 : 18,
          fontWeight: 700,
          color: isInk ? 'var(--paper)' : 'var(--ink-0)',
          letterSpacing: '-0.02em',
          marginBottom: 8,
          fontFamily: 'var(--font-sans)',
        }}>
          {title}
        </div>
        {excerpt && (
          <p className="ut-body-sm" style={{
            color: isInk ? 'rgba(255,255,255,0.65)' : 'var(--ink-2)',
            margin: 0, marginBottom: 14, lineHeight: 1.55,
          }}>
            {excerpt}
          </p>
        )}
        {meta && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            fontSize: 11, color: isInk ? 'rgba(255,255,255,0.45)' : 'var(--ink-4)',
          }}>
            <span className="ut-mono">{meta.date}</span>
            {meta.readTime && (
              <>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                <span>{meta.readTime}</span>
              </>
            )}
            {meta.views != null && (
              <>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                <span>조회 {meta.views.toLocaleString()}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
