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

const countedLines = [
  line('Fates', 450, 50), { ...line('1/4', 346, 508), width: 28 },
  line('Doomsayer', 190, 154), line('Wildfire', 450, 134), line('Murderous', 710, 154),
  line('Creates massive', 190, 362), line('explosive blasts of', 190, 382), line('blackfire', 190, 402),
  line('Creates walls Of blackfire.', 450, 342), line('Summons malignant', 710, 362), line('crows', 710, 382),
  { ...line('SELECT', 354, 360), width: 36 }, line('Blood Moon', 450, 626),
]
function readCounted(lines: typeof countedLines) {
  return extractCards({ ...base, ocr: { ...base.ocr, lines } }).cards.map(({ name, modifiers }) => [name, ...modifiers])
}
const countedCards = [
  ['Doomsayer', 'Creates massive explosive blasts of blackfire'],
  ['Wildfire', 'Creates walls of blackfire'], ['Murderous', 'Summons malignant crows'],
]
test('reads raised cards and their wrapped text when the counter anchors an unreadable button', () => {
  expect(readCounted(countedLines)).toEqual(countedCards)
  expect(readCounted(countedLines.filter(l => l.text !== 'Fates'))).toEqual([])
  expect(readCounted(countedLines.map(l => l.text === '1/4' ? { ...l, text: '114' } : l))).toEqual([])
})
test('requires a tooltip over the title, Confirm and independent card columns to recover a masked heading', () => {
  const masked = countedLines.filter(l => l.text !== 'Fates').concat(line('CONFIRM', 450, 515))
  expect(readCounted(masked)).toEqual([])
  const tooltip = { ...line('Empowered Monster creates fissures of bloated corpses', 420, 55), width: 440 }
  expect(readCounted([...masked, tooltip])).toEqual(countedCards)
  expect(readCounted([...masked, tooltip, line('Invoke Fates', 450, 45)])).toEqual([])
})

test('recognizes a tooltip ending inside the title plate only with the remaining letters and aligned button', () => {
  const row = countedLines.filter(l => l.text !== 'Fates').concat(line('CONFIRM', 450, 515))
  const tooltip = { ...line('Empowered Monster deals cold damage', 110, 55), width: 375 }
  const fragment = { ...line('es', 509, 51), width: 20 }
  const footer = line('Confirm', 370, 720)
  expect(readCounted([...row, tooltip, fragment, footer])).toEqual(countedCards)
  expect(readCounted([...row, tooltip, footer])).toEqual([])
  expect(readCounted([...row, fragment])).toEqual([])
  expect(readCounted([...row.filter(l => l.text !== 'CONFIRM'), tooltip, fragment, footer])).toEqual([])
})
test('preserves changed or incomplete description text and abstains on an ambiguous grid', () => {
  expect(readCounted(countedLines.filter(l => l.text !== 'blackfire'))[0]).toEqual(['Doomsayer', 'Creates massive explosive blasts of'])
  expect(readCounted([...countedLines, line('Butcher', 447, 150)])).toEqual([])
  expect(readCounted(countedLines.map(l => l.text === 'Creates walls Of blackfire.' ? { ...l, text: 'Creates two walls of blackfire' } : l))[1])
    .toEqual(['Wildfire', 'Creates two walls of blackfire'])
})

test('preserves an unknown outer card next to a recognized pair when the opposite header is missing', () => {
  const partial = [
    line('Fates', 550, 50), line('Confirm', 550, 520), line('New Fate', 155, 154),
    line('Doomsayer', 418, 154), line('Wildfire', 682, 154),
    line('Unseen effect', 155, 360), line('First known effect', 418, 360), line('Second known effect', 682, 360),
  ]
  expect(readCounted(partial)).toEqual([['', 'Unseen effect'], ['Doomsayer', 'First known effect'], ['Wildfire', 'Second known effect']])
})

test('ignores title-cased HUD labels beyond the widest six-card layout', () => {
  const lines = countedLines.map(l => ({ ...l, x: l.x + 500 }))
  lines.push(line('Short Allocation', 1730, 148))
  const cards = extractCards({ ...base, image: { ...base.image, width: 1920 }, ocr: { ...base.ocr, lines } }).cards
  expect(cards.map(c => [c.name, ...c.modifiers])).toEqual(countedCards)
})

test('ignores a quest on a possible outer column above a complete row', () => {
  const quest = { ...line('Kingsmarch', 970, 107), width: 100 }
  const result = extractCards({ ...base, image: { ...base.image, width: 1200 },
    ocr: { ...base.ocr, lines: [...countedLines, quest] } })
  expect(result.cards.map(c => [c.name, ...c.modifiers])).toEqual(countedCards)
})

test('separates a wrapped sidebar objective from a possible outer card at the same height', () => {
  const outer = line('Kingsmarch', 970, 154)
  const objective = { ...line('Speak to Johan in the Karui Shores to visit', 971, 134), width: 304 }
  const read = (extra: typeof countedLines) => extractCards({ ...base, image: { ...base.image, width: 1400 },
    ocr: { ...base.ocr, lines: [...countedLines, outer, ...extra] } }).cards.map(c => [c.name, ...c.modifiers])
  expect(read([objective])).toEqual(countedCards)
  expect(read([])).toEqual([])
  expect(read([{ ...objective, x: 940 }])).toEqual([])
  expect(read([objective, line('Unseen effect', 970, 362)])).toEqual([])
})

