/**
 * Inbound signature extraction (QA RQA-020).
 *
 * An inbound message often ends with the sender's identity —
 * "… start in March. – Jonas, CTO at Fenwick Pay". The profile reader expects
 * the name on its own line and the role/company on the next, so the whole
 * message otherwise collapses into the title and the company becomes the last
 * word of that title ("Jona").
 */

export interface TrailingSignature {
  name: string
  title: string | null
  company: string | null
}

const SIGNATURE =
  /(?:^|\n|[-–—])\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,2}),\s*([^,.\n]{2,60}?)\s+at\s+([A-Z][A-Za-z0-9&.' -]{2,40})\s*$/i

/** A bare "Name, Role" with no "at Company" is still a signature. */
const SIGNATURE_NO_COMPANY =
  /(?:^|\n|[-–—])\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,2}),\s*(CTO|CFO|CEO|COO|CPO|VP|Founder|Co-?Founder|Director|Head of [A-Za-z ]{2,30}|Manager|Lead|Engineer|Developer|Recruiter|Product [A-Za-z ]{2,20})\s*$/i

export function extractTrailingSignature(message: string): TrailingSignature | null {
  const text = (message ?? '').trim()
  if (!text) return null
  const withCompany = text.match(SIGNATURE)
  if (withCompany) {
    return {
      name: withCompany[1].trim(),
      title: withCompany[2].trim(),
      company: withCompany[3].trim(),
    }
  }
  const noCompany = text.match(SIGNATURE_NO_COMPANY)
  if (noCompany) {
    return { name: noCompany[1].trim(), title: noCompany[2].trim(), company: null }
  }
  return null
}

/** A profile-shaped block the extraction reader can parse. */
export function profileInfoFromSignature(sig: TrailingSignature): string {
  const lines = [sig.name]
  if (sig.title && sig.company) lines.push(`${sig.title} at ${sig.company}`)
  else if (sig.title) lines.push(sig.title)
  else if (sig.company) lines.push(sig.company)
  return lines.join('\n')
}
