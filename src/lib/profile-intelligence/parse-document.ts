import mammoth from 'mammoth'
import { loadPdfParse } from '@/lib/pdf/load-pdf-parse'

export interface ParsedDocument {
  content: string
  pages: string[]
  pageCount: number
  needsOcr: boolean
  warnings: string[]
}

const MAX_PAGES = 50
const MIN_TEXT_PER_PAGE = 20
/** Below this much text a PDF has nothing to extract from — it needs OCR. */
export const MIN_PDF_TEXT_CHARS = 100
/** Below this much text any document is too thin to build a profile from. */
const MIN_DOCUMENT_TEXT_CHARS = 30

/**
 * A file that cannot become a profile, with a message written for the person
 * who uploaded it. `ocrRequired` marks scanned / image-only PDFs.
 */
export class DocumentParseError extends Error {
  readonly userMessage: string
  readonly ocrRequired: boolean
  constructor(userMessage: string, opts: { ocrRequired?: boolean; detail?: string } = {}) {
    super(opts.detail ? `${userMessage} (${opts.detail})` : userMessage)
    this.name = 'DocumentParseError'
    this.userMessage = userMessage
    this.ocrRequired = opts.ocrRequired ?? false
  }
}

const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
}

/**
 * The MIME type to process a file as. Browsers often send an empty type, or
 * application/octet-stream, for .md/.csv/.docx; the extension decides then.
 */
export function resolveMimeType(browserType: string | null | undefined, filename: string): string {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  const byExt = EXTENSION_MIME[ext]
  const t = (browserType ?? '').toLowerCase().split(';')[0].trim()
  if (!t || t === 'application/octet-stream' || t === 'binary/octet-stream') return byExt ?? (t || 'unknown')
  // A .csv reported as Excel by Windows browsers is still a CSV.
  if (ext === 'csv' && t === 'application/vnd.ms-excel') return 'text/csv'
  return t
}

export async function parseDocument(buffer: ArrayBuffer, mimeType: string, filename: string): Promise<ParsedDocument> {
  if (buffer.byteLength === 0) throw new DocumentParseError('The file is empty.')
  switch (mimeType) {
    case 'application/pdf':
      return parsePdf(buffer)
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return parseDocx(buffer)
    case 'application/msword':
      // Legacy binary .doc is not a zip; mammoth reads .docx only.
      if (!isZip(buffer)) throw new DocumentParseError('Old Word .doc files are not supported. Save the file as .docx or PDF and upload it again.')
      return parseDocx(buffer)
    case 'text/plain':
    case 'text/markdown':
    case 'text/csv':
    case 'text/x-markdown':
      return parseText(buffer)
    default:
      throw new DocumentParseError(`Unsupported file type: ${mimeType || 'unknown'} (${filename}). Upload PDF, DOCX, TXT, CSV or XLSX.`)
  }
}

function isZip(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

function isPdf(buffer: ArrayBuffer): boolean {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength)))
  return head.includes('%PDF-')
}

async function parsePdf(buffer: ArrayBuffer): Promise<ParsedDocument> {
  if (!isPdf(buffer)) {
    throw new DocumentParseError('This file is not a valid PDF. It may be corrupted or renamed from another format.')
  }
  const warnings: string[] = []
  let result: { text: string; numpages: number; pages: string[] }
  try {
    const uint8 = new Uint8Array(buffer)
    const { PDFParse, CanvasFactory } = await loadPdfParse()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = new PDFParse({ data: uint8 as any, withCredentials: false, verbosity: 0, CanvasFactory })
    // Only the first MAX_PAGES pages are read: a 300-page export still extracts.
    const textResult = await parser.getText({ first: MAX_PAGES }).finally(() => parser.destroy().catch(() => {}))
    const pages = Array.isArray(textResult.pages) && textResult.pages.length > 0
      ? textResult.pages.slice(0, MAX_PAGES).map((p) => p.text ?? '')
      : splitPdfPages(textResult.text, Math.min(textResult.total, MAX_PAGES))
    result = { text: pages.join('\n\n'), numpages: textResult.total, pages }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown error'
    if (/password/i.test(detail)) {
      throw new DocumentParseError('This PDF is password-protected. Remove the password and upload it again.', { detail })
    }
    throw new DocumentParseError('This PDF could not be read. The file may be corrupted.', { detail })
  }

  const content = normalizeText(result.text)
  if (content.replace(/\s+/g, '').length < MIN_PDF_TEXT_CHARS) {
    throw new DocumentParseError(
      'This PDF has no readable text. It looks scanned or image-only and needs OCR. Upload a text-based PDF, a DOCX, or paste the text into a .txt file.',
      { ocrRequired: true },
    )
  }

  const needsOcr = detectOcrNeeded(result.pages)
  if (needsOcr) warnings.push('Most pages have no readable text (scanned?). Extraction used the pages that do.')
  if (result.numpages > MAX_PAGES) warnings.push(`Only the first ${MAX_PAGES} of ${result.numpages} pages were read.`)

  return {
    content,
    pages: result.pages.map(normalizeText),
    pageCount: Math.min(result.numpages, MAX_PAGES),
    needsOcr,
    warnings,
  }
}

async function parseDocx(buffer: ArrayBuffer): Promise<ParsedDocument> {
  if (!isZip(buffer)) {
    throw new DocumentParseError('This file is not a valid DOCX. It may be corrupted, or an old .doc renamed to .docx.')
  }
  const warnings: string[] = []
  let value: string
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
    const errors = result.messages.filter((m) => m.type === 'error')
    if (errors.length > 0) warnings.push(`DOCX parsing warnings: ${errors.map((e) => e.message).join('; ')}`)
    value = result.value
  } catch (err) {
    throw new DocumentParseError('This DOCX could not be read. The file may be corrupted.', { detail: err instanceof Error ? err.message : undefined })
  }
  const content = requireText(normalizeText(value))
  return { content, pages: [content], pageCount: 1, needsOcr: false, warnings }
}

function parseText(buffer: ArrayBuffer): ParsedDocument {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  // NUL bytes or mostly replacement characters: a binary file with a text name.
  const bad = (raw.match(/\u0000|\uFFFD/g) ?? []).length
  if (bad > 0 && bad / Math.max(raw.length, 1) > 0.01) {
    throw new DocumentParseError('This file is not plain text. It may be a binary file with a .txt name.')
  }
  const content = requireText(normalizeText(raw))
  return { content, pages: [content], pageCount: 1, needsOcr: false, warnings: [] }
}

function requireText(content: string): string {
  if (content.replace(/\s+/g, '').length < MIN_DOCUMENT_TEXT_CHARS) {
    throw new DocumentParseError('The file has almost no text, so there is nothing to build a profile from.')
  }
  return content
}

function splitPdfPages(fullText: string, pageCount: number): string[] {
  const separator = /\f|\n\s*\f\s*\n/
  const rawPages = fullText.split(separator).filter((p) => p.trim().length > 0)

  if (rawPages.length >= pageCount) {
    return rawPages.slice(0, pageCount)
  }

  return [fullText]
}

function detectOcrNeeded(pages: string[]): boolean {
  const textPages = pages.filter((p) => p.trim().length > MIN_TEXT_PER_PAGE)
  const ratio = textPages.length / Math.max(pages.length, 1)
  return ratio < 0.3 && pages.length > 1
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').slice(0, 200)
}

export function contentHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}
