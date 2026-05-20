import { useEffect, useRef, useState } from 'react'
import { Plus, Save, X } from 'lucide-react'
import { Card } from '../components/Card'
import { PageTitle } from '../components/PageTitle'
import { settingsApi } from '../api/client'

export default function SiteManage() {
  const [heroTitle,   setHeroTitle]   = useState('한 사람의 인덱스')
  const [heroSub,     setHeroSub]     = useState('매일 들여다보면서 알게 된 것들.')
  const [editorNote,  setEditorNote]  = useState('')
  const [copyright,   setCopyright]   = useState('U.T Lab4 — 한 사람의 인덱스')
  const [keywords,    setKeywords]    = useState<string[]>([])
  const [marqueeSpeed, setMarqueeSpeed] = useState(60)
  const [newKw,       setNewKw]       = useState('')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [loading, setLoading] = useState(true)
  const kwInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    settingsApi.get()
      .then(({ data }) => {
        if (data.site_hero_title)       setHeroTitle(data.site_hero_title)
        if (data.site_hero_subtitle)    setHeroSub(data.site_hero_subtitle)
        if (data.site_editor_note)      setEditorNote(data.site_editor_note)
        if (data.site_footer_copyright) setCopyright(data.site_footer_copyright)
        if (data.site_marquee_items && Array.isArray(data.site_marquee_items)) {
          setKeywords(data.site_marquee_items)
        }
        if (typeof data.site_marquee_speed === 'number') {
          setMarqueeSpeed(data.site_marquee_speed)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const addKeyword = () => {
    const kw = newKw.trim().toUpperCase()
    if (!kw || keywords.includes(kw)) { setNewKw(''); return }
    setKeywords(prev => [...prev, kw])
    setNewKw('')
    kwInputRef.current?.focus()
  }

  const removeKeyword = (i: number) => setKeywords(prev => prev.filter((_, idx) => idx !== i))

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveStatus('idle')
    // 10초 안에 응답 없으면 강제 해제 (확장 프로그램 간섭 등 대비)
    const safetyTimer = setTimeout(() => {
      setSaving(false)
      setSaveStatus('err')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }, 10000)
    try {
      await settingsApi.update({
        site_hero_title: heroTitle,
        site_hero_subtitle: heroSub,
        site_editor_note: editorNote,
        site_footer_copyright: copyright,
        site_marquee_items: keywords,
        site_marquee_speed: marqueeSpeed,
      })
      clearTimeout(safetyTimer)
      setSaveStatus('ok')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      clearTimeout(safetyTimer)
      setSaveStatus('err')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-zinc-400">불러오는 중...</div>

  return (
    <div className="space-y-4 max-w-2xl">
      <PageTitle sub="홈페이지 관리" title="메인화면 관리" />

      <Card title="히어로 텍스트">
        <div className="p-4 space-y-4">
          <div>
            <label className="ut-eyebrow block mb-1.5">메인 제목</label>
            <p className="text-xs mb-2" style={{ color: 'var(--ink-4)' }}>마침표(.)는 자동으로 붙습니다. 입력하지 마세요.</p>
            <input
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-0)' }}
              value={heroTitle}
              onChange={e => setHeroTitle(e.target.value.replace(/\.$/, ''))}
              placeholder="한 사람의 인덱스"
            />
          </div>
          <div>
            <label className="ut-eyebrow block mb-1.5">부제목</label>
            <input
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-0)' }}
              value={heroSub}
              onChange={e => setHeroSub(e.target.value)}
              placeholder="매일 들여다보면서 알게 된 것들."
            />
          </div>
        </div>
      </Card>

      <Card title="Editor's Note">
        <div className="p-4">
          <textarea
            className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
            style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-0)' }}
            rows={3}
            value={editorNote}
            onChange={e => setEditorNote(e.target.value)}
            placeholder="메인 페이지 Editor's Note에 표시될 문구를 입력하세요."
          />
        </div>
      </Card>

      <Card title="마퀴 키워드">
        <div className="p-4 space-y-3">
          <p className="text-xs" style={{ color: 'var(--ink-4)' }}>
            메인화면 흐르는 텍스트 키워드. 대문자로 자동 변환됩니다.
          </p>
          {/* 칩 목록 (가로 줄바꿈) */}
          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((kw, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ background: 'var(--mist)', color: 'var(--ink-1)', border: '1px solid var(--line)' }}
                >
                  {kw}
                  <button
                    onClick={() => removeKeyword(i)}
                    className="ml-0.5 rounded-full hover:text-red-500 transition-colors flex-shrink-0"
                    style={{ color: 'var(--ink-4)', lineHeight: 1 }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {keywords.length === 0 && (
            <p className="text-xs italic" style={{ color: 'var(--ink-4)' }}>키워드가 없습니다. 기본 키워드(WRITING, MUSIC, FILM, CODE)가 표시됩니다.</p>
          )}
          {/* 속도 슬라이더 */}
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>스크롤 속도</span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--ink-3)' }}>
                {marqueeSpeed <= 30 ? '매우 빠름' : marqueeSpeed <= 50 ? '빠름' : marqueeSpeed <= 75 ? '보통' : marqueeSpeed <= 100 ? '느림' : '매우 느림'}
                &nbsp;({marqueeSpeed}s)
              </span>
            </div>
            <input
              type="range" min={20} max={140} step={5}
              value={marqueeSpeed}
              onChange={e => setMarqueeSpeed(Number(e.target.value))}
              className="w-full accent-amber-400"
              style={{ cursor: 'pointer' }}
            />
            <div className="flex justify-between text-xs mt-0.5" style={{ color: 'var(--ink-4)' }}>
              <span>빠름</span>
              <span>느림</span>
            </div>
          </div>

          {/* 입력 */}
          <div className="flex gap-2">
            <input
              ref={kwInputRef}
              className="flex-1 px-3 py-2 rounded-lg border text-sm"
              style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-0)' }}
              value={newKw}
              onChange={e => setNewKw(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
              placeholder="키워드 입력 후 Enter (예: FILM)"
            />
            <button
              onClick={addKeyword}
              className="px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 transition-colors flex-shrink-0"
              style={{ background: 'var(--ink-0)', color: 'var(--paper)' }}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </Card>

      <Card title="푸터 Copyright">
        <div className="p-4">
          <input
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-0)' }}
            value={copyright}
            onChange={e => setCopyright(e.target.value)}
            placeholder="U.T Lab4 — 한 사람의 인덱스"
          />
          <p className="text-xs mt-2" style={{ color: 'var(--ink-4)' }}>© {new Date().getFullYear()} 가 자동으로 앞에 붙습니다.</p>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
          style={{ background: saveStatus === 'err' ? '#ef4444' : 'var(--c-accent)', color: '#fff' }}
        >
          <Save size={15} />
          {saving ? '저장 중...' : saveStatus === 'ok' ? '저장됨 ✓' : saveStatus === 'err' ? '저장 실패' : '저장하기'}
        </button>
        {saveStatus === 'err' && (
          <span className="text-xs text-red-500">서버 오류가 발생했습니다. 다시 시도해 주세요.</span>
        )}
      </div>
    </div>
  )
}
