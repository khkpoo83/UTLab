export type OverlayStyle = 'both' | 'dim' | 'blur' | 'frosted' | 'none'

export const OVERLAY_OPTIONS: { id: OverlayStyle; label: string; desc: string }[] = [
  { id: 'both',    label: '음영+블러', desc: '반투명 어둡게 + 블러' },
  { id: 'dim',     label: '음영',      desc: '반투명 어둡게만' },
  { id: 'blur',    label: '블러',      desc: '흐리게만 (밝은 톤)' },
  { id: 'frosted', label: '프로스트',  desc: '밝은 반투명 유리' },
  { id: 'none',    label: '없음',      desc: '배경 처리 없음' },
]

export function loadOverlayStyle(): OverlayStyle {
  return (localStorage.getItem('overlay_style') as OverlayStyle) ?? 'both'
}

export function applyOverlayStyle(style: OverlayStyle) {
  document.documentElement.setAttribute('data-overlay', style)
  localStorage.setItem('overlay_style', style)
}
