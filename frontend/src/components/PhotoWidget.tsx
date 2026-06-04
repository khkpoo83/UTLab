import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Pencil, X, Check, Camera, ImageOff } from 'lucide-react'
import Card from './Card'
import apiClient, { settingsApi } from '../api/client'

// ── 타입 ─────────────────────────────────────────────────────────────────────

type PhotoSource = 'unsplash' | 'openverse' | 'wikimedia' | 'aic'

interface ArtWork {
  id: string
  title: string
  artist: string
  artistUrl?: string
  imageUrl: string
  downloadLocation?: string
  source?: PhotoSource
}

interface WikiPage {
  pageid: number
  title: string
  imageinfo?: [{
    url: string
    thumburl?: string
    extmetadata?: {
      Artist?: { value: string }
      ObjectName?: { value: string }
    }
  }]
}

// ── 상수 ─────────────────────────────────────────────────────────────────────

const DEFAULT_KEYWORD = 'nature landscape'

const SRC_LABEL: Record<PhotoSource, string> = {
  unsplash:  'Unsplash',
  openverse: 'Openverse',
  wikimedia: 'Wikimedia',
  aic:       'Art Institute',
}

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

// ── 위젯 비율 → Unsplash orientation ────────────────────────────────────────
// GRID_ROW_H=180px, 컬럼 폭≈1.6×행높이 기준
function widgetOrientation(w: number, h: number): 'portrait' | 'squarish' | 'landscape' {
  const aspect = (w * 1.6) / Math.max(h, 1)
  if (aspect < 0.9)  return 'portrait'
  if (aspect > 1.45) return 'landscape'
  return 'squarish'
}

// ── 백엔드 통합 검색 (Unsplash + Openverse, 한글→영어 번역 포함) ──────────────

async function fetchFromBackend(
  keyword: string,
  orientation: 'portrait' | 'squarish' | 'landscape',
  page = 1,
): Promise<{ items: ArtWork[]; query: string }> {
  const { data: json } = await apiClient.get('/api/photos/search', {
    params: { q: keyword, per_page: 30, page, orientation },
  })
  return {
    items: (json.items ?? []) as ArtWork[],
    query: json.query || keyword,   // 번역된 영어 키워드 (폴백 소스에 재사용)
  }
}

async function triggerUnsplashDownload(downloadLocation: string) {
  try {
    await apiClient.post(`/api/photos/download`, null, {
      params: { url: downloadLocation },
    })
  } catch { /* fire and forget */ }
}

// ── Wikimedia Commons 검색 (폴백) ────────────────────────────────────────────

async function fetchFromWikimedia(
  keyword: string,
  thumbW: number,
  orientation: 'portrait' | 'squarish' | 'landscape',
): Promise<ArtWork[]> {
  const ctl = new AbortController()
  const tid = setTimeout(() => ctl.abort(), 12000)

  try {
    const q = encodeURIComponent(keyword)
    // portrait 위젯은 높이 기준 썸네일, 나머지는 폭 기준
    const sizeParam = orientation === 'portrait'
      ? `iiurlheight=${thumbW}`
      : `iiurlwidth=${thumbW}`
    const url =
      `https://commons.wikimedia.org/w/api.php` +
      `?action=query&generator=search` +
      `&gsrsearch=${q}&gsrnamespace=6&gsrlimit=60` +
      `&prop=imageinfo&iiprop=url|extmetadata` +
      `&${sizeParam}&format=json&origin=*`

    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (json.error) throw new Error(json.error.info ?? 'wiki error')

    const pages = Object.values(json.query?.pages ?? {}) as WikiPage[]
    return pages
      .filter(p => /\.(jpe?g|png)$/i.test(p.title))
      .map(p => {
        const info = p.imageinfo![0]
        const meta = info.extmetadata ?? {}
        const rawTitle = p.title
          .replace(/^File:/, '')
          .replace(/\.[^.]+$/, '')
          .replace(/_/g, ' ')
        const title  = meta.ObjectName?.value ? stripHtml(meta.ObjectName.value) : rawTitle
        const artist = meta.Artist?.value    ? stripHtml(meta.Artist.value)      : ''
        return { id: String(p.pageid), title, artist, imageUrl: info.thumburl ?? info.url, source: 'wikimedia' as const }
      })
  } finally {
    clearTimeout(tid)
  }
}

