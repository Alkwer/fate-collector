import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeFateName } from '../shared/fate-names.ts'
import { extractCards } from '../shared/recognition.ts'

// This archive contains encounter-level name labels, without per-frame header
// boxes. Measure names as a multiset for the first screenshot of each offer.
const [directory, freshOcr] = process.argv.slice(2)
if (!directory || process.argv.length > 4) throw new Error('Usage: node scripts/replay-campaign-names.mjs ARCHIVE_DIRECTORY [FRESH_OCR_DIRECTORY]')
const json = async filename => JSON.parse((await readFile(join(directory, filename), 'utf8')).replace(/^\uFEFF/, ''))
const { offers, schema } = await json('observations.json')
assert.equal(schema, 'fate-campaign-screenshot-research/v1')
assert(offers.length > 0, 'No labeled offers')
const { attachments } = await json('source-index.json')
const scenes = []
const seen = new Set()
for (const { sourceImages, cards } of offers) {
  const index = sourceImages[0]
  assert(Number.isSafeInteger(index) && index > 0 && cards.length > 0)
  const stem = String(index).padStart(2, '0')
  const png = await readFile(join(directory, 'screenshots', stem + '.png'))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  const sha = createHash('sha256').update(png).digest('hex')
  assert.equal(sha, attachments.find(item => item.index === index)?.sha256)
  assert(!seen.has(sha), 'Duplicate first frame')
  seen.add(sha)
  const record = freshOcr ? JSON.parse((await readFile(join(freshOcr, stem + '.json'), 'utf8')).replace(/^\uFEFF/, '')) : await json(join('ocr', stem + '.json'))
  if (freshOcr) assert.equal(record.pngSha256, sha, 'Fresh OCR belongs to another frame')
  const { ocr } = record
  const image = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
  const expected = cards.map(card => card.name)
  const missing = [...expected]
  const unexpected = []
  const predictions = extractCards({ image, ocr }).cards.map(card => card.name).filter(Boolean)
  for (const name of predictions) {
    const i = missing.findIndex(label => normalizeFateName(label) === normalizeFateName(name))
    if (i < 0) unexpected.push(name)
    else missing.splice(i, 1)
  }
  scenes.push({ index, sha256: sha, ocrStatus: ocr.status, expected, predictions, missing, unexpected })
}
const count = field => scenes.reduce((sum, scene) => sum + scene[field].length, 0)
const expected = count('expected'), correct = expected - count('missing')
console.log(JSON.stringify({ mode: 'archived-campaign-names', ocr: freshOcr ? 'fresh' : 'archived', offers: scenes.length, expected, correct,
  omitted: count('missing'), unexpected: count('unexpected'), recall: correct / expected, scenes }, null, 2))
