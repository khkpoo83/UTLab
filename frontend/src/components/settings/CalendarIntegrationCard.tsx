import { useEffect, useState } from 'react'
import { Calendar, RefreshCw, Unlink, ExternalLink, Wifi, WifiOff, Check, X } from 'lucide-react'
import { calendarApi, investmentMarksApi, CalendarStatus } from '../../api/client'
import { Card } from '../Card'
import { Button } from './Button'

// Self-contained Google Calendar integration card (roadmap Phase 3, P3-3).
// Extracted from pages/Settings.tsx — owns connection status + all connect/
// disconnect/sync handlers. Fetches status on mount (lazy: the integration tab
// only mounts this card when opened).
export function CalendarIntegrationCard() {
  const [calStatus, setCalStatus] = useState<CalendarStatus | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calMsg, setCalMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    calendarApi.status().then(s => setCalStatus(s)).catch(() => {})
  }, [])

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

  return (
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
  )
}
