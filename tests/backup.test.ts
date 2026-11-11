import { expect, test } from 'vitest'
import { newCard, newOffer } from '../shared/offers'
import { MAX_IMPORT_BYTES } from '../shared/schema'
import { createBackupParts, importJson } from '../src/lib/imports'

test('a large journal exports into individually importable UTF-8 bounded parts without losing corrections', async () => {
  const entries = Array.from({ length: 250 }, () => ({ offer: { ...newOffer(), revision: 3, cards: [
    { ...newCard(), name: 'Test', modifiers: Array(30).fill('ą'.repeat(1000)) },
  ] }, evidence: null }))
  const builder = createBackupParts(false)
  entries.forEach(entry => builder.add(entry))
  const parts = builder.finish()
  expect(parts.length).toBeGreaterThan(1)
  const restored = []
  for (const part of parts) {
    expect(part.blob.size).toBeLessThanOrEqual(MAX_IMPORT_BYTES)
    const imported = await importJson(await part.blob.text())
    expect(imported.mode).toBe('restore')
    restored.push(...imported.entries)
  }
  expect(restored).toEqual(entries)
  expect(new Set(parts.map(part => part.filename)).size).toBe(parts.length)
})
