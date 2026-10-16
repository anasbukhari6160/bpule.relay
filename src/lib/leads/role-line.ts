/**
 * "Technical Recruiter at Northstar Technologies" + "Northstar Technologies"
 * → "Technical Recruiter". Leaves the title alone when the employer differs.
 */
export function stripEmployerFromTitle(title: string | null | undefined, company: string | null | undefined): string | null {
  const t = title?.trim()
  if (!t) return null
  const c = company?.trim()
  if (!c || /^unknown( company)?$/i.test(c)) return t
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = t.replace(new RegExp(`\\s*(?:\\bat\\b|@|[|·,—-])\\s*${escaped}\\s*$`, 'i'), '').trim()
  return stripped || t
}

/** One subtitle: "Technical Recruiter · Northstar Technologies", without repeating the employer. */
export function formatRoleLine(title: string | null | undefined, company: string | null | undefined): string {
  const c = company?.trim() && !/^unknown( company)?$/i.test(company.trim()) ? company.trim() : null
  const role = stripEmployerFromTitle(title, c)
  return [role, c].filter(Boolean).join(' · ') || 'Unknown'
}
