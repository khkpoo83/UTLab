import React, { useEffect, useMemo, useRef, useState, memo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Sun, Moon, Monitor } from 'lucide-react'
import RaindropCanvas from '../components/RaindropCanvas'
import { LogoMark, Wordmark } from '../components/ut/UTLogo'
import { settingsApi } from '../api/client'
import { usePublicTheme } from '../hooks/usePublicTheme'

// ── 랜딩 설정 localStorage 캐시 ──────────────────────────────
const SITE_CACHE_KEY = 'ut_site_settings_v1'

function loadSiteCache(): Record<string, any> | null {
  try {
    const raw = localStorage.getItem(SITE_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveSiteCache(data: Record<string, any>) {
  try { localStorage.setItem(SITE_CACHE_KEY, JSON.stringify(data)) } catch {}
}

// ── 마우스 따라다니는 amber dot (CTA 푸터용) ─────────────────
function FollowDot({ container }: { container: { current: HTMLElement | null } }) {
  const dotRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = container.current
    const dot = dotRef.current
    if (!el || !dot) return
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      dot.style.transform = `translate(calc(${e.clientX - r.left}px - 50%), calc(${e.clientY - r.top}px - 50%))`
      dot.style.opacity = '0.5'
    }
    const leave = () => { dot.style.opacity = '0' }
    el.addEventListener('mousemove', move)
    el.addEventListener('mouseleave', leave)
    return () => { el.removeEventListener('mousemove', move); el.removeEventListener('mouseleave', leave) }
  }, [container])
  return (
    <div ref={dotRef} style={{
      position: 'absolute', left: 0, top: 0,
      width: 72, height: 72, borderRadius: '50%',
      background: 'radial-gradient(circle, var(--dot) 0%, transparent 70%)',
      pointerEvents: 'none',
      opacity: 0,
      transition: 'opacity 0.3s ease',
      zIndex: 1,
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


// ── 프리즘 패턴 v3 (랜덤 삼각형, 전방향 분산, 좌→우 페이드) ──────
const PrismCanvas = memo(function PrismCanvas({ isDark }: { isDark: boolean }) {
  const [show, setShow] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShow(true), 120); return () => clearTimeout(t) }, [])

  // 그리드 대신 랜덤 방향/크기 정삼각형 320개 — 전 영역 균등 분산
  const tris = useMemo(() => {
    const W = 1000, H = 500
    const out: { p: string; op: number }[] = []
    for (let i = 0; i < 320; i++) {
      const cx = Math.random() * W
      const cy = Math.random() * H
      const angle = Math.random() * Math.PI        // 임의 방향
      const size  = 12 + Math.random() * 30        // 12~42px 소형~중형
      const pts3  = [0,1,2].map(j => {
        const a = angle + j * 2*Math.PI/3
        return [cx + size*Math.cos(a), cy + size*Math.sin(a)]
      })
      out.push({ p: pts3.map(p=>p.join(',')).join(' '), op: .05+Math.random()*.17 })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const base = isDark ? '255,255,255' : '0,0,0'
  return (
    <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice"
      style={{ position:'absolute', inset:0, width:'100%', height:'100%',
        opacity: show ? 1 : 0, transition: 'opacity 2.4s ease',
        pointerEvents:'none', zIndex:1 }}>
      <defs>
        <linearGradient id="prism-lr" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="white" stopOpacity="0"/>
          <stop offset="28%"  stopColor="white" stopOpacity="0"/>
          <stop offset="58%"  stopColor="white" stopOpacity="0.45"/>
          <stop offset="100%" stopColor="white" stopOpacity="1"/>
        </linearGradient>
        <mask id="prism-mask">
          <rect width="1000" height="500" fill="url(#prism-lr)"/>
        </mask>
      </defs>
      <g mask="url(#prism-mask)">
        {tris.map((t,i) => (
          <polygon key={i} points={t.p}
            fill={`rgba(${base},${t.op})`}
            stroke={`rgba(${base},0.06)`} strokeWidth={.4}/>
        ))}
      </g>
    </svg>
  )
})

// ── 다중 아이코사헤드론 와이어 (원근 투영, 서로 연결, 우측 배치) ──
const ICO_EDGES: [number,number][] = [
  [0,1],[0,4],[0,5],[0,8],[0,9],
  [1,6],[1,7],[1,8],[1,9],
  [2,3],[2,4],[2,5],[2,10],[2,11],
  [3,6],[3,7],[3,10],[3,11],
  [4,5],[4,8],[4,10],
  [5,9],[5,11],
  [6,7],[6,8],[6,10],
  [7,9],[7,11],
  [8,10],[9,11],
]

const WireCanvas = memo(function WireCanvas({ isDark }: { isDark: boolean }) {
  const [show, setShow] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShow(true), 120); return () => clearTimeout(t) }, [])

  const { icoList, connLines } = useMemo(() => {
    const phi = (1 + Math.sqrt(5)) / 2
    const norm = Math.sqrt(1 + phi * phi)
    const rx = 32*Math.PI/180, ry = 20*Math.PI/180
    const baseV: [number,number,number][] = (
      [[0,1,phi],[0,-1,phi],[0,1,-phi],[0,-1,-phi],
       [1,phi,0],[-1,phi,0],[1,-phi,0],[-1,-phi,0],
       [phi,0,1],[-phi,0,1],[phi,0,-1],[-phi,0,-1]]
    ).map(([x,y,z]) => {
      const nx=x/norm, ny=y/norm, nz=z/norm
      const y1=ny*Math.cos(rx)-nz*Math.sin(rx), z1=ny*Math.sin(rx)+nz*Math.cos(rx)
      const x2=nx*Math.cos(ry)+z1*Math.sin(ry), z2=-nx*Math.sin(ry)+z1*Math.cos(ry)
      return [x2, y1, z2] as [number,number,number]
    })

    // F=170 극단적 원근감, 포커스 심도 4.0 근처(nodes 1,2)가 선명
    const F=170, SCX=280, SCY=240, R=0.72

    const centers: [number,number,number][] = [
      [ 0.0,  0.0,  2.2],  // 0: 중앙 기준 (포커스)
      [ 2.1,  0.5,  3.8],  // 1: 우상
      [-1.5, -0.7,  4.4],  // 2: 좌하
      [ 1.3, -1.5,  6.0],  // 3: 우하
      [-0.7,  1.6,  7.2],  // 4: 좌상
      [ 1.2, -0.3,  1.5],  // 5: 우측 이탈 (매우 근접)
      [-2.2,  5.8,  6.0],  // 6: 좌상단 소형
      [ 3.0,  2.5,  5.5],  // 7: 우상단
      [-0.4, -2.8,  8.5],  // 8: 하단
      [-1.2, -1.4,  3.2],  // 9: 하좌
      [ 1.6,  2.6,  4.8],  // 10: 상단 우중간
      [ 2.2, -2.2,  5.2],  // 11: 하단 우중간
      [ 3.6,  0.6,  6.8],  // 12: 우 원거리
      [-0.2, -3.8,  7.8],  // 13: 하단 중앙 원거리
      [ 0.4,  4.2,  9.5],  // 14: 상단 중앙 원거리
    ]

    const proj = (wx:number,wy:number,wz:number) => ({
      px: SCX + wx*(F/wz),
      py: SCY - wy*(F/wz),
      sc: F/wz * R,
    })

    const icoList = centers.map(([wx,wy,wz]) => {
      const { px, py, sc } = proj(wx, wy, wz)
      return {
        verts: baseV.map(([vx,vy]): [number,number] => [px+vx*sc, py-vy*sc]),
        px, py, sc, wz,
      }
    })

    const pairs: [number,number][] = [
      [0,1],[0,2],[1,3],[2,4],[0,4],[1,2],
      [0,5],[1,5],[5,3],
      [0,6],[4,6],
      [1,7],[3,7],[0,7],
      [3,8],[2,8],
      [0,9],[2,9],[9,8],
      [1,10],[7,10],[10,4],
      [3,11],[1,11],[11,9],
      [7,12],[3,12],[12,13],
      [8,13],[9,13],
      [4,14],[10,14],[14,6],
    ]
    const connLines = pairs.map(([a,b]) => ({
      x1:icoList[a].px, y1:icoList[a].py,
      x2:icoList[b].px, y2:icoList[b].py,
    }))

    return { icoList, connLines }
  }, [])

  const base = isDark ? '255,255,255' : '10,10,20'
  const ec = `rgba(${base},0.24)`, dc = `rgba(${base},0.44)`, cc = `rgba(${base},0.09)`
  const REF_SC = icoList[0]?.sc ?? 56
  const FOCUS = 2.2   // node 0 (중앙 기준 20면체) 선명
  const dofBlur = (wz: number) => Math.min(2.0, Math.abs(wz - FOCUS) * 0.6)

  return (
    <svg viewBox="0 0 440 480" preserveAspectRatio="xMaxYMid slice"
      style={{ position:'absolute', right:0, top:0, width:'58%', height:'100%',
        opacity: show ? 1 : 0, transition: 'opacity 2.4s ease',
        pointerEvents:'none', zIndex:1 }}>
      <defs>
        <linearGradient id="wire-lr" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="white" stopOpacity="0"/>
          <stop offset="25%"  stopColor="white" stopOpacity="0.28"/>
          <stop offset="55%"  stopColor="white" stopOpacity="0.65"/>
          <stop offset="100%" stopColor="white" stopOpacity="1"/>
        </linearGradient>
        <mask id="wire-mask">
          <rect width="440" height="480" fill="url(#wire-lr)"/>
        </mask>
        {/* 심도 블러 필터: 포커스 심도≈4.0 기준, 가깝거나 먼 것일수록 흐릿 */}
        {icoList.map((ico, idx) => {
          const b = dofBlur(ico.wz)
          if (b < 0.08) return null
          return (
            <filter key={idx} id={`dof-${idx}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation={b.toFixed(2)}/>
            </filter>
          )
        })}
      </defs>
      <g mask="url(#wire-mask)">
        {connLines.map((c,i) => (
          <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
            stroke={cc} strokeWidth={0.7} strokeDasharray="3 6"/>
        ))}
        {icoList.map((ico,idx) => {
          const ratio = ico.sc / REF_SC
          const b = dofBlur(ico.wz)
          return (
            <g key={idx} {...(b >= 0.08 ? { filter: `url(#dof-${idx})` } : {})}>
              {ICO_EDGES.map(([a,b2],i) => (
                <line key={i}
                  x1={ico.verts[a][0]} y1={ico.verts[a][1]}
                  x2={ico.verts[b2][0]} y2={ico.verts[b2][1]}
                  stroke={ec} strokeWidth={Math.max(0.3, 0.9*ratio)}/>
              ))}
              {ico.verts.map(([x,y],i) => (
                <circle key={i} cx={x} cy={y} r={Math.max(0.8, 2.4*ratio)} fill={dc}/>
              ))}
            </g>
          )
        })}
      </g>
    </svg>
  )
})

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
  const { mode: themeMode, isDark, cycleTheme } = usePublicTheme()
  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor
  const goToApp = () => navigate(isLoggedIn ? '/home' : '/login')
  const enterFrom = (location.state as Record<string, string> | null)?.enterFrom
  const slideClass = enterFrom === 'left' ? 'pub-slide-from-left' : enterFrom === 'right' ? 'pub-slide-from-right' : ''
  const [ctaPalette] = useState(() => CTA_PALETTES[Math.floor(Math.random() * CTA_PALETTES.length)])

  // 캐시에서 초기값 읽기 → API 응답 전 flash 방지
  const _cache = useState(() => loadSiteCache())[0]
  const [ready,         setReady]         = useState(!!_cache)
  const [heroTitle,     setHeroTitle]     = useState(_cache?.site_hero_title     ?? '한 사람의 인덱스')
  const [heroSub,       setHeroSub]       = useState(_cache?.site_hero_subtitle  ?? '매일 들여다보면서 알게 된 것들.')
  const [editorNote,    setEditorNote]    = useState(_cache?.site_editor_note    ?? '인덱스를 만드는 게 목표가 아니라, 다시 찾아보고 싶은 기록을 남기는 게 목표입니다.')
  const [copyright,     setCopyright]     = useState(_cache?.site_footer_copyright ?? 'U.T Lab4 — 한 사람의 인덱스')
  const [marqueeItems,  setMarqueeItems]  = useState<MarqueeItem[]>(() =>
    buildMarqueePool(_cache?.site_marquee_items && Array.isArray(_cache.site_marquee_items) ? _cache.site_marquee_items : [])
  )
  const [marqueeSpeed,    setMarqueeSpeed]    = useState<number>(_cache?.site_marquee_speed    ?? 60)
  const [marqueeType,     setMarqueeType]     = useState<'triple' | 'single'>(_cache?.site_marquee_type     ?? 'triple')
  const [marqueeEnabled,  setMarqueeEnabled]  = useState<boolean>(_cache?.site_marquee_enabled  ?? true)
  const [marqueePosition, setMarqueePosition] = useState<'top' | 'bottom'>(_cache?.site_marquee_position ?? 'top')
  const [footerBg, setFooterBg] = useState<'particle' | 'prism' | 'wire'>(_cache?.site_footer_bg ?? 'particle')

  useEffect(() => {
    settingsApi.publicGet()
      .then(({ data }) => {
        saveSiteCache(data)
        if (data.site_hero_title)       setHeroTitle(data.site_hero_title)
        if (data.site_hero_subtitle)    setHeroSub(data.site_hero_subtitle)
        if (data.site_editor_note)      setEditorNote(data.site_editor_note)
        if (data.site_footer_copyright) setCopyright(data.site_footer_copyright)
        setMarqueeItems(buildMarqueePool(
          data.site_marquee_items && Array.isArray(data.site_marquee_items) ? data.site_marquee_items : []
        ))
        if (typeof data.site_marquee_speed === 'number') setMarqueeSpeed(data.site_marquee_speed)
        if (data.site_marquee_type === 'single' || data.site_marquee_type === 'triple') setMarqueeType(data.site_marquee_type)
        if (typeof data.site_marquee_enabled === 'boolean') setMarqueeEnabled(data.site_marquee_enabled)
        if (data.site_marquee_position === 'top' || data.site_marquee_position === 'bottom') setMarqueePosition(data.site_marquee_position)
        if (data.site_footer_bg === 'particle' || data.site_footer_bg === 'prism' || data.site_footer_bg === 'wire') setFooterBg(data.site_footer_bg)
        setReady(true)
      })
      .catch(() => { setReady(true) })
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
        background: 'var(--pub-header-bg)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--line-2)',
        boxSizing: 'border-box',
      }}>
        {/* 로고 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <LogoMark size={24} variant={isDark ? 'ink' : 'paper'} />
          <Wordmark size={13} />
        </div>
        {/* 버튼 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={cycleTheme}
            title={themeMode === 'dark' ? '다크 모드' : themeMode === 'light' ? '라이트 모드' : '시스템 모드'}
            style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              border: '1px solid var(--line)', background: 'var(--mist)',
              color: 'var(--ink-3)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer',
            }}
          ><ThemeIcon size={14} /></button>
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

      {/* 콘텐츠 — 캐시/API 로드 전엔 숨겨서 flash 방지 */}
      {!ready && <div style={{ minHeight: '100vh' }} />}

      {/* Hero — Wiggly 헤드라인 + 마퀴 */}
      <section style={{ padding: 'clamp(100px,12vw,140px) clamp(20px,4vw,48px) 0', visibility: ready ? 'visible' : 'hidden' }}>
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

        {/* 마퀴 — 형태/활성화 무관하게 고정 공간 확보, position으로 상단/하단 정렬 */}
        <div style={{
          minHeight: 'clamp(280px, 26vw, 380px)',
          paddingBottom: marqueePosition === 'bottom' ? '4px' : 'clamp(64px, 7vw, 100px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: marqueePosition === 'bottom' ? 'flex-end' : 'flex-start',
        }}>
          {marqueeEnabled && (
            marqueeType === 'single' ? (
              <div style={{ overflow: 'hidden' }}>
                <LiveMarquee size={28} weight={400} color="var(--ink-3)" opacity={0.65} duration={marqueeSpeed} items={marqueeRows[0]} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <LiveMarquee size={88} weight={800} color="var(--ink-0)" duration={marqueeSpeed} items={marqueeRows[0]} />
                <LiveMarquee size={60} weight={500} color="var(--ink-2)" reverse opacity={0.96} duration={Math.round(marqueeSpeed * 0.85)} items={marqueeRows[1]} />
                <LiveMarquee size={40} weight={400} color="var(--ink-3)" opacity={0.82} duration={Math.round(marqueeSpeed * 1.6)} items={marqueeRows[2]} />
              </div>
            )
          )}
        </div>
      </section>

      {/* Editor's Note */}
      <section style={{ padding: 'clamp(32px,4vw,56px) clamp(20px,4vw,48px)', display: 'grid', gridTemplateColumns: 'clamp(120px,14vw,180px) 1fr', alignItems: 'start', gap: 'clamp(16px,2vw,32px)', visibility: ready ? 'visible' : 'hidden' }}>
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
        {footerBg === 'particle' && (
          <RaindropCanvas
            bg={ctaPalette.bg}
            bgEdge={ctaPalette.bgEdge}
            particle={ctaPalette.particle}
            highlight={ctaPalette.highlight}
          />
        )}
        {footerBg === 'prism' && <PrismCanvas isDark={ctaPalette.isDark} />}
        {footerBg === 'wire'  && <WireCanvas  isDark={ctaPalette.isDark} />}
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
