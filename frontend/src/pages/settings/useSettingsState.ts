// Settings state + persistence logic (roadmap Phase 3, P3-3 deep decomposition).
// Extracted verbatim from pages/Settings.tsx so the page component is render-only.
// Owns the server settings dict, the pending appearance values (applied on save),
// profile state, and the load/save/revert flow.
import { useState, useEffect, useRef, useContext } from 'react'
import { NavModeContext } from '../../contexts'
import { settingsApi, profileApi, UserProfile, AiUsageStats } from '../../api/client'
import { LogoAnyStyle, getLogoIconStyle, setLogoIconStyle } from '../../components/Logo'
import { BgConfig, loadBgConfig, saveBgConfig, applyBackground, BG_DEFAULTS } from '../../utils/background'
import { WeatherIconStyle, getWeatherIconStyle, saveWeatherIconStyle } from '../../components/WeatherWidget'
import { OverlayStyle, loadOverlayStyle, applyOverlayStyle } from '../../utils/overlay'
import {
  loadPnlColorConfig, applyPnlColors, PnlColorConfig,
  applyUiRadius, getUiRadius, UiRadius, getCardOpacity, applyCardOpacity,
  applyDotColor, getDotColor,
  applyColorTheme, getColorTheme, ColorTheme,
} from '../../utils/settings-utils'

