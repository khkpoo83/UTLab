export const CHART_TOOLTIP_STYLE: Record<string, string | number> = {
  fontSize: 12,
  backgroundColor: 'var(--tooltip-bg)',
  border: '1px solid var(--tooltip-border)',
  borderRadius: 8,
  color: 'var(--tooltip-text)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
}

export const CHART_TOOLTIP_LABEL_STYLE: Record<string, string> = {
  color: 'var(--tooltip-label)',
}

export const CHART_TOOLTIP_ITEM_STYLE: Record<string, string> = {
  color: 'var(--tooltip-text)',
}

export const CHART_CURSOR_STYLE: Record<string, string> = {
  fill: 'var(--chart-cursor-fill)',
}

/** CSS 변수에서 상승/하락 색상을 읽어 반환. SSR/초기화 전에는 fallback 사용. */
export function getChartColors(): { up: string; down: string } {
  if (typeof window === 'undefined') return { up: '#EF4444', down: '#3B82F6' }
  const style = getComputedStyle(document.documentElement)
  const up   = style.getPropertyValue('--c-up').trim()   || '#EF4444'
  const down = style.getPropertyValue('--c-down').trim() || '#3B82F6'
  return { up, down }
}
