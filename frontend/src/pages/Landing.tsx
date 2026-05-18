import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RaindropCanvas from '../components/RaindropCanvas'
import { LogoMark, Wordmark } from '../components/ut/UTLogo'
import { loadLandingConfig } from './SiteManage'

// ── 실시간 KST 시계 ───────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const update = () => {
      const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }))
      setTime(kst.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])
  return <>{time} KST</>
}

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

// ── 라이브 데이터 기반 마퀴 ───────────────────────────────────
interface MarqueeItem { text: string; static?: boolean; kind?: 'now' | 'live' }

const _cfg = loadLandingConfig()
const MARQUEE_POOL: MarqueeItem[] = [
  { text: '지금 듣는 — Slow Pulp', kind: 'now' },
  ..._cfg.keywords.map(kw => ({ text: kw, static: true as const })),
  { text: 'KOSPI 2,718 +0.46%', kind: 'live' as const },
  { text: '최근 글 — 교토에서 본 골목', kind: 'now' as const },
  { text: 'USD/KRW 1,394 -0.17%', kind: 'live' as const },
]

interface LiveMarqueeProps {
  size: number
  weight: number
  color: string
  opacity?: number
  reverse?: boolean
  speed?: 'normal' | 'slow'
}

function LiveMarquee({ size, weight, color, opacity = 1, reverse, speed }: LiveMarqueeProps) {
  const dup = [...MARQUEE_POOL, ...MARQUEE_POOL]
  return (
    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', opacity }}>
      <div
        className={`ut-marquee-track${speed === 'slow' ? ' slow' : ''}${reverse ? ' rev' : ''}`}
        style={{ display: 'inline-flex', gap: size * 0.42 }}
      >
        {dup.map((it, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: size * 0.42,
            fontSize: size, fontWeight: weight, color,
            letterSpacing: '-0.035em', lineHeight: 1.0,
            fontFamily: 'var(--font-sans)',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'baseline', opacity: it.static ? 1 : 0.85 }}>
              {!it.static && (
                <span style={{
                  fontSize: size * 0.22, fontWeight: 600, letterSpacing: '0.10em',
                  color: it.kind === 'live' ? 'var(--dot)' : color,
                  opacity: 0.5, marginRight: size * 0.12, verticalAlign: 'middle',
                }}>
                  {it.kind === 'live' ? 'LIVE' : 'NOW'}
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

// ── 3가지 원칙 카드 ───────────────────────────────────────────
interface Principle { n: string; title: string; sub: string; body: string }

function PrincipleCard({ p, first }: { p: Principle; first: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '8px 32px',
        borderLeft: first ? '1px solid var(--line)' : 'none',
        borderRight: '1px solid var(--line)',
        transition: 'background 0.2s ease',
        background: hov ? 'var(--paper)' : 'transparent',
        cursor: 'default',
      }}
    >
      <div className="ut-mono" style={{
        fontSize: 13, fontWeight: 700,
        color: hov ? 'var(--ink-0)' : 'var(--ink-4)',
        letterSpacing: '0.1em', marginBottom: 24,
        transition: 'color 0.2s ease',
      }}>{p.n}</div>
      <div style={{
        fontSize: 40, fontWeight: 800, color: 'var(--ink-0)',
        letterSpacing: '-0.04em', lineHeight: 1, marginBottom: 4,
        transform: hov ? 'translateX(4px)' : 'translateX(0)',
        transition: 'transform 0.3s cubic-bezier(0.2, 0.7, 0.3, 1)',
      }}>{p.title}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-3)', marginBottom: 14, letterSpacing: '-0.01em' }}>{p.sub}</div>
      <p className="ut-body-sm" style={{ color: 'var(--ink-2)', margin: 0 }}>{p.body}</p>
    </div>
  )
}

const PRINCIPLES: Principle[] = [
  { n: '01', title: 'QUIET',  sub: '조용한 공간',   body: '알고리즘 없음. 푸시 없음. 직접 골라온 것만 올라오는 인덱스.' },
  { n: '02', title: 'MIXED',  sub: '다양한 관심사', body: '글 · 음악 · 영화 · 책 · 여행 · 코드 · 사진 · 가끔 시장. 한 사람의 안에서 다 일어남.' },
  { n: '03', title: 'SLOW',   sub: '느린 갱신',     body: '매주 1-2편. 매일 쓰지 않습니다. 쌓이는 게 빨라야 좋은 건 아닙니다.' },
]

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
  const ctaRef = useRef<HTMLElement>(null)
  const isLoggedIn = !!localStorage.getItem('token')
  const goToApp = () => navigate(isLoggedIn ? '/home' : '/login')
  const [ctaPalette] = useState(() => CTA_PALETTES[Math.floor(Math.random() * CTA_PALETTES.length)])

  return (
    <div className="ut-screen" style={{
      width: '100%', minHeight: '100vh',
      background: 'var(--cream)', position: 'relative', overflow: 'hidden',
    }}>
      {/* 헤더 */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        padding: '20px 48px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(250,250,247,0.88)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--line-2)',
      }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <LogoMark size={32} />
          <Wordmark size={17} />
        </div>
        <nav style={{ display: 'inline-flex', gap: 28, fontSize: 13, color: 'var(--ink-2)' }}>
          {['글', '음악', '영화·책', '여행', '사진', '시장 노트'].map(item => (
            <a key={item} style={{ cursor: 'pointer', fontWeight: 500, textDecoration: 'none', color: 'inherit' }}>{item}</a>
          ))}
        </nav>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-sans)' }}>
            <LiveClock />
          </span>
          <button
            className="ut-btn ut-btn-primary ut-btn-sm"
            onClick={goToApp}
          >
            {isLoggedIn ? '대시보드 →' : '시작하기'}
          </button>
        </div>
      </header>

      {/* Hero — Wiggly 헤드라인 + 마퀴 */}
      <section style={{ padding: '140px 48px 50px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 32, marginBottom: 40 }}>
          <div>
            <div className="ut-eyebrow" style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: 'var(--dot)',
                display: 'inline-block',
              }} className="ut-dot-pulse" />
              ONLINE · 2026
            </div>
            <h1 style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 700, fontStyle: 'italic',
              color: 'var(--ink-0)', letterSpacing: '-0.02em', lineHeight: 1.1,
              margin: 0,
            }}>
              <WigglyText text={_cfg.heroTitle} />
              <span style={{ color: 'var(--dot)' }}>.</span>
              <br />
              <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>{_cfg.heroSubtitle}</span>
            </h1>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, paddingBottom: 8 }}>
            <button className="ut-btn ut-btn-secondary">RSS · 구독</button>
            <button
              className="ut-btn ut-btn-primary"
              onClick={() => navigate('/public/blog')}
            >
              글 보러가기 →
            </button>
          </div>
        </div>

        {/* 라이브 마퀴 3단 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <LiveMarquee size={88} weight={800} color="var(--ink-0)" />
          <LiveMarquee size={60} weight={500} color="var(--ink-2)" reverse opacity={0.96} />
          <LiveMarquee size={40} weight={400} color="var(--ink-3)" speed="slow" opacity={0.82} />
        </div>

        {/* 마퀴 설명 뱃지 */}
        <div style={{
          marginTop: 16, padding: '10px 16px',
          background: 'var(--paper)', border: '1px solid var(--line)',
          borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 12,
          fontSize: 11.5, color: 'var(--ink-3)',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dot)', flexShrink: 0 }} className="ut-dot-pulse" />
          위 흐르는 단어들은 <strong style={{ color: 'var(--ink-0)' }}>라이브 데이터</strong>로 자동 채워집니다
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span>키워드 5개만 정해두면 NOW PLAYING · 최근 글 · 시장 시세가 자동 포함</span>
        </div>
      </section>

      {/* Editorial Note */}
      <section style={{ padding: '48px 48px 32px', display: 'grid', gridTemplateColumns: '180px 1fr', alignItems: 'start', gap: 32 }}>
        <div className="ut-eyebrow">EDITORIAL NOTE</div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <h3 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 28, fontWeight: 500, fontStyle: 'italic',
            color: 'var(--ink-0)', maxWidth: 880, lineHeight: 1.35,
            margin: 0, letterSpacing: '-0.012em',
          }}>
            인덱스를 만드는 게 목표가 아니라,{' '}
            <span style={{ color: 'var(--ink-3)' }}>다시 찾아보고 싶은 기록</span>을 남기는 게 목표입니다.
          </h3>
        </div>
      </section>

      {/* 3가지 원칙 */}
      <section style={{
        margin: '24px 48px 60px', padding: '32px 0',
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
      }}>
        {PRINCIPLES.map((p, i) => (
          <PrincipleCard key={p.n} p={p} first={i === 0} />
        ))}
      </section>

      {/* CTA 푸터 — RaindropCanvas + FollowDot */}
      <section
        ref={ctaRef}
        style={{
          padding: '80px 48px 48px',
          background: ctaPalette.bg, color: ctaPalette.textColor,
          borderRadius: 'var(--r-xl) var(--r-xl) 0 0',
          position: 'relative', overflow: 'hidden',
          minHeight: 520,
        }}
      >
        <RaindropCanvas
          bg={ctaPalette.bg}
          bgEdge={ctaPalette.bgEdge}
          particle={ctaPalette.particle}
          highlight={ctaPalette.highlight}
        />

        {/* 가독성용 vignette */}
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
            const muted = ctaPalette.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'
            const divider = ctaPalette.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'
            const btnBg = ctaPalette.isDark ? '#FAFAF7' : '#0A0A0B'
            const btnColor = ctaPalette.isDark ? '#0A0A0B' : '#FAFAF7'
            return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 32 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', color: sub, marginBottom: 24 }}>
                READ MORE ↓
              </div>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'clamp(60px, 9vw, 144px)', fontWeight: 800,
                letterSpacing: '-0.045em', lineHeight: 0.95, color: tc,
              }}>
                U<span style={{ color: 'var(--dot)' }}>.</span>T Lab4
              </div>
              <div style={{ fontSize: 14, color: muted, marginTop: 18, maxWidth: 540 }}>
                매주 1-2편 · RSS와 Atom 지원 · 알고리즘 없음. 한 사람의 인덱스 그 자체.
              </div>
            </div>
            <div style={{ display: 'inline-flex', gap: 12, paddingBottom: 18 }}>
              <button
                className="ut-btn"
                style={{ background: 'transparent', color: tc, border: `1px solid ${divider.replace('0.10','0.3')}` }}
                onClick={() => navigate('/public/blog')}
              >
                공개 블로그 →
              </button>
              <button
                className="ut-btn"
                style={{ background: btnBg, color: btnColor }}
                onClick={goToApp}
              >
                {isLoggedIn ? '대시보드 →' : '구독하기'}
              </button>
            </div>
          </div>
            )
          })()}

          <div style={{
            marginTop: 80, paddingTop: 28,
            borderTop: `1px solid ${ctaPalette.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 12, color: ctaPalette.isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)',
          }}>
            <span>© 2026 U.T Lab4 — 한 사람의 인덱스</span>
            <span>마우스를 움직여보세요 · Pretendard + Noto Serif KR · KST</span>
          </div>
        </div>
      </section>
    </div>
  )
}
