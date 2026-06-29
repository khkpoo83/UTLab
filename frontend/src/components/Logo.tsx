import React from 'react'
import { LogoMark, Wordmark as UTWordmark } from './ut/UTLogo'

export type LogoIconStyle = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'
export type LogoNewStyle  =
  'nw-monolith' |
  'nw-indigo' | 'nw-coral' | 'nw-cradle' | 'nw-brutalist' | 'nw-flask' |
  'nw-folio'  | 'nw-cube'  | 'nw-particle' | 'nw-aperture' | 'nw-stack' |
  'nw-utmark'
export type LogoAnyStyle  = LogoIconStyle | LogoNewStyle

export const LOGO_ICON_STYLES: { id: LogoIconStyle; label: string; desc: string }[] = [
  { id: 'a', label: 'Sky',     desc: '스카이 블루' },
  { id: 'b', label: 'Purple',  desc: '딥 퍼플' },
  { id: 'c', label: 'Teal',    desc: '틸 그린' },
  { id: 'd', label: 'Coral',   desc: '코랄 오렌지' },
  { id: 'e', label: 'Dark',    desc: '다크 슬레이트' },
  { id: 'f', label: 'Forest',  desc: '포레스트 그린' },
  { id: 'g', label: 'Rose',    desc: '로즈 핑크' },
  { id: 'h', label: 'Gold',    desc: '골드 앰버' },
  { id: 'i', label: 'Indigo',  desc: '인디고 네이비' },
  { id: 'j', label: 'Crimson', desc: '크림슨 레드' },
]

const VALID_OLD = new Set<string>(['a','b','c','d','e','f','g','h','i','j'])
const VALID_NEW = new Set<string>([
  'nw-indigo','nw-coral','nw-cradle','nw-brutalist','nw-flask',
  'nw-folio','nw-cube','nw-particle','nw-aperture','nw-stack',
  'nw-utmark',
])

export function getLogoIconStyle(): LogoAnyStyle {
  const s = localStorage.getItem('logoIcon')
  if (s && (VALID_OLD.has(s) || VALID_NEW.has(s))) return s as LogoAnyStyle
  return 'a'
}

export function setLogoIconStyle(s: LogoAnyStyle) {
  localStorage.setItem('logoIcon', s)
  window.dispatchEvent(new Event('logoIconChange'))
}

// ── PNG 로고 ──────────────────────────────────────────────────────────────────

export type LogoPngSrc = 'w1392' | 'w1403'

export interface PngLogoOption {
  src: LogoPngSrc
  filterId: string
  label: string
  filter: string
}

export const PNG_LOGO_OPTIONS: PngLogoOption[] = [
  { src: 'w1392', filterId: 'w1392-orig',   label: '스타일 A · 원본',   filter: 'none' },
  { src: 'w1392', filterId: 'w1392-red',    label: '스타일 A · 레드',    filter: 'hue-rotate(120deg) saturate(1.4)' },
  { src: 'w1392', filterId: 'w1392-purple', label: '스타일 A · 보라',    filter: 'hue-rotate(60deg) saturate(1.2)' },
  { src: 'w1392', filterId: 'w1392-mono',   label: '스타일 A · 흑백',    filter: 'grayscale(1) brightness(0.5)' },
  { src: 'w1403', filterId: 'w1403-orig',   label: '스타일 B · 원본',   filter: 'none' },
  { src: 'w1403', filterId: 'w1403-red',    label: '스타일 B · 레드',    filter: 'hue-rotate(120deg) saturate(1.4)' },
  { src: 'w1403', filterId: 'w1403-purple', label: '스타일 B · 보라',    filter: 'hue-rotate(60deg) saturate(1.2)' },
  { src: 'w1403', filterId: 'w1403-mono',   label: '스타일 B · 흑백',    filter: 'grayscale(1) brightness(0.5)' },
]

export function getPngLogoOption(): PngLogoOption | null {
  const id = localStorage.getItem('logoPngId')
  if (id === '__svg__') return null
  if (id) return PNG_LOGO_OPTIONS.find(o => o.filterId === id) ?? null
  return null
}

export function setPngLogoOption(opt: PngLogoOption | null) {
  localStorage.setItem('logoPngId', opt ? opt.filterId : '__svg__')
  window.dispatchEvent(new Event('logoIconChange'))
}

