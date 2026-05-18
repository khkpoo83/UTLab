import { useState } from 'react'
import { Plus, Trash2, Save, Globe } from 'lucide-react'
import { Card } from '../components/Card'
import { PageTitle } from '../components/PageTitle'

const LS_KEY = 'landing_config'

interface LandingConfig {
  heroTitle: string
  heroSubtitle: string
  keywords: string[]
}

const DEFAULTS: LandingConfig = {
  heroTitle: '한 사람의 인덱스',
  heroSubtitle: '매일 들여다보면서 알게 된 것들.',
  keywords: ['한 사람의 인덱스', 'PERSONAL · 2026', '매주 1-2편', 'RSS · ATOM', 'WRITING · MUSIC · FILM'],
}

export function loadLandingConfig(): LandingConfig {
  try {
    const s = localStorage.getItem(LS_KEY)
    if (!s) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(s) }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveLandingConfig(cfg: LandingConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg))
}

export default function SiteManage() {
  const [cfg, setCfg] = useState<LandingConfig>(loadLandingConfig)
  const [newKw, setNewKw] = useState('')
  const [saved, setSaved] = useState(false)

  const update = (patch: Partial<LandingConfig>) => setCfg(prev => ({ ...prev, ...patch }))

  const addKeyword = () => {
    const kw = newKw.trim()
    if (!kw || cfg.keywords.includes(kw)) return
    update({ keywords: [...cfg.keywords, kw] })
    setNewKw('')
  }

  const removeKeyword = (i: number) =>
    update({ keywords: cfg.keywords.filter((_, idx) => idx !== i) })

  const handleSave = () => {
    saveLandingConfig(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <PageTitle sub="홈페이지 관리" title="메인화면 관리" />

      <Card icon={<Globe size={15} />} title="히어로 텍스트">
        <div className="p-4 space-y-4">
          <div>
            <label className="ut-eyebrow block mb-1.5">메인 제목</label>
            <input
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-0)' }}
              value={cfg.heroTitle}
              onChange={e => update({ heroTitle: e.target.value })}
              placeholder="한 사람의 인덱스"
            />
          </div>
          <div>
            <label className="ut-eyebrow block mb-1.5">부제목</label>
            <input
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-0)' }}
              value={cfg.heroSubtitle}
              onChange={e => update({ heroSubtitle: e.target.value })}
              placeholder="매일 들여다보면서 알게 된 것들."
            />
          </div>
        </div>
      </Card>

      <Card icon={<Globe size={15} />} title="마퀴 키워드">
        <div className="p-4 space-y-3">
          <p className="text-xs" style={{ color: 'var(--ink-4)' }}>
            메인화면 마퀴(흐르는 텍스트)에 표시될 키워드를 관리합니다.
          </p>

          {/* 현재 키워드 목록 */}
          <div className="space-y-1.5">
            {cfg.keywords.map((kw, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: 'var(--mist)' }}>
                <span className="flex-1 text-sm" style={{ color: 'var(--ink-1)' }}>{kw}</span>
                <button
                  onClick={() => removeKeyword(i)}
                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-zinc-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* 새 키워드 추가 */}
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 rounded-lg border text-sm"
              style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-0)' }}
              value={newKw}
              onChange={e => setNewKw(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addKeyword()}
              placeholder="새 키워드 입력 후 Enter"
            />
            <button
              onClick={addKeyword}
              className="px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 transition-colors"
              style={{ background: 'var(--ink-0)', color: 'var(--paper)' }}
            >
              <Plus size={14} /> 추가
            </button>
          </div>
        </div>
      </Card>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--c-accent)', color: '#fff' }}
      >
        <Save size={15} />
        {saved ? '저장됨 ✓' : '저장하기'}
      </button>
    </div>
  )
}
