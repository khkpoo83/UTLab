import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { Search, MapPin, Crosshair } from 'lucide-react'

// Vite 번들러에서 기본 마커 아이콘 경로가 깨지는 문제 픽스
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const SEOUL: [number, number] = [37.5665, 126.9780]

export interface LatLon { lat: number; lon: number }

interface NominatimItem {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

// ── Nominatim 헬퍼 ────────────────────────────────────────────────────────────

async function geocode(query: string): Promise<NominatimItem[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&accept-language=ko`,
    { headers: { 'Accept-Language': 'ko' } }
  )
  return res.json()
}

/** 주소 문자열 → 첫 좌표 (수정 모달 진입 시 핀 복원용) */
export async function geocodeFirst(query: string): Promise<LatLon | null> {
  if (!query.trim()) return null
  try {
    const items = await geocode(query)
    if (!items.length) return null
    return { lat: parseFloat(items[0].lat), lon: parseFloat(items[0].lon) }
  } catch {
    return null
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ko`,
    { headers: { 'Accept-Language': 'ko' } }
  )
  const data = await res.json()
  return data?.display_name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

// ── 지도 내부 헬퍼 컴포넌트 ────────────────────────────────────────────────────

/** center가 바뀌면 부드럽게 이동 */
function Recenter({ center }: { center: [number, number] }) {
  const map = useMap()
  const prev = useRef<string>('')
  useEffect(() => {
    const key = center.join(',')
    if (key === prev.current) return
    prev.current = key
    map.flyTo(center, Math.max(map.getZoom(), 15), { duration: 0.6 })
  }, [center, map])
  return null
}

/** 지도 클릭 시 핀 이동 */
function ClickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) { onPick(e.latlng.lat, e.latlng.lng) },
  })
  return null
}

// ── LocationPicker ────────────────────────────────────────────────────────────

export default function LocationPicker({
  value, coords, onChange, height = 280,
}: {
  value: string
  coords: LatLon | null
  onChange: (location: string, coords: LatLon) => void
  height?: number
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NominatimItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [resolving, setResolving] = useState(false)

  const center: [number, number] = coords ? [coords.lat, coords.lon] : SEOUL

  async function runSearch() {
    if (!query.trim()) return
    setSearching(true); setSearched(true)
    try { setResults(await geocode(query)) }
    catch { setResults([]) }
    finally { setSearching(false) }
  }

  function selectResult(item: NominatimItem) {
    onChange(item.display_name, { lat: parseFloat(item.lat), lon: parseFloat(item.lon) })
    setResults([])
    setQuery('')
    setSearched(false)
  }

  // 핀 이동(드래그/클릭) → 주소 역지오코딩
  async function pickAt(lat: number, lon: number) {
    setResolving(true)
    try {
      const addr = await reverseGeocode(lat, lon)
      onChange(addr, { lat, lon })
    } catch {
      onChange(`${lat.toFixed(5)}, ${lon.toFixed(5)}`, { lat, lon })
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* 검색 */}
      <div className="relative">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runSearch() } }}
            placeholder="장소·주소 검색"
            className="flex-1 px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-accent transition-colors"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={searching}
            className="px-3 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center"
          >
            <Search size={14} />
          </button>
        </div>

        {/* 검색 결과 드롭다운 */}
        {searched && (
          <div className="absolute z-[1000] left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl max-h-44 overflow-y-auto">
            {searching && <p className="text-xs text-zinc-400 text-center py-3">검색 중...</p>}
            {!searching && results.length === 0 && (
              <p className="text-xs text-zinc-400 text-center py-3">검색 결과 없음</p>
            )}
            {results.map(r => (
              <button
                key={r.place_id}
                type="button"
                onClick={() => selectResult(r)}
                className="w-full text-left px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors leading-snug flex items-start gap-1.5"
              >
                <MapPin size={12} className="mt-0.5 flex-shrink-0 text-accent" />
                <span className="min-w-0">{r.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 지도 */}
      <div className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700" style={{ height }}>
        <MapContainer
          center={center}
          zoom={coords ? 15 : 11}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Recenter center={center} />
          <ClickHandler onPick={pickAt} />
          {coords && (
            <Marker
              position={[coords.lat, coords.lon]}
              draggable
              eventHandlers={{
                dragend(e) {
                  const m = e.target as L.Marker
                  const { lat, lng } = m.getLatLng()
                  pickAt(lat, lng)
                },
              }}
            />
          )}
        </MapContainer>

        {/* 안내/상태 오버레이 */}
        <div className="absolute bottom-1.5 left-1.5 z-[1000] flex items-center gap-1 px-2 py-1 rounded-md bg-black/55 text-white text-[10px] pointer-events-none">
          <Crosshair size={10} />
          {resolving ? '주소 확인 중...' : coords ? '핀 드래그·지도 클릭으로 조정' : '지도를 클릭해 위치 지정'}
        </div>
      </div>

      {/* 선택된 주소 */}
      <div className="text-xs text-zinc-500 dark:text-zinc-400 min-h-[1.25rem] leading-snug break-words">
        {value
          ? <span className="flex items-start gap-1"><MapPin size={12} className="mt-0.5 flex-shrink-0 text-accent" />{value}</span>
          : <span className="text-zinc-400">위치가 지정되지 않음</span>}
      </div>
    </div>
  )
}