function pngSrc(src: LogoPngSrc): string {
  return src === 'w1392' ? '/logo_width_1392.png' : '/logo_width_1403.png'
}

// ── iOS 앱 아이콘 스타일 로고 ─────────────────────────────────────────────────

interface StyleConfig {
  top: string
  bot: string
  symbol: 'text' | 'chart' | 'arrow'
}

const ICON_CONFIGS: Record<LogoIconStyle, StyleConfig> = {
  a: { top: '#5BC8F5', bot: '#0A7AC4', symbol: 'text'  },  // Sky Blue
  b: { top: '#B86EDA', bot: '#6A12C4', symbol: 'text'  },  // Deep Purple
  c: { top: '#4EC6BB', bot: '#0C8A7C', symbol: 'text'  },  // Teal
  d: { top: '#FF8561', bot: '#C93200', symbol: 'chart' },  // Coral + chart
  e: { top: '#3C4F62', bot: '#0E1A26', symbol: 'text'  },  // Dark Slate
  f: { top: '#6DD47E', bot: '#1C7832', symbol: 'text'  },  // Forest Green
  g: { top: '#F46FAD', bot: '#C01562', symbol: 'text'  },  // Rose Pink
  h: { top: '#FFD060', bot: '#DC6400', symbol: 'arrow' },  // Gold + arrow
  i: { top: '#6878D4', bot: '#1C2880', symbol: 'text'  },  // Indigo
  j: { top: '#EE4A4A', bot: '#9C0000', symbol: 'text'  },  // Crimson
}

interface IconCfg { ih: number; uid: string; style: LogoIconStyle }

function LogoIcon({ ih, uid, style }: IconCfg) {
  const rx = ih * 0.22
  const cfg = ICON_CONFIGS[style]
  const gId = `${uid}-g`
  const glId = `${uid}-gl`

  const defs = (
    <defs>
      <linearGradient id={gId} x1="0" y1="0" x2="0" y2={ih} gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={cfg.top} />
        <stop offset="100%" stopColor={cfg.bot} />
      </linearGradient>
      <linearGradient id={glId} x1="0" y1="0" x2="0" y2={ih * 0.55} gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="white" stopOpacity={0.28} />
        <stop offset="100%" stopColor="white" stopOpacity={0} />
      </linearGradient>
    </defs>
  )

  const base = (
    <>
      <rect width={ih} height={ih} rx={rx} fill={`url(#${gId})`} />
      <rect width={ih} height={ih} rx={rx} fill={`url(#${glId})`} />
    </>
  )

  if (cfg.symbol === 'chart') {
    const pts = [
      [0.12, 0.76], [0.32, 0.48], [0.50, 0.60], [0.68, 0.28], [0.88, 0.44],
    ].map(([px, py]) => `${(px * ih).toFixed(1)},${(py * ih).toFixed(1)}`).join(' ')
    return (
      <>
        {defs}{base}
        <polyline points={pts} fill="none" stroke="white"
          strokeWidth={ih * 0.1} strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      </>
    )
  }

  if (cfg.symbol === 'arrow') {
    const ax = ih * 0.5, aw = ih * 0.36, sw = ih * 0.15
    const sy1 = ih * 0.44, sy2 = ih * 0.78
    return (
      <>
        {defs}{base}
        <polygon
          points={`${ax},${ih * 0.14} ${ax + aw},${ih * 0.50} ${ax - aw},${ih * 0.50}`}
          fill="white" opacity="0.95"
        />
        <rect x={ax - sw} y={sy1} width={sw * 2} height={sy2 - sy1} fill="white" opacity="0.95" />
      </>
    )
  }

  return (
    <>
      {defs}{base}
      <text
        x={ih * 0.15} y={ih * 0.76}
        fontFamily="Pretendard,system-ui,sans-serif"
        fontSize={ih * 0.62} fontWeight="800" fill="white"
      >U</text>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  신규 아이콘 컴포넌트 (icons.jsx 포팅)
// ══════════════════════════════════════════════════════════════════════════════

interface NI { size?: number }

// UTLogo의 LogoMark를 그대로 사용 (renewal aperture 스타일)
const NwUTMark: React.FC<NI> = ({ size = 44 }) => <LogoMark size={size} />

const NwMonolith: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.235
  const dot = size * 0.085
  return (
    <div style={{
      width: size, height: size, borderRadius: r,
      background: '#0A0A0B', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      fontFamily: 'Pretendard Variable, system-ui, sans-serif',
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'baseline', gap: size * 0.035,
        fontWeight: 800, fontSize: size * 0.50, color: '#FAFAF7',
        letterSpacing: '-0.06em', lineHeight: 1,
      }}>
        <span>U</span>
        <span style={{ width: dot, height: dot, borderRadius: '50%', background: '#F59E0B', alignSelf: 'baseline', marginBottom: size * 0.04, flexShrink: 0 }} />
        <span>T</span>
      </div>
    </div>
  )
}

const NwIndigo: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      background: 'linear-gradient(135deg,#6473ff 0%,#3331c4 100%)',
      borderRadius: r, display: 'grid', placeItems: 'center',
      boxShadow: '0 4px 14px rgba(50,40,180,0.35),inset 0 1px 0 rgba(255,255,255,0.22)',
      fontFamily: '"SF Pro Display","Pretendard Variable",system-ui,sans-serif',
      overflow: 'hidden',
    }}>
      <span style={{ fontWeight: 800, fontSize: size * 0.44, color: '#fff', letterSpacing: '-0.05em', lineHeight: 1 }}>U<span style={{ color: 'rgba(255,200,80,0.95)' }}>.</span>T</span>
    </div>
  )
}