// ── Art Institute of Chicago 검색 (폴백2) ────────────────────────────────────

async function fetchFromAIC(keyword: string): Promise<ArtWork[]> {
  const ctl = new AbortController()
  const tid = setTimeout(() => ctl.abort(), 12000)

  try {
    const q   = encodeURIComponent(keyword)
    const url = `https://api.artic.edu/api/v1/artworks/search?q=${q}&fields=id,title,artist_display,image_id&limit=80`
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()

    return (json.data as Array<{ id: number; title: string; artist_display: string; image_id: string | null }>)
      .filter(a => !!a.image_id)
      .map(a => ({
        id: String(a.id),
        title: a.title,
        artist: a.artist_display.split('\n')[0],
        imageUrl: `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg`,
        source: 'aic' as const,
      }))
  } finally {
    clearTimeout(tid)
  }
}

// ── 통합 검색: 백엔드(Unsplash+Openverse) → Wikimedia → AIC ───────────────────

async function fetchArtworks(
  keyword: string,
  thumbW: number,
  widgetW: number,
  widgetH: number,
  page = 1,
): Promise<{ items: ArtWork[]; fromBackend: boolean }> {
  const orientation = widgetOrientation(widgetW, widgetH)
  let enKw = keyword

  try {
    const { items, query } = await fetchFromBackend(keyword, orientation, page)
    if (query) enKw = query   // 번역된 영어 키워드 → 폴백 소스에도 사용
    if (items.length > 0) return { items, fromBackend: true }
  } catch (e) {
    console.warn('[PhotoWidget] 백엔드 검색 실패:', e)
  }

  try {
    const data = await fetchFromWikimedia(enKw, thumbW, orientation)
    if (data.length >= 3) return { items: data, fromBackend: false }
  } catch (e) {
    console.warn('[PhotoWidget] Wikimedia 실패, AIC로 전환:', e)
  }

  return { items: await fetchFromAIC(enKw), fromBackend: false }
}

// ── KeywordOverlay ────────────────────────────────────────────────────────────

function KeywordOverlay({
  draft, onChange, onApply, onCancel,
}: {
  draft: string
  onChange: (v: string) => void
  onApply: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/65 z-10 p-4 rounded-b-xl">
      <p className="text-white text-sm font-semibold mb-3 drop-shadow">이미지 키워드</p>
      <div className="flex gap-2 w-full max-w-[280px]">
        <input
          ref={ref}
          value={draft}
          onChange={e => onChange(e.target.value)}
          // 한글 IME 조합 중 Enter(조합 확정)는 제출하지 않음
          onKeyDown={e => {
            if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) onApply()
            else if (e.key === 'Escape') onCancel()
          }}
          placeholder="예: 꽃, 바다, Van Gogh…"
          className="flex-1 px-3 py-2 text-sm bg-white/20 border border-white/30 rounded-lg text-white placeholder-white/40 outline-none focus:border-white/60 transition-colors min-w-0"
        />
        <button onClick={onApply}
          className="p-2 bg-white/20 hover:bg-white/35 rounded-lg text-white transition-colors flex-shrink-0">
          <Check size={14} />
        </button>
        <button onClick={onCancel}
          className="p-2 bg-white/20 hover:bg-white/35 rounded-lg text-white transition-colors flex-shrink-0">
          <X size={14} />
        </button>
      </div>
      <p className="text-white/45 text-[11px] mt-2.5 text-center leading-relaxed">
        Unsplash · Openverse · Wikimedia · Art Institute<br />
        <span className="text-white/30">한글 입력 OK (자동 번역) · 꽃 · 바다 · 추상 · 건축</span>
      </p>
    </div>
  )
}

