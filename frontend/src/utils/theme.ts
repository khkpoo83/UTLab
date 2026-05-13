/**
 * 테마 accent 색상 기반 토널 팔레트 생성
 * CSS 변수 --c-accent-rgb 를 읽어 opacity 단계별 색상 배열 반환
 * Recharts Cell fill, SVG 등 CSS class를 쓸 수 없는 곳에서 사용
 */
export function getTonalPalette(): string[] {
  const rgb =
    (typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
          .getPropertyValue('--c-accent-rgb')
          .trim()
      : '') || '26 158 255'

  // 짙은 → 연한 순서 (차트 비중 순서 대응)
  return [
    `rgb(${rgb} / 1.00)`,
    `rgb(${rgb} / 0.78)`,
    `rgb(${rgb} / 0.58)`,
    `rgb(${rgb} / 0.42)`,
    `rgb(${rgb} / 0.30)`,
    `rgb(${rgb} / 0.20)`,
    `rgb(${rgb} / 0.50)`,  // 7번째 이상 wrap-around용
  ]
}
