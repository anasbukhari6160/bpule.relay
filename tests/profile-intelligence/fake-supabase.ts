/**
 * In-memory stand-in for the Supabase client calls the profile-intelligence
 * routes make (PostgREST filters, single/maybeSingle, insert/update/upsert
 * with select, storage upload/download/createBucket). Enforces the
 * profile_sources / batch status check constraints so a bad status fails
 * the test the way it would fail in Postgres.
 */
type Row = Record<string, unknown>

const CHECKS: Record<string, Record<string, string[]>> = {
  profile_sources: {
    parsing_status: ['pending', 'parsing', 'parsed', 'ocr_required', 'failed', 'unsupported'],
    extraction_status: ['pending', 'extracting', 'extracted', 'partial_failure', 'failed'],
  },
  profile_import_batches: {
    status: ['uploaded', 'parsing', 'identifying_people', 'extracting', 'matching', 'synthesizing', 'review_required', 'ready', 'partial_failure', 'failed'],
  },
}
const DEFAULTS: Record<string, Row> = {
  profile_sources: { parsing_status: 'pending', extraction_status: 'pending', detected_people: [], error_message: null, profile_id: null },
  profile_import_batches: { status: 'uploaded', processed_files: 0, failed_files: 0, created_profiles: 0, merged_profiles: 0, detected_people: 0, metadata: {} },
  profiles: { archived_at: null },
}

let seq = 0
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

export function createFakeSupabase() {
  const tables: Record<string, Row[]> = {}
  const files = new Map<string, Uint8Array>()
  const buckets = new Set<string>(['profile-sources'])
  const table = (name: string) => (tables[name] ??= [])

  function check(name: string, row: Row): string | null {
    for (const [col, allowed] of Object.entries(CHECKS[name] ?? {})) {
      if (row[col] !== undefined && !allowed.includes(String(row[col]))) return `new row for relation "${name}" violates check constraint "${name}_${col}_check"`
    }
    return null
  }

  class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
    private filters: Array<(r: Row) => boolean> = []
    private op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    private payload: Row | Row[] | null = null
    private returning = false
    private mode: 'many' | 'single' | 'maybe' = 'many'
    private limitN: number | null = null
    private orderBy: { col: string; asc: boolean } | null = null
    constructor(private name: string) {}
    select() { if (this.op !== 'select') this.returning = true; return this }
    insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this }
    update(p: Row) { this.op = 'update'; this.payload = p; return this }
    upsert(p: Row | Row[]) { this.op = 'upsert'; this.payload = p; return this }
    eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this }
    is(col: string, v: unknown) { this.filters.push((r) => (r[col] ?? null) === v); return this }
    lt(col: string, v: string) { this.filters.push((r) => String(r[col] ?? '') < v); return this }
    in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[col])); return this }
    order(col: string, o: { ascending?: boolean } = {}) { this.orderBy = { col, asc: o.ascending !== false }; return this }
    limit(n: number) { this.limitN = n; return this }
    single() { this.mode = 'single'; return this }
    maybeSingle() { this.mode = 'maybe'; return this }

    private run(): { data: unknown; error: { message: string } | null } {
      const rows = table(this.name)
      let result: Row[]
      if (this.op === 'insert' || this.op === 'upsert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!]
        result = []
        for (const p of list) {
          const row = { ...(DEFAULTS[this.name] ?? {}), id: id(), uploaded_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...p }
          const bad = check(this.name, row)
          if (bad) return { data: null, error: { message: bad } }
          rows.push(row)
          result.push(row)
        }
        if (!this.returning) return { data: null, error: null }
      } else if (this.op === 'update') {
        const bad = check(this.name, this.payload as Row)
        if (bad) return { data: null, error: { message: bad } }
        result = rows.filter((r) => this.filters.every((f) => f(r)))
        for (const r of result) Object.assign(r, this.payload)
        if (!this.returning) return { data: null, error: null }
      } else {
        result = rows.filter((r) => this.filters.every((f) => f(r)))
        if (this.orderBy) {
          const { col, asc } = this.orderBy
          result = [...result].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
        }
        if (this.limitN != null) result = result.slice(0, this.limitN)
      }
      const copy = result.map((r) => ({ ...r }))
      if (this.mode === 'single') return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
      if (this.mode === 'maybe') return { data: copy[0] ?? null, error: null }
      return { data: copy, error: null }
    }

    then<A, B>(ok?: ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return Promise.resolve().then(() => this.run()).then(ok, bad)
    }
  }

  const client = {
    from: (name: string) => new Query(name),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array) => {
          if (!buckets.has(bucket)) return { data: null, error: { message: 'Bucket not found' } }
          files.set(`${bucket}/${path}`, body)
          return { data: { path }, error: null }
        },
        download: async (path: string) => {
          const body = files.get(`${bucket}/${path}`)
          if (!buckets.has(bucket)) return { data: null, error: { message: 'Bucket not found' } }
          return body ? { data: new Blob([body as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
      }),
      createBucket: async (bucket: string) => { buckets.add(bucket); return { data: { name: bucket }, error: null } },
    },
  }

  return { client, tables, files, buckets, table }
}
