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
  /^(?:message|follow|following|connect|pending|more|more actions|save to pdf|send profile in a message|report\s*\/\s*block|contact info|view (?:full )?profile|open to|add profile section|enhance profile|resources|show all|see more|see less|…\s*see more|\.\.\.\s*see more)$/i

export function isLinkedInChromeLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  return VIEW_PROFILE.test(t) || CHROME_LINE.test(t)
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
