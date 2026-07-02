import React from 'react'
import {
  Clock, CalendarDays, Sparkles, TrendingUp, Database, Palette, Shapes, Wallpaper,
  User, Check, X,
  RectangleHorizontal, Scroll, Layers, Plug, Plus,
} from 'lucide-react'
import { Card } from '../components/Card'
import ProgressBar from '../components/ProgressBar'
import { FormInput } from '../components/FormField'
import PageTitle from '../components/PageTitle'
import {
  getProfileIconNode,
  loadPnlColorConfig, applyPnlColors, PnlColorConfig,
  applyUiRadius, getUiRadius, UiRadius, getCardOpacity, applyCardOpacity,
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
import { PasswordChangeCard } from '../components/settings/PasswordChangeCard'
import { CalendarIntegrationCard } from '../components/settings/CalendarIntegrationCard'
import { useSettingsState } from './settings/useSettingsState'

// Re-export for backward compat (외부에서 Settings를 직접 import하는 경우 대비)
export type { PnlColorConfig, UiRadius }
export {
  getProfileIconNode, loadPnlColorConfig, applyPnlColors,
  applyUiRadius, getUiRadius, getCardOpacity, applyCardOpacity,
}


// ── Main ─────────────────────────────────────────────────────────────────────

const Settings: React.FC = () => {
  const {
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
  } = useSettingsState()

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
      element: <PasswordChangeCard />,
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
            <SettingRow title="메뉴 방식" control={<NavModePicker value={pendingNavMode} onChange={updateNavMode} />} />
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
              <WeatherIconStylePicker value={pendingWeatherIcon} onChange={updateWeatherIcon} />
            </div>
            <SettingRow title="메모 색상" control={<MemoColorPicker value={pendingMemoColorMode} onChange={updateMemoColorMode} />} />
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
                  <p className={`text-xs font-semibold ${aiUsage.failed_total > 0 ? 'text-danger' : 'text-ink-1'}`}>{aiUsage.failed_total}</p>
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
      element: <CalendarIntegrationCard />,
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
