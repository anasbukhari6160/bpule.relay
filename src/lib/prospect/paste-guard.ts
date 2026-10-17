/**
 * Client-side check of a pasted research block before any request. One
 * message per problem; the caller shows it inline next to the field.
 */
export function pasteGuard(raw: string, emptyMessage = 'Paste some profile text first.'): string | null {
  const text = raw.trim()
  if (!text) return emptyMessage
  if (/^https?:\/\/\S+\s*$/i.test(text)) {
    return 'That is just a URL. Paste the profile or post text alongside it.'
  }
  if (text.length < 24) {
    return 'That paste is too short. Add a sentence or two of real research.'
  }
  return null
}
