export function formatPrice(n: number | null | undefined, currency = '원'): string {
  if (n == null) return '-'
  return n.toLocaleString('ko-KR') + currency
}

export function formatPct(n: number | null | undefined): string {
  if (n == null) return '-'
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

export function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const diffMin = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (diffMin < 1) return '방금'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`
  return `${Math.floor(diffHour / 24)}일 전`
}