// ── PhotoWidget ───────────────────────────────────────────────────────────────

export default function PhotoWidget({
  widgetW, widgetH = 2, title, dragHandle, minH,
}: {
  widgetW: number
  widgetH?: number
  title?: string
  dragHandle?: React.ReactNode
  minH?: number
}) {
  const today    = new Date()
  const monthDay = `${today.getMonth() + 1}월 ${today.getDate()}일`
  const dowLabel = ['일', '월', '화', '수', '목', '금', '토'][today.getDay()]

  const [keyword,      setKeyword]      = useState(DEFAULT_KEYWORD)
  const [artworks,     setArtworks]     = useState<ArtWork[]>([])
  const [fromBackend,  setFromBackend]  = useState(false)
  const [page,         setPage]         = useState(1)
  const [idx,          setIdx]          = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState(false)
  const [imgError,     setImgError]     = useState(false)
  const [editingKw,    setEditingKw]    = useState(false)
  const [kwDraft,      setKwDraft]      = useState(DEFAULT_KEYWORD)
  const [settingsDone, setSettingsDone] = useState(false)

  useEffect(() => {
    settingsApi.get()
      .then(r => {
        const kw = r.data.ui_photo_keyword ?? DEFAULT_KEYWORD
        setKeyword(kw)
        setKwDraft(kw)
      })
      .catch(() => {})
      .finally(() => setSettingsDone(true))
  }, [])

  const thumbW = Math.min(1200, Math.max(400, widgetW * 300))

  const loadArtworks = useCallback(async (kw: string, tw: number, pg = 1) => {
    setLoading(true)
    setFetchError(false)
    setImgError(false)
    try {
      const { items, fromBackend: fb } = await fetchArtworks(kw, tw, widgetW, widgetH, pg)
      if (items.length === 0) {
        setFetchError(true)
        setArtworks([])
      } else {
        // 백엔드 결과는 Unsplash 우선 순서 유지, 폴백(미술관)은 섞어서 다양화
        setArtworks(fb ? items : [...items].sort(() => Math.random() - 0.5))
        setFromBackend(fb)
        setPage(pg)
        setIdx(0)
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [widgetW, widgetH])

  // 키워드 또는 설정 로드 완료 시 작품 목록 갱신
  const kwRef      = useRef(keyword)
  const thumbWRef  = useRef(thumbW)
  kwRef.current    = keyword
  thumbWRef.current = thumbW

  useEffect(() => {
    if (!settingsDone) return
    loadArtworks(kwRef.current, thumbWRef.current)
  }, [keyword, settingsDone, loadArtworks])

  const current = artworks[idx] ?? null

  // Unsplash 가이드라인: 사진 표시 시 download 이벤트 트리거
  useEffect(() => {
    if (current?.downloadLocation) {
      triggerUnsplashDownload(current.downloadLocation)
    }
  }, [current?.id])

  // 이미지 로드 실패 시 2초 후 자동 다음 이미지로 이동
  useEffect(() => {
    if (!imgError || artworks.length <= 1) return
    const t = setTimeout(() => {
      setImgError(false)
      setIdx(i => (i + 1) % artworks.length)
    }, 2000)
    return () => clearTimeout(t)
  }, [imgError, artworks.length])

  function refresh() {
    if (artworks.length === 0) { loadArtworks(keyword, thumbW, 1); return }
    setImgError(false)
    // 백엔드 소스: 마지막 이미지면 다음 페이지 로드, 아니면 다음으로 이동
    if (fromBackend && idx >= artworks.length - 1) {
      loadArtworks(keyword, thumbW, page + 1)
    } else {
      setIdx(i => (i + 1) % artworks.length)
    }
  }

  function applyKeyword() {
    const kw = kwDraft.trim() || DEFAULT_KEYWORD
    setEditingKw(false)
    if (kw === keyword) { loadArtworks(kw, thumbW, 1); return }
    setPage(1)
    setKeyword(kw)
    settingsApi.update({ ui_photo_keyword: kw }).catch(console.error)
  }

  const cardRight = (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => { setEditingKw(true); setKwDraft(keyword) }}
        className="p-1 rounded transition-colors"
        style={{ color: 'var(--ink-4)' }}
        title="키워드 변경"
      ><Pencil size={12} /></button>
      <button
        onClick={refresh}
        disabled={loading}
        className="p-1 rounded transition-colors disabled:opacity-40"
        style={{ color: 'var(--ink-4)' }}
        title="다음 이미지"
      ><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /></button>
    </div>
  )

  return (
    <Card
      icon={<Camera size={14} />}
      title={title ?? '오늘의 사진'}
      dragHandle={dragHandle}
      minH={minH}
      contentClassName="p-0"
      className="h-full"
      right={cardRight}
    >
      <div className="relative overflow-hidden rounded-b-xl" style={{ height: `${(minH ?? 100) - 44}px` }}>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--mist)' }}>
            <RefreshCw size={22} className="animate-spin" style={{ color: 'var(--ink-4)' }} />
          </div>
        )}

        {!loading && (fetchError || !current) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4" style={{ background: 'var(--mist)' }}>
            <ImageOff size={24} style={{ color: 'var(--ink-5)' }} />
            <p className="text-xs text-center" style={{ color: 'var(--ink-4)' }}>"{keyword}" 검색 결과 없음</p>
            <button onClick={() => loadArtworks(keyword, thumbW)}
              className="text-xs text-accent hover:underline">다시 시도</button>
          </div>
        )}

        {!loading && current && !fetchError && (
          <>
            {imgError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: 'var(--mist)' }}>
                <RefreshCw size={18} className="animate-spin" style={{ color: 'var(--ink-4)' }} />
                <p className="text-xs" style={{ color: 'var(--ink-4)' }}>다음 이미지로 이동 중...</p>
              </div>
            ) : (
              <div className="relative w-full h-full bg-black">
                {/* 블러 배경: 비율 불일치 시 레터박스 영역 채움 */}
                <img
                  src={current.imageUrl}
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl brightness-50 pointer-events-none"
                />
                {/* 실제 이미지: 잘림 없이 전체 표시 */}
                <img
                  key={current.id}
                  src={current.imageUrl}
                  alt={current.title}
                  className="relative w-full h-full object-contain"
                  onError={() => setImgError(true)}
                  loading="lazy"
                />
              </div>
            )}
            {!imgError && (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent pointer-events-none" />
                {/* 소스 표시 배지 (이미지별) */}
                {current.source && (
                  <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                    <span className="bg-black/30 text-white/60 text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-sm pointer-events-none">
                      {SRC_LABEL[current.source]}
                    </span>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-3 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    {current.source === 'unsplash' && current.artist ? (
                      <p className="text-white/55 text-[10px] drop-shadow truncate leading-snug">
                        Photo by{' '}
                        <a
                          href={current.artistUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-white/80 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >{current.artist}</a>
                        {' '}on{' '}
                        <a
                          href="https://unsplash.com?utm_source=ut_lab&utm_medium=referral"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-white/80 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >Unsplash</a>
                      </p>
                    ) : (
                      <>
                        <p className="text-white text-sm font-semibold leading-snug drop-shadow line-clamp-2">
                          {current.title}
                        </p>
                        {current.artist && (
                          <p className="text-white/65 text-xs mt-0.5 drop-shadow truncate">
                            {current.artist}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-white text-xs font-medium drop-shadow tabular-nums">
                      {monthDay} {dowLabel}요일
                    </p>
                    <p className="text-white/45 text-[10px] mt-0.5 tabular-nums">
                      {idx + 1} / {artworks.length}
                    </p>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {editingKw && (
          <KeywordOverlay
            draft={kwDraft}
            onChange={setKwDraft}
            onApply={applyKeyword}
            onCancel={() => setEditingKw(false)}
          />
        )}
      </div>
    </Card>
  )
}
