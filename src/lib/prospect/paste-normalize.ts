/**
 * Strip LinkedIn interface chrome from a pasted profile before any analysis.
 *
 * Copying a LinkedIn page picks up button and link labels ("View Jane Doe's
 * profile", "Message", "Follow"). They are not evidence about the prospect,
 * and leaving them in changed the extracted name and, through it, lead
 * eligibility. Section headers (About, Experience, Activity, Posts) and
 * connection-degree badges are kept: the segmenter and the input classifier
 * rely on them.
 */

const VIEW_PROFILE = /^view\s+(?:(.+?)(?:['’]s?)\s+)?(?:full\s+)?profile\.?$/i

const CHROME_LINE =
  /^(?:message|follow|following|connect|pending|more|more actions|save to pdf|send profile in a message|report\s*\/\s*block|contact info|view (?:full )?profile|open to|add profile section|enhance profile|resources|show all|see more|see less|…\s*see more|\.\.\.\s*see more|vernetzen|nachricht|folgen|kontakt|folgen sie uns|profil ansehen)$/i

// LinkedIn renders the connection degree and the action buttons on ONE line
// ("3rd · Connect", "2. · Vernetzen", "2nd • Message"). Neither half is
// evidence: the degree is not a title and the button is not a company. Strip
// the whole line so it can never become a role, company or subtitle
// (QA RQA-003).
const DEGREE_CHROME_LINE =
  /^\W*\d+(?:\.\d+)?\.?\s*(?:(?:st|nd|rd|th)\b)?[\s·•|]*(?:connect|message|follow|following|pending|vernetzen|nachricht|folgen|kontakt|open\s+to\s+work)?\s*$/i

export function isLinkedInChromeLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  return VIEW_PROFILE.test(t) || CHROME_LINE.test(t) || DEGREE_CHROME_LINE.test(t)
}

/** "View Jane Doe's profile" → "Jane Doe". Null when the line is not that label. */
export function nameFromViewProfileLabel(line: string): string | null {
  const m = line.trim().match(VIEW_PROFILE)
  const name = m?.[1]?.trim()
  return name ? name : null
}

export function normalizeProspectPaste(rawText: string): string {
  const out: string[] = []
  for (const line of rawText.replace(/\r\n?/g, '\n').split('\n')) {
    if (isLinkedInChromeLine(line)) continue
    out.push(line.replace(/\s+$/, ''))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Display name for a lead saved before chrome stripping existed:
 * "View Riya Rajeev’s profile, open to work" → "Riya Rajeev".
 */
export function displayContactName(name: string | null | undefined): string | null {
  const t = name?.trim()
  if (!t) return null
  const m = t.match(/^view\s+(.+?)['’]s?\s+(?:full\s+)?profile\b.*$/i)
  return m?.[1]?.trim() || t
}
