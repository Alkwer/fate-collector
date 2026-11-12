import { readFile, mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { symbolReportSchema, validateSymbolPixels } from '../shared/symbol-reports.ts'

export function reviewReports(input, now = Date.now()) {
  if (!Array.isArray(input)) throw new Error('Expected a Wrangler JSON result array.')
  const rows = input.flatMap(part => Array.isArray(part.results) ? part.results : [part])
  const seen = new Set()
  return rows.filter(row => row.report_json !== null && !row.withdrawn_at && Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) > now).map(row => {
    const report = symbolReportSchema.parse(JSON.parse(row.report_json))
    if (row.id !== report.id || seen.has(report.id)) throw new Error('Duplicate or mismatched report ID.')
    seen.add(report.id)
    return { report, expiresAt: row.expires_at }
  })
}
async function main() {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: node scripts/export-symbol-reports.mjs queue.json output-directory')
  const destination = resolve(output)
  try { await access(destination); throw new Error('Output directory already exists; choose a new directory.') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const reports = reviewReports(JSON.parse(await readFile(input, 'utf8')))
  for (const { report } of reports) if (!await validateSymbolPixels(report)) throw new Error('Invalid image pixels; no files exported.')
  await mkdir(destination, { recursive: true })
  const queue = []
  for (const { report, expiresAt } of reports) {
    const dir = join(destination, report.id); await mkdir(dir)
    const { icon, tooltip, ...metadata } = report
    await writeFile(join(dir, 'icon.png'), Buffer.from(icon.dataBase64, 'base64'))
    await writeFile(join(dir, 'tooltip.png'), Buffer.from(tooltip.dataBase64, 'base64'))
    await writeFile(join(dir, 'report.json'), JSON.stringify({ ...metadata, expiresAt }, null, 2) + '\n')
    queue.push({ id: report.id, status: 'pending', verifiedLabel: null, verifiedKind: null, verifiedThreshold: null, reviewer: null, reviewedAt: null, notes: '', expiresAt })
  }
  await writeFile(join(destination, 'review.json'), JSON.stringify(queue, null, 2) + '\n')
  process.stdout.write(`Prepared ${queue.length} private reports for review. No recognition templates were changed.\n`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
