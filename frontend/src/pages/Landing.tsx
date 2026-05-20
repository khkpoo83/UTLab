import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import RaindropCanvas from '../components/RaindropCanvas'
import { LogoMark, Wordmark } from '../components/ut/UTLogo'

// ── 마우스 따라다니는 amber dot (CTA 푸터용) ─────────────────
function FollowDot({ container }: { container: { current: HTMLElement | null } }) {
  const [pos, setPos] = useState({ x: 50, y: 50, visible: false })
  useEffect(() => {
    const el = container.current
    if (!el) return
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      setPos({ x: e.clientX - r.left, y: e.clientY - r.top, visible: true })
    }
    const leave = () => setPos(p => ({ ...p, visible: false }))
    el.addEventListener('mousemove', move)
    el.addEventListener('mouseleave', leave)
    return () => { el.removeEventListener('mousemove', move); el.removeEventListener('mouseleave', leave) }
  }, [container])
  return (
    <div style={{
      position: 'absolute', left: pos.x, top: pos.y,
      transform: 'translate(-50%, -50%)',
      width: 36, height: 36, borderRadius: '50%',
      background: 'var(--dot)', pointerEvents: 'none',
      opacity: pos.visible ? 0.5 : 0,
      transition: 'left 0.18s ease-out, top 0.18s ease-out, opacity 0.3s ease',
      filter: 'blur(8px)', zIndex: 1,
    }} />
  )
}

// ── 글자별 흔들림 헤드라인 ────────────────────────────────────
function WigglyText({ text, baseStyle }: { text: string; baseStyle?: React.CSSProperties }) {
  const [hover, setHover] = useState(false)
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'inline-block', cursor: 'default' }}
    >
      {Array.from(text).map((c, i) => (
        <span key={i} style={{
          display: 'inline-block',
          transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          transform: hover
            ? `translateY(${Math.sin(i * 0.7) * 6}px) rotate(${Math.sin(i * 0.7) * 3}deg)`
            : 'translateY(0) rotate(0)',
          transitionDelay: `${i * 30}ms`,
          ...baseStyle,
        }}>
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </span>
  )
}

// ── 마퀴 ──────────────────────────────────────────────────────
interface MarqueeItem { text: string; now?: boolean }

const DEFAULT_KEYWORDS = ['WRITING', 'MUSIC', 'FILM', 'CODE']

function buildMarqueePool(keywords: string[]): MarqueeItem[] {
  const kws = keywords.length > 0 ? keywords : DEFAULT_KEYWORDS
  // 배열 끝 3개 = 가장 최근 등록된 키워드
  const recentSet = new Set(kws.slice(-3))
  return kws.map(kw => ({ text: kw, now: recentSet.has(kw) }))
}

function shuffleItems(items: MarqueeItem[]): MarqueeItem[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface LiveMarqueeProps {
  size: number
  weight: number
  color: string
  opacity?: number
  reverse?: boolean
  duration: number  // 애니메이션 기준 시간(초)
}

function LiveMarquee({ size, weight, color, opacity = 1, reverse, duration, items }: LiveMarqueeProps & { items: MarqueeItem[] }) {
  const dup = [...items, ...items]
  return (
    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', opacity }}>
      <div
        className={`ut-marquee-track${reverse ? ' rev' : ''}`}
        style={{ display: 'inline-flex', gap: size * 0.42, animationDuration: `${duration}s` }}
      >
        {dup.map((it, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: size * 0.42,
            fontSize: size, fontWeight: weight, color,
            letterSpacing: '-0.035em', lineHeight: 1.0,
            fontFamily: 'var(--font-sans)',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'baseline' }}>
              {it.now && (
                <span style={{
                  fontSize: size * 0.22, fontWeight: 700, letterSpacing: '0.10em',
                  color: '#F59E0B',
                  marginRight: size * 0.12, verticalAlign: 'middle',
                }}>
                  NOW
                </span>
              )}
              {it.text}
            </span>
            <span style={{
              width: size * 0.10, height: size * 0.10, borderRadius: '50%',
              background: 'var(--dot)', display: 'inline-block', flexShrink: 0,
            }} />
          </span>
        ))}
      </div>
    </div>
  )
}


