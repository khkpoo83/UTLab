import { useState, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Globe, Lock, Tag, X, Sparkles, Save, ArrowLeft, Image as ImageIcon,
  Loader2, Eye, EyeOff, ChevronDown, ChevronUp as ChevronUpIcon, Wand2,
} from 'lucide-react'
import BlogEditor from '../components/blog/BlogEditor'
import { blogApi } from '../api/client'

const STYLES = [
  { value: 'casual',    label: '친근하게' },
  { value: 'formal',    label: '격식체' },
  { value: 'technical', label: '기술적' },
  { value: 'creative',  label: '창의적' },
]
const LENGTHS = [
  { value: 'short',  label: '짧게 (500자~)' },
  { value: 'medium', label: '보통 (1000자~)' },
  { value: 'long',   label: '길게 (2000자~)' },
]
const AUDIENCES = [
  { value: 'general',   label: '일반 독자' },
  { value: 'developer', label: '개발자' },
  { value: 'investor',  label: '투자자' },
  { value: 'student',   label: '학생/입문자' },
]
const STRUCTURES = [
  { value: 'free',      label: '자유형' },
  { value: 'listicle',  label: '목록형' },
  { value: 'howto',     label: '하우투' },
  { value: 'analysis',  label: '분석형' },
]

export default function BlogWrite() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const coverInputRef = useRef<HTMLInputElement>(null)

  const [title,       setTitle]       = useState('')
  const [content,     setContent]     = useState('')
  const [coverImage,  setCoverImage]  = useState<string | null>(null)
  const [visibility,  setVisibility]  = useState<'public' | 'private'>('private')
  const [tagInput,    setTagInput]    = useState('')
  const [tags,        setTags]        = useState<string[]>([])
  const [saving,      setSaving]      = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [coverError,  setCoverError]  = useState<string | null>(null)

  // 미리보기
  const [previewMode, setPreviewMode] = useState(false)

  // AI 생성
  const [aiPanel,           setAiPanel]           = useState(false)
  const [aiAdvanced,        setAiAdvanced]        = useState(false)
  const [aiTopic,           setAiTopic]           = useState('')
  const [aiStyle,           setAiStyle]           = useState('casual')
  const [aiLength,          setAiLength]          = useState('medium')
  const [aiLanguage,        setAiLanguage]        = useState('ko')
  const [aiKeywords,        setAiKeywords]        = useState('')
  const [aiAudience,        setAiAudience]        = useState('general')
  const [aiStructure,       setAiStructure]       = useState('free')
  const [aiIncludeExamples, setAiIncludeExamples] = useState(false)
  const [aiAppendMode,      setAiAppendMode]      = useState(false)
  const [generating,        setGenerating]        = useState(false)
  const [genProgress,       setGenProgress]       = useState('')
  const [generatingCover,   setGeneratingCover]   = useState(false)
  const [coverGenPrompt,    setCoverGenPrompt]     = useState('')
  const [coverGenError,     setCoverGenError]      = useState('')

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
    setCoverError(null)
    try {
      const { data } = await blogApi.upload(file)
      setCoverImage(data.url)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setCoverError(msg ?? '이미지 업로드 실패')
      setTimeout(() => setCoverError(null), 4000)
    }
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
    setGenProgress('Gemini가 글을 작성하고 있어요...')
    try {
      const { data } = await blogApi.generate({
        title,
        topic: aiTopic,
        style: aiStyle,
        length: aiLength,
        language: aiLanguage,
        keywords: aiKeywords,
        audience: aiAudience,
        structure: aiStructure,
        include_examples: aiIncludeExamples,
        append_mode: aiAppendMode,
        current_content: aiAppendMode ? content : '',
      })
      if (aiAppendMode && content) {
        setContent(content + '\n' + data.content)
      } else {
        setContent(data.content)
      }
      setGenProgress('완료!')
      setTimeout(() => setGenProgress(''), 2000)
    } catch (e) {
      setGenProgress('생성 실패. 다시 시도해주세요.')
      setTimeout(() => setGenProgress(''), 3000)
      console.error(e)
    } finally {
      setGenerating(false)
    }
  }

  async function handleGenerateCover() {
    if (!title) return
    setGeneratingCover(true)
    setCoverGenError('')
    setCoverGenPrompt('')
    try {
      const excerpt = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
      const { data } = await blogApi.generateCover({ title, tags, excerpt })
      setCoverImage(data.url)
      setCoverGenPrompt(data.prompt)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setCoverGenError(msg ?? '썸네일 생성 실패 (Imagen API 활성화 필요)')
      setTimeout(() => setCoverGenError(''), 6000)
    } finally {
      setGeneratingCover(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── 상단 헤더 ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex-shrink-0">
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
          {/* 미리보기 토글 */}
          <button
            onClick={() => setPreviewMode(p => !p)}
            title={previewMode ? '편집 모드로 돌아가기' : '미리보기'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              previewMode
                ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            {previewMode ? <EyeOff size={14} /> : <Eye size={14} />}
            {previewMode ? '편집' : '미리보기'}
          </button>
          <button
            onClick={() => setAiPanel(p => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              aiPanel
                ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
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
      <div className="flex-1 overflow-hidden flex min-h-0">

        {/* 에디터 또는 미리보기 */}
        <div className="flex-1 overflow-y-auto">
          {previewMode ? (
            <div className="max-w-3xl mx-auto px-6 py-8">
              {/* 미리보기 헤더 */}
              {coverImage && (
                <div className="rounded-2xl overflow-hidden mb-6 h-48">
                  <img src={coverImage} alt="cover" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {tags.map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 bg-accent/10 text-accent rounded-full">{t}</span>
                ))}
                <span className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded-full ${
                  visibility === 'public'
                    ? 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                }`}>
                  {visibility === 'public' ? <Globe size={10} /> : <Lock size={10} />}
                  {visibility === 'public' ? '공개' : '비공개'}
                </span>
              </div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-6 leading-tight">
                {title || '(제목 없음)'}
              </h1>
              {content ? (
                <div
                  className="prose prose-zinc dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              ) : (
                <p className="text-zinc-400 text-sm italic">내용이 없습니다.</p>
              )}
            </div>
          ) : (
            <div className="p-4 h-full">
              <BlogEditor content={content} onChange={setContent} />
            </div>
          )}
        </div>

        {/* 우측 사이드바 */}
        <div className="w-64 border-l border-zinc-200 dark:border-zinc-700 overflow-y-auto p-4 space-y-5 bg-zinc-50 dark:bg-zinc-900/60 flex-shrink-0">

          {/* 커버 이미지 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">커버 이미지</p>
              <button
                onClick={handleGenerateCover}
                disabled={generatingCover || !title}
                title={!title ? '제목을 먼저 입력하세요' : 'AI로 썸네일 자동 생성 (Imagen 3)'}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50 disabled:opacity-40 transition-colors"
              >
                {generatingCover
                  ? <Loader2 size={10} className="animate-spin" />
                  : <Wand2 size={10} />
                }
                {generatingCover ? '생성 중...' : 'AI 생성'}
              </button>
            </div>
            {coverImage ? (
              <div className="relative rounded-lg overflow-hidden">
                <img src={coverImage} alt="cover" className="w-full h-28 object-cover" />
                <button onClick={() => { setCoverImage(null); setCoverGenPrompt('') }} className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white hover:bg-black/70">
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
            {coverError && <p className="mt-1 text-[11px] text-red-500">{coverError}</p>}
            {coverGenError && <p className="mt-1 text-[11px] text-red-500">{coverGenError}</p>}
            {coverGenPrompt && !coverGenError && (
              <p className="mt-1 text-[10px] text-zinc-400 leading-snug line-clamp-2" title={coverGenPrompt}>
                ✦ {coverGenPrompt}
              </p>
            )}
          </div>

          {/* 공개 설정 */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">공개 설정</p>
            <div className="flex gap-2">
              <button
                onClick={() => setVisibility('private')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border transition-colors ${
                  visibility === 'private'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                }`}
              >
                <Lock size={12} /> 비공개
              </button>
              <button
                onClick={() => setVisibility('public')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border transition-colors ${
                  visibility === 'public'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-600'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                }`}
              >
                <Globe size={12} /> 공개
              </button>
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

              {/* 주제 보충 */}
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

              {/* 문체 */}
              <div>
                <p className="text-[11px] text-zinc-500 mb-1">문체</p>
                <div className="grid grid-cols-2 gap-1">
                  {STYLES.map(s => (
                    <button key={s.value} onClick={() => setAiStyle(s.value)}
                      className={`py-1 text-[11px] rounded-md border transition-colors ${
                        aiStyle === s.value
                          ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/30 text-purple-600'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 분량 */}
              <div>
                <p className="text-[11px] text-zinc-500 mb-1">분량</p>
                <div className="flex flex-col gap-1">
                  {LENGTHS.map(l => (
                    <button key={l.value} onClick={() => setAiLength(l.value)}
                      className={`py-1 text-[11px] rounded-md border transition-colors ${
                        aiLength === l.value
                          ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/30 text-purple-600'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                      }`}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 고급 옵션 토글 */}
              <button
                onClick={() => setAiAdvanced(p => !p)}
                className="w-full flex items-center justify-between text-[11px] text-purple-500 hover:text-purple-600 transition-colors py-0.5"
              >
                <span>고급 옵션</span>
                {aiAdvanced ? <ChevronUpIcon size={12} /> : <ChevronDown size={12} />}
              </button>

              {aiAdvanced && (
                <div className="space-y-3 pt-1 border-t border-purple-200 dark:border-purple-800/60">
                  {/* 언어 */}
                  <div>
                    <p className="text-[11px] text-zinc-500 mb-1">언어</p>
                    <div className="flex gap-1">
                      {[{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }].map(l => (
                        <button key={l.value} onClick={() => setAiLanguage(l.value)}
                          className={`flex-1 py-1 text-[11px] rounded-md border transition-colors ${
                            aiLanguage === l.value
                              ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/30 text-purple-600'
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                          }`}>
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 타겟 독자 */}
                  <div>
                    <p className="text-[11px] text-zinc-500 mb-1">타겟 독자</p>
                    <div className="grid grid-cols-2 gap-1">
                      {AUDIENCES.map(a => (
                        <button key={a.value} onClick={() => setAiAudience(a.value)}
                          className={`py-1 text-[11px] rounded-md border transition-colors ${
                            aiAudience === a.value
                              ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/30 text-purple-600'
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                          }`}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 구조 */}
                  <div>
                    <p className="text-[11px] text-zinc-500 mb-1">글 구조</p>
                    <div className="grid grid-cols-2 gap-1">
                      {STRUCTURES.map(s => (
                        <button key={s.value} onClick={() => setAiStructure(s.value)}
                          className={`py-1 text-[11px] rounded-md border transition-colors ${
                            aiStructure === s.value
                              ? 'border-purple-400 bg-purple-100 dark:bg-purple-900/30 text-purple-600'
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300'
                          }`}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 키워드 */}
                  <div>
                    <p className="text-[11px] text-zinc-500 mb-1">키워드 (쉼표 구분)</p>
                    <input
                      value={aiKeywords}
                      onChange={e => setAiKeywords(e.target.value)}
                      placeholder="예: React, 성능최적화, hooks"
                      className="w-full text-xs px-2 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 placeholder-zinc-400"
                    />
                  </div>

                  {/* 체크옵션들 */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={aiIncludeExamples}
                        onChange={e => setAiIncludeExamples(e.target.checked)}
                        className="w-3 h-3 accent-purple-500"
                      />
                      <span className="text-[11px] text-zinc-600 dark:text-zinc-400">예시·사례 포함</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={aiAppendMode}
                        onChange={e => setAiAppendMode(e.target.checked)}
                        className="w-3 h-3 accent-purple-500"
                      />
                      <span className="text-[11px] text-zinc-600 dark:text-zinc-400">현재 내용에 이어서 추가</span>
                    </label>
                  </div>
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={generating || (!title && !aiTopic)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-purple-500 hover:bg-purple-600 text-white disabled:opacity-50 transition-colors"
              >
                {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {generating ? '생성 중...' : (aiAppendMode ? '내용 추가 생성' : '본문 생성')}
              </button>

              {genProgress && (
                <p className={`text-[11px] text-center ${
                  genProgress.includes('실패') ? 'text-red-400' : 'text-purple-500'
                }`}>
                  {genProgress}
                </p>
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
