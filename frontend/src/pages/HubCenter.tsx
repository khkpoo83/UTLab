import React from 'react'
import ParticleCanvas from '../components/ParticleCanvas'
import BreathingIndicator from '../components/BreathingIndicator'

interface Props {
  onGoRight: () => void
  onGoBottom: () => void
  isLight: boolean
  setIsLight: (v: boolean) => void
}

const HubCenter: React.FC<Props> = ({ onGoRight, onGoBottom, isLight, setIsLight }) => {
  const panelBg    = isLight ? '#ffffff'               : '#000000'
  const textColor  = isLight ? 'rgba(8,10,30,0.85)'   : 'rgba(220,228,255,0.85)'
  const textMuted  = isLight ? 'rgba(8,10,30,0.42)'   : 'rgba(220,228,255,0.42)'
  const accentLine = isLight ? 'rgba(8,10,30,0.18)'   : 'rgba(188,214,255,0.30)'
  /* 라이트: 은은하게, 다크: 확실히 보이게 */
  const divider    = isLight ? 'rgba(8,10,30,0.07)'   : 'rgba(188,214,255,0.20)'
  const copyCol    = isLight ? 'rgba(8,10,30,0.28)'   : 'rgba(188,214,255,0.25)'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* ── 좌측 2/3: 파티클 캔버스 ── */}
      <div style={{
        position: 'relative',
        width: '66.667%', height: '100%', flexShrink: 0,
        borderRight: `1px solid ${divider}`,
        transition: 'border-color 0.55s',
      }}>
        <ParticleCanvas key={isLight ? 'light' : 'dark'} inverted={isLight} />
      </div>

      {/* ── 우측 1/3: 텍스트 패널 ── */}
      <div style={{
        position: 'relative',
        width: '33.333%', height: '100%', flexShrink: 0,
        background: panelBg,
        transition: 'background 0.55s ease',
      }}>
        {/* 태그라인 + 토글 + 저작권 — 하단 고정 */}
        <div style={{
          position: 'absolute',
          bottom: 'clamp(2.2rem, 6vh, 4.5rem)',
          left: 'clamp(1.6rem, 3.5vw, 2.8rem)',
          right: 'clamp(1.6rem, 3.5vw, 2.8rem)',
        }}>
          <div style={{
            width: '28px', height: '1px',
            background: accentLine,
            marginBottom: '1.2rem',
            transition: 'background 0.55s',
          }} />

          <p style={{
            margin: '0 0 0.22rem',
            fontSize: 'clamp(0.78rem, 1.1vw, 1rem)',
            fontWeight: 300,
            letterSpacing: '0.04em',
            lineHeight: 1.3,
            color: textMuted,
            transition: 'color 0.55s',
          }}>
            Be who you want to be
          </p>
          <p style={{
            margin: '0 0 1.6rem',
            fontSize: 'clamp(0.78rem, 1.1vw, 1rem)',
            fontWeight: 300,
            letterSpacing: '0.04em',
            lineHeight: 1.3,
            color: textColor,
            transition: 'color 0.55s',
          }}>
            Do what you love to do
          </p>

          {/* 흑/백 모드 토글 */}
          <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '1.4rem' }}>
            {(['dark', 'light'] as const).map((m) => {
              const active = (m === 'light') === isLight
              return (
                <button
                  key={m}
                  onClick={() => setIsLight(m === 'light')}
                  style={{
                    padding: '3px 15px',
                    borderRadius: '20px',
                    border: `1px solid ${isLight
                      ? (active ? 'rgba(8,10,30,0.50)' : 'rgba(8,10,30,0.14)')
                      : (active ? 'rgba(188,214,255,0.60)' : 'rgba(188,214,255,0.16)')}`,
                    background: active
                      ? (isLight ? 'rgba(8,10,30,0.07)' : 'rgba(188,214,255,0.08)')
                      : 'transparent',
                    color: isLight
                      ? (active ? 'rgba(8,10,30,0.85)' : 'rgba(8,10,30,0.28)')
                      : (active ? 'rgba(220,228,255,0.90)' : 'rgba(220,228,255,0.28)'),
                    fontSize: '9px',
                    letterSpacing: '0.12em',
                    fontWeight: active ? 500 : 300,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {m}
                </button>
              )
            })}
          </div>

          <p style={{
            margin: 0, fontSize: '9.5px',
            letterSpacing: '0.05em',
            color: copyCol,
            transition: 'color 0.55s',
          }}>
            © 2026 U.T Lab4. All rights reserved.
          </p>
        </div>

        {/* 로그인 인디케이터 */}
        <BreathingIndicator
          direction="right"
          onClick={onGoRight}
          label="Login"
          variant={isLight ? 'light' : 'dark'}
        />
      </div>

      {/* ── 전체 화면 중앙 하단: 블로그 인디케이터 ── */}
      <BreathingIndicator
        direction="down"
        onClick={onGoBottom}
        label="Blog"
        variant={isLight ? 'light' : 'dark'}
      />
    </div>
  )
}

export default HubCenter