// ── Landing C 페이지 ──────────────────────────────────────────
// 푸터 팔레트: 모노톤 vs 크림라이트 랜덤
const CTA_PALETTES = [
  { isDark: true,  bg: '#0a0a0b', bgEdge: '#000',    particle: [255,255,255] as [number,number,number], highlight: [200,200,200] as [number,number,number], vignette: 'rgba(0,0,0,0.55)',         textColor: '#FAFAF7' },
  { isDark: true,  bg: '#1a1a1c', bgEdge: '#0a0a0b', particle: [220,210,190] as [number,number,number], highlight: [255,250,240] as [number,number,number], vignette: 'rgba(10,10,11,0.45)',      textColor: '#FAFAF7' },
  { isDark: false, bg: '#FAFAF7', bgEdge: '#EEEBe4', particle: [60,60,65] as [number,number,number],  highlight: [30,30,35] as [number,number,number],  vignette: 'rgba(250,250,247,0.35)', textColor: '#0A0A0B' },
  { isDark: false, bg: '#F5F1E8', bgEdge: '#E8E3D3', particle: [80,70,55] as [number,number,number],  highlight: [40,35,25] as [number,number,number],  vignette: 'rgba(245,241,232,0.35)', textColor: '#0A0A0B' },
]

export default function Landing() {
  const navigate = useNavigate()
  const location = useLocation()
  const ctaRef = useRef<HTMLElement>(null)
  const isLoggedIn = !!localStorage.getItem('token')
  const goToApp = () => navigate(isLoggedIn ? '/home' : '/login')
  const enterFrom = (location.state as Record<string, string> | null)?.enterFrom
  const slideClass = enterFrom === 'left' ? 'pub-slide-from-left' : enterFrom === 'right' ? 'pub-slide-from-right' : ''
  const [ctaPalette] = useState(() => CTA_PALETTES[Math.floor(Math.random() * CTA_PALETTES.length)])

  const [heroTitle,   setHeroTitle]   = useState('한 사람의 인덱스')
  const [heroSub,     setHeroSub]     = useState('매일 들여다보면서 알게 된 것들.')
  const [editorNote,  setEditorNote]  = useState('인덱스를 만드는 게 목표가 아니라, 다시 찾아보고 싶은 기록을 남기는 게 목표입니다.')
  const [copyright,   setCopyright]   = useState('U.T Lab4 — 한 사람의 인덱스')
  const [marqueeItems, setMarqueeItems] = useState<MarqueeItem[]>(() => buildMarqueePool([]))
  const [marqueeSpeed, setMarqueeSpeed] = useState(60)

  useEffect(() => {
    import('../api/client').then(({ settingsApi }) => {
      settingsApi.publicGet()
        .then(({ data }) => {
          if (data.site_hero_title)    setHeroTitle(data.site_hero_title)
          if (data.site_hero_subtitle) setHeroSub(data.site_hero_subtitle)
          if (data.site_editor_note)   setEditorNote(data.site_editor_note)
          if (data.site_footer_copyright) setCopyright(data.site_footer_copyright)
          if (data.site_marquee_items && Array.isArray(data.site_marquee_items)) {
            setMarqueeItems(buildMarqueePool(data.site_marquee_items))
          } else {
            setMarqueeItems(buildMarqueePool([]))
          }
          if (typeof data.site_marquee_speed === 'number') {
            setMarqueeSpeed(data.site_marquee_speed)
          }
        })
        .catch(() => {})
    })
  }, [])

  const marqueeRows = useMemo(() => [
    shuffleItems(marqueeItems),
    shuffleItems(marqueeItems),
    shuffleItems(marqueeItems),
  ], [marqueeItems])

  const currentYear = new Date().getFullYear()

  return (
    <div className={`ut-screen${slideClass ? ` ${slideClass}` : ''}`} style={{
      width: '100%', minHeight: '100vh',
      background: 'var(--cream)', position: 'relative', overflow: 'hidden',
    }}>
      {/* 헤더 */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        height: 56,
        padding: '0 clamp(20px,4vw,48px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        background: 'rgba(250,250,247,0.88)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--line-2)',
        boxSizing: 'border-box',
      }}>
        {/* 로고 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <LogoMark size={24} />
          <Wordmark size={13} />
        </div>
        {/* 버튼 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button
            className="ut-btn ut-btn-secondary ut-btn-sm"
            onClick={goToApp}
          >{isLoggedIn ? '관리자페이지 →' : '로그인'}</button>
          <button
            className="ut-btn ut-btn-primary ut-btn-sm"
            onClick={() => navigate('/public/blog', { state: { enterFrom: 'right' } })}
          >글 목록 →</button>
        </div>
      </header>

      {/* Hero — Wiggly 헤드라인 + 마퀴 */}
      <section style={{ padding: 'clamp(100px,12vw,140px) clamp(20px,4vw,48px) clamp(32px,4vw,50px)' }}>
        <div style={{ marginBottom: 40 }}>
          <div className="ut-eyebrow" style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot)', display: 'inline-block' }} className="ut-dot-pulse" />
            ONLINE · {currentYear}
          </div>
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(32px, 5vw, 64px)', fontWeight: 700, fontStyle: 'italic',
            color: 'var(--ink-0)', letterSpacing: '-0.02em', lineHeight: 1.1,
            margin: 0,
          }}>
            <WigglyText text={heroTitle} />
            <span style={{ color: 'var(--dot)' }}>.</span>
            <br />
            <span style={{ color: 'var(--ink-3)', fontWeight: 500, fontSize: 'clamp(18px,2.5vw,32px)' }}>{heroSub}</span>
          </h1>
        </div>

        {/* 마퀴 3단 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <LiveMarquee size={88} weight={800} color="var(--ink-0)" duration={marqueeSpeed} items={marqueeRows[0]} />
          <LiveMarquee size={60} weight={500} color="var(--ink-2)" reverse opacity={0.96} duration={Math.round(marqueeSpeed * 0.85)} items={marqueeRows[1]} />
          <LiveMarquee size={40} weight={400} color="var(--ink-3)" opacity={0.82} duration={Math.round(marqueeSpeed * 1.6)} items={marqueeRows[2]} />
        </div>
      </section>

      {/* Editor's Note */}
      <section style={{ padding: 'clamp(32px,4vw,48px) clamp(20px,4vw,48px)', display: 'grid', gridTemplateColumns: 'clamp(120px,14vw,180px) 1fr', alignItems: 'start', gap: 'clamp(16px,2vw,32px)' }}>
        <div className="ut-eyebrow">EDITOR'S NOTE</div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <h3 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(18px,2vw,28px)', fontWeight: 500, fontStyle: 'italic',
            color: 'var(--ink-0)', maxWidth: 880, lineHeight: 1.35,
            margin: 0, letterSpacing: '-0.012em',
          }}>
            {editorNote}
          </h3>
        </div>
      </section>

      {/* 3가지 원칙 — 숨김 처리 (추후 작업) */}
      {/* TODO: 원칙 섹션 콘텐츠 기획 후 재활성화 */}

      {/* CTA 푸터 */}
      <section
        ref={ctaRef}
        style={{
          padding: 'clamp(48px,6vw,80px) clamp(20px,4vw,48px) clamp(32px,4vw,48px)',
          background: ctaPalette.bg, color: ctaPalette.textColor,
          borderRadius: 'var(--r-xl) var(--r-xl) 0 0',
          position: 'relative', overflow: 'hidden',
          minHeight: 400,
        }}
      >
        <RaindropCanvas
          bg={ctaPalette.bg}
          bgEdge={ctaPalette.bgEdge}
          particle={ctaPalette.particle}
          highlight={ctaPalette.highlight}
        />
        <div style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(180deg, ${ctaPalette.vignette} 0%, transparent 35%, ${ctaPalette.vignette} 100%)`,
          pointerEvents: 'none', zIndex: 1,
        }} />
        <FollowDot container={ctaRef} />

        <div style={{ position: 'relative', zIndex: 2 }}>
          {(() => {
            const tc = ctaPalette.textColor
            const sub = ctaPalette.isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'
            const divider = ctaPalette.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'
            const btnBg = ctaPalette.isDark ? '#FAFAF7' : '#0A0A0B'
            const btnColor = ctaPalette.isDark ? '#0A0A0B' : '#FAFAF7'
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 32, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', color: sub, marginBottom: 24 }}>READ MORE ↓</div>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'clamp(48px, 9vw, 144px)', fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 0.95, color: tc }}>
                    U<span style={{ color: 'var(--dot)' }}>.</span>T Lab4
                  </div>
                </div>
                <div style={{ display: 'inline-flex', gap: 12, paddingBottom: 18, flexWrap: 'wrap' }}>
                  <button className="ut-btn" style={{ background: 'transparent', color: tc, border: `1px solid ${divider.replace('0.10','0.3')}` }} onClick={goToApp}>
                    {isLoggedIn ? '관리자페이지 →' : '로그인'}
                  </button>
                  <button className="ut-btn" style={{ background: btnBg, color: btnColor }} onClick={() => navigate('/public/blog', { state: { enterFrom: 'right' } })}>
                    글 목록 →
                  </button>
                </div>
              </div>
            )
          })()}

          <div style={{
            marginTop: 60, paddingTop: 24,
            borderTop: `1px solid ${ctaPalette.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
            fontSize: 12, color: ctaPalette.isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
          }}>
            <span>© {currentYear} {copyright}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
