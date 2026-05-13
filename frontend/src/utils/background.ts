export type BgType = 'none' | 'solid' | 'gradient' | 'dot' | 'grid' | 'line' | 'diagonal' | 'cross'
export type GradientDir = '135deg' | '90deg' | '180deg' | '45deg' | '225deg' | '0deg'

export interface BgConfig {
  type: BgType
  patternColor: string  // 패턴 무늬 색 (hex)
  size: number          // 패턴 크기 px 10–60
  opacity: number       // 패턴 불투명도 0–100
  solidColor: string    // solid 배경색 (hex)
  gradientFrom: string  // gradient 시작색 (hex)
  gradientTo: string    // gradient 종료색 (hex)
  gradientDir: GradientDir
  bgFixed: boolean      // true: background-attachment fixed (뷰포트 고정)
}

export const BG_DEFAULTS: BgConfig = {
  type: 'none',
  patternColor: '#e4e4e7',
  size: 24,
  opacity: 60,
  solidColor: '#f8fafc',
  gradientFrom: '#e0f2fe',
  gradientTo: '#fdf4ff',
  gradientDir: '135deg',
  bgFixed: true,
}

export function loadBgConfig(): BgConfig {
  try {
    const s = localStorage.getItem('bgConfig')
    if (!s) return { ...BG_DEFAULTS }
    return { ...BG_DEFAULTS, ...JSON.parse(s) }
  } catch {
    return { ...BG_DEFAULTS }
  }
}

export function saveBgConfig(cfg: BgConfig) {
  localStorage.setItem('bgConfig', JSON.stringify(cfg))
}

function hexToRgba(hex: string, opacity: number): string {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${(opacity / 100).toFixed(2)})`
}

export interface BgStyle {
  backgroundImage: string
  backgroundSize: string
}

export function getBgStyle(cfg: BgConfig): BgStyle {
  if (cfg.type === 'none' || cfg.type === 'solid' || cfg.type === 'gradient') {
    return { backgroundImage: '', backgroundSize: '' }
  }

  const pc = hexToRgba(cfg.patternColor, cfg.opacity)
  const s = cfg.size

  switch (cfg.type) {
    case 'dot':
      return {
        backgroundImage: `radial-gradient(${pc} 1.5px, transparent 1.5px)`,
        backgroundSize: `${s}px ${s}px`,
      }
    case 'grid':
      return {
        backgroundImage: [
          `linear-gradient(to right, ${pc} 1px, transparent 1px)`,
          `linear-gradient(to bottom, ${pc} 1px, transparent 1px)`,
        ].join(', '),
        backgroundSize: `${s}px ${s}px`,
      }
    case 'line':
      return {
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent calc(${s}px - 1px), ${pc} calc(${s}px - 1px), ${pc} ${s}px)`,
        backgroundSize: '',
      }
    case 'diagonal':
      return {
        backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent calc(${s}px - 1px), ${pc} calc(${s}px - 1px), ${pc} ${s}px)`,
        backgroundSize: '',
      }
    case 'cross':
      return {
        backgroundImage: [
          `repeating-linear-gradient(0deg, transparent, transparent calc(${s}px - 1px), ${pc} calc(${s}px - 1px), ${pc} ${s}px)`,
          `repeating-linear-gradient(90deg, transparent, transparent calc(${s}px - 1px), ${pc} calc(${s}px - 1px), ${pc} ${s}px)`,
        ].join(', '),
        backgroundSize: '',
      }
    default:
      return { backgroundImage: '', backgroundSize: '' }
  }
}

export function applyBackground(cfg: BgConfig) {
  const body = document.body
  const fixed = cfg.bgFixed ? 'fixed' : ''

  if (cfg.type === 'solid') {
    body.style.backgroundImage      = ''
    body.style.backgroundSize       = ''
    body.style.backgroundAttachment = ''
    body.style.backgroundColor      = cfg.solidColor || BG_DEFAULTS.solidColor
  } else if (cfg.type === 'gradient') {
    const from = cfg.gradientFrom || BG_DEFAULTS.gradientFrom
    const to   = cfg.gradientTo   || BG_DEFAULTS.gradientTo
    const dir  = cfg.gradientDir  || BG_DEFAULTS.gradientDir
    body.style.backgroundColor      = ''
    body.style.backgroundSize       = fixed ? '100% 100vh' : ''
    body.style.backgroundAttachment = fixed
    body.style.backgroundImage      = `linear-gradient(${dir}, ${from}, ${to})`
  } else {
    body.style.backgroundColor      = ''
    body.style.backgroundAttachment = fixed
    const { backgroundImage, backgroundSize } = getBgStyle(cfg)
    body.style.backgroundImage = backgroundImage
    body.style.backgroundSize  = backgroundSize
  }
}