const NwCoral: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225, dot = size * 0.10
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, background: '#0e1117', borderRadius: r,
      display: 'grid', placeItems: 'center',
      border: `${Math.max(1, size * 0.005)}px solid #1f242e`,
      fontFamily: '"SF Pro Display","Pretendard Variable",sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: size * 0.035, fontWeight: 800, fontSize: size * 0.5, color: '#f4f4f6', letterSpacing: '-0.06em', lineHeight: 1 }}>
        <span>U</span>
        <span style={{ width: dot, height: dot, borderRadius: '50%', background: '#F97316', flex: 'none', boxShadow: `0 0 0 ${size * 0.012}px rgba(249,115,22,0.18)` }} />
        <span>T</span>
      </div>
    </div>
  )
}

const NwCradle: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      background: 'linear-gradient(160deg,#0e4639 0%,#082a23 100%)',
      borderRadius: r, position: 'relative', overflow: 'hidden',
    }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <path d="M24 26 L24 60 A26 26 0 0 0 76 60 L76 26" stroke="#34d399" strokeWidth="9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M37 44 L63 44" stroke="#ffffff" strokeWidth="8" strokeLinecap="round" />
        <path d="M50 44 L50 72" stroke="#ffffff" strokeWidth="8" strokeLinecap="round" />
      </svg>
    </div>
  )
}

const NwBrutalist: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, background: '#f4f1ea',
      borderRadius: r, overflow: 'hidden', position: 'relative',
      fontFamily: '"SF Pro Display","Pretendard Variable",sans-serif',
    }}>
      <div style={{ position: 'absolute', left: size*0.08, top: size*0.08, right: size*0.08, bottom: size*0.08, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 900, fontSize: size*0.34, color: '#0b0a09', letterSpacing: '-0.075em', lineHeight: 0.84, transform: 'scaleX(0.92)', transformOrigin: 'left top' }}>
          U.T<br />LAB4
        </div>
        <div style={{ display: 'flex', gap: size*0.018, alignItems: 'flex-end' }}>
          <div style={{ width: size*0.04, height: size*0.18, background: '#0b0a09' }} />
          <div style={{ width: size*0.04, height: size*0.10, background: '#0b0a09' }} />
          <div style={{ width: size*0.04, height: size*0.22, background: '#F97316' }} />
        </div>
      </div>
    </div>
  )
}

const NwFlask: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  const pid = `fl-${size}`
  return (
    <div style={{ width: size, height: size, flexShrink: 0, background: '#08111f', borderRadius: r, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.18 }}>
        <defs><pattern id={pid} width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="0.5" fill="#7cd8e0" /></pattern></defs>
        <rect width="100" height="100" fill={`url(#${pid})`} />
      </svg>
      <svg viewBox="0 0 100 100" width={size * 0.62} height={size * 0.62}>
        <path d="M40 18 L40 38 L22 76 A8 8 0 0 0 30 86 L70 86 A8 8 0 0 0 78 76 L60 38 L60 18 Z" fill="none" stroke="#7cd8e0" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="36" y1="22" x2="64" y2="22" stroke="#7cd8e0" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M30 70 Q50 65 70 70" fill="none" stroke="#a9e7ec" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        <circle cx="50" cy="74" r="3" fill="#7cd8e0" />
      </svg>
    </div>
  )
}

