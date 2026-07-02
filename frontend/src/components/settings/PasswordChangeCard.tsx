import { useState } from 'react'
import { Lock, Check, X } from 'lucide-react'
import { authApi } from '../../api/client'
import { Card } from '../Card'
import { FormInput } from '../FormField'
import { Button } from './Button'

// Self-contained password-change card (roadmap Phase 3, P3-3).
// Extracted from pages/Settings.tsx — owns its own form state + API call,
// no coupling to the Settings settings/dirty state.
export function PasswordChangeCard() {
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

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

  return (
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
  )
}
