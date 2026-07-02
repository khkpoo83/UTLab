import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('../client', () => ({
  watchlistApi: { list: vi.fn(), remove: vi.fn() },
}))

import { watchlistApi } from '../client'
import { useWatchlist, useDeleteWatchlist } from './useWatchlist'

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, Wrapper }
}

describe('useWatchlist', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the watchlist from the API', async () => {
    ;(watchlistApi.list as any).mockResolvedValue([{ id: 1, ticker: '005930', name: '삼성전자' }])
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useWatchlist(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0].ticker).toBe('005930')
  })

  it('delete mutation removes then invalidates the watchlist query', async () => {
    ;(watchlistApi.remove as any).mockResolvedValue({})
    const { client, Wrapper } = makeWrapper()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteWatchlist(), { wrapper: Wrapper })
    await result.current.mutateAsync(7)
    expect(watchlistApi.remove).toHaveBeenCalledWith(7)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['watchlist'] })
  })
})
