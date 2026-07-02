import { useQuery } from '@tanstack/react-query'
import apiClient, { indicesApi, MarketIndex } from '../client'

// Pilot TanStack Query hook (roadmap Phase 3, P3-1).
//
// Replaces IndexPanel's manual `useState + useEffect + setInterval(5min)`.
// Fetches the index list, then each index's intraday series in parallel —
// exactly the legacy behavior — and re-polls every 5 minutes via refetchInterval.

export interface IntradayPoint {
  time: number
  close: number
}

export interface IndicesData {
  indices: MarketIndex[]
  intradays: Record<string, IntradayPoint[]>
  /** ISO timestamp of the most recently updated index, or null. */
  updatedAt: string | null
}

const POLL_MS = 5 * 60 * 1000

async function fetchIndices(): Promise<IndicesData> {
  const { data: indices } = await indicesApi.get()

  const ts = indices
    .map((d) =>
      d.updated_at ? Date.parse(d.updated_at.endsWith('Z') ? d.updated_at : d.updated_at + 'Z') : 0,
    )
    .filter((n) => n > 0)
  const updatedAt = ts.length ? new Date(Math.max(...ts)).toISOString() : null

  const results = await Promise.allSettled(
    indices.map((idx) =>
      apiClient
        .get<IntradayPoint[]>(`/api/indices/${encodeURIComponent(idx.symbol)}/intraday`)
        .then(({ data: intraday }) => ({ symbol: idx.symbol, intraday })),
    ),
  )
  const intradays: Record<string, IntradayPoint[]> = {}
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.intraday && r.value.intraday.length > 1) {
      intradays[r.value.symbol] = r.value.intraday
    }
  }

  return { indices, intradays, updatedAt }
}

export function useIndices() {
  return useQuery({
    queryKey: ['indices'],
    queryFn: fetchIndices,
    refetchInterval: POLL_MS,
  })
}
