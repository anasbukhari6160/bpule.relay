/**
 * Profile Intelligence batch flow, end to end through the real routes:
 * upload API → storage → process API (polled) → profiles + per-file results.
 * Supabase is an in-memory fake that enforces the status check constraints;
 * the AI is a deterministic fake that can rate-limit or fail on demand.
 * All documents are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from './fake-supabase'
import { buildDocx, buildPdf, buildXlsx, CV_LINES } from './fixtures'

const state = vi.hoisted(() => ({
  fake: null as ReturnType<typeof import('./fake-supabase').createFakeSupabase> | null,
  aiMode: 'ok' as 'ok' | 'down' | 'classify-fails' | 'no-people',
  rateLimitNext: 0,
  calls: [] as string[],
}))

vi.mock('@/lib/auth/organization', () => ({
  getAuthContext: async () => ({ orgId: 'org-1', repId: 'rep-1', isOwner: true, isAdmin: true, isManager: false, permissions: [] }),
}))
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabase: () => state.fake!.client }))
vi.mock('@/lib/ai/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/runtime')>()
  const KNOWN = ['Jordan Avery', 'Sam Lee', 'Priya Raman', 'Mateo Cruz']
  const namesIn = (text: string) => KNOWN.filter((n) => text.includes(n))
  const once = async (opts: { callSite?: string; user: string }) => {
    const site = (opts.callSite ?? '').split(':')[1] ?? ''
    state.calls.push(site)
    if (state.rateLimitNext > 0) { state.rateLimitNext--; throw new Error('All providers failed: groq/m: 429 Too Many Requests') }
    if (state.aiMode === 'down') throw new Error('All providers failed: groq/m: timeout; openai/m: timeout')
    const text = opts.user
    switch (site) {
      case 'classifyDocument':
        if (state.aiMode === 'classify-fails') throw new Error('All providers failed: groq/m: Unable to normalize JSON')
        return { documentType: 'cv', sourceQuality: 'good', detectedPeople: state.aiMode === 'no-people' ? [] : namesIn(text).map((name) => ({ name, sectionStart: text.indexOf(name) - text.indexOf('\n\n') - 2, sectionEnd: 0 })) }
      case 'extractFacts': {
        const name = namesIn(text)[0] ?? null
        return { fullName: name, currentRole: /Engineer/.test(text) ? 'Senior Full-Stack Engineer' : 'Data Engineer', primarySkills: 'React, Node.js', technologies: ['PostgreSQL'], professionalSummary: 'Builds products.' }
      }
      case 'extractProjects': return { projects: [{ name: 'Billing platform', summary: 'Built a billing platform.' }] }
      case 'buildProofs': return { proofs: [{ claim: 'Built a billing platform', whyItMatters: 'Relevant', supportingEvidence: 'CV', confidence: 0.8, safeForOutreach: true }] }
      case 'extractReviews': return { reviews: [] }
      case 'qualityGate': return { passed: true, issues: [] }
      default: return { identitySummary: 'Engineer', capabilities: [], strongestProof: [], industries: [], technologies: [], differentiators: [], safeClaims: [], prohibitedClaims: [] }
    }
  }
  return {
    ...actual,
    generate: vi.fn(async (opts: Parameters<typeof actual.generate>[0]) => {
      const data = await actual.withAiRetry(() => once(opts), opts.retry, { sleep: async () => {} })
      return { data, trace: {} }
    }),
  }
})

const { POST: upload } = await import('@/app/api/profile-intelligence/batch/route')
const { POST: processStep } = await import('@/app/api/profile-intelligence/batch/[id]/process/route')

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

async function uploadFiles(files: Array<{ name: string; type: string; body: Uint8Array | string }>) {
  const form = new FormData()
  for (const f of files) form.append('files', new File([f.body as BlobPart], f.name, { type: f.type }))
  const res = await upload(new Request('http://test/api/profile-intelligence/batch', { method: 'POST', body: form }))
  expect(res.status).toBe(200)
  return (await res.json()) as { batch: { id: string }; processed: number; failed: number }
}

/** Poll like the frontend until done:true; asserts it terminates. */
async function processAll(batchId: string) {
  const bodies: Array<{ done: boolean; status: string }> = []
  for (let i = 0; i < 30; i++) {
    const res = await processStep(new Request('http://test', { method: 'POST' }), { params: Promise.resolve({ id: batchId }) })
    const body = await res.json()
    bodies.push(body)
    if (body.done) return { final: body, bodies }
  }
  throw new Error('batch never finished')
}

