import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/client'

function getTokens(isLight: boolean) {
  return isLight
    ? {
        bg:               '#ffffff',
        textPrimary:      'rgba(8,10,30,0.88)',
        textMuted:        'rgba(8,10,30,0.45)',
        inputBg:          'rgba(8,10,30,0.04)',
        inputBorder:      'rgba(8,10,30,0.14)',
        inputFocusBg:     'rgba(8,10,30,0.07)',
        inputFocusBorder: 'rgba(8,10,30,0.40)',
        inputText:        'rgba(8,10,30,0.88)',
        btnBg:            'rgba(8,10,30,0.08)',
        btnBorder:        'rgba(8,10,30,0.30)',
        btnText:          'rgba(8,10,30,0.88)',
        accent:           'rgba(8,10,30,0.55)',
      }
    : {
        bg:               '#000000',
        textPrimary:      'rgba(220,228,255,0.90)',
        textMuted:        'rgba(220,228,255,0.45)',
        inputBg:          'rgba(255,255,255,0.04)',
        inputBorder:      'rgba(80,90,160,0.20)',
        inputFocusBg:     'rgba(255,255,255,0.07)',
        inputFocusBorder: 'rgba(90,160,255,0.48)',
        inputText:        'rgba(210,218,255,0.88)',
        btnBg:            'rgba(188,214,255,0.12)',
        btnBorder:        'rgba(188,214,255,0.28)',
        btnText:          'rgba(220,228,255,0.92)',
        accent:           'rgba(188,214,255,0.75)',
      }
}

const InputField: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { isLight: boolean }> = ({ isLight, ...props }) => {
  const [focused, setFocused] = React.useState(false)
  const t = getTokens(isLight)
  const base:  React.CSSProperties = { background: t.inputBg,      border: `1px solid ${t.inputBorder}`,      color: t.inputText }
  const focus: React.CSSProperties = { background: t.inputFocusBg, border: `1px solid ${t.inputFocusBorder}`, color: t.inputText }
  return (
    <input
      {...props}
      className="w-full rounded-lg outline-none transition-all"
      style={{ ...(focused ? focus : base), padding: '6px 10px', fontSize: '12px' }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e) }}
      onBlur={(e)  => { setFocused(false); props.onBlur?.(e) }}
    />
  )
}

const Login: React.FC = () => {
  const navigate = useNavigate()
  const isLight = localStorage.getItem('hubMode') === 'light'
  const t = getTokens(isLight)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { data } = await authApi.login(username, password)
      localStorage.setItem('token', data.access_token)
      navigate('/portfolio', { replace: true })
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string }; status?: number } }
      if (ax.response?.status === 429)
        setError(ax.response.data?.detail ?? '계정이 잠겼습니다. 잠시 후 다시 시도하세요.')
      else if (ax.response?.status === 401)
        setError('아이디 또는 비밀번호가 올바르지 않습니다.')
      else
        setError('로그인 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: t.bg }}>
      <div className="w-full" style={{ maxWidth: '300px', padding: '2.5rem 1.75rem' }}>
        <div className="mb-8">
          <h1 className="font-bold tracking-tight" style={{ fontSize: '18px', color: t.textPrimary, letterSpacing: '-0.025em' }}>
            U<span style={{ color: t.accent }}>.</span>T
            <span style={{ fontWeight: 300, opacity: 0.75 }}> Lab</span>
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2.5">
            <div>
              <label className="block font-medium mb-1" style={{ fontSize: '11px', color: t.textMuted }}>아이디</label>
              <InputField isLight={isLight} type="text" autoComplete="username" value={username}
                onChange={(e) => setUsername(e.target.value)} placeholder="admin" required />
            </div>
            <div>
              <label className="block font-medium mb-1" style={{ fontSize: '11px', color: t.textMuted }}>비밀번호</label>
              <InputField isLight={isLight} type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
          </div>

          {error && (
            <div className="px-2.5 py-1.5 rounded-lg" style={{
              fontSize: '11px',
              background: 'rgba(220,38,38,0.12)',
              border: '1px solid rgba(220,38,38,0.22)',
              color: 'rgba(220,38,38,0.88)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full font-medium rounded-lg transition-opacity disabled:opacity-50"
            style={{ padding: '7px 0', fontSize: '12px', marginTop: '4px', background: t.btnBg, border: `1px solid ${t.btnBorder}`, color: t.btnText }}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="text-center mt-4 space-y-2">
          <button onClick={() => navigate('/')} style={{ display: 'block', width: '100%', fontSize: '11px', color: t.textMuted }} className="hover:opacity-80 transition-opacity">
            ← 허브로 돌아가기
          </button>
          <button onClick={() => navigate('/public/blog')} style={{ display: 'block', width: '100%', fontSize: '11px', color: t.textMuted }} className="hover:opacity-80 transition-opacity">
            공개 블로그 보기 →
          </button>
        </div>
      </div>
    </div>
  )
}

export default Login
