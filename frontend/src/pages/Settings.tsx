import React, { useContext, useEffect, useRef, useState } from 'react'
import {
  Clock, CalendarDays, Sparkles, TrendingUp, Database, Palette, Shapes, Wallpaper,
  User, Lock, Check, X, Calendar, RefreshCw, Unlink, ExternalLink, Wifi, WifiOff,
  RectangleHorizontal, Scroll, Layers, Plug, Plus,
} from 'lucide-react'
import { NavModeContext } from '../contexts'
import { settingsApi, profileApi, authApi, calendarApi, investmentMarksApi, UserProfile, AiUsageStats, CalendarStatus } from '../api/client'
import { Card } from '../components/Card'
import ProgressBar from '../components/ProgressBar'
import {
  LogoAnyStyle, getLogoIconStyle, setLogoIconStyle,
} from '../components/Logo'
import {
  BgConfig, loadBgConfig, saveBgConfig, applyBackground, BG_DEFAULTS,
} from '../utils/background'
import {
  WeatherIconStyle, getWeatherIconStyle, saveWeatherIconStyle,
} from '../components/WeatherWidget'
import { FormInput } from '../components/FormField'
import PageTitle from '../components/PageTitle'
import { OverlayStyle, loadOverlayStyle, applyOverlayStyle } from '../utils/overlay'
import {
  getProfileIconNode,
  loadPnlColorConfig, applyPnlColors, PnlColorConfig,
  applyUiRadius, getUiRadius, UiRadius, getCardOpacity, applyCardOpacity,
  applyDotColor, getDotColor,
  applyColorTheme, getColorTheme, ColorTheme,
} from '../utils/settings-utils'
import { Button } from '../components/settings/Button'
import { OptionTile, OptionGrid } from '../components/settings/OptionTile'
import { Toggle } from '../components/settings/Toggle'
import { RangeField } from '../components/settings/RangeField'
import { SettingRow } from '../components/settings/SettingRow'
import { Segmented } from '../components/settings/Segmented'
import { SettingsLayout } from '../components/settings/SettingsLayout'
import type { SettingsTab, SettingsSection } from '../components/settings/SettingsLayout'
import {
  ProfileIconPicker, LogoIconPicker, PnlColorPicker, BackgroundPicker, ScheduleGrid,
  RadiusPicker, NavModePicker, OverlayStylePicker, WeatherIconStylePicker,
  MemoColorPicker, ThemePicker, FOOTER_BG_OPTIONS, MARQUEE_TYPES, MARQUEE_POSITIONS,
  marqueeSpeedLabel,
} from '../components/settings/pickers'
import type { Schedule } from '../components/settings/pickers'

// Re-export for backward compat (외부에서 Settings를 직접 import하는 경우 대비)
export type { PnlColorConfig, UiRadius }
export {
  getProfileIconNode, loadPnlColorConfig, applyPnlColors,
  applyUiRadius, getUiRadius, getCardOpacity, applyCardOpacity,
}


// ── Main ─────────────────────────────────────────────────────────────────────

