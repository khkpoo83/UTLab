import { useEffect, useState } from 'react'

export type PubTheme = 'light' | 'dark' | 'system'

function getIsDark(mode: PubTheme, sysDark: boolean) {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return sysDark
}

export function usePublicTheme() {
  const [mode, setMode] = useState<PubTheme>(() => {
    const s = localStorage.getItem('pub_theme') as PubTheme | null
    return s === 'light' || s === 'dark' || s === 'system' ? s : 'system'
  })
  const [sysDark, setSysDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  // 시스템 선호도 변경 감지
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isDark = getIsDark(mode, sysDark)

  // html.dark 클래스 적용 + 언마운트 시 로그인 테마 복원
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    return () => {
      const loginTheme = localStorage.getItem('theme')
      const loginDark =
        loginTheme === 'dark' ? true
        : loginTheme === 'light' ? false
        : window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', loginDark)
    }
  }, [isDark])

  const cycleTheme = () => {
    const next: PubTheme =
      mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light'
    localStorage.setItem('pub_theme', next)
    setMode(next)
  }

  return { mode, isDark, cycleTheme }
}