export function useSettingsState() {
  const [settings, setSettings] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [aiUsage, setAiUsage] = useState<AiUsageStats | null>(null)
  const dragState = useRef<{ active: boolean; day: number; hour: number; setTo: boolean } | null>(null)
  const aiPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { navMode, setNavMode } = useContext(NavModeContext)

  // 시각 설정 — 저장 전까지 pending 상태
  const [pendingNavMode, setPendingNavMode] = useState<'top' | 'sidebar'>(navMode)
  const [pendingLogoIcon, setPendingLogoIcon] = useState<LogoAnyStyle>(getLogoIconStyle)
  const [bgEditMode, setBgEditMode] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )
  const [pendingBgLight, setPendingBgLight] = useState<BgConfig>(() => loadBgConfig('light'))
  const [pendingBgDark, setPendingBgDark] = useState<BgConfig>(() => loadBgConfig('dark'))
  const pendingBg = bgEditMode === 'dark' ? pendingBgDark : pendingBgLight
  const [pendingPnlColor, setPendingPnlColor] = useState<PnlColorConfig>(loadPnlColorConfig)
  const [pendingRadius, setPendingRadius] = useState<UiRadius>(getUiRadius)
  const [pendingOverlay, setPendingOverlay] = useState<OverlayStyle>(loadOverlayStyle)
  const [pendingCardOpacity, setPendingCardOpacity] = useState<number>(getCardOpacity)
  const [pendingDotColor, setPendingDotColor] = useState<string>(getDotColor)
  const [pendingTheme, setPendingTheme] = useState<ColorTheme>(getColorTheme)
  const [pendingWeatherIcon, setPendingWeatherIcon] = useState<WeatherIconStyle>(getWeatherIconStyle)
  const [pendingMemoColorMode, setPendingMemoColorMode] = useState<'pastel' | 'theme'>('pastel')

  // 마퀴 키워드 입력
  const [newKw, setNewKw] = useState('')

  // 프로필 상태
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileDirty, setProfileDirty] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  // 서버 설정 반영 (초기 로드 + 되돌리기 공용)
  const applyFromData = (data: Record<string, any>) => {
    setSettings(data)
    if (data.ui_radius) { setPendingRadius(data.ui_radius as UiRadius); applyUiRadius(data.ui_radius as UiRadius) }
    if (data.ui_overlay_style) { setPendingOverlay(data.ui_overlay_style as OverlayStyle); applyOverlayStyle(data.ui_overlay_style as OverlayStyle) }
    if (data.ui_card_opacity != null) { setPendingCardOpacity(data.ui_card_opacity as number); applyCardOpacity(data.ui_card_opacity as number) }
    if (data.ui_dot_color) { setPendingDotColor(data.ui_dot_color as string); applyDotColor(data.ui_dot_color as string) }
    if (data.ui_color_theme) { setPendingTheme(data.ui_color_theme as ColorTheme); applyColorTheme(data.ui_color_theme as ColorTheme) }
    if (data.ui_weather_icon_style) { setPendingWeatherIcon(data.ui_weather_icon_style as WeatherIconStyle); saveWeatherIconStyle(data.ui_weather_icon_style as WeatherIconStyle) }
    if (data.ui_nav_mode) setPendingNavMode(data.ui_nav_mode as 'top' | 'sidebar')
    if (data.memo_color_mode) setPendingMemoColorMode(data.memo_color_mode as 'pastel' | 'theme')
    // pending 전용(저장 시에만 적용)은 마지막 저장값(localStorage)에서 리셋
    setPendingLogoIcon(getLogoIconStyle())
    setPendingPnlColor(loadPnlColorConfig())
    setPendingBgLight(loadBgConfig('light'))
    setPendingBgDark(loadBgConfig('dark'))
  }

  useEffect(() => {
    settingsApi.get().then(({ data }) => {
      applyFromData(data)
      setLoading(false)
    }).catch(() => setLoading(false))

    profileApi.get().then(p => setProfile(p)).catch(() => {})

    const fetchAiUsage = () => {
      settingsApi.aiUsage().then(({ data }) => setAiUsage(data)).catch(() => {})
    }
    fetchAiUsage()
    aiPollRef.current = setInterval(fetchAiUsage, 10000)
    return () => { if (aiPollRef.current) clearInterval(aiPollRef.current) }
  }, [])

  const updateProfile = (patch: Partial<UserProfile>) => {
    setProfile(prev => prev ? { ...prev, ...patch } : prev)
    setProfileDirty(true)
    setProfileSaved(false)
  }

  const handleProfileSave = async () => {
    if (!profile) return
    setProfileSaving(true)
    try {
      const updated = await profileApi.update({
        display_name: profile.display_name,
        birth_date: profile.birth_date,
        profile_icon: profile.profile_icon,
        job: profile.job,
        retire_age: profile.retire_age,
        monthly_income_만: profile.monthly_income_만,
      })
      setProfile(updated)
      localStorage.setItem('profileIcon', updated.profile_icon)
      window.dispatchEvent(new Event('profileIconChange'))
      setProfileDirty(false)
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch {
      // ignore
    } finally {
      setProfileSaving(false)
    }
  }

  const update = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
    setSaved(false)
  }

  const markDirty = () => { setDirty(true); setSaved(false) }
  const updateNavMode = (m: 'top' | 'sidebar') => { setPendingNavMode(m); markDirty() }
  const updateWeatherIcon = (i: WeatherIconStyle) => { setPendingWeatherIcon(i); markDirty() }
  const updateMemoColorMode = (m: 'pastel' | 'theme') => { setPendingMemoColorMode(m); markDirty() }
  const updateLogoIcon = (s: LogoAnyStyle) => { setPendingLogoIcon(s); setDirty(true); setSaved(false) }
  const updateBg = (cfg: BgConfig) => {
    if (bgEditMode === 'dark') setPendingBgDark(cfg)
    else setPendingBgLight(cfg)
    setDirty(true); setSaved(false)
  }
  const updatePnlColor = (cfg: PnlColorConfig) => { setPendingPnlColor(cfg); setDirty(true); setSaved(false) }
  const updateRadius = (r: UiRadius) => { setPendingRadius(r); setDirty(true); setSaved(false) }
  const updateOverlay = (s: OverlayStyle) => { applyOverlayStyle(s); setPendingOverlay(s); setDirty(true); setSaved(false) }
  const updateCardOpacity = (v: number) => { applyCardOpacity(v); setPendingCardOpacity(v); setDirty(true); setSaved(false) }
  const updateTheme = (t: ColorTheme) => {
    applyColorTheme(t); setPendingTheme(t)
    // 테마 선택 시 배경을 테마 추종(none = --c-bg)으로 리셋 — 이후 개별 변경 가능
    const reset: BgConfig = { ...BG_DEFAULTS, type: 'none' }
    setPendingBgLight(reset); setPendingBgDark(reset); applyBackground(reset)
    setDirty(true); setSaved(false)
  }

  // 마퀴 키워드
  const marqueeItems: string[] = settings.site_marquee_items ?? []
  const addKeyword = () => {
    const kw = newKw.trim().toUpperCase()
    if (!kw || marqueeItems.includes(kw)) { setNewKw(''); return }
    update('site_marquee_items', [...marqueeItems, kw])
    setNewKw('')
  }
  const removeKeyword = (i: number) => update('site_marquee_items', marqueeItems.filter((_, idx) => idx !== i))

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data } = await settingsApi.update({
        ...settings,
        ui_nav_mode: pendingNavMode,
        ui_logo_icon: pendingLogoIcon,
        ui_pnl_color_config: pendingPnlColor,
        ui_bg_config: pendingBgLight,
        ui_bg_config_dark: pendingBgDark,
        ui_radius: pendingRadius,
        ui_overlay_style: pendingOverlay,
        ui_card_opacity: pendingCardOpacity,
        ui_dot_color: pendingDotColor,
        ui_color_theme: pendingTheme,
        ui_weather_icon_style: pendingWeatherIcon,
        memo_color_mode: pendingMemoColorMode,
      })
      setSettings(data)
      setNavMode(pendingNavMode)
      window.dispatchEvent(new CustomEvent('navModeChange', { detail: { mode: pendingNavMode } }))
      setLogoIconStyle(pendingLogoIcon)
      saveBgConfig(pendingBgLight, 'light')
      saveBgConfig(pendingBgDark, 'dark')
      const isDark = document.documentElement.classList.contains('dark')
      applyBackground(isDark ? pendingBgDark : pendingBgLight)
      applyPnlColors(pendingPnlColor)
      applyUiRadius(pendingRadius)
      applyOverlayStyle(pendingOverlay)
      applyCardOpacity(pendingCardOpacity)
      applyDotColor(pendingDotColor)
      applyColorTheme(pendingTheme)
      saveWeatherIconStyle(pendingWeatherIcon)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  const handleRevert = () => {
    settingsApi.get().then(({ data }) => {
      applyFromData(data)
      setDirty(false)
      setSaved(false)
    }).catch(() => {})
  }

  return {
    settings, loading, saving, saved, dirty, aiUsage, dragState,
    update, handleSave, handleRevert,
    pendingNavMode, updateNavMode,
    pendingLogoIcon, updateLogoIcon,
    bgEditMode, setBgEditMode, pendingBg, updateBg,
    pendingPnlColor, updatePnlColor,
    pendingRadius, updateRadius,
    pendingOverlay, updateOverlay,
    pendingCardOpacity, updateCardOpacity,
    pendingTheme, updateTheme,
    pendingWeatherIcon, updateWeatherIcon,
    pendingMemoColorMode, updateMemoColorMode,
    newKw, setNewKw, marqueeItems, addKeyword, removeKeyword,
    profile, updateProfile, handleProfileSave, profileDirty, profileSaving, profileSaved,
  }
}
