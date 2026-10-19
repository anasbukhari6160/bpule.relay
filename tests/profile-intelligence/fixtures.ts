/** Fictional test documents built in code — no real person's data. */
import * as XLSX from 'xlsx'

/** A minimal, valid PDF: one page per entry, each with the given lines of text (empty = no text). */
export function buildPdf(pages: string[][]): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => { objects.push(body); return objects.length }
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pagesId = objects.length + 1
  objects.push('') // placeholder for /Pages
  const kids: number[] = []
  for (const lines of pages) {
    const ops = lines.length === 0
      ? ''
      : `BT /F1 11 Tf 50 780 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join(' ')} ET`
    const contentId = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`))
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

export const CV_LINES = [
  'Jordan Avery',
  'Senior Full-Stack Engineer',
  'Lisbon, Portugal',
  'Professional summary: eight years building React and Node.js products for SaaS clients.',
  'Skills: React, Next.js, Node.js, PostgreSQL, AWS',
  'Experience: Lead Engineer at Brightwave Labs, 2021 to present. Built a billing platform.',
]

export function buildXlsx(rows: Array<Record<string, string>>, type: 'xlsx' | 'csv' = 'xlsx'): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Team')
  if (type === 'csv') return new TextEncoder().encode(XLSX.utils.sheet_to_csv(wb.Sheets.Team))
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

export const toArrayBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

/** A real, minimal DOCX (zip) with one paragraph per line, built with xlsx's zip writer. */
export function buildDocx(lines: string[]): Uint8Array {
  const CFB = XLSX.CFB
  const cfb = CFB.utils.cfb_new()
  const add = (path: string, body: string) => CFB.utils.cfb_add(cfb, path, Buffer.from(body))
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  add('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`)
  CFB.utils.cfb_del(cfb, '\u0001Sh33tJ5')
  return new Uint8Array(CFB.write(cfb, { fileType: 'zip', type: 'buffer' }) as Buffer)
}
