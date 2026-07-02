import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { watchlistApi, WatchlistItem } from '../client'

// TanStack Query hooks for the watchlist resource (roadmap Phase 3, P3-2).
// Establishes the query + mutation + cache-invalidation pattern that the
// remaining pages follow.

export const watchlistKey = ['watchlist'] as const

export function useWatchlist() {
  return useQuery<WatchlistItem[]>({
    queryKey: watchlistKey,
    queryFn: () => watchlistApi.list(),
  })
}

/** Delete a watchlist entry, then refresh the list from the server. */
export function useDeleteWatchlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => watchlistApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKey }),
  })
}
