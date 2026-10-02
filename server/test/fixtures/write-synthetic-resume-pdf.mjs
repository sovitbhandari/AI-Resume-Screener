import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const stream = `BT
/F1 24 Tf
72 720 Td
(Synthetic resume fixture) Tj
ET
`

const objects = [
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
  '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  `4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`,
  '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
]

let body = '%PDF-1.4\n'
const offsets = [0]
for (const object of objects) {
  offsets.push(Buffer.byteLength(body))
  body += object
}

const xrefStart = Buffer.byteLength(body)
let xref = `xref\n0 ${objects.length + 1}\n`
xref += '0000000000 65535 f \n'
for (let index = 1; index < offsets.length; index += 1) {
  xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
}

const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
const pdf = body + xref + trailer
const outputPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'synthetic-resume.pdf')
writeFileSync(outputPath, pdf)
console.log(`wrote ${outputPath} (${Buffer.byteLength(pdf)} bytes)`)
