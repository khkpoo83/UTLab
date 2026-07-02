import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock the axios transport layer so the hook is tested in isolation.
vi.mock('../client', () => ({
  default: { get: vi.fn() },
  indicesApi: { get: vi.fn() },
}))

import apiClient, { indicesApi } from '../client'
import { useIndices } from './useIndices'

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useIndices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges the index list with per-symbol intraday and computes latest updatedAt', async () => {
    ;(indicesApi.get as any).mockResolvedValue({
      data: [
        {
          symbol: '^KS11',
          name: 'KOSPI',
          price: 1,
          change: 0,
          change_pct: 0,
          updated_at: '2026-07-02T00:00:00',
        },
        {
          symbol: '^KQ11',
          name: 'KOSDAQ',
          price: 2,
          change: 0,
          change_pct: 0,
          updated_at: '2026-07-02T01:00:00',
        },
      ],
    })
    ;(apiClient.get as any).mockImplementation((url: string) => {
      if (url.includes('%5EKS11'))
        return Promise.resolve({
          data: [
            { time: 1, close: 1 },
            { time: 2, close: 2 },
          ],
        })
      // KQ11 returns a too-short series -> excluded from intradays
      return Promise.resolve({ data: [{ time: 1, close: 1 }] })
    })

    const { result } = renderHook(() => useIndices(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const d = result.current.data!
    expect(d.indices).toHaveLength(2)
    expect(Object.keys(d.intradays)).toEqual(['^KS11']) // short series dropped
    // latest updated_at (01:00Z) normalized to ISO
    expect(d.updatedAt).toBe('2026-07-02T01:00:00.000Z')
  })

  it('returns null updatedAt when no index carries a timestamp', async () => {
    ;(indicesApi.get as any).mockResolvedValue({
      data: [
        { symbol: '^GSPC', name: 'S&P', price: 1, change: 0, change_pct: 0, updated_at: null },
      ],
    })
    ;(apiClient.get as any).mockResolvedValue({ data: [] })

    const { result } = renderHook(() => useIndices(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.updatedAt).toBeNull()
    expect(result.current.data!.intradays).toEqual({})
  })
})
