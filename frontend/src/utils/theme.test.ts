import { describe, it, expect } from 'vitest'
import { getTonalPalette } from './theme'

describe('getTonalPalette', () => {
  it('rgb() opacity 계단 색상 배열을 반환한다', () => {
    const palette = getTonalPalette()
    expect(Array.isArray(palette)).toBe(true)
    expect(palette.length).toBeGreaterThanOrEqual(6)
    palette.forEach((c) => {
      expect(c).toMatch(/^rgb\(.+ \/ [\d.]+\)$/)
    })
  })

  it('CSS 변수 미설정 시 기본 accent RGB(26 158 255)로 폴백한다', () => {
    // jsdom 에서는 --c-accent-rgb 가 비어있으므로 폴백값이 사용된다
    const palette = getTonalPalette()
    expect(palette[0]).toBe('rgb(26 158 255 / 1.00)')
  })
})
