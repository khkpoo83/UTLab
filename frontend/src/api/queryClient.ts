import { QueryClient } from '@tanstack/react-query'

// Shared TanStack Query client.
//
// Defaults are intentionally conservative so migrating a component from the
// legacy `useEffect + axios` pattern does NOT change its runtime behavior:
//  - retry: false           — the axios layer (api/client.ts) already retries GETs
//  - refetchOnWindowFocus    — off; legacy code polled on an interval, not on focus
//  - staleTime 30s           — dedupe bursts of identical reads across components
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})