const NwFolio: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  return (
    <div style={{ width: size, height: size, flexShrink: 0, background: '#f1ece1', borderRadius: r, position: 'relative', overflow: 'hidden', fontFamily: '"SF Pro Display","Pretendard Variable",sans-serif' }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <path d="M100 0 L100 20 L80 0 Z" fill="rgba(0,0,0,0.08)" />
        <path d="M82 2 L98 18 L80 18 Z" fill="#e6ddc9" />
        <line x1="18" y1="62" x2="62" y2="62" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
        <line x1="18" y1="72" x2="74" y2="72" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
        <line x1="18" y1="82" x2="54" y2="82" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
      </svg>
      <div style={{ position: 'absolute', left: size*0.13, top: size*0.18, fontWeight: 700, fontSize: size*0.28, color: '#231c12', letterSpacing: '-0.05em', lineHeight: 1 }}>
        u<span style={{ color: '#c47a1a' }}>.</span>t
      </div>
    </div>
  )
}

const NwCube: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  return (
    <div style={{ width: size, height: size, flexShrink: 0, background: 'radial-gradient(circle at 30% 25%,#1a223a 0%,#0a0e1a 70%)', borderRadius: r, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" width={size * 0.7} height={size * 0.7}>
        <ellipse cx="50" cy="86" rx="22" ry="3" fill="rgba(0,0,0,0.4)" />
        <path d="M50 18 L78 32 L50 46 L22 32 Z" fill="#7686ff" />
        <path d="M22 32 L22 66 L50 80 L50 46 Z" fill="#3d44c4" />
        <path d="M78 32 L78 66 L50 80 L50 46 Z" fill="#5764e0" />
        <text x="52" y="64" fontSize="10" fontFamily='"SF Pro Display",sans-serif' fontWeight="800" fill="#fff" letterSpacing="-0.3" transform="skewY(-13)">U.T</text>
      </svg>
    </div>
  )
}

const NwParticle: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  const id = `pt-${size}`
  return (
    <div style={{ width: size, height: size, flexShrink: 0, background: '#000', borderRadius: r, position: 'relative', overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <defs>
          <pattern id={`pat-${id}`} width="2.6" height="2.6" patternUnits="userSpaceOnUse">
            <circle cx="1.3" cy="1.3" r="0.55" fill="#fff" />
            <circle cx="1.3" cy="1.3" r="0.95" fill="#fff" opacity="0.12" />
          </pattern>
          <mask id={`mask-${id}`}>
            <rect width="100" height="100" fill="black" />
            <text x="50" y="62" fontSize="38" fontFamily='"SF Pro Display",sans-serif' fontWeight="900" textAnchor="middle" fill="white" letterSpacing="-2">U.T</text>
          </mask>
        </defs>
        <rect width="100" height="100" fill={`url(#pat-${id})`} mask={`url(#mask-${id})`} />
      </svg>
    </div>
  )
}

const NwAperture: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  return (
    <div style={{ width: size, height: size, flexShrink: 0, background: '#0e1118', borderRadius: r, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <circle cx="50" cy="50" r="38" fill="none" stroke="#262d3d" strokeWidth="1" strokeDasharray="0.8 2.5" />
        <circle cx="50" cy="50" r="28" fill="none" stroke="#3b4566" strokeWidth="1" strokeDasharray="0.8 2.2" />
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i * 60) * Math.PI / 180
          return <line key={i} x1={50+Math.cos(a)*12} y1={50+Math.sin(a)*12} x2={50+Math.cos(a)*22} y2={50+Math.sin(a)*22} stroke="#6c7bff" strokeWidth="2" strokeLinecap="round" />
        })}
        <circle cx="50" cy="50" r="3.2" fill="#6c7bff" />
        <circle cx="50" cy="50" r="6" fill="none" stroke="#6c7bff" strokeWidth="0.6" />
      </svg>
    </div>
  )
}

