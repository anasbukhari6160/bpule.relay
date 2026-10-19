/** Profile Intelligence: parsing every format, clear errors, AI retry, poller termination. */
import { describe, expect, it } from 'vitest'
import { DocumentParseError, parseDocument, resolveMimeType } from '@/lib/profile-intelligence/parse-document'
import { aiRetryDelay, isRetryableAiError, withAiRetry } from '@/lib/ai/runtime'
import { finalizeBatchStatus, stuckSourceUpdate } from '@/lib/profile-intelligence/batch-status'
import { pollBatch, toImportBatch } from '@/lib/profile-intelligence/batch-poller'
import { guessNameFromHeader, segmentByPeople, validPeople } from '@/lib/profile-intelligence/pipeline'
import { buildPdf, CV_LINES, toArrayBuffer } from './fixtures'

const PDF = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function parseError(buf: ArrayBuffer, mime: string, name: string): Promise<DocumentParseError> {
  try {
    await parseDocument(buf, mime, name)
  } catch (err) {
    expect(err).toBeInstanceOf(DocumentParseError)
    return err as DocumentParseError
  }
  throw new Error('expected a parse error')
}

describe('parseDocument', () => {
  it('reads a text PDF', async () => {
    const parsed = await parseDocument(toArrayBuffer(buildPdf([CV_LINES])), PDF, 'cv.pdf')
    expect(parsed.content).toContain('Jordan Avery')
    expect(parsed.content).toContain('React')
    expect(parsed.pageCount).toBe(1)
  }, 30_000)

  it('a scanned / image-only PDF is OCR-required with a clear message', async () => {
    const err = await parseError(toArrayBuffer(buildPdf([[], []])), PDF, 'scan.pdf')
    expect(err.ocrRequired).toBe(true)
    expect(err.userMessage).toMatch(/no readable text.*OCR/i)
  }, 30_000)

  it('a PDF over 50 pages is truncated but still extracts', async () => {
    const pages = Array.from({ length: 55 }, (_, i) => [`Page ${i + 1} of the team handbook. Jordan Avery works on React projects.`])
    const parsed = await parseDocument(toArrayBuffer(buildPdf(pages)), PDF, 'big.pdf')
    expect(parsed.pageCount).toBe(50)
    expect(parsed.content).toContain('Page 50 of')
    expect(parsed.content).not.toContain('Page 51 of')
    expect(parsed.warnings.join(' ')).toMatch(/first 50 of 55 pages/)
  }, 60_000)

  it.each([
    ['random bytes named .pdf', new TextEncoder().encode('this is not a pdf at all'), /not a valid PDF/],
    ['truncated PDF', new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog'), /could not be read.*corrupted/i],
  ])('corrupted PDF (%s) → clear error', async (_label, bytes, message) => {
    const err = await parseError(toArrayBuffer(bytes), PDF, 'broken.pdf')
    expect(err.userMessage).toMatch(message)
    expect(err.ocrRequired).toBe(false)
  }, 30_000)

  it('corrupted DOCX and legacy .doc → clear errors', async () => {
    expect((await parseError(toArrayBuffer(new TextEncoder().encode('not a zip')), DOCX, 'cv.docx')).userMessage).toMatch(/not a valid DOCX/)
    const zipButNotDocx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8])
    expect((await parseError(toArrayBuffer(zipButNotDocx), DOCX, 'cv.docx')).userMessage).toMatch(/could not be read/)
    const legacyDoc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect((await parseError(toArrayBuffer(legacyDoc), 'application/msword', 'cv.doc')).userMessage).toMatch(/\.doc files are not supported/)
  })

  it('TXT: reads text; empty, whitespace-only and binary files get clear errors', async () => {
    const ok = await parseDocument(toArrayBuffer(new TextEncoder().encode(CV_LINES.join('\n'))), 'text/plain', 'cv.txt')
    expect(ok.content.split('\n')[0]).toBe('Jordan Avery')
    expect((await parseError(new ArrayBuffer(0), 'text/plain', 'empty.txt')).userMessage).toMatch(/empty/)
    expect((await parseError(toArrayBuffer(new TextEncoder().encode('   \n \n ')), 'text/plain', 'blank.txt')).userMessage).toMatch(/almost no text/)
    expect((await parseError(toArrayBuffer(new Uint8Array(200).fill(0)), 'text/plain', 'bin.txt')).userMessage).toMatch(/not plain text/)
  })

  it('MIME type falls back to the extension for generic browser types', () => {
    expect(resolveMimeType('', 'cv.pdf')).toBe('application/pdf')
    expect(resolveMimeType('application/octet-stream', 'team.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(resolveMimeType('application/vnd.ms-excel', 'team.csv')).toBe('text/csv')
    expect(resolveMimeType('', 'notes.md')).toBe('text/markdown')
    expect(resolveMimeType('image/png', 'photo.png')).toBe('image/png')
    expect(resolveMimeType('', 'mystery')).toBe('unknown')
  })
})

describe('AI retry with exponential backoff', () => {
  it('retries rate limits with growing waits, then succeeds', async () => {
    const waits: number[] = []
    let calls = 0
    const result = await withAiRetry(async () => {
      calls++
      if (calls < 3) throw new Error('All providers failed: groq/x: 429 Too Many Requests')
      return 'ok'
    }, { attempts: 3, baseDelayMs: 1000 }, { sleep: async (ms) => { waits.push(ms) }, random: () => 0 })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
    expect(waits).toEqual([1000, 2000])
  })

  it('does not retry permanent errors, and never waits past the deadline', async () => {
    let calls = 0
    await expect(withAiRetry(async () => { calls++; throw new Error('AI budget exceeded — expensive tier blocked') }, { attempts: 3 }, { sleep: async () => {} })).rejects.toThrow(/budget/)
    expect(calls).toBe(1)
    calls = 0
    await expect(withAiRetry(async () => { calls++; throw new Error('timeout') }, { attempts: 5, baseDelayMs: 10_000, deadline: 1_005_000 }, { sleep: async () => {}, now: () => 1_000_000, random: () => 0 })).rejects.toThrow(/timeout/)
    expect(calls).toBe(1)
  })

  it('classifies errors', () => {
    expect(isRetryableAiError(new Error('All providers failed: openai/m: skipped_unhealthy'))).toBe(true)
    expect(isRetryableAiError(new Error('request timed out after 60000ms'))).toBe(true)
    expect(isRetryableAiError(new Error('All providers failed: '))).toBe(false)
    expect(isRetryableAiError(new Error('401 Unauthorized'))).toBe(false)
    expect(aiRetryDelay(4, { attempts: 5, baseDelayMs: 2000, maxDelayMs: 10_000 }, () => 0)).toBe(10_000)
  })
})

describe('batch status rules', () => {
  it('a stuck source is retried once, then failed with a reason', () => {
    const first = stuckSourceUpdate(null)
    expect(first.extraction_status).toBe('pending')
    const second = stuckSourceUpdate(first.error_message as string)
    expect(second.extraction_status).toBe('failed')
    expect(second.error_message).toMatch(/timed out twice/)
  })

  it('final status reflects what was actually produced', () => {
    expect(finalizeBatchStatus([{ extraction_status: 'extracted' }]).status).toBe('review_required')
    expect(finalizeBatchStatus([{ extraction_status: 'extracted' }, { extraction_status: 'failed' }]).status).toBe('partial_failure')
    expect(finalizeBatchStatus([{ extraction_status: 'failed' }]).status).toBe('failed')
    expect(finalizeBatchStatus([{ extraction_status: 'partial_failure', profile_id: 'p1' }]).status).toBe('partial_failure')
    expect(finalizeBatchStatus([{ extraction_status: 'partial_failure', profile_id: null }]).status).toBe('failed')
  })
})

describe('frontend poller', () => {
  const clock = () => {
    let t = 0
    return { now: () => t, sleep: async (ms: number) => { t += ms } }
  }

  it('stops only on done:true, one request at a time', async () => {
    const c = clock()
    let inFlight = 0
    let maxInFlight = 0
    const responses = [{ done: false, batch: { processed_files: 0 } }, { done: false, batch: { processed_files: 1 } }, { done: true, status: 'review_required', sources: [] }]
    let i = 0
    const end = await pollBatch({
      ...c,
      step: async () => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
        const body = responses[i++]
        inFlight--
        return { ok: true, status: 200, body }
      },
    })
    expect(end.kind).toBe('done')
    expect(i).toBe(3)
    expect(maxInFlight).toBe(1)
  })

  it('a batch status of "failed" without done does not stop polling early', async () => {
    const c = clock()
    let i = 0
    const end = await pollBatch({ ...c, step: async () => ({ ok: true, status: 200, body: i++ < 2 ? { done: false, status: 'failed', batch: { processed_files: i } } : { done: true, status: 'failed' } }) })
    expect(end.kind).toBe('done')
    expect(i).toBe(3)
  })

  it('always ends: repeated errors, missing batch, or no progress', async () => {
    let calls = 0
    expect((await pollBatch({ ...clock(), step: async () => { calls++; return { ok: false, status: 503, body: null } } })).kind).toBe('error')
    expect(calls).toBe(6)
    expect((await pollBatch({ ...clock(), step: async () => ({ ok: false, status: 404, body: { error: 'Batch not found.' } }) }))).toEqual({ kind: 'error', message: 'Batch not found.' })
    const stalled = await pollBatch({ ...clock(), step: async () => ({ ok: true, status: 200, body: { done: false, batch: { processed_files: 1 } } }) })
    expect(stalled.kind).toBe('stalled')
    calls = 0
    const thrown = await pollBatch({ ...clock(), step: async () => { calls++; throw new Error('Failed to fetch') } })
    expect(thrown.kind).toBe('error')
    expect(calls).toBe(6)
  })

  it('maps the API batch row to the UI shape', () => {
    expect(toImportBatch({ id: 'b1', total_files: 3, processed_files: 2, created_profiles: 1, status: 'extracting' })).toMatchObject({ id: 'b1', totalFiles: 3, processedFiles: 2, createdProfiles: 1, status: 'extracting' })
    expect(toImportBatch(null)).toBeNull()
  })
})

