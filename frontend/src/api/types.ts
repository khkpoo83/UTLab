// Ergonomic aliases over the auto-generated OpenAPI types (`schema.d.ts`).
//
// Regenerate the schema after backend API changes:  npm run gen:api
// Prefer these generated types over hand-written interfaces when adopting
// TanStack Query hooks (see api/hooks/) — they stay in sync with the backend.
import type { components, paths } from './schema'

/** All named response/request models from the backend OpenAPI schema. */
export type Schemas = components['schemas']

/** Success (200) JSON body type for a GET path, e.g. `GetJson<'/api/portfolio'>`. */
export type GetJson<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer R } } } }
}
  ? R
  : never

// Commonly consumed models, re-exported for convenience.
export type PortfolioResponse = Schemas['PortfolioResponse']
export type WatchlistResponse = Schemas['WatchlistResponse']
export type CalendarEventResponse = Schemas['CalendarEventResponse']
export type ProfileResponse = Schemas['ProfileResponse']