const NwStack: React.FC<NI> = ({ size = 44 }) => {
  const r = size * 0.225
  return (
    <div style={{ width: size, height: size, flexShrink: 0, background: 'linear-gradient(180deg,#f7f3ec 0%,#ece6da 100%)', borderRadius: r, position: 'relative', overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <rect x="22" y="36" width="56" height="48" rx="6" fill="#ccc1a4" />
        <rect x="26" y="30" width="56" height="48" rx="6" fill="#a18d61" />
        <rect x="30" y="20" width="56" height="50" rx="6" fill="#15110a" />
        <text x="58" y="51" fontSize="19" fontFamily='"SF Pro Display",sans-serif' fontWeight="900" textAnchor="middle" fill="#f3ead3" letterSpacing="-0.8">U.T</text>
        <circle cx="46" cy="52" r="1.8" fill="#f97316" />
      </svg>
    </div>
  )
}

/* 신규 스타일 메타데이터 */
export const NEW_LOGO_STYLES: { id: LogoNewStyle; label: string; desc: string; Component: React.FC<NI> }[] = [
  { id: 'nw-utmark',    label: 'U.T Mark',  desc: '크림 사각 + 앰버 도트', Component: NwUTMark   },
  { id: 'nw-monolith',  label: 'Monolith',  desc: 'U·dot·T 앰버',     Component: NwMonolith  },
  { id: 'nw-indigo',    label: 'Indigo',    desc: '인디고 그라디언트',  Component: NwIndigo    },
  { id: 'nw-coral',     label: 'Coral',     desc: 'U·T 코랄 도트',     Component: NwCoral     },
  { id: 'nw-cradle',    label: 'Cradle',    desc: 'U가 T를 감싸는 형', Component: NwCradle    },
  { id: 'nw-brutalist', label: 'Brutalist', desc: '브루탈리스트 타이포', Component: NwBrutalist },
  { id: 'nw-flask',     label: 'Flask',     desc: '플라스크 Lab 아이콘', Component: NwFlask    },
  { id: 'nw-folio',     label: 'Folio',     desc: '저널 페이퍼 스타일', Component: NwFolio    },
  { id: 'nw-cube',      label: 'Cube',      desc: '아이소메트릭 큐브',  Component: NwCube      },
  { id: 'nw-particle',  label: 'Particle',  desc: '도트 파티클 U.T',   Component: NwParticle  },
  { id: 'nw-aperture',  label: 'Aperture',  desc: '어퍼처 렌즈 심볼',  Component: NwAperture  },
  { id: 'nw-stack',     label: 'Stack',     desc: '레이어드 카드 스택', Component: NwStack     },
]
const NEW_LOGO_IDS = new Set<string>(NEW_LOGO_STYLES.map(s => s.id))

// ── 메인 Logo 컴포넌트 ────────────────────────────────────────────────────────

interface LogoProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  iconStyle?: LogoAnyStyle
  iconOnly?: boolean
}

const Logo: React.FC<LogoProps> = ({ className = '', size = 'md', iconStyle, iconOnly = false }) => {
  const [style, setStyle] = React.useState<LogoAnyStyle>(iconStyle ?? getLogoIconStyle())
  const [pngOpt, setPngOpt] = React.useState<PngLogoOption | null>(iconStyle ? null : getPngLogoOption())

  React.useEffect(() => {
    if (iconStyle) { setStyle(iconStyle); setPngOpt(null); return }
    const handler = () => { setStyle(getLogoIconStyle()); setPngOpt(getPngLogoOption()) }
    window.addEventListener('logoIconChange', handler)
    return () => window.removeEventListener('logoIconChange', handler)
  }, [iconStyle])

  const cfg = {
    sm:  { ih: 16, fs: 13, gap: 4 },
    md:  { ih: 22, fs: 16, gap: 5 },
    lg:  { ih: 30, fs: 22, gap: 7 },
  }[size]

  const { ih, fs, gap } = cfg
  const uid = `ul-${size}-${style}`

  // ── PNG 로고 ─────────────────────────────────────────────────────────────
  if (pngOpt) {
    const handleImgError = () => { setPngOpt(null); localStorage.removeItem('logoPngId') }
    const imgStyle: React.CSSProperties = {
      width: ih, height: ih,
      filter: pngOpt.filter === 'none' ? undefined : pngOpt.filter,
      borderRadius: '18%', objectFit: 'cover', flexShrink: 0,
    }
    if (iconOnly) return <img src={pngSrc(pngOpt.src)} alt="U.T Lab4" style={imgStyle} className={className} onError={handleImgError} />
    return (
      <div className={`inline-flex items-center ${className}`} style={{ gap }} aria-label="U.T Lab4">
        <img src={pngSrc(pngOpt.src)} alt="" style={imgStyle} onError={handleImgError} />
        <LogoWordmark fs={fs} ih={ih} />
      </div>
    )
  }

  // ── 신규 아이콘 ──────────────────────────────────────────────────────────
  const newDef = NEW_LOGO_STYLES.find(s => s.id === style)
  if (newDef || NEW_LOGO_IDS.has(style)) {
    const IconComp = newDef?.Component ?? NwIndigo
    if (iconOnly) return <div className={className}><IconComp size={ih} /></div>
    // nw-utmark는 UTLogo Wordmark 사용 (renewal 타이포그래피)
    if (style === 'nw-utmark') {
      return (
        <div className={`inline-flex items-center ${className}`} style={{ gap }} aria-label="U.T Lab4">
          <IconComp size={ih} />
          <UTWordmark size={fs} />
        </div>
      )
    }
    return (
      <div className={`inline-flex items-center ${className}`} style={{ gap }} aria-label="U.T Lab4">
        <IconComp size={ih} />
        <LogoWordmark fs={fs} ih={ih} />
      </div>
    )
  }

  // ── 기존 SVG 아이콘 ──────────────────────────────────────────────────────
  const oldStyle = style as LogoIconStyle
  const uW   = { sm: 9,  md: 11, lg: 15 }[size]   // "U"
  const dotW = { sm: 4,  md: 5,  lg: 7  }[size]   // "."
  const tW   = { sm: 9,  md: 11, lg: 15 }[size]   // "T"
  const lab4W = { sm: 28, md: 34, lg: 46 }[size]  // " Lab4"
  const baseY = ih * 0.77

  if (iconOnly) {
    return (
      <svg width={ih} height={ih} viewBox={`0 0 ${ih} ${ih}`} fill="none"
        xmlns="http://www.w3.org/2000/svg" className={className} aria-label="U.T Lab4">
        <LogoIcon ih={ih} uid={uid} style={oldStyle} />
      </svg>
    )
  }

  const textX = ih + gap
  const totalW = Math.ceil(textX + uW + dotW + tW + lab4W + 2)

  return (
    <svg width={totalW} height={ih} viewBox={`0 0 ${totalW} ${ih}`} fill="none"
      xmlns="http://www.w3.org/2000/svg" className={className} aria-label="U.T Lab4">
      <LogoIcon ih={ih} uid={uid} style={oldStyle} />
      <text x={textX}                         y={baseY} fontFamily="Pretendard,system-ui,sans-serif" fontSize={fs} fontWeight="700" fill="currentColor">U</text>
      <text x={textX + uW}                    y={baseY} fontFamily="Pretendard,system-ui,sans-serif" fontSize={fs} fontWeight="700" fill="#F59E0B">.</text>
      <text x={textX + uW + dotW}             y={baseY} fontFamily="Pretendard,system-ui,sans-serif" fontSize={fs} fontWeight="700" fill="currentColor">T</text>
      <text x={textX + uW + dotW + tW}        y={baseY} fontFamily="Pretendard,system-ui,sans-serif" fontSize={fs} fontWeight="300" fill="currentColor" opacity="0.7"> Lab4</text>
    </svg>
  )
}

// ── 워드마크 텍스트 (신규 아이콘 + PNG 공용) ──────────────────────────────
function LogoWordmark({ fs }: { fs: number; ih?: number }) {
  return (
    <span style={{ fontSize: fs, fontWeight: 700, letterSpacing: '-0.025em', color: 'inherit', lineHeight: 1, fontFamily: 'Pretendard,system-ui,sans-serif' }}>
      U<span style={{ color: '#F59E0B' }}>.</span>T<span style={{ fontWeight: 300, opacity: 0.72 }}> Lab4</span>
    </span>
  )
}

export default Logo
