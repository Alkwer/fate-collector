import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { parseSymbolDraft, type SymbolDraft } from '../shared/symbol-drafts'
import { SYMBOL_REPORT_LIMIT } from '../shared/symbol-reports'
import { symbolDraftContext } from '../src/lib/symbol-drafts'
import { newCard, newOffer } from '../shared/offers'
import { stripCanvasPngMetadata } from '../src/lib/symbol-reports'
import release from '../shared/helper-release.json' with { type: 'json' }

function draft(): SymbolDraft {
  const image = (name: string) => {
    const bytes = readFileSync(`public/game-art/${name}.png`)
    return { mimeType: 'image/png' as const, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), dataBase64: stripCanvasPngMetadata(bytes.toString('base64')) }
  }
  return { kind: 'fate-collector.symbol-draft', schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), helperVersion: '0.4.0',
    origin: 'test', captureId: null, icon: image('reward-gold-grid'), tooltip: image('reward-item-rarity') }
}
test.runIf(!!process.env.HELPER_SYMBOL_FIXTURE)('the real Windows cropper output passes the browser PNG and draft validator', async () => {
  const result = await parseSymbolDraft(readFileSync(process.env.HELPER_SYMBOL_FIXTURE!, 'utf8'))
  expect(result).toMatchObject({ kind: 'fate-collector.symbol-draft', origin: 'test', captureId: null, helperVersion: release.version })
  expect(result.icon.width).toBeGreaterThanOrEqual(8)
  expect(result.tooltip.height).toBeGreaterThanOrEqual(8)
})
test('local draft preserves the exact bounded PNG pixels and contains no upload authority', async () => {
  const input = draft()
  expect(await parseSymbolDraft(JSON.stringify(input))).toEqual(input)
  for (const extra of [{ token: 'secret' }, { consent: { acceptedAt: input.createdAt } }, { destination: 'https://elsewhere.test' }]) {
    await expect(parseSymbolDraft(JSON.stringify({ ...input, ...extra }))).rejects.toThrow('unsupported')
  }
})
test('malformed, oversized, metadata-bearing or dimension-mismatched images fail before preview', async () => {
  const input = draft()
  await expect(parseSymbolDraft('not JSON')).rejects.toThrow('Copy a symbol draft')
  await expect(parseSymbolDraft(' '.repeat(SYMBOL_REPORT_LIMIT + 1))).rejects.toThrow('too large')
  for (const icon of [{ ...input.icon, width: input.icon.width + 1 }, { ...input.icon, dataBase64: 'AAAA' }, { ...input.icon, dataBase64: input.icon.dataBase64 + 'AAAA' }]) {
    await expect(parseSymbolDraft(JSON.stringify({ ...input, icon }))).rejects.toThrow('damaged')
  }
  await expect(parseSymbolDraft(JSON.stringify({ ...input, schemaVersion: 2 }))).rejects.toThrow('unsupported')
})
test('context uses only matching capture and provenance, never the unrelated current offer', () => {
  const input = draft(), candidate = { ...newOffer(), captureId: crypto.randomUUID(), cards: [{ ...newCard(), name: 'Alchemist' }] }
  const independent = symbolDraftContext(input, candidate)
  expect(independent.linked).toBe(false)
  expect(independent.offer).toMatchObject({ id: input.id, captureId: null, gameVersion: 'unknown', origin: 'test', cards: [{ name: '' }] })
  input.captureId = candidate.captureId
  const linked = symbolDraftContext(input, candidate)
  expect(linked.linked).toBe(true)
  linked.offer.cards[0].name = 'Changed locally'
  expect(candidate.cards[0].name).toBe('Alchemist')
  expect(symbolDraftContext({ ...input, origin: 'live' }, candidate).linked).toBe(false)
  expect(symbolDraftContext(input, { ...candidate, cards: [] }).linked).toBe(false)
})