describe('pipeline helpers', () => {
  it('drops nameless, duplicate and junk people', () => {
    const people = validPeople([{ name: 'Jordan Avery' }, { name: 'jordan avery' }, { name: '' }, null, { name: 42 }, { name: 'Sam Lee' }])
    expect(people.map((p) => p.name)).toEqual(['Jordan Avery', 'Sam Lee'])
    expect(validPeople('not an array')).toEqual([])
  })

  it('guesses a name from a CV header, not from a title line', () => {
    expect(guessNameFromHeader(CV_LINES.join('\n'))).toBe('Jordan Avery')
    expect(guessNameFromHeader('Curriculum Vitae\nName: Priya Raman\nData Engineer')).toBe('Priya Raman')
    expect(guessNameFromHeader('Senior Software Engineer\nreact, node')).toBeNull()
  })

  it('segments a team document by name when the model offsets are wrong', () => {
    const text = `Team overview.\n\nJordan Avery\n${'Jordan builds React apps for SaaS clients. '.repeat(4)}\n\nSam Lee\n${'Sam runs data pipelines on AWS for retail clients. '.repeat(4)}`
    const people = [
      { name: 'Jordan Avery', sectionStart: 99999, sectionEnd: 5 },
      { name: 'Sam Lee', sectionStart: Number.NaN, sectionEnd: 0 },
    ] as never
    const seg = segmentByPeople(text, people)
    expect(seg.get('Jordan Avery')).toMatch(/^Jordan Avery[\s\S]*React/)
    expect(seg.get('Jordan Avery')).not.toContain('Sam runs')
    expect(seg.get('Sam Lee')).toMatch(/^Sam Lee[\s\S]*AWS/)
  })
})

describe('spreadsheet grouping', () => {
  it('keeps names as written, groups case-insensitively, and never turns blank-name rows into people', async () => {
    const { parseSpreadsheet } = await import('@/lib/profile-intelligence/parse-spreadsheet')
    const { buildXlsx } = await import('./fixtures')
    const sheet = await parseSpreadsheet(toArrayBuffer(buildXlsx([
      { Name: 'José Núñez', Role: 'Designer', Skills: 'Figma' },
      { Name: 'josé núñez', Role: 'Designer', Skills: 'Prototyping' },
      { Name: '', Role: 'Unknown', Skills: 'Excel' },
    ])), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'team.xlsx')
    expect(sheet.detectedPeople).toEqual(['José Núñez'])
    const keys = [...sheet.personGroups.keys()]
    expect(keys.filter((k) => !k.startsWith('__unassigned'))).toHaveLength(1)
    expect(sheet.personGroups.get(keys[0])).toHaveLength(2)
    expect(keys.some((k) => k.startsWith('__unassigned'))).toBe(true)
  })
})
