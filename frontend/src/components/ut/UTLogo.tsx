// ── Aperture 로고 마크 (renewal Brand B 선택안) ───────────────
// 크림 배경 + 검정 보더 + 중앙 amber 도트 + 코너 U·T / LAB4 레이블
interface LogoMarkProps {
  size?: number
  variant?: 'paper' | 'ink'
}

export function LogoMark({ size = 40, variant = 'paper' }: LogoMarkProps) {
  const r = size * 0.235
  const isDark = variant === 'ink'
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flexShrink: 0,
      background: isDark ? '#0A0A0B' : '#FAFAF7',
      border: isDark ? 'none' : '1.5px solid #0A0A0B',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        width: size * 0.40, height: size * 0.40, borderRadius: '50%',
        background: '#F59E0B',
        boxShadow: `0 ${size * 0.04}px ${size * 0.12}px rgba(245,158,11,0.35)`,
      }} />
      {size >= 28 && (
        <>
          <div style={{
            position: 'absolute', bottom: size * 0.10, left: size * 0.12,
            fontFamily: 'Pretendard Variable, Pretendard, system-ui, sans-serif',
            fontWeight: 800, fontSize: size * 0.18,
            color: isDark ? '#FAFAF7' : '#0A0A0B',
            letterSpacing: '-0.04em', lineHeight: 1,
          }}>U·T</div>
          <div style={{
            position: 'absolute', top: size * 0.10, right: size * 0.12,
            fontFamily: 'Pretendard Variable, Pretendard, system-ui, sans-serif',
            fontWeight: 600, fontSize: size * 0.11,
            color: isDark ? 'rgba(250,250,247,0.55)' : '#6B6A65',
            letterSpacing: '0.06em',
          }}>LAB4</div>
        </>
      )}
    </div>
  )
}

// ── 워드마크 (Tight — Pretendard 800, 극도로 좁은 자간) ───────
interface WordmarkProps {
  size?: number
  dark?: boolean
}

export function Wordmark({ size = 18, dark = false }: WordmarkProps) {
  const ink = dark ? '#FAFAF7' : 'var(--ink-0)'
  const lab = dark ? 'rgba(250,250,247,0.6)' : 'var(--ink-3)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline',
      fontFamily: 'Pretendard Variable, Pretendard, system-ui, sans-serif',
      lineHeight: 1, color: ink,
    }}>
      <span style={{ fontSize: size, fontWeight: 800, letterSpacing: '-0.07em' }}>
        U<span style={{ color: 'var(--dot)' }}>.</span>T
      </span>
      <span style={{
        fontSize: size * 0.42, fontWeight: 600,
        letterSpacing: '0.16em', color: lab,
        marginLeft: size * 0.24, alignSelf: 'center',
      }}>LAB4</span>
    </span>
  )
}
