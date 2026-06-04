/**
 * 메모(포스트잇) 종이 색상 팔레트 유틸
 *
 * 모드 A — pastel: 테마 무관 고정 다색 종이톤
 * 모드 B — theme: 현재 accent(--c-accent-rgb)를 hue 기반으로 톤온톤 생성
 */

export interface PaperColor {
  bg: string   // 종이 배경색 (solid hex or hsl)
  edge: string // 테두리/그림자 강조색
  ink: string  // 글자색
}

// ── 모드 A: 파스텔 고정 팔레트 ────────────────────────────────────────────────
// 12종 — 라이트/다크 동일한 밝은 종이톤 (어두운 배경에 밝은 포스트잇이 자연스러움)
const PASTEL_COLORS: PaperColor[] = [
  { bg: '#f1d979', edge: '#d4b85a', ink: '#3a2f10' }, // mustard
  { bg: '#cfde9f', edge: '#a8bb7d', ink: '#1f2e15' }, // sage
  { bg: '#f1b5c2', edge: '#cf8a9c', ink: '#3a1820' }, // rose
  { bg: '#cdc4ec', edge: '#9d92c8', ink: '#1f1838' }, // lilac
  { bg: '#b3d9ec', edge: '#83b1c9', ink: '#0e2030' }, // sky
  { bg: '#f3c79c', edge: '#cf9b6e', ink: '#3a1f0e' }, // peach
  { bg: '#b8e0cf', edge: '#86bca6', ink: '#0f2a22' }, // mint
  { bg: '#fde68a', edge: '#d97706', ink: '#3a2200' }, // amber
  { bg: '#ddd6fe', edge: '#7c3aed', ink: '#2e1065' }, // violet
  { bg: '#fed7aa', edge: '#ea580c', ink: '#431407' }, // orange
  { bg: '#bfdbfe', edge: '#2563eb', ink: '#1e3a5f' }, // blue
  { bg: '#d1fae5', edge: '#059669', ink: '#064e3b' }, // emerald
]

export const PASTEL_PALETTE = { light: PASTEL_COLORS, dark: PASTEL_COLORS }

// ── 모드 B: accent 기반 톤온톤 생성 ───────────────────────────────────────────

/** RGB 스페이스 구분 문자열(예: "26 158 255") → { h, s, l } */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  s = Math.max(0, Math.min(1, s))
  l = Math.max(0, Math.min(1, l))
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * v).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** --c-accent-rgb "R G B" 파싱 */
function parseAccentRgb(raw: string): [number, number, number] {
  const parts = raw.trim().split(/\s+/).map(Number)
  if (parts.length >= 3) return [parts[0], parts[1], parts[2]]
  return [26, 158, 255] // 폴백
}

/**
 * accent hue 기반 톤온톤 종이 팔레트 생성 (12종)
 * 라이트/다크 모두 밝은 종이톤 — 파스텔 모드와 동일한 철학
 */
export function memoPaperPalette(accentRgb: string, scheme: 'light' | 'dark'): PaperColor[] {
  const [r, g, b] = parseAccentRgb(accentRgb)
  const { h } = rgbToHsl(r, g, b)

  // 12종 hue 오프셋 — 황금비 기반으로 충분히 분산
  const hueOffsets = [-18, 0, 22, -8, 38, 12, -30, 48, -5, 25, -42, 15]
  // 밝기/채도 변주 (인덱스별 고정)
  const bgLights  = [0.86, 0.82, 0.89, 0.80, 0.87, 0.84, 0.83, 0.88, 0.81, 0.85, 0.82, 0.87]
  const bgSats    = [0.34, 0.44, 0.30, 0.40, 0.36, 0.32, 0.46, 0.28, 0.42, 0.35, 0.38, 0.43]

  return hueOffsets.map((offset, idx) => {
    const hue = (h + offset + 360) % 360
    // 다크 모드에서도 밝은 종이톤 유지 (약간만 낮춤)
    const bgL = bgLights[idx] - (scheme === 'dark' ? 0.04 : 0)
    const bgS = bgSats[idx]
    const edgeL = bgL - 0.12
    const edgeS = bgS + 0.12

    const bg   = hslToHex(hue, bgS, bgL)
    const edge = hslToHex(hue, edgeS, edgeL)
    const ink  = hslToHex(hue, 0.50, 0.17)  // 진한 동계열 잉크 (라이트/다크 동일)
    return { bg, edge, ink }
  })
}

/** bg hex → 라이트/다크 판단 후 ink 반환 (대비 자동) */
export function autoInk(bgHex: string): string {
  const r = parseInt(bgHex.slice(1, 3), 16)
  const g = parseInt(bgHex.slice(3, 5), 16)
  const b = parseInt(bgHex.slice(5, 7), 16)
  // 상대 휘도 근사
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#1a1a1a' : '#f0f0f0'
}

/**
 * 노트 id와 팔레트로 결정적 색상 선택
 * (hashRand는 Memo.tsx에 있으므로 인덱스만 계산)
 */
export function pickPaperColor(palette: PaperColor[], hashValue: number): PaperColor {
  const idx = Math.floor(hashValue * palette.length)
  return palette[Math.max(0, Math.min(palette.length - 1, idx))]
}
