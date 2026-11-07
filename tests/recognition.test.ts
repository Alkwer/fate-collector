import { expect, test } from 'vitest'
import { extractCards } from '../shared/recognition'
import type { Capture } from '../shared/schema'
import pressKitOcr from './fixtures/presskit-ocr.json'
const line = (text: string, x: number, y: number) => ({ text, x, y, width: 100, height: 20 })
const base: Capture = { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.1.0', image: { width: 1000, height: 800, mimeType: 'image/png', dataBase64: 'eA==' }, ocr: { status: 'ok', text: '', language: 'en-US', lines: [] } }
test('extracts the offered row, allows a raised selected card, excludes the collected deck', () => {
  const result = extractCards({ ...base, ocr: { ...base.ocr, lines: [
    line('Alchemist', 30, 100), line('Sanguine', 300, 100), line('Houndmaster', 650, 70),
    line('Creates boiling', 30, 250), line('cauldrons of blood', 30, 275), line('Creates spectral wolves', 650, 250),
    line('Torchbearer', 400, 600), line('Creates dangerous bonfires', 400, 700),
  ] } })
  expect(result.cards.map(c => c.name)).toEqual(['Alchemist', 'Sanguine', 'Houndmaster'])
  expect(result.cards[0].modifiers).toEqual(['Creates boiling cauldrons of blood'])
  expect(result.cards[0].tier).toBeNull()
  expect(result.cards[0].rewards).toEqual([])
})
test('does not guess from absent geometry or an unknown name', () => {
  expect(extractCards({ ...base, ocr: { ...base.ocr, text: 'Alchemist', lines: [] } }).cards).toEqual([])
  expect(extractCards({ ...base, ocr: { ...base.ocr, lines: [line('Brandnewfate', 30, 100)] } }).cards).toEqual([])
})
test('reads four offered cards from real Windows OCR of the GGG pre-release screenshot, excluding the owned Torchbearer', () => {
  const result = extractCards({ ...base, image: { ...base.image, width: 3840, height: 2160 }, ocr: { ...pressKitOcr, status: 'ok' } })
  expect(result.cards.map(c => c.name)).toEqual(['Torchbearer', 'Tempest', 'Stormcaller', 'Houndmaster'])
  expect(result.cards[0].modifiers).toEqual(['Creates dangerous bonfires of corpses'])
  expect(result.cards[3].modifiers).toEqual(['Creates spectral wolves which explode into ice'])
})