const Settings: React.FC = () => {
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

  // 비밀번호 변경 상태
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 구글 캘린더 상태
  const [calStatus, setCalStatus] = useState<CalendarStatus | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calMsg, setCalMsg] = useState<{ ok: boolean; text: string } | null>(null)

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
    calendarApi.status().then(s => setCalStatus(s)).catch(() => {})

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

  const handleChangePassword = async () => {
    if (pwNew !== pwConfirm) {
      setPwMsg({ ok: false, text: '새 비밀번호가 일치하지 않습니다.' })
      return
    }
    if (pwNew.length < 6) {
      setPwMsg({ ok: false, text: '비밀번호는 6자 이상이어야 합니다.' })
      return
    }
    setPwSaving(true)
    setPwMsg(null)
    try {
      await authApi.changePassword(pwCurrent, pwNew)
      setPwMsg({ ok: true, text: '비밀번호가 변경되었습니다.' })
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? '오류가 발생했습니다.'
      setPwMsg({ ok: false, text: detail })
    } finally {
      setPwSaving(false)
    }
  }

  const handleCalConnect = async () => {
    setCalLoading(true)
    setCalMsg(null)
    try {
      const { auth_url } = await calendarApi.connect()
      window.location.href = auth_url
    } catch {
      setCalMsg({ ok: false, text: '연결 URL 생성에 실패했습니다. 서버 환경변수를 확인하세요.' })
      setCalLoading(false)
    }
  }

  const handleCalDisconnect = async () => {
    if (!window.confirm('Google Calendar 연결을 해제하면 동기화된 일정이 모두 삭제됩니다. 계속하시겠습니까?')) return
    setCalLoading(true)
    setCalMsg(null)
    try {
      await calendarApi.disconnect()
      setCalStatus(null)
      setCalMsg({ ok: true, text: '연결이 해제되었습니다.' })
    } catch {
      setCalMsg({ ok: false, text: '연결 해제 중 오류가 발생했습니다.' })
    } finally {
      setCalLoading(false)
    }
  }

  const handleCalSync = async () => {
    setCalLoading(true)
    setCalMsg(null)
    try {
      const res = await calendarApi.sync()
      setCalMsg({ ok: true, text: res.message })
      calendarApi.status().then(s => setCalStatus(s)).catch(() => {})
    } catch {
      setCalMsg({ ok: false, text: '동기화 중 오류가 발생했습니다.' })
    } finally {
      setCalLoading(false)
    }
  }

  const handleCalRegisterWatch = async () => {
    setCalLoading(true)
    setCalMsg(null)
    try {
      const res = await calendarApi.registerWatch()
      setCalMsg({ ok: res.push_enabled, text: res.message })
      calendarApi.status().then(s => setCalStatus(s)).catch(() => {})
    } catch {
      setCalMsg({ ok: false, text: 'Push 채널 등록 중 오류가 발생했습니다.' })
    } finally {
      setCalLoading(false)
    }
  }

  const handleSyncUnsyncedMarks = async () => {
    setCalLoading(true)
    setCalMsg(null)
    try {
      const res = await investmentMarksApi.syncUnsynced()
      if (res.error) {
        setCalMsg({ ok: false, text: res.error })
      } else {
        setCalMsg({ ok: true, text: `마커 동기화 완료: ${res.synced}건 성공${res.failed ? `, ${res.failed}건 실패` : ''}` })
      }
    } catch {
      setCalMsg({ ok: false, text: '마커 동기화 중 오류가 발생했습니다.' })
    } finally {
      setCalLoading(false)
    }
  }

  const update = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
    setSaved(false)
  }

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

  if (loading) return <div className="py-8 text-center text-sm text-ink-4">설정 로딩 중...</div>

  const newsSchedule: Schedule = settings.news_schedule ?? {}

  const TABS: SettingsTab[] = [
    { id: 'account',     label: '계정',          Icon: User },
    { id: 'appearance',  label: '외관',          Icon: Palette },
    { id: 'data',        label: '자동화·데이터', Icon: Database },
    { id: 'integration', label: '연동',          Icon: Plug },
  ]

  const sections: SettingsSection[] = [
    // ── 계정 ────────────────────────────────────────────────
    {
      id: 'settings-profile', tab: 'account', title: '내 프로필',
      keywords: ['프로필', '이름', '직업', '생년월일', '은퇴', '소득', '아이콘', 'profile'],
      element: (
        <Card collapsible id="settings-profile" icon={<User size={16} />} title="내 프로필" defaultOpen>
          {profile && (
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-ink-5 flex items-center justify-center text-accent select-none">
                  {getProfileIconNode(profile.profile_icon || 'user', 26)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink-0">{profile.display_name || '이름 미설정'}</p>
                  <p className="text-xs text-ink-4 mt-0.5">
                    {profile.age != null ? `만 ${profile.age}세` : '생년월일 미설정'}
                    {profile.job ? ` · ${profile.job}` : ''}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs text-ink-3 block mb-2">프로필 아이콘</label>
                <ProfileIconPicker value={profile.profile_icon || '👤'} onChange={icon => updateProfile({ profile_icon: icon })} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormInput label="이름 (표시명)" type="text" placeholder="홍길동" value={profile.display_name ?? ''} onChange={e => updateProfile({ display_name: e.target.value || null })} />
                <FormInput label="직업" type="text" placeholder="직장인, 자영업, 프리랜서..." value={profile.job ?? ''} onChange={e => updateProfile({ job: e.target.value || null })} />
                <FormInput label="생년월일" type="date" value={profile.birth_date ?? ''} onChange={e => updateProfile({ birth_date: e.target.value || null })} hint={profile.age != null ? `만 ${profile.age}세` : undefined} />
                <FormInput label="목표 은퇴 나이" type="number" min={40} max={80} value={profile.retire_age ?? 60} onChange={e => updateProfile({ retire_age: parseInt(e.target.value) })} />
                <FormInput label="월 소득 (만원)" type="number" min={0} step={10} placeholder="500" value={profile.monthly_income_만 ?? ''} onChange={e => updateProfile({ monthly_income_만: e.target.value ? parseInt(e.target.value) : null })} />
              </div>

              <div className="notice notice-accent text-2xs">생년월일·은퇴 나이는 은퇴 플래너에서 자동으로 불러옵니다.</div>

              <div className="flex items-center gap-3">
                <Button onClick={handleProfileSave} loading={profileSaving} loadingLabel="저장 중..." disabled={!profileDirty}>프로필 저장</Button>
                {profileSaved && <span className="flex items-center gap-1 text-xs text-accent font-medium"><Check size={12} /> 저장되었습니다.</span>}
              </div>
            </div>
          )}
        </Card>
      ),
    },
    {
      id: 'settings-password', tab: 'account', title: '비밀번호 변경',
      keywords: ['비밀번호', '패스워드', '보안', 'password'],
      element: (
        <Card collapsible id="settings-password" icon={<Lock size={16} />} title="비밀번호 변경" defaultOpen={false}>
          <div className="space-y-4 max-w-sm">
            <FormInput label="현재 비밀번호" type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} />
            <FormInput label="새 비밀번호 (6자 이상)" type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} />
            <FormInput label="새 비밀번호 확인" type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} />
            {pwMsg && (
              <div className={`flex items-center gap-1.5 text-xs font-medium ${pwMsg.ok ? 'text-accent' : 'text-red-500'}`}>
                {pwMsg.ok ? <Check size={13} /> : <X size={13} />}
                {pwMsg.text}
              </div>
            )}
            <Button onClick={handleChangePassword} loading={pwSaving} loadingLabel="변경 중..." disabled={!pwCurrent || !pwNew || !pwConfirm}>비밀번호 변경</Button>
          </div>
        </Card>
      ),
    },

    // ── 외관 ────────────────────────────────────────────────
    {
      id: 'settings-colors', tab: 'appearance', group: '테마 색상', title: '색상',
      keywords: ['색상', '등락', '상승', '하락', '빨강', '파랑', 'pnl', '포인트', '강조', 'dot', '테마', '팔레트', 'theme', 'accent'],
      element: (
        <Card collapsible id="settings-colors" icon={<Palette size={16} />} title="색상" defaultOpen>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-ink-3 mb-1.5">색상 테마</p>
              <ThemePicker value={pendingTheme} onChange={updateTheme} />
              <p className="text-2xs text-ink-4 mt-2">강조색·포인트·차트 색이 함께 바뀝니다. 다크/라이트는 상단 토글로 별도 전환.</p>
            </div>
            <div>
              <p className="text-xs text-ink-3 mb-1.5">등락 색상</p>
              <PnlColorPicker value={pendingPnlColor} onChange={updatePnlColor} />
            </div>
          </div>
        </Card>
      ),
    },
    {
      id: 'settings-layout', tab: 'appearance', group: '레이아웃 & 카드', title: '레이아웃',
      keywords: ['메뉴', '네비게이션', '사이드바', '상단', 'nav', '카드', '둥글기', '모서리', '투명도', 'radius', 'opacity'],
      element: (
        <Card collapsible id="settings-layout" icon={<RectangleHorizontal size={16} />} title="레이아웃" defaultOpen>
          <div className="space-y-3">
            <SettingRow title="메뉴 방식" control={<NavModePicker value={pendingNavMode} onChange={mode => { setPendingNavMode(mode); setDirty(true); setSaved(false) }} />} />
            <SettingRow title="모서리 둥글기" control={<RadiusPicker value={pendingRadius} onChange={updateRadius} />} />
            <RangeField label="카드 투명도" min={0.1} max={1} step={0.05} value={pendingCardOpacity} onChange={updateCardOpacity} display={`${Math.round(pendingCardOpacity * 100)}%`} labelWidth={80} />
          </div>
        </Card>
      ),
    },
    {
      id: 'settings-overlay', tab: 'appearance', group: '효과', title: '모달·슬라이드 배경 처리',
      keywords: ['모달', '오버레이', '블러', '슬라이드', 'overlay'],
      element: (
        <Card collapsible id="settings-overlay" icon={<Shapes size={16} />} title="모달·슬라이드 배경 처리" defaultOpen={false}>
          <OverlayStylePicker value={pendingOverlay} onChange={updateOverlay} />
        </Card>
      ),
    },
    {
      id: 'settings-background', tab: 'appearance', group: '효과', title: '배경 무늬',
      keywords: ['배경', '무늬', '패턴', '그라디언트', '도트', '격자', 'background'],
      element: (
        <Card collapsible id="settings-background" icon={<Wallpaper size={16} />} title="배경 무늬" defaultOpen={false} contentClassName="px-6 py-5 space-y-3">
          <Segmented<'light' | 'dark'>
            value={bgEditMode}
            onChange={m => setBgEditMode(m)}
            options={[
              { value: 'light', label: '라이트 모드' },
              { value: 'dark',  label: '다크 모드' },
            ]}
          />
          <BackgroundPicker value={pendingBg} onChange={updateBg} />
        </Card>
      ),
    },
    {
      id: 'settings-branding', tab: 'appearance', group: '브랜딩 & 위젯', title: '로고 · 날씨 · 메모',
      keywords: ['로고', '아이콘', 'logo', '날씨', 'weather', '위젯', '메모', '포스트잇', 'memo'],
      element: (
        <Card collapsible id="settings-branding" icon={<Shapes size={16} />} title="로고 · 날씨 · 메모" defaultOpen={false}>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-ink-3 mb-1.5">로고 아이콘</p>
              <LogoIconPicker svgValue={pendingLogoIcon} onSvg={updateLogoIcon} />
            </div>
            <div>
              <p className="text-xs text-ink-3 mb-1.5">날씨 아이콘</p>
              <WeatherIconStylePicker value={pendingWeatherIcon} onChange={icon => { setPendingWeatherIcon(icon); setDirty(true); setSaved(false) }} />
            </div>
            <SettingRow title="메모 색상" control={<MemoColorPicker value={pendingMemoColorMode} onChange={m => { setPendingMemoColorMode(m); setDirty(true); setSaved(false) }} />} />
          </div>
        </Card>
      ),
    },
    {
      id: 'settings-marquee', tab: 'appearance', group: '랜딩페이지', title: '마퀴 설정',
      keywords: ['마퀴', '흐르는', '텍스트', '키워드', '랜딩', 'marquee'],
      element: (
        <Card collapsible id="settings-marquee" icon={<Scroll size={16} />} title="마퀴 설정" defaultOpen={false}>
          <div className="space-y-5">
            <SettingRow
              title="마퀴 표시"
              desc="랜딩페이지 흐르는 텍스트 표시 여부"
              control={<Toggle checked={settings.site_marquee_enabled ?? true} onChange={v => update('site_marquee_enabled', v)} />}
            />

            <div>
              <p className="text-xs font-medium text-ink-2 mb-2">마퀴 키워드</p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {marqueeItems.length === 0 && <span className="text-2xs text-ink-4">키워드가 없습니다.</span>}
                {marqueeItems.map((kw, i) => (
                  <span key={i} className="tag tag-tonal flex items-center gap-1">
                    {kw}
                    <button onClick={() => removeKeyword(i)} className="hover:text-red-500"><X size={11} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <FormInput
                  value={newKw}
                  onChange={e => setNewKw(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
                  placeholder="키워드 입력 후 추가"
                  wrapperClassName="flex-1"
                />
                <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addKeyword}>추가</Button>
              </div>
            </div>

            <div className="flex gap-6 flex-wrap">
              <div>
                <p className="text-xs font-medium text-ink-2 mb-2">표시 형태</p>
                <Segmented value={settings.site_marquee_type ?? 'triple'} onChange={v => update('site_marquee_type', v)}
                  options={MARQUEE_TYPES.map(o => ({ value: o.id, label: o.label }))} />
              </div>
              <div>
                <p className="text-xs font-medium text-ink-2 mb-2">표시 위치</p>
                <Segmented value={settings.site_marquee_position ?? 'top'} onChange={v => update('site_marquee_position', v)}
                  options={MARQUEE_POSITIONS.map(o => ({ value: o.id, label: o.label }))} />
              </div>
            </div>

            <RangeField
              label="스크롤 속도"
              min={20} max={140} step={5}
              value={settings.site_marquee_speed ?? 60}
              onChange={v => update('site_marquee_speed', v)}
              display={`${marqueeSpeedLabel(settings.site_marquee_speed ?? 60)}`}
              labelWidth={72}
            />
          </div>
        </Card>
      ),
    },
    {
      id: 'settings-footer-bg', tab: 'appearance', group: '랜딩페이지', title: '푸터 배경',
      keywords: ['푸터', '배경', 'cta', '랜딩', 'footer', '파티클', '프리즘'],
      element: (
        <Card collapsible id="settings-footer-bg" icon={<Layers size={16} />} title="푸터 배경" defaultOpen={false}>
          <OptionGrid cols={3}>
            {FOOTER_BG_OPTIONS.map(opt => (
              <OptionTile
                key={opt.id}
                active={(settings.site_footer_bg ?? 'particle') === opt.id}
                onClick={() => update('site_footer_bg', opt.id)}
                preview={opt.preview}
                label={opt.label}
              />
            ))}
          </OptionGrid>
        </Card>
      ),
    },

    // ── 자동화·데이터 ───────────────────────────────────────
    {
      id: 'settings-interval', tab: 'data', title: '조회 인터벌',
      keywords: ['인터벌', '주기', '주식', '뉴스', '조회', 'interval'],
      element: (
        <Card collapsible id="settings-interval" icon={<Clock size={16} />} title="조회 인터벌">
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="주식 조회 주기 (분)" type="number" min={5} max={60} step={5} value={settings.stock_interval_minutes ?? 15} onChange={(e) => update('stock_interval_minutes', parseInt(e.target.value))} />
            <FormInput label="뉴스 조회 주기 (시간)" type="number" min={1} max={24} step={1} value={settings.news_interval_hours ?? 1} onChange={(e) => update('news_interval_hours', parseInt(e.target.value))} />
          </div>
        </Card>
      ),
    },
    {
      id: 'settings-news-schedule', tab: 'data', title: '뉴스 조회 스케줄',
      keywords: ['뉴스', '스케줄', '시간대', '요일', 'schedule'],
      element: (
        <Card collapsible id="settings-news-schedule" icon={<CalendarDays size={16} />} title="뉴스 조회 스케줄" defaultOpen={false}>
          <div className="space-y-3">
            <p className="text-2xs text-ink-4">활성화된 요일/시간대에만 뉴스를 자동 수집합니다.</p>
            <ScheduleGrid label="뉴스 조회 활성 시간" scheduleKey="news_schedule" schedule={newsSchedule} onChange={update} dragState={dragState} />
          </div>
        </Card>
      ),
    },
    {
      id: 'settings-ai-summary', tab: 'data', title: 'AI 서머리 설정',
      keywords: ['ai', '서머리', '요약', 'gemini', '시간'],
      element: (
        <Card collapsible id="settings-ai-summary" icon={<Sparkles size={16} />} title="AI 서머리 설정">
          <div className="grid grid-cols-3 gap-4">
            <FormInput label="요약 시작 시간 (시)" type="number" min={0} max={23} value={settings.ai_summary_start_hour ?? 8} onChange={(e) => update('ai_summary_start_hour', parseInt(e.target.value))} />
            <FormInput label="요약 종료 시간 (시)" type="number" min={0} max={23} value={settings.ai_summary_end_hour ?? 22} onChange={(e) => update('ai_summary_end_hour', parseInt(e.target.value))} />
            <FormInput label="회당 최대 요약 건수" type="number" min={1} max={50} value={settings.ai_summary_max_items ?? 20} onChange={(e) => update('ai_summary_max_items', parseInt(e.target.value))} />
          </div>
        </Card>
      ),
    },
    {
      id: 'settings-ai-usage', tab: 'data', title: 'Gemini AI 사용량',
      keywords: ['ai', '사용량', '토큰', 'rpd', 'rpm', 'gemini'],
      element: (
        <Card collapsible id="settings-ai-usage" icon={<TrendingUp size={16} />} title="Gemini AI 사용량" right={aiUsage && <span className="text-2xs text-ink-4">{aiUsage.model}</span>}>
          {aiUsage ? (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-ink-3">일 요청 (RPD)</span>
                  <span className="text-xs font-medium text-ink-1">
                    {aiUsage.rpd_used} / {aiUsage.rpd_limit}
                    <span className="text-ink-4 font-normal ml-1">(남은 {aiUsage.rpd_remaining})</span>
                  </span>
                </div>
                <ProgressBar value={Math.min(100, (aiUsage.rpd_used / aiUsage.rpd_limit) * 100)} height="md" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-ink-3">현재 분당 요청 (RPM)</span>
                  <span className="text-xs font-medium text-ink-1">
                    {aiUsage.rpm_used} / {aiUsage.rpm_limit}
                    <span className="text-ink-4 font-normal ml-1">(남은 {aiUsage.rpm_remaining})</span>
                  </span>
                </div>
                <ProgressBar value={Math.min(100, (aiUsage.rpm_used / aiUsage.rpm_limit) * 100)} height="md" />
              </div>
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                  <p className="text-2xs text-ink-4 mb-0.5">입력 토큰 (오늘)</p>
                  <p className="text-xs font-semibold text-ink-1">{aiUsage.tokens_in_today.toLocaleString()}</p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                  <p className="text-2xs text-ink-4 mb-0.5">출력 토큰 (오늘)</p>
                  <p className="text-xs font-semibold text-ink-1">{aiUsage.tokens_out_today.toLocaleString()}</p>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                  <p className="text-2xs text-ink-4 mb-0.5">누적 실패</p>
                  <p className={`text-xs font-semibold ${aiUsage.failed_total > 0 ? 'text-red-500' : 'text-ink-1'}`}>{aiUsage.failed_total}</p>
                </div>
              </div>
              <p className="text-2xs text-ink-4">무료 티어 기준 · 일 요청은 자정에 초기화 · 10초마다 갱신</p>
            </div>
          ) : (
            <p className="text-xs text-ink-4">로딩 중...</p>
          )}
        </Card>
      ),
    },
    {
      id: 'settings-retention', tab: 'data', title: '데이터 보관',
      keywords: ['데이터', '보관', '뉴스', '기간', 'retention'],
      element: (
        <Card collapsible id="settings-retention" icon={<Database size={16} />} title="데이터 보관">
          <div className="max-w-xs">
            <FormInput label="뉴스 보관 기간 (일)" type="number" min={7} max={365} value={settings.news_retention_days ?? 30} onChange={(e) => update('news_retention_days', parseInt(e.target.value))} />
          </div>
        </Card>
      ),
    },

    // ── 연동 ────────────────────────────────────────────────
    {
      id: 'settings-calendar', tab: 'integration', title: 'Google 캘린더 연동',
      keywords: ['구글', '캘린더', '연동', '동기화', 'google', 'calendar', 'sync'],
      element: (
        <Card collapsible id="settings-calendar" icon={<Calendar size={16} />} title="Google 캘린더 연동" defaultOpen>
          <div className="space-y-4">
            {calStatus?.connected ? (
              <>
                <div className="flex items-center gap-2">
                  <Wifi size={14} className={`flex-shrink-0 ${calStatus.needs_reconnect ? 'text-amber-500' : 'text-green-500'}`} />
                  <span className="text-sm font-medium text-ink-0">{calStatus.google_email}</span>
                  <span className={`tag text-xs ${calStatus.needs_reconnect ? 'tag-amber' : 'tag-tonal'}`}>
                    {calStatus.needs_reconnect ? '재연결 필요' : '연결됨'}
                  </span>
                </div>
                {calStatus.needs_reconnect && (
                  <div className="notice notice-amber text-xs">Google 토큰이 만료되었습니다. 아래 버튼으로 다시 연결하면 일정 동기화가 재개됩니다.</div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                    <p className="text-2xs text-ink-4 mb-0.5">동기화 일정</p>
                    <p className="text-xs font-semibold text-ink-1">{calStatus.event_count}개</p>
                  </div>
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                    <p className="text-2xs text-ink-4 mb-0.5">Push 알림</p>
                    <p className={`text-xs font-semibold ${calStatus.push_enabled ? 'text-green-600 dark:text-green-400' : 'text-ink-4'}`}>{calStatus.push_enabled ? '활성' : '폴링'}</p>
                  </div>
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-2.5 text-center">
                    <p className="text-2xs text-ink-4 mb-0.5">채널 만료</p>
                    <p className="text-2xs font-medium text-ink-2 leading-tight">
                      {calStatus.channel_expires ? new Date(calStatus.channel_expires).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '—'}
                    </p>
                  </div>
                </div>
                {!calStatus.push_enabled && (
                  <div className="notice notice-amber text-xs">
                    Push 알림 채널이 비활성 상태입니다. GOOGLE_WEBHOOK_BASE_URL 환경변수가 설정되어 있으면 "채널 등록" 버튼을 눌러 재등록하세요. 현재는 30분마다 폴링으로 동기화됩니다.
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {calStatus.needs_reconnect ? (
                    <Button onClick={handleCalConnect} loading={calLoading} loadingLabel="연결 중..." icon={<ExternalLink size={13} />}>Google 재연결</Button>
                  ) : (
                    <>
                      <Button onClick={handleCalSync} disabled={calLoading} icon={<RefreshCw size={13} className={calLoading ? 'animate-spin' : ''} />}>전체 동기화</Button>
                      <Button variant="secondary" onClick={handleCalRegisterWatch} disabled={calLoading} icon={<Wifi size={13} />}>{calStatus.push_enabled ? 'Push 채널 갱신' : 'Push 채널 등록'}</Button>
                      <Button variant="secondary" onClick={handleSyncUnsyncedMarks} disabled={calLoading} icon={<RefreshCw size={13} />} title="차트 마커 중 GCal 미동기화된 항목을 재시도합니다">마커 동기화</Button>
                    </>
                  )}
                  <Button variant="danger" onClick={handleCalDisconnect} disabled={calLoading} icon={<Unlink size={13} />}>연결 해제</Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-ink-4">
                  <WifiOff size={14} />
                  <span className="text-sm">Google Calendar가 연결되지 않았습니다.</span>
                </div>
                <div className="notice notice-zinc text-xs space-y-1">
                  <p>연결하면 다른 기기에서 등록한 일정이 플래너에 자동으로 반영됩니다.</p>
                  <p>서버에 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI 환경변수가 필요합니다.</p>
                </div>
                <Button onClick={handleCalConnect} loading={calLoading} loadingLabel="연결 중..." icon={<ExternalLink size={13} />}>Google 계정으로 연결</Button>
              </>
            )}
            {calMsg && (
              <div className={`flex items-center gap-1.5 text-xs font-medium ${calMsg.ok ? 'text-accent' : 'text-red-500'}`}>
                {calMsg.ok ? <Check size={13} /> : <X size={13} />}
                {calMsg.text}
              </div>
            )}
            <p className="text-2xs text-ink-4">연결 후 Push 알림으로 다른 기기 변경사항이 수 초 내 플래너에 반영됩니다.</p>
          </div>
        </Card>
      ),
    },
  ]

  return (
    <div className="w-full pb-24">
      <PageTitle sub="preferences" title="Settings" />
      <div className="mt-4">
        <SettingsLayout tabs={TABS} sections={sections} />
      </div>

      {/* 스티키 저장 바 — 미저장 변경사항이 있을 때만 등장 */}
      {(dirty || saved) && (
        <div className={`save-bar-pop fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl bg-white dark:bg-zinc-900 backdrop-blur shadow-2xl ${
          saved ? 'border border-ink-5' : 'border-2 border-accent ring-4 ring-accent/20'
        }`}>
          {saved ? (
            <span className="flex items-center gap-1.5 text-sm text-accent font-medium px-1"><Check size={14} /> 저장되었습니다.</span>
          ) : (
            <>
              <span className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap pl-1 text-ink-1">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                </span>
                저장하지 않은 변경사항
              </span>
              <Button variant="ghost" size="sm" onClick={handleRevert} disabled={saving}>되돌리기</Button>
              <Button size="sm" onClick={handleSave} loading={saving} loadingLabel="저장 중...">저장하기</Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default Settings
