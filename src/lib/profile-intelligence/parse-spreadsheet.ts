import * as XLSX from 'xlsx'

export interface SpreadsheetRow {
  rowNumber: number
  raw: Record<string, unknown>
  inferredColumns: Record<string, string | undefined>
}

export interface SpreadsheetParseResult {
  headers: string[]
  normalizedHeaders: string[]
  rows: SpreadsheetRow[]
  personGroups: Map<string, SpreadsheetRow[]>
  /** Group key → the name as written in the sheet (case and accents kept). */
  personDisplayNames: Map<string, string>
  detectedPeople: string[]
  warnings: string[]
}

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'full name', 'fullname', 'person', 'employee', 'team member', 'member', 'who', 'resource', 'consultant', 'contractor'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'mail', 'contact email'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin link', 'li', 'profile url', 'profile'],
  role: ['role', 'title', 'position', 'job title', 'jobtitle', 'designation', 'level', 'seniority'],
  company: ['company', 'organization', 'org', 'employer', 'firm', 'client', 'client name', 'client company'],
  skills: ['skills', 'skill', 'tech stack', 'techstack', 'technologies', 'technology stack', 'competencies', 'expertise', 'capabilities'],
  project: ['project', 'projects', 'project name', 'engagement', 'engagements', 'work', 'case study', 'case studies'],
  project_description: ['project description', 'description', 'summary', 'project summary', 'details', 'about', 'notes', 'project notes'],
  review: ['review', 'reviews', 'testimonial', 'testimonials', 'feedback', 'client feedback', 'client review', 'rating', 'endorsement'],
  dates: ['dates', 'date', 'period', 'duration', 'start', 'end', 'from', 'to', 'timeline', 'tenure'],
  portfolio: ['portfolio', 'portfolio url', 'website', 'site', 'github', 'repo', 'repos', 'samples'],
  industry: ['industry', 'industries', 'sector', 'domain', 'vertical'],
  location: ['location', 'city', 'country', 'region', 'timezone', 'tz'],
  notes: ['notes', 'comments', 'additional', 'extra', 'other', 'remarks'],
}

export async function parseSpreadsheet(buffer: ArrayBuffer, mimeType: string, filename: string): Promise<SpreadsheetParseResult> {
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('Spreadsheet has no sheets.')
  }

  const sheet = workbook.Sheets[sheetName]
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })

  if (jsonRows.length === 0) {
    throw new Error('Spreadsheet is empty.')
  }

  const rawHeaders = Object.keys(jsonRows[0])
  const normalizedHeaders = rawHeaders.map(normalizeHeader)

  const columnMapping = inferColumnMapping(rawHeaders, jsonRows)

  const rows: SpreadsheetRow[] = jsonRows.map((raw, idx) => ({
    rowNumber: idx + 2,
    raw,
    inferredColumns: mapColumns(raw, rawHeaders, columnMapping),
  }))

  const personDisplayNames = new Map<string, string>()
  const personGroups = groupRowsByPerson(rows, columnMapping, personDisplayNames)
  const detectedPeople = [...personGroups.keys()]
    .filter((n) => n && n.length > 1 && !n.startsWith('__unassigned'))
    .map((n) => personDisplayNames.get(n) ?? n)

  const warnings: string[] = []
  if (detectedPeople.length === 0) {
    warnings.push('No person names detected — rows will be treated as a single unknown profile.')
  }
  if (rows.length > 500) {
    warnings.push(`Large spreadsheet: ${rows.length} rows. Processing first 500.`)
  }

  return {
    headers: rawHeaders,
    normalizedHeaders,
    rows: rows.slice(0, 500),
    personGroups,
    personDisplayNames,
    detectedPeople,
    warnings,
  }
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, ' ')
}

function inferColumnMapping(rawHeaders: string[], rows: Record<string, unknown>[]): Record<string, string> {
  const mapping: Record<string, string> = {}

  for (const header of rawHeaders) {
    const normalized = normalizeHeader(header)
    let bestMatch: string | null = null
    let bestScore = 0

    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
      for (const alias of aliases) {
        const score = matchColumnAlias(normalized, alias)
        if (score > bestScore) {
          bestScore = score
          bestMatch = canonical
        }
      }
    }

    if (bestMatch && bestScore >= 0.7) {
      mapping[header] = bestMatch
    }
  }

  for (const header of rawHeaders) {
    if (mapping[header]) continue
    const normalized = normalizeHeader(header)
    const sampleValues = rows.slice(0, 10).map((r) => String(r[header] ?? '')).filter(Boolean)

    if (sampleValues.some((v) => /@/.test(v))) {
      mapping[header] = 'email'
    } else if (sampleValues.some((v) => /linkedin\.com|linkedin\.in/.test(v.toLowerCase()))) {
      mapping[header] = 'linkedin'
    } else if (sampleValues.some((v) => /^(senior|junior|lead|mid|principal|staff|director|vp|cto|ceo|manager|engineer|developer|designer)/i.test(v))) {
      mapping[header] = 'role'
    }
  }

  return mapping
}