const sources = () => state.fake!.table('profile_sources')
const profiles = () => state.fake!.table('profiles')

beforeEach(() => {
  state.fake = createFakeSupabase()
  state.aiMode = 'ok'
  state.rateLimitNext = 0
  state.calls = []
})

describe('Profile Intelligence batch flow', () => {
  it.each([
    ['TXT', 'cv.txt', MIME.txt, () => CV_LINES.join('\n')],
    ['PDF', 'cv.pdf', MIME.pdf, () => buildPdf([CV_LINES])],
    ['DOCX', 'cv.docx', MIME.docx, () => buildDocx(CV_LINES)],
  ])('%s CV → one profile with name, role and skills', async (_label, name, type, body) => {
    const { batch } = await uploadFiles([{ name, type, body: body() }])
    const { final, bodies } = await processAll(batch.id)
    // done:true only on the call after every file is finished.
    expect(bodies.slice(0, -1).every((b) => b.done === false)).toBe(true)
    expect(final).toMatchObject({ done: true, status: 'review_required' })
    expect(final.batch).toMatchObject({ status: 'review_required', created_profiles: 1, processed_files: 1 })
    expect(profiles()).toHaveLength(1)
    expect(profiles()[0]).toMatchObject({ full_name: 'Jordan Avery', current_role: 'Senior Full-Stack Engineer', readiness: 'ready' })
    expect(profiles()[0].primary_skills).toEqual(expect.arrayContaining(['React']))
    expect(sources()[0]).toMatchObject({ extraction_status: 'extracted', parsing_status: 'parsed', error_message: null, profile_id: profiles()[0].id })
  }, 60_000)

  it.each([
    ['CSV', 'team.csv', MIME.csv, 'csv' as const],
    ['XLSX', 'team.xlsx', MIME.xlsx, 'xlsx' as const],
  ])('%s → one profile per person row', async (_label, name, type, kind) => {
    const rows = [
      { Name: 'Priya Raman', Role: 'Data Engineer', Skills: 'Python, Airflow' },
      { Name: 'Mateo Cruz', Role: 'Data Engineer', Skills: 'dbt, Snowflake' },
    ]
    const { batch } = await uploadFiles([{ name, type, body: buildXlsx(rows, kind) }])
    const { final } = await processAll(batch.id)
    expect(final.status).toBe('review_required')
    expect(profiles().map((p) => p.full_name).sort()).toEqual(['Mateo Cruz', 'Priya Raman'])
    expect(final.batch.created_profiles).toBe(2)
    // Rows skip document classification: the name is already known.
    expect(state.calls).not.toContain('classifyDocument')
  }, 60_000)

  it('corrupted and scanned PDFs fail with a clear reason shown next to the file name', async () => {
    const { batch } = await uploadFiles([
      { name: 'broken.pdf', type: MIME.pdf, body: '%PDF-1.4\n1 0 obj\n<< /Type' },
      { name: 'scan.pdf', type: MIME.pdf, body: buildPdf([[], []]) },
    ])
    const { final } = await processAll(batch.id)
    expect(final.status).toBe('failed')
    const byName = Object.fromEntries((final.errors as Array<{ filename: string; error: string }>).map((e) => [e.filename, e.error]))
    expect(byName['broken.pdf']).toMatch(/could not be read.*corrupted/i)
    expect(byName['scan.pdf']).toMatch(/needs OCR/)
    expect(sources().find((s) => s.original_filename === 'scan.pdf')).toMatchObject({ parsing_status: 'ocr_required', extraction_status: 'failed' })
    expect(profiles()).toHaveLength(0)
  }, 60_000)

  it('a mixed batch is partial_failure and still creates the good profile', async () => {
    const { batch } = await uploadFiles([
      { name: 'cv.txt', type: MIME.txt, body: CV_LINES.join('\n') },
      { name: 'empty.txt', type: MIME.txt, body: '   ' },
    ])
    const { final } = await processAll(batch.id)
    expect(final.status).toBe('partial_failure')
    expect(profiles()).toHaveLength(1)
    expect(final.errors).toEqual([expect.objectContaining({ filename: 'empty.txt', error: expect.stringMatching(/almost no text/) })])
  }, 60_000)

  it('rejected uploads keep their reason (never overwritten by a download error)', async () => {
    const { batch, failed } = await uploadFiles([
      { name: 'photo.png', type: 'image/png', body: 'png' },
      { name: 'zero.pdf', type: MIME.pdf, body: '' },
    ])
    expect(failed).toBe(2)
    const { final } = await processAll(batch.id)
    const reasons = (final.errors as Array<{ error: string }>).map((e) => e.error).join(' | ')
    expect(reasons).toMatch(/Unsupported file type \(image\/png\)/)
    expect(reasons).toMatch(/empty/)
    expect(reasons).not.toMatch(/download/i)
  }, 60_000)

  it('rate-limited AI retries with backoff and still creates the profile', async () => {
    state.rateLimitNext = 2
    const { batch } = await uploadFiles([{ name: 'cv.txt', type: MIME.txt, body: CV_LINES.join('\n') }])
    const { final } = await processAll(batch.id)
    expect(final.status).toBe('review_required')
    expect(profiles()).toHaveLength(1)
  }, 60_000)

  it('classification failing or finding nobody falls back to a single-person CV', async () => {
    for (const mode of ['classify-fails', 'no-people'] as const) {
      state.fake = createFakeSupabase()
      state.aiMode = mode
      const { batch } = await uploadFiles([{ name: 'cv.txt', type: MIME.txt, body: CV_LINES.join('\n') }])
      const { final } = await processAll(batch.id)
      expect(final.status).toBe('review_required')
      expect(profiles()[0]).toMatchObject({ full_name: 'Jordan Avery' })
    }
  }, 60_000)

  it('AI fully down → the file fails with the step-level reason, not silently', async () => {
    state.aiMode = 'down'
    const { batch } = await uploadFiles([{ name: 'cv.txt', type: MIME.txt, body: CV_LINES.join('\n') }])
    const { final } = await processAll(batch.id)
    expect(final.status).toBe('failed')
    expect(final.errors[0].error).toMatch(/No person could be identified|Could not extract/)
    expect(final.errors[0].error).toMatch(/timeout/)
  }, 60_000)

  it('a multi-person team document creates one profile per person', async () => {
    const text = `Team overview\n\nJordan Avery\nSenior Full-Stack Engineer. Builds React apps for SaaS clients across Europe and the US.\n\nSam Lee\nData Engineer. Runs data pipelines on AWS for retail clients and marketplaces.`
    const { batch } = await uploadFiles([{ name: 'team.txt', type: MIME.txt, body: text }])
    const { final } = await processAll(batch.id)
    expect(final.status).toBe('review_required')
    expect(profiles().map((p) => p.full_name).sort()).toEqual(['Jordan Avery', 'Sam Lee'])
  }, 60_000)

  it('concurrent polls never process the same file twice', async () => {
    const { batch } = await uploadFiles([{ name: 'cv.txt', type: MIME.txt, body: CV_LINES.join('\n') }])
    const call = () => processStep(new Request('http://test', { method: 'POST' }), { params: Promise.resolve({ id: batch.id }) })
    await Promise.all([call(), call(), call()])
    await processAll(batch.id)
    expect(profiles()).toHaveLength(1)
    expect(state.calls.filter((c) => c === 'extractFacts')).toHaveLength(1)
  }, 60_000)

  it('a source stuck in extracting is retried once, then failed with a reason', async () => {
    const { batch } = await uploadFiles([{ name: 'cv.txt', type: MIME.txt, body: CV_LINES.join('\n') }])
    const stale = new Date(Date.now() - 10 * 60_000).toISOString()
    Object.assign(sources()[0], { extraction_status: 'extracting', updated_at: stale })
    const { final } = await processAll(batch.id)
    expect(final.status).toBe('review_required')

    Object.assign(sources()[0], { extraction_status: 'extracting', updated_at: stale, error_message: 'Reset: previous extraction timed out' })
    const again = await processAll(batch.id)
    expect(again.final.errors[0].error).toMatch(/timed out twice/)
  }, 60_000)

  it('a missing storage bucket is created and the upload succeeds', async () => {
    state.fake!.buckets.clear()
    const { batch, processed } = await uploadFiles([{ name: 'cv.txt', type: MIME.txt, body: CV_LINES.join('\n') }])
    expect(processed).toBe(1)
    expect(state.fake!.buckets.has('profile-sources')).toBe(true)
    const { final } = await processAll(batch.id)
    expect(final.status).toBe('review_required')
  }, 60_000)
})
