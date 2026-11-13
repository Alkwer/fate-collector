import { expect, test } from 'vitest'
import { extractCards, offeredCardHeaders } from '../shared/recognition'
import type { Capture } from '../shared/schema'
import pressKitOcr from './fixtures/presskit-ocr.json'
import presentationOcr from './fixtures/presentation-ocr.json'
const line = (text: string, x: number, y: number) => ({ text, x, y, width: 100, height: 20 })
const base: Capture = { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.1.0', image: { width: 1000, height: 800, mimeType: 'image/png', dataBase64: 'eA==' }, ocr: { status: 'ok', text: '', language: 'en-US', lines: [] } }

test.each([
  line('Creates dangerous monsters', 300, 100),
  { ...line('Creates Monsters', 300, 100), height: 10 },
  line('New Fate', 80, 100),
  line('1st Reward', 300, 100),
])('rejects body text, small text and overlapping unknown headers (%#)', candidate => {
  const anchor = line('Alchemist', 30, 100)
  expect(offeredCardHeaders([anchor, candidate])).toEqual([anchor])
})

test.each(Object.entries(presentationOcr.cases))('uses fresh Windows OCR for presentation %s', (name, capture) => {
  expect(capture.ocr.status).toBe('ok')
  const result = extractCards({ ...capture, ocr: { ...capture.ocr, status: 'ok' } })
  expect(result.cards.map(card => card.name)).toEqual(name.startsWith('offer-a')
    ? ['Alchemist', 'Sanguine', 'Butcher', 'Gravewalker']
    : name.startsWith('offer-b') ? ['Torchbearer', 'Tempest', 'Stormcaller', 'Houndmaster'] : [])
})
test('extracts the offered row, allows a raised selected card, excludes the collected deck', () => {
  const result = extractCards({ ...base, ocr: { ...base.ocr, lines: [
    line('Fates', 450, 0), line('CONFIRM', 450, 450),
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

test('pairs panel controls despite an unrelated world-space title and excludes cards below Confirm', () => {
  const result = extractCards({ ...base, ocr: { ...base.ocr, lines: [
    line('SELECT A FATE', 20, 0), line('Fates', 450, 100), line('CONFIRM', 450, 550),
    line('Alchemist', 30, 200), line('Unknown Fate', 300, 200), line('Sanguine', 650, 180),
    line('First description', 30, 350), line('Unknown description', 300, 350), line('Third description', 650, 350),
    line('Torchbearer', 450, 650),
  ] } })
  expect(result.cards.map(card => ({ name: card.name, modifiers: card.modifiers }))).toEqual([
    { name: 'Alchemist', modifiers: ['First description'] }, { name: '', modifiers: ['Unknown description'] }, { name: 'Sanguine', modifiers: ['Third description'] },
  ])
})

test.each(['CONFIR', 'NHR', 'Confirm selection'])('does not invent a Confirm boundary from %s', text => {
  const result = extractCards({ ...base, ocr: { ...base.ocr, lines: [
    line('Fates', 450, 0), line(text, 450, 450), line('Alchemist', 30, 100), line('Torchbearer', 450, 600),
  ] } })
  expect(result.cards).toEqual([])
})
test('reads four offered cards from real Windows OCR of the GGG pre-release screenshot, excluding the owned Torchbearer', () => {
  const result = extractCards({ ...base, image: { ...base.image, width: 3840, height: 2160 }, ocr: { ...pressKitOcr, status: 'ok' } })
  expect(result.cards.map(c => c.name)).toEqual(['Torchbearer', 'Tempest', 'Stormcaller', 'Houndmaster'])
  expect(result.cards[0].modifiers).toEqual(['Creates dangerous bonfires of corpses'])
  expect(result.cards[3].modifiers).toEqual(['Creates spectral wolves which explode into ice'])
})

test('does not promote a collected card when the offered name is unknown and panel boundaries are absent', () => {
  const result = extractCards({ ...base, ocr: { ...base.ocr, lines: [
    line('Unknown offered fate', 30, 100), line('Torchbearer', 400, 600),
  ] } })
  expect(result.cards).toEqual([])
})

test.each(['unknown', 'missing'])('keeps the owned Torchbearer out when all offered names are %s in real OCR geometry', mode => {
  const lines = pressKitOcr.lines.flatMap(entry => {
    if (entry.y >= 479 && entry.y <= 523) return mode === 'missing' ? [] : [{ ...entry, text: 'Unrecognized header' }]
    return [entry]
  })
  const result = extractCards({ ...base, image: { ...base.image, width: 3840, height: 2160 }, ocr: { ...pressKitOcr, status: 'ok', lines } })
  expect(result.cards).toEqual([])
})

test.each(['Fates', 'CONFIRM'])('abstains if the %s boundary is unreadable', marker => {
  const result = extractCards({ ...base, image: { ...base.image, width: 3840, height: 2160 }, ocr: {
    ...pressKitOcr, status: 'ok', lines: pressKitOcr.lines.filter(entry => entry.text !== marker),
  } })
  expect(result.cards).toEqual([])
})

test('keeps partial recognition and descriptions within the offered area, including unknown header slots', () => {
  const result = extractCards({ ...base, ocr: { ...base.ocr, lines: [
    line('Select a Fate', 450, 0), line('CONFIRM', 450, 450),
    line('Alchemist', 30, 100), line('New unknown Fate', 300, 70), line('Sanguine', 650, 100),
    line('First description', 30, 250), line('Unknown card description', 300, 250), line('Third description', 650, 250),
    line('Torchbearer', 300, 600), line('Collected card description', 300, 700),
  ].reverse() } })
  expect(result.cards.map(card => ({ name: card.name, modifiers: card.modifiers }))).toEqual([
    { name: 'Alchemist', modifiers: ['First description'] }, { name: 'Sanguine', modifiers: ['Third description'] },
  ])
})

test.each([
  [line('Fates', 450, 0), line('CONFIRM', 450, 450), line('CONFIRM', 450, 750)],
  [line('Fates', 450, 0), line('Fates', 450, 50), line('CONFIRM', 450, 450)],
  [line('Fates', 450, 500), line('CONFIRM', 450, 450)],
  [line('Invoke Fates', 450, 0), line('CONFIRM', 450, 450)],
  [line('Invoke', 450, 0), line('Fates', 450, 25), line('CONFIRM', 450, 450)],
  [line('Fates', 50, 0), line('CONFIRM', 450, 450)],
  [line('Fates', -10, 0), line('CONFIRM', -10, 450)],
].map(controls => ({ controls })))('does not guess an offer from ambiguous or non-offer controls (%#)', ({ controls }) => {
  const result = extractCards({ ...base, ocr: { ...base.ocr, lines: [...controls, line('Alchemist', 30, 100)] } })
  expect(result.cards).toEqual([])
})

test.each([0.5, 1, 1.5])('preserves the real offered row at %sx scale', scale => {
  const result = extractCards({ image: { width: 3840 * scale, height: 2160 * scale }, ocr: { ...pressKitOcr, status: 'ok',
    lines: pressKitOcr.lines.map(entry => ({ ...entry, x: entry.x * scale, y: entry.y * scale, width: entry.width * scale, height: entry.height * scale })),
  } })
  expect(result.cards.map(card => card.name)).toEqual(['Torchbearer', 'Tempest', 'Stormcaller', 'Houndmaster'])
})
