/**
 * Inbound signature extraction (QA RQA-020).
 *
 * An inbound message often ends with the sender's identity —
 * "… start in March. – Jonas, CTO at Fenwick Pay". The profile reader expects
 * the name on its own line and the role/company on the next, so the whole
 * message otherwise collapses into the title and the company becomes the last
 * word of that title ("Jona").
 *
 * Also handles multi-line signature blocks (QA RQA-020 follow-up):
 *
 *   Best regards,
 *   Person Name
 *   CTO
 *   Company Name
 *
 * and labeled blocks:
 *
 *   Signature:
 *   Person Name
 *   Founder & CEO
 *   Company Name
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

/** A title keyword that identifies a role line in a multi-line signature block. */
const ROLE_KINDS = /\b(?:CEO|CTO|CFO|COO|CPO|VP|Founder|Co-?Founder|Director|Head|Manager|Lead|Engineer|Developer|Architect|Consultant|Partner|President|Officer|Recruiter|Owner)\b/i

/** Is `value` a plausible person name for a signature block? */
function looksLikeSigName(value: string): boolean {
  if (!value) return false
  // Reject anything that ends with sentence punctuation — signatures are
  // clean lines, not prose endings ("Alex." is a sentence, not a sig).
  if (/[.!?]$/.test(value)) return false
  const words = value.split(/\s+/)
  if (words.length < 1 || words.length > 4) return false
  if (!/^[A-Z]/.test(value)) return false
  if (ROLE_KINDS.test(value)) return false
  if (/[,@]/.test(value)) return false
  if (/\b(?:i'?m|i am|we are|we're|with|looking|currently|available|offering|need|want|this|thanks|regards|best|my|name|is|am|from)\b/i.test(value)) return false
  // Reject greetings as signature names.
  if (/^(?:hi|hey|hello|dear|greetings|good|team|there|all|everyone|sir|madam|ma'am|morning|afternoon|evening|day)$/i.test(value)) return false
  return true
}

/**
 * Detect a multi-line signature block at the end of a message.
 *
 * Supports three shapes:
 *   Name / Role / Company
 *   Name / Role
 *   Name only                (Chris)
 *
 * The block sits at the trailing end of the message. All lines must be
 * plausible signature content — no prose, no greetings.
 */
function extractMultiLineSignature(text: string): TrailingSignature | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return null

  // Pass 1: look for Name / Role [/ Company] anchored by a role line.
  for (let i = lines.length - 1; i >= Math.max(1, lines.length - 5); i--) {
    const roleLine = lines[i]
    if (!ROLE_KINDS.test(roleLine)) continue

    const nameLine = lines[i - 1]
    const nameClean = nameLine.replace(/^[,\s]+|[,.\s!]+$/g, '')
    if (!looksLikeSigName(nameClean)) continue

    const companyLine = lines[i + 1] ?? null
    let company: string | null = null
    if (companyLine) {
      const companyClean = companyLine.replace(/^[,\s]+|[,.\s!]+$/g, '')
      if (companyClean && /^[A-Z]/.test(companyClean) && !ROLE_KINDS.test(companyClean)
        && !/\b(?:i'?m|i am|we are|we're|looking|currently|available|offering|need|want|contact|reach|reply|message|interested)\b/i.test(companyClean)) {
        company = companyClean
      }
    }

    return { name: nameClean, title: roleLine, company }
  }

  // Pass 2: bare single-name signature (Chris). The last non-empty line is
  // the name; the line before it is a closing ("Thanks,", "Best,").
  const last = lines[lines.length - 1]
  const nameClean = last.replace(/^[,\s]+|[,.\s!]+$/g, '')
  if (looksLikeSigName(nameClean) && lines.length >= 2) {
    const prev = lines[lines.length - 2]
    // The previous line should read like a closing or greeting, NOT prose.
    if (/^(?:(?:best|kind|warm|many|thanks|thank you|regards|cheers|sincerely|best regards)[,.]?|[!,.])?$/i.test(prev) || /^ thanks[,.]?$/i.test(prev)) {
      return { name: nameClean, title: null, company: null }
    }
  }

  return null
}

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
  // Fall back to multi-line signature block detection.
  return extractMultiLineSignature(text)
}

/** A profile-shaped block the extraction reader can parse. */
export function profileInfoFromSignature(sig: TrailingSignature): string {
  const lines = [sig.name]
  if (sig.title && sig.company) lines.push(`${sig.title} at ${sig.company}`)
  else if (sig.title) lines.push(sig.title)
  else if (sig.company) lines.push(sig.company)
  return lines.join('\n')
}
