import axios from 'axios'

// Type-safe extraction from caught errors (roadmap Phase 3, P3-4).
// Replaces the `catch (e: any)` + `e?.response?.data?.detail` idiom so call
// sites can catch `unknown` and stay strictly typed.

/** Backend error `detail` string if present, else the given fallback. */
export function errorDetail(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const detail = (e.response?.data as { detail?: unknown } | undefined)?.detail
    if (typeof detail === 'string') return detail
  }
  return fallback
}

/** HTTP status code from an axios error, or undefined for non-HTTP errors. */
export function errorStatus(e: unknown): number | undefined {
  return axios.isAxiosError(e) ? e.response?.status : undefined
}
