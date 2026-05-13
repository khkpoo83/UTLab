export const STRENGTH_CONFIG = {
  strong: { label: '강력추천', stars: '★★★', cls: 'text-up' },
  normal: { label: '추천',   stars: '★★☆', cls: 'text-accent' },
  watch:  { label: '관심',   stars: '★☆☆', cls: 'text-zinc-400' },
} as const

export type StrengthKey = keyof typeof STRENGTH_CONFIG
