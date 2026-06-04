interface RecommendationCardProps {
  rank: number
  ticker: string
  name: string
  score: number
  rationale: string
  current: string
  target: string
  gap: string
  onAdd?: () => void
  onDismiss?: () => void
}

export function RecommendationCard({
  rank, ticker, name, score, rationale,
  current, target, gap,
  onAdd, onDismiss,
}: RecommendationCardProps) {
  return (
    <div style={{
      border: '1px solid var(--line)',
      borderRadius: 'var(--r-md)',
      background: 'var(--c-surface)',
      padding: '22px 24px',
      position: 'relative',
    }}>
      {/* Score corner */}
      <div style={{
        position: 'absolute', top: 18, right: 20,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot)' }} />
        <span className="ut-mono" style={{
          fontSize: 11, fontWeight: 700, color: 'var(--ink-0)', letterSpacing: '0.04em',
        }}>
          SCORE {score}
        </span>
      </div>

      <div className="ut-eyebrow" style={{ marginBottom: 10 }}>
        추천 · #{String(rank).padStart(2, '0')}
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700, color: 'var(--ink-0)',
        letterSpacing: '-0.025em', marginBottom: 4, fontFamily: 'var(--font-sans)',
      }}>
        {name}<span style={{ color: 'var(--dot)' }}>.</span>
      </div>
      <div className="ut-mono" style={{ fontSize: 11.5, color: 'var(--ink-4)', marginBottom: 14 }}>
        {ticker}
      </div>

      <p className="ut-body-sm" style={{ color: 'var(--ink-2)', marginBottom: 16, lineHeight: 1.55 }}>
        {rationale}
      </p>

      {/* current / target / gap 지표 */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 14,
        padding: '10px 14px', background: 'var(--c-surface-subtle)',
        borderRadius: 8, marginBottom: 18,
      }}>
        {[
          { l: '현재', v: current },
          { l: '목표', v: target },
          { l: '격차', v: gap, dot: true },
        ].map(x => (
          <div key={x.l}>
            <div className="ut-eyebrow" style={{ fontSize: 9 }}>{x.l}</div>
            <div className="ut-mono" style={{
              fontSize: 14, fontWeight: 700, marginTop: 2,
              color: x.dot ? 'var(--dot)' : 'var(--ink-0)',
            }}>
              {x.v}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ut-btn ut-btn-primary ut-btn-sm" onClick={onAdd}>담기 →</button>
        <button className="ut-btn ut-btn-secondary ut-btn-sm" onClick={onDismiss}>무시</button>
      </div>
    </div>
  )
}
