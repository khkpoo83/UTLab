import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Pencil, X, Check, Camera, ImageOff } from 'lucide-react'
import Card from './Card'
import apiClient, { settingsApi } from '../api/client'

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface ArtWork {
  id: string
  title: string
  artist: string
  artistUrl?: string
  imageUrl: string
  downloadLocation?: string
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

// ── Unsplash (백엔드 프록시) ──────────────────────────────────────────────────

async function fetchFromUnsplash(
  keyword: string,
  orientation: 'portrait' | 'squarish' | 'landscape',
  page = 1,
): Promise<{ items: ArtWork[]; configured: boolean }> {
  const { data: json } = await apiClient.get('/api/photos/search', {
    params: { q: keyword, per_page: 30, page, orientation },
  })
  if (json.source === 'none') return { items: [], configured: false }
  return { items: json.items as ArtWork[], configured: true }
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
        return { id: String(p.pageid), title, artist, imageUrl: info.thumburl ?? info.url }
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
      }))
  } finally {
    clearTimeout(tid)
  }
}

// ── 통합 검색: Unsplash 우선 → Wikimedia → AIC ───────────────────────────────

async function fetchArtworks(
  keyword: string,
  thumbW: number,
  widgetW: number,
  widgetH: number,
  page = 1,
): Promise<{ items: ArtWork[]; source: 'unsplash' | 'wikimedia' | 'aic' }> {
  const orientation = widgetOrientation(widgetW, widgetH)

  try {
    const { items, configured } = await fetchFromUnsplash(keyword, orientation, page)
    if (configured && items.length > 0) return { items, source: 'unsplash' }
    if (!configured) {
      // API 키 미설정 → 기존 소스로
    }
  } catch (e) {
    console.warn('[PhotoWidget] Unsplash 실패:', e)
  }

  try {
    const data = await fetchFromWikimedia(keyword, thumbW, orientation)
    if (data.length >= 3) return { items: data, source: 'wikimedia' }
  } catch (e) {
    console.warn('[PhotoWidget] Wikimedia 실패, AIC로 전환:', e)
  }

  return { items: await fetchFromAIC(keyword), source: 'aic' }
}

function containsKorean(str: string) {
  return /[ㄱ-ㅣ가-힣]/.test(str)
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
          onKeyDown={e => { if (e.key === 'Enter') onApply(); if (e.key === 'Escape') onCancel() }}
          placeholder="예: Alphonse Mucha, Van Gogh…"
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
        Unsplash · Wikimedia · Art Institute of Chicago<br />
        <span className="text-white/30">nature · city · abstract · portrait · architecture</span>
      </p>
      {containsKorean(draft) && (
        <p className="text-yellow-400/90 text-[11px] mt-2 text-center font-medium">
          ⚠ Unsplash는 영어 키워드만 지원합니다
        </p>
      )}
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
  const [source,       setSource]       = useState<'unsplash' | 'wikimedia' | 'aic' | null>(null)
  const [unsplashPage, setUnsplashPage] = useState(1)
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

  const loadArtworks = useCallback(async (kw: string, tw: number, page = 1) => {
    setLoading(true)
    setFetchError(false)
    setImgError(false)
    try {
      const { items, source: src } = await fetchArtworks(kw, tw, widgetW, widgetH, page)
      if (items.length === 0) {
        setFetchError(true)
        setArtworks([])
      } else {
        setArtworks(src === 'unsplash' ? items : [...items].sort(() => Math.random() - 0.5))
        setSource(src)
        setUnsplashPage(page)
        setIdx(0)
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [])

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
    // Unsplash: 마지막 이미지면 다음 페이지 로드, 아니면 다음으로 이동
    if (source === 'unsplash' && idx >= artworks.length - 1) {
      loadArtworks(keyword, thumbW, unsplashPage + 1)
    } else {
      setIdx(i => (i + 1) % artworks.length)
    }
  }

  function applyKeyword() {
    const kw = kwDraft.trim() || DEFAULT_KEYWORD
    setEditingKw(false)
    if (kw === keyword) { loadArtworks(kw, thumbW, 1); return }
    setUnsplashPage(1)
    setKeyword(kw)
    settingsApi.update({ ui_photo_keyword: kw }).catch(console.error)
  }

  const cardRight = (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => { setEditingKw(true); setKwDraft(keyword) }}
        className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        title="키워드 변경"
      ><Pencil size={12} /></button>
      <button
        onClick={refresh}
        disabled={loading}
        className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-40"
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
      <div className="relative overflow-hidden rounded-b-xl h-full" style={{ minHeight: (minH ?? 100) - 44 }}>

        {loading && (
          <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
            <RefreshCw size={22} className="text-zinc-400 animate-spin" />
          </div>
        )}

        {!loading && (fetchError || !current) && (
          <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 flex flex-col items-center justify-center gap-2 p-4">
            <ImageOff size={24} className="text-zinc-300 dark:text-zinc-600" />
            <p className="text-xs text-zinc-400 text-center">"{keyword}" 검색 결과 없음</p>
            <button onClick={() => loadArtworks(keyword, thumbW)}
              className="text-xs text-accent hover:underline">다시 시도</button>
          </div>
        )}

        {!loading && current && !fetchError && (
          <>
            {imgError ? (
              <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 flex flex-col items-center justify-center gap-2">
                <RefreshCw size={18} className="text-zinc-400 animate-spin" />
                <p className="text-xs text-zinc-400">다음 이미지로 이동 중...</p>
              </div>
            ) : (
              <img
                key={current.id}
                src={current.imageUrl}
                alt={current.title}
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
                loading="lazy"
              />
            )}
            {!imgError && (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent pointer-events-none" />
                {/* 소스 표시 배지 */}
                {source && (
                  <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                    <span className="bg-black/30 text-white/60 text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-sm pointer-events-none">
                      {source === 'unsplash' ? 'Unsplash' : source === 'wikimedia' ? 'Wikimedia' : 'Art Institute'}
                    </span>
                    {source !== 'unsplash' && containsKorean(keyword) && (
                      <button
                        onClick={() => { setEditingKw(true); setKwDraft(keyword) }}
                        className="bg-yellow-500/75 hover:bg-yellow-500/95 text-white text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-sm transition-colors"
                        title="Unsplash는 영어 키워드만 지원합니다"
                      >
                        영어 키워드 → Unsplash
                      </button>
                    )}
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-3 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    {source === 'unsplash' && current.artist ? (
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
