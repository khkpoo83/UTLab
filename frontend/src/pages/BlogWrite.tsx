import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Globe, Lock, Tag, X, Sparkles, Save, ArrowLeft, Image as ImageIcon, Loader2 } from 'lucide-react'
import BlogEditor from '../components/blog/BlogEditor'
import { blogApi } from '../api/client'

const STYLES = [
  { value: 'casual', label: '친근하게' },
  { value: 'formal', label: '격식체' },
  { value: 'technical', label: '기술적' },
  { value: 'creative', label: '창의적' },
]

const LENGTHS = [
  { value: 'short', label: '짧게 (500자~)' },
  { value: 'medium', label: '보통 (1000자~)' },
  { value: 'long', label: '길게 (2000자~)' },
]

export default function BlogWrite() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const coverInputRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [coverImage, setCoverImage] = useState<string | null>(null)
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [aiTopic, setAiTopic] = useState('')
  const [aiStyle, setAiStyle] = useState('casual')
  const [aiLength, setAiLength] = useState('medium')
  const [generating, setGenerating] = useState(false)
  const [aiPanel, setAiPanel] = useState(false)

  useEffect(() => {
    if (!isEdit) return
    blogApi.get(Number(id))
      .then(({ data }) => {
        setTitle(data.title)
        setContent(data.content || '')
        setCoverImage(data.cover_image)
        setVisibility(data.visibility)
        setTags(data.tags)
      })
      .catch(console.error)
  }, [id])

  async function handleCoverUpload(file: File) {
    try {
      const { data } = await blogApi.upload(file)
      setCoverImage(data.url)
    } catch (e) { console.error(e) }
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }

  async function doSave() {
    setConfirmDialog(false)
    setSaving(true)
    try {
      const payload = {
        title: title || '제목 없음',
        content,
        cover_image: coverImage?.split('/').pop() || undefined,
        visibility,
        tags,
      }
      if (isEdit) {
        await blogApi.update(Number(id), payload)
        navigate(`/blog/${id}`)
      } else {
        const { data } = await blogApi.create(payload)
        navigate(`/blog/${data.id}`, { replace: true })
      }
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  async function handleGenerate() {
    if (!title && !aiTopic) return
    setGenerating(true)
    try {
      const { data } = await blogApi.generate({ title, topic: aiTopic, style: aiStyle, length: aiLength })
      setContent(data.content)
    } catch (e) { console.error(e) }
    finally { setGenerating(false) }
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── 상단 헤더 ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-sm flex-shrink-0">
          <ArrowLeft size={16} /> 뒤로
        </button>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="제목을 입력하세요"
          className="flex-1 text-lg font-bold bg-transparent outline-none text-zinc-800 dark:text-zinc-200 placeholder-zinc-300 dark:placeholder-zinc-600 min-w-0"
        />
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setAiPanel(p => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${aiPanel ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
          >
            <Sparkles size={14} /> AI
          </button>
          <button
            onClick={() => setConfirmDialog(true)}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장
          </button>
        </div>
      </div>

      {/* ── 본문 영역 ── */}
      <div className="flex-1 overflow-hidden flex">
        {/* 에디터 */}
        <div className="flex-1 overflow-y-auto p-4">
          <BlogEditor content={content} onChange={setContent} />
        </div>

        {/* 우측 사이드바 */}
        <div className="w-64 border-l border-zinc-200 dark:border-zinc-700 overflow-y-auto p-4 space-y-5 bg-zinc-50 dark:bg-zinc-900/60 flex-shrink-0">
          {/* 커버 이미지 */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">커버 이미지</p>
            {coverImage ? (
              <div className="relative rounded-lg overflow-hidden">
                <img src={coverImage} alt="cover" className="w-full h-28 object-cover" />
                <button onClick={() => setCoverImage(null)} className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white hover:bg-black/70">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => coverInputRef.current?.click()}
                className="w-full h-28 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg flex flex-col items-center justify-center gap-2 text-zinc-400 hover:border-accent hover:text-accent transition-colors"
              >
                <ImageIcon size={20} />
                <span className="text-xs">이미지 업로드</span>
              </button>
            )}
            <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCoverUpload(f); e.target.value = '' }} />
          </div>

          {/* 공개 설정 */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">공개 설정</p>
            <div className="flex gap-2">
              <button
                onClick={() => setVisibility('private')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border transition-colors ${visibility === 'private' ? 'border-accent bg-accent/10 text-accent' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'}`}
              ><Lock size={12} /> 비공개</button>
              <button
                onClick={() => setVisibility('public')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border transition-colors ${visibility === 'public' ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-600' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'}`}
              ><Globe size={12} /> 공개</button>
            </div>
          </div>

          {/* 태그 */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">태그</p>
            <div className="flex gap-1 flex-wrap mb-2">
              {tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-xs rounded-full">
                  {tag}
                  <button onClick={() => setTags(prev => prev.filter(t => t !== tag))}><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                placeholder="태그 입력 후 Enter"
                className="flex-1 text-xs px-2 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 outline-none focus:border-accent text-zinc-700 dark:text-zinc-300 placeholder-zinc-400"
              />
              <button onClick={addTag} className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600">
                <Tag size={12} />
              </button>
            </div>
          </div>

          {/* AI 생성 패널 */}
          {aiPanel && (
            <div className="border border-purple-200 dark:border-purple-800 rounded-xl p-3 bg-purple-50 dark:bg-purple-900/10 space-y-3">
              <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                <Sparkles size={12} /> AI 자동 생성
              </p>
              <div>
                <p className="text-[11px] text-zinc-500 mb-1">주제 보충 설명 (선택)</p>
                <textarea
                  value={aiTopic}
                  onChange={e => setAiTopic(e.target.value)}
                  placeholder="어떤 내용을 쓸지 추가 설명..."
                  rows={2}
                  className="w-full text-xs px-2 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 outline-none resize-none text-zinc-700 dark:text-zinc-300 placeholder-zinc-400"
                />
              </div>
              <div>
                <p className="text-[11px] text-zinc-500 mb-1">문체</p>
                <div className="grid grid-cols-2 gap-1">
                  {STYLES.map(s => (
                    <button key={s.value} onClick={() => setAiStyle(s.value)}
                      className={`py-1 text-[11px] rounded-md border transition-colors ${aiStyle === s.value ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/30 text-purple-600' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] text-zinc-500 mb-1">분량</p>
                <div className="flex flex-col gap-1">
                  {LENGTHS.map(l => (
                    <button key={l.value} onClick={() => setAiLength(l.value)}
                      className={`py-1 text-[11px] rounded-md border transition-colors ${aiLength === l.value ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/30 text-purple-600' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'}`}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating || (!title && !aiTopic)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-purple-500 hover:bg-purple-600 text-white disabled:opacity-50 transition-colors"
              >
                {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {generating ? '생성 중...' : '본문 생성'}
              </button>
              {generating && (
                <p className="text-[11px] text-purple-500 text-center">Gemini가 글을 작성하고 있어요...</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 저장 확인 모달 ── */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
          onClick={() => setConfirmDialog(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl border border-zinc-200 dark:border-zinc-700"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-5">
              {visibility === 'public'
                ? <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0"><Globe size={18} className="text-green-600" /></div>
                : <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0"><Lock size={18} className="text-zinc-500" /></div>
              }
              <div>
                <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                  {visibility === 'public' ? '공개 글로 저장합니다' : '비공개로 저장합니다'}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {visibility === 'public' ? '누구나 이 글을 볼 수 있습니다' : '나만 볼 수 있습니다'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDialog(false)}
                className="flex-1 py-2.5 text-sm rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                취소
              </button>
              <button onClick={doSave}
                className="flex-1 py-2.5 text-sm rounded-xl bg-accent text-white font-medium hover:bg-accent/90 transition-colors">
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