function matchColumnAlias(header: string, alias: string): number {
  if (header === alias) return 1
  if (header.includes(alias) || alias.includes(header)) return 0.9
  const distance = levenshtein(header, alias)
  if (distance <= 2 && header.length > 3) return 0.8 - distance * 0.1
  return 0
}

function mapColumns(
  raw: Record<string, unknown>,
  rawHeaders: string[],
  mapping: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const header of rawHeaders) {
    const canonical = mapping[header]
    if (canonical) {
      result[canonical] = String(raw[header] ?? '').trim()
    }
  }
  return result
}

function groupRowsByPerson(
  rows: SpreadsheetRow[],
  mapping: Record<string, string>,
  displayNames: Map<string, string> = new Map(),
): Map<string, SpreadsheetRow[]> {
  const groups = new Map<string, SpreadsheetRow[]>()
  const nameHeaders = Object.entries(mapping).filter(([, v]) => v === 'name').map(([k]) => k)

  for (const row of rows) {
    let personName: string | null = null

    for (const nameHeader of nameHeaders) {
      const nameValue = String(row.raw[nameHeader] ?? '').trim()
      if (nameValue.length > 1) {
        personName = nameValue
        break
      }
    }

    if (!personName) {
      const inferredName = row.inferredColumns['name']
      if (inferredName && inferredName.length > 1) {
        personName = inferredName
      }
    }

    if (!personName) {
      const rawValues = Object.values(row.raw).filter((v) => String(v).trim().length > 1)
      const candidate = rawValues.find((v) => /^[A-Z][a-z]+(\s[A-Z][a-z]+)+$/.test(String(v).trim()))
      if (candidate) {
        personName = String(candidate).trim()
      }
    }

    if (!personName) {
      personName = `__unassigned_row_${row.rowNumber}`
    }

    // Placeholder keys stay as-is so callers can recognise and skip them.
    const normalizedPerson = personName.startsWith('__unassigned') ? personName : normalizePersonName(personName) || personName
    if (!displayNames.has(normalizedPerson)) displayNames.set(normalizedPerson, personName.replace(/\s+/g, ' ').trim())
    if (!groups.has(normalizedPerson)) {
      groups.set(normalizedPerson, [])
    }
    groups.get(normalizedPerson)!.push(row)
  }

  return groups
}

export function normalizePersonName(name: string): string {
  // Letters in any script count, so "José Núñez" keys as "josé núñez", not "jos nez".
  return name.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
      }
    }
  }
  return matrix[b.length][a.length]
}

export function spreadsheetToText(personName: string, rows: SpreadsheetRow[]): string {
  const parts: string[] = [`Person: ${personName}`]

  const allColumns = new Set<string>()
  for (const row of rows) {
    Object.keys(row.inferredColumns).forEach((k) => allColumns.add(k))
  }

  const nameParts: string[] = []
  const roleParts: string[] = []
  const companyParts: string[] = []
  const skillsParts: string[] = []
  const projectParts: string[] = []
  const reviewParts: string[] = []
  const otherParts: string[] = []

  for (const row of rows) {
    const c = row.inferredColumns
    if (c['email']) nameParts.push(`Email: ${c['email']}`)
    if (c['linkedin']) nameParts.push(`LinkedIn: ${c['linkedin']}`)
    if (c['role']) roleParts.push(c['role'])
    if (c['company']) companyParts.push(c['company'])
    if (c['location']) otherParts.push(`Location: ${c['location']}`)
    if (c['industry']) otherParts.push(`Industry: ${c['industry']}`)
    if (c['skills']) skillsParts.push(c['skills'])
    if (c['technologies']) skillsParts.push(c['technologies'])
    if (c['project']) projectParts.push(c['project'])
    if (c['project_description']) projectParts.push(c['project_description'])
    if (c['dates']) projectParts.push(`(${c['dates']})`)
    if (c['review']) reviewParts.push(c['review'])
    if (c['portfolio']) otherParts.push(`Portfolio: ${c['portfolio']}`)
    if (c['notes']) otherParts.push(`Notes: ${c['notes']}`)
  }

  const uniqueValues = (arr: string[]) => [...new Set(arr.filter(Boolean))]

  if (nameParts.length > 0) parts.push(uniqueValues(nameParts).join('\n'))
  if (roleParts.length > 0) parts.push(`Role: ${uniqueValues(roleParts).join(' / ')}`)
  if (companyParts.length > 0) parts.push(`Company: ${uniqueValues(companyParts).join(' / ')}`)
  if (skillsParts.length > 0) parts.push(`Skills/Technologies: ${uniqueValues(skillsParts).join(', ')}`)
  if (projectParts.length > 0) parts.push(`Projects:\n${uniqueValues(projectParts).map((p) => `  - ${p}`).join('\n')}`)
  if (reviewParts.length > 0) parts.push(`Reviews:\n${uniqueValues(reviewParts).map((r) => `  - "${r}"`).join('\n')}`)
  if (otherParts.length > 0) parts.push(uniqueValues(otherParts).join('\n'))

  return parts.join('\n')
}
