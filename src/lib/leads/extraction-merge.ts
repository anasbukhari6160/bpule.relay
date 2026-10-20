/**
 * Merge a fresh extraction into the manual-lead form.
 *
 * Three owners per field: the previous extraction, the current one, and the
 * rep. A field still equal to what the previous extraction wrote belongs to
 * the old source and follows the new one, even to empty. A field the rep
 * edited is theirs and is kept; for the title fields the rep's value also
 * wins over a fresh extraction, matching the form's original behaviour.
 * Without this, extracting person B after person A left A's name, title
 * and location next to B's company (REL-QA-013).
 */
export const EXTRACTED_FIELD_KEYS = [
  'company',
  'contactName',
  'contactTitle',
  'titleRaw',
  'locationRaw',
  'aboutSummary',
  'experienceSummary',
  'url',
  'verbatimQuote',
] as const

export type ExtractedFieldKey = (typeof EXTRACTED_FIELD_KEYS)[number]
export type ExtractedFields = Record<ExtractedFieldKey, string>

/** Fields where a rep's own value is kept even when the new source has one. */
const REP_WINS: ReadonlySet<ExtractedFieldKey> = new Set(['contactTitle', 'titleRaw'])

export function mergeExtractedFields(
  current: ExtractedFields,
  fresh: ExtractedFields,
  previous: Partial<ExtractedFields> | null,
): ExtractedFields {
  const out = { ...current }
  for (const key of EXTRACTED_FIELD_KEYS) {
    const cur = current[key].trim()
    const next = fresh[key].trim()
    const fromPreviousSource = previous !== null && cur === (previous[key] ?? '').trim()
    if (!cur || fromPreviousSource) {
      out[key] = next
      continue
    }
    out[key] = next && !REP_WINS.has(key) ? next : cur
  }
  return out
}
