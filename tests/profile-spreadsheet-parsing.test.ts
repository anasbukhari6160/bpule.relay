import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseSpreadsheet, spreadsheetToText, normalizePersonName } from '@/lib/profile-intelligence/parse-spreadsheet'

function createWorkbook(rows: Record<string, unknown>[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return data as ArrayBuffer
}

function createCsvBuffer(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer as ArrayBuffer
}

describe('parseSpreadsheet', () => {
  it('parses a simple one-person-per-row CSV', async () => {
    const csv = `name,role,company,skills,project
Aneeb Khan,CTO,BPulse,"React, Node.js",BPulse Payments
Hassan Raza,Senior Backend Engineer,BPulse,"Python, Django",E-commerce API
Fiza,Frontend Engineer,BPulse,"React, TypeScript",Design System`

    const result = await parseSpreadsheet(createCsvBuffer(csv), 'text/csv', 'team.csv')

    expect(result.detectedPeople).toContain('Aneeb Khan')
    expect(result.detectedPeople).toContain('Hassan Raza')
    expect(result.detectedPeople).toContain('Fiza')
    expect(result.personGroups.size).toBe(3)
  })

  it('parses XLSX with standard headers', async () => {
    const rows = [
      { Name: 'Aneeb Khan', Role: 'CTO', Company: 'BPulse', Skills: 'React, Node.js', Project: 'BPulse Payments' },
      { Name: 'Hassan Raza', Role: 'Senior Backend', Company: 'BPulse', Skills: 'Python, Django', Project: 'E-commerce API' },
    ]

    const result = await parseSpreadsheet(createWorkbook(rows), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'team.xlsx')

    expect(result.detectedPeople).toContain('Aneeb Khan')
    expect(result.detectedPeople).toContain('Hassan Raza')
    expect(result.headers).toContain('Name')
    expect(result.headers).toContain('Role')
  })

  it('groups multiple rows for the same person', async () => {
    const csv = `name,project,review
Aneeb Khan,BPulse Payments,Great work on the platform
Aneeb Khan,BPulse Dashboard,Delivered on time
Hassan Raza,E-commerce API,Excellent backend architecture`

    const result = await parseSpreadsheet(createCsvBuffer(csv), 'text/csv', 'projects.csv')

    expect(result.personGroups.size).toBe(2)
    const aneebRows = result.personGroups.get(normalizePersonName('Aneeb Khan'))
    expect(aneebRows?.length).toBe(2)
  })

  it('infers column meaning from arbitrary headers', async () => {
    const csv = `Full Name,Job Title,Organization,Tech Stack,Engagement,Client Feedback
Aneeb Khan,CTO,BPulse,"React, Node.js",BPulse Payments,Great work
Hassan Raza,Senior Backend,BPulse,"Python, Django",E-commerce API,Excellent`

    const result = await parseSpreadsheet(createCsvBuffer(csv), 'text/csv', 'arbitrary.csv')

    const firstRow = result.rows[0]
    expect(firstRow.inferredColumns['name']).toBe('Aneeb Khan')
    expect(firstRow.inferredColumns['role']).toBe('CTO')
    expect(firstRow.inferredColumns['company']).toBe('BPulse')
    expect(firstRow.inferredColumns['skills']).toBe('React, Node.js')
    expect(firstRow.inferredColumns['project']).toBe('BPulse Payments')
    expect(firstRow.inferredColumns['review']).toBe('Great work')
  })

  it('handles email and LinkedIn columns', async () => {
    const csv = `name,email,linkedin,role
Aneeb Khan,aneeb@bpulse.dev,https://linkedin.com/in/aneeb,CTO
Hassan Raza,hassan@bpulse.dev,https://linkedin.com/in/hassan,Senior Backend`

    const result = await parseSpreadsheet(createCsvBuffer(csv), 'text/csv', 'contacts.csv')

    expect(result.rows[0].inferredColumns['email']).toBe('aneeb@bpulse.dev')
    expect(result.rows[0].inferredColumns['linkedin']).toBe('https://linkedin.com/in/aneeb')
  })

  it('preserves row numbers as provenance', async () => {
    const csv = `name,role
Aneeb Khan,CTO
Hassan Raza,Senior Backend
Fiza,Frontend Engineer`

    const result = await parseSpreadsheet(createCsvBuffer(csv), 'text/csv', 'team.csv')

    expect(result.rows[0].rowNumber).toBe(2)
    expect(result.rows[1].rowNumber).toBe(3)
    expect(result.rows[2].rowNumber).toBe(4)
  })

  it('handles empty spreadsheet gracefully', async () => {
    await expect(parseSpreadsheet(createCsvBuffer(''), 'text/csv', 'empty.csv')).rejects.toThrow()
  })

  it('handles spreadsheet with no name column', async () => {
    const csv = `task,description,status
Build API,Create REST endpoints,complete
Fix bug,Resolve login issue,in progress`

    const result = await parseSpreadsheet(createCsvBuffer(csv), 'text/csv', 'tasks.csv')

    expect(result.detectedPeople.length).toBe(0)
    expect(result.warnings.some((w) => w.includes('No person names detected'))).toBe(true)
  })
})

describe('spreadsheetToText', () => {
  it('converts person rows to structured text', () => {
    const rows = [
      {
        rowNumber: 2,
        raw: { name: 'Aneeb Khan', role: 'CTO', skills: 'React, Node.js', project: 'BPulse Payments' },
        inferredColumns: { name: 'Aneeb Khan', role: 'CTO', skills: 'React, Node.js', project: 'BPulse Payments' },
      },
      {
        rowNumber: 3,
        raw: { name: 'Aneeb Khan', project: 'BPulse Dashboard', review: 'Great work' },
        inferredColumns: { name: 'Aneeb Khan', project: 'BPulse Dashboard', review: 'Great work' },
      },
    ]

    const text = spreadsheetToText('Aneeb Khan', rows)

    expect(text).toContain('Person: Aneeb Khan')
    expect(text).toContain('Role: CTO')
    expect(text).toContain('React, Node.js')
    expect(text).toContain('BPulse Payments')
    expect(text).toContain('BPulse Dashboard')
    expect(text).toContain('Great work')
  })

  it('deduplicates values across rows', () => {
    const rows = [
      {
        rowNumber: 2,
        raw: { name: 'Aneeb Khan', skills: 'React', project: 'Project A' },
        inferredColumns: { name: 'Aneeb Khan', skills: 'React', project: 'Project A' },
      },
      {
        rowNumber: 3,
        raw: { name: 'Aneeb Khan', skills: 'React', project: 'Project B' },
        inferredColumns: { name: 'Aneeb Khan', skills: 'React', project: 'Project B' },
      },
    ]

    const text = spreadsheetToText('Aneeb Khan', rows)
    const reactCount = (text.match(/React/g) ?? []).length
    expect(reactCount).toBe(1)
  })
})

describe('normalizePersonName', () => {
  it('normalizes names for grouping', () => {
    expect(normalizePersonName('Aneeb Khan')).toBe('aneeb khan')
    expect(normalizePersonName('  Aneeb   Khan  ')).toBe('aneeb khan')
    expect(normalizePersonName('Aneeb-Khan')).toBe('aneebkhan')
  })
})
