import React from 'react'

interface PageTitleProps {
  sub: string
  title: string
  subtitle?: React.ReactNode
}

export function PageTitle({ sub, title, subtitle }: PageTitleProps) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div className="ut-eyebrow" style={{ marginBottom: 5, color: 'var(--ink-4)', textTransform: 'uppercase' }}>
        {sub}<span style={{ color: 'var(--dot)', fontSize: '1.4em' }}>.</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{
          fontSize: 'clamp(22px, 2.4vw, 30px)', fontWeight: 700,
          color: 'var(--ink-0)', letterSpacing: '-0.022em', lineHeight: 1.2, margin: 0,
          textTransform: 'uppercase',
        }}>
          {title}
        </h1>
        {subtitle && (
          <span className="ut-mono" style={{ fontSize: 12, color: 'var(--ink-4)' }}>{subtitle}</span>
        )}
      </div>
    </div>
  )
}

export default PageTitle