test('requires the same card tooltip and its printed phrase for a digit-like connector', () => {
  const row = countedLines.map(l => l.text === 'Wildfire' ? { ...l, text: 'Tempest' } :
    l.text === 'Creates walls Of blackfire.' ? { ...l, text: 'Creates volatile orbs 01 lightning' } : l)
  const title = line('Tempest', 3, 18)
  const phrase = { ...line('Volatile orbs of Lightning come into being nearby Empowered Monster', 4, 48), width: 360 }
  const text = (extra: typeof row) => readCounted([...row, ...extra])[1][1]
  expect(text([title, phrase])).toBe('Creates volatile orbs of lightning')
  expect(text([phrase])).toBe('Creates volatile orbs 01 lightning')
  expect(text([{ ...title, text: 'Dryad' }, phrase])).toBe('Creates volatile orbs 01 lightning')
  expect(text([title, { ...phrase, x: 70 }])).toBe('Creates volatile orbs 01 lightning')
  expect(text([title, { ...phrase, text: 'Volatile orbs deal Lightning Damage' }])).toBe('Creates volatile orbs 01 lightning')
})

test('corroborates a misread header only with the complete description in its own column', () => {
  const typo = countedLines.map(l => l.text === 'Doomsayer' ? { ...l, text: 'Doornsayer' } : l)
  expect(readCounted(typo)).toEqual(countedCards)
  expect(readCounted(typo.filter(l => l.text !== 'blackfire'))[0][0]).toBe('')
  expect(readCounted(typo.map(l => l.text === 'Doornsayer' ? { ...l, text: 'New Fate' } : l))[0][0]).toBe('')
})

test.each([
  ['Wildfire', 'Creates walls of bl', 'Empowered Monster will create walls of Blackfire, which deal Fire Damage', 'Creates walls of blackfire'],
  ['Murderous', 'Summons malign crows', 'Empowered Monster will continually spawn malignant crows, which linger', 'Summons malignant crows'],
  ['Murderous', 'Summons malignant cro', 'Empowered Monster will continually spawn malignant crows, which linger', 'Summons malignant crows'],
])('reads one truncated word of %s only when its named tooltip repeats the phrase', (name, partial, tooltip, complete) => {
  const row = countedLines.map(l => l.text === 'Wildfire' ? { ...l, text: name }
    : l.text === 'Murderous' ? { ...l, text: 'Alchemist' }
    : l.text === 'Creates walls Of blackfire.' ? { ...l, text: partial } : l)
  const title = line(name, 4, 17), body = { ...line(tooltip, 4, 49), width: 400 }
  const read = (extra: typeof row, cards = row) => readCounted([...cards, ...extra])[1][1]
  expect(read([title, body])).toBe(complete)
  expect(read([body])).toBe(partial)
  expect(read([{ ...title, text: 'Conjurer' }, body])).toBe(partial)
  expect(read([title, { ...body, text: 'Empowered Monster will cast blackfire and summon crows' }])).toBe(partial)
  expect(read([title, { ...body, x: 250 }])).toBe(partial)
  expect(read([title, body], row.map(l => l.text === 'Alchemist' ? { ...l, text: name } : l))).toBe(partial)
  for (const changed of ['Creates walls of', 'Creates walls of 2', 'Creates walls of blood', 'Creates 3 walls of bl']) {
    expect(read([title, body], row.map(l => l.text === partial ? { ...l, text: changed } : l))).toBe(changed)
  }
})

test('repairs isolated glyph errors but preserves missing words, quantities and alternate catalog words', () => {
  const change = (text: string) => readCounted(countedLines.map(l =>
    l.text === 'Creates walls Of blackfire.' ? { ...l, text } : l))[1][1]
  expect(change('Creates walls of bhckfire')).toBe('Creates walls of blackfire')
  for (const text of ['Creates of blackfire', 'Creates 2 walls of blackfire', 'Creates walls on blackfire']) {
    expect(change(text)).toBe(text)
  }
})

test.each([
  ['Crowkeeper', '—Crowkeeper', 'Releases n •s of crow proj', 'Releases novas of crow projectiles',
    'Empowered Monster will regularly release novas of Crow Projectiles', 'Releases n •s of crow hands'],
  ['Rot', 'Rotted', 'Cursed reomsticks sweep ac the area', 'Cursed broomsticks sweep across the area',
    'Empowered Monster summons forth cursed broomsticks, which fly in a straight line', 'Cursed reomsticks sweep 2 the area'],
])('corroborates two damaged fragments of %s only with matching card and tooltip evidence',
  (name, tooltip, raw, expected, phrase, conflict) => {
    const title = line(tooltip, 4, 17)
    const body = { ...line(phrase, tooltip.startsWith('—') ? 35 : 4, 49), width: 400 }
    const read = (text: string, extra: typeof countedLines) => readCounted([...countedLines.map(l =>
      l.text === 'Wildfire' ? { ...l, text: name } :
      l.text === 'Creates walls Of blackfire.' ? { ...l, text } : l), ...extra])[1][1]
    expect(read(raw, [title, body])).toBe(expected)
    expect(read(conflict, [title, body])).toBe(conflict)
    expect(read(raw, [body])).toBe(raw)
    expect(read(raw, [title, { ...body, text: 'Empowered Monster will drop additional Threads' }])).toBe(raw)
    expect(read(raw, [title, { ...body, x: 200 }])).toBe(raw)
  })
