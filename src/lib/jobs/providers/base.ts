/**
 * Find Jobs — shared provider runtime.
 *
 * Wraps a provider definition (URL builder + pure response parser) with the
 * request lifecycle: HTTP with timeout, error classification, mock mode and
 * local failure injection. A single provider can never crash the search.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Job, JobSearchParams, JobSource, ProviderFailureKind } from '../types'
import { ProviderFailure } from '../types'
import { failureInjection, providerTimeoutMs, mockProvidersEnabled, providerMaxPages, maxJobsPerProvider } from '../config'
import { providerName } from '../attribution'
import type { JobProvider, ProviderCallOptions, ProviderSearchResult } from '../provider-types'

export interface ProviderDefinition {
  source: JobSource
  requiresCredentials: boolean
  isConfigured(): boolean
  buildUrl(params: JobSearchParams, page: number): string
  buildHeaders?(): Record<string, string>
  parseResponse(raw: unknown, params: JobSearchParams): Job[]
  /** False when the provider ignores its `page` param (feed-only boards). */
  paginates?: boolean
  /** Overrides the global page-per-query cap for this provider. */
  maxPages?: number
}

export function defineProvider(def: ProviderDefinition): JobProvider {
  return {
    meta: {
      id: def.source,
      name: providerName(def.source),
      requiresCredentials: def.requiresCredentials,
      // Evaluated on every read so credentials added or removed after import
      // (tests, hot reload, rotated env) are seen immediately.
      get configured() { return def.isConfigured() },
    },
    parseResponse: (raw: unknown, params: JobSearchParams) => def.parseResponse(raw, params),
    buildUrl: (params: JobSearchParams, page?: number) => def.buildUrl(params, page ?? 1),
    async search(params: JobSearchParams, opts?: ProviderCallOptions): Promise<ProviderSearchResult> {
      const startedAt = performance.now()
      const duration = () => Math.round(performance.now() - startedAt)

      // Local failure injection (dev + mock only) lets us verify isolation.
      const injected = failureInjection()[def.source]
      if (injected) {
        throw new ProviderFailure(injected as ProviderFailureKind, `${def.source}: injected ${injected}`)
      }

      if (opts?.mock ?? mockProvidersEnabled()) {
        const raw = await loadMock(def.source)
        const jobs = parseSafe(def, raw, params)
        return { jobs, rawCount: jobs.length, mock: true, durationMs: duration(), pagesFetched: 1 }
      }

      const maxPages = def.paginates === false ? 1 : (def.maxPages ?? providerMaxPages())
      const jobCap = maxJobsPerProvider()
      const fetchFn = opts?.fetchFn ?? fetch
      const timeoutMs = opts?.timeoutMs ?? providerTimeoutMs()

      const collected: Job[] = []
      let pages = 0
      let firstId: string | undefined

      for (let page = 1; page <= maxPages && collected.length < jobCap; page++) {
        const url = def.buildUrl(params, page)
        const response = await fetchWithTimeout(url, def.buildHeaders?.(), fetchFn, timeoutMs)
        let json: unknown
        try {
          json = await response.json()
        } catch {
          throw new ProviderFailure('invalid_response', `${def.source}: non-JSON response`)
        }
        const pageJobs = parseSafe(def, json, params)
        pages++
        if (pageJobs.length === 0) break
        const pageFirst = pageJobs[0]?.id
        if (page > 1 && firstId && pageFirst === firstId) break
        firstId = firstId ?? pageFirst
        collected.push(...pageJobs)
      }

      const jobs = collected.slice(0, jobCap)
      return { jobs, rawCount: jobs.length, mock: false, durationMs: duration(), pagesFetched: pages }
    },
  }
}

function parseSafe(def: ProviderDefinition, raw: unknown, params: JobSearchParams): Job[] {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    throw new ProviderFailure('invalid_response', `${def.source}: response is not an object`)
  }
  try {
    return def.parseResponse(raw, params)
  } catch (err) {
    if (err instanceof ProviderFailure) throw err
    throw new ProviderFailure(
      'invalid_response',
      `${def.source}: parse failed — ${err instanceof Error ? err.message : 'unknown'}`,
    )
  }
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> | undefined,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(headers ?? {}) },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new ProviderFailure(classifyStatus(response.status), `HTTP ${response.status}`)
    }
    return response
  } catch (err) {
    if (err instanceof ProviderFailure) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ProviderFailure('timeout', `request timed out after ${timeoutMs}ms`)
    }
    throw new ProviderFailure('unavailable', err instanceof Error ? err.message : 'network failure')
  } finally {
    clearTimeout(timer)
  }
}

function classifyStatus(status: number): ProviderFailureKind {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'unavailable'
  return 'failed'
}

export function encodeQueryPairs(params: Record<string, string | number | boolean | undefined>): string {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return pairs.join('&')
}

const pageCache = new Map<JobSource, Promise<unknown>>()

async function loadMock(source: JobSource): Promise<unknown> {
  const cached = pageCache.get(source)
  if (cached) return cached
  const promise = (async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const file = path.join(currentDir, '..', 'mocks', `${source}.json`)
    const contents = await readFile(file, 'utf8')
    return JSON.parse(contents) as unknown
  })()
  pageCache.set(source, promise)
  return promise
}