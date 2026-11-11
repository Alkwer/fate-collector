import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { expect, test } from 'vitest'
import type { Capture } from '../shared/schema'
import { analyzeVisualCapture, type VisualBox } from '../shared/visual-recognition'
import catalog from '../shared/visual-templates.json'
import presskitOcr from './fixtures/presskit-ocr.json'
import presentationOcr from './fixtures/presentation-ocr.json'

const fixture = (path: string) => new URL(`../prototypes/vision/fixtures/${path}`, import.meta.url)
const digest = (contents: Buffer) => createHash('sha256').update(contents).digest('hex')

function loadFixture(path: string) {
  // The checked-in press images are 8-bit, non-interlaced RGB PNG. Keep the
  // decoder scoped to this fixture format and use Node's existing inflater.
  const png = readFileSync(fixture(path))
  expect(digest(png)).toBe(catalog.sources[path as keyof typeof catalog.sources])
  expect([...png.subarray(24, 29)]).toEqual([8, 2, 0, 0, 0])
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const chunks: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset)
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size))
    offset += 12 + size
  }
  const bytes = inflateSync(Buffer.concat(chunks))
  const data = new Uint8ClampedArray(width * height * 4)
  const rgb = new Uint8Array(width * height * 3)
  const stride = width * 3
  for (let y = 0; y < height; y++) {
    const filter = bytes[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const pos = y * stride + x
      const a = x >= 3 ? rgb[pos - 3] : 0
      const b = y ? rgb[pos - stride] : 0
      const c = y && x >= 3 ? rgb[pos - stride - 3] : 0
      const estimate = a + b - c
      const da = Math.abs(estimate - a)
      const db = Math.abs(estimate - b)
      const dc = Math.abs(estimate - c)
      const predictors = [0, a, b, Math.floor((a + b) / 2), da <= db && da <= dc ? a : db <= dc ? b : c]
      rgb[pos] = bytes[y * (stride + 1) + x + 1] + predictors[filter]
      data[pos + Math.floor(pos / 3)] = rgb[pos]
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  return { width, height, data }
}

type Image = ReturnType<typeof loadFixture>
const press = loadFixture('images/press-offer-b.png')
const pressOcr: Capture['ocr'] = {
  ...presskitOcr,
  status: 'ok',
  lines: presskitOcr.lines.map(({ text, x, y, width, height }) => ({ text, x: x / 2, y: y / 2, width: width / 2, height: height / 2 })),
}
const names = ['Torchbearer', 'Tempest', 'Stormcaller', 'Houndmaster']
const symbols = [['gold-ring'], ['silver-cluster', 'orange-feathers', 'gold-ring'], ['three-gems'], ['gold-axe']]

function cropImage(image: Image, { x, y, width, height }: VisualBox): Image {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 4
    data.set(image.data.subarray(start, start + width * 4), row * width * 4)
  }
  return { width, height, data }
}

test.each(['offer-a', 'offer-b', 'offer-a-panel', 'offer-b-panel'] as const)('matches presentation pixels with fresh OCR: %s', name => {
  const capture = presentationOcr.cases[name]
  expect(digest(readFileSync(new URL(`../${capture.source}`, import.meta.url)))).toBe(capture.sourceSha256)
  const full = loadFixture(`images/press-${name.startsWith('offer-a') ? 'offer-a' : 'offer-b'}.png`)
  const image = capture.crop ? cropImage(full, capture.crop) : full
  expect([image.width, image.height]).toEqual([capture.image.width, capture.image.height])
  const result = analyzeVisualCapture({ ...image, frameHeight: capture.image.frameHeight, ocr: { ...capture.ocr, status: 'ok' } })
  expect(result.status).toBe('candidates')
  expect(result.cards.map(card => card.name)).toEqual(name.startsWith('offer-a') ? ['Alchemist', 'Sanguine', 'Butcher', 'Gravewalker'] : names)
  expect(result.cards.map(card => card.tier)).toEqual([2, 2, 2, 2])
  expect(result.cards.map(card => card.symbols.map(symbol => symbol.visualId))).toEqual(name.startsWith('offer-a')
    ? [['blue-diamond', 'gold-stack'], ['gold-grid', 'blue-diamond'], ['blue-diamond'], ['blue-diamond', 'gold-ring']] : symbols)
})

function scaleImage(image: Image, scale: 0.5 | 2): Image {
  const width = image.width * scale
  const height = image.height * scale
  const data = new Uint8ClampedArray(width * height * 4)
  const block = scale === 0.5 ? 2 : 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const source = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4
      for (let channel = 0; channel < 4; channel++) {
        const sample = source + channel
        data[i + channel] = block === 1 ? image.data[sample]
          : (image.data[sample] + image.data[sample + 4]
            + image.data[sample + image.width * 4] + image.data[sample + image.width * 4 + 4]) / 4
      }
    }
  }
  return { width, height, data }
}

test('reads offered cards and motifs on a real press image without assigning the collected Torchbearer', () => {
  const result = analyzeVisualCapture({ ...press, ocr: pressOcr })
  expect(result.version).toBe('browser-v1')
  expect(result.status).toBe('candidates')
  expect(result.cards.map(card => card.name)).toEqual(names)
  expect(result.cards.map(card => card.tier)).toEqual([2, 2, 2, 2])
  expect(result.cards.map(card => card.symbols.map(symbol => symbol.visualId))).toEqual(symbols)
  expect(result.cards[0].symbols[0]).toMatchObject({ box: { x: 610, y: 509, width: 24, height: 24 }, score: 1 })
  for (const card of result.cards) {
    for (const symbol of card.symbols) {
      expect(symbol.score).toBeGreaterThanOrEqual(0.86)
      expect(symbol.margin).toBeGreaterThanOrEqual(0.07)
      expect(symbol).not.toHaveProperty('probability')
    }
  }
})

test('reports screenshot-local coordinates after cropping the same press pixels and OCR', () => {
  const x = 489
  const y = 143
  const image = cropImage(press, { x, y, width: 924, height: 464 })
  const ocr = { ...pressOcr, lines: pressOcr.lines.map(line => ({ ...line, x: line.x - x, y: line.y - y })) }
  const full = analyzeVisualCapture({ ...press, ocr: pressOcr })
  const cropped = analyzeVisualCapture({ ...image, ocr, frameHeight: press.height })
  expect(cropped).toEqual({ ...full, cards: full.cards.map(card => ({
    ...card, header: { ...card.header, x: card.header.x - x, y: card.header.y - y },
    symbols: card.symbols.map(symbol => ({ ...symbol, box: { ...symbol.box, x: symbol.box.x - x, y: symbol.box.y - y } })),
  })) })
  expect(analyzeVisualCapture({ ...image, ocr })).toMatchObject({ status: 'unavailable', cards: [] })
})

test.each([0.5, 2] as const)('uses frame scale for press pixels resampled to %sx', scale => {
  const image = scaleImage(press, scale)
  const ocr = { ...pressOcr, lines: pressOcr.lines.map(({ text, x, y, width, height }) =>
    ({ text, x: x * scale, y: y * scale, width: width * scale, height: height * scale })) }
  const result = analyzeVisualCapture({ ...image, ocr })
  expect(result.status).toBe('candidates')
  expect(result.cards.map(card => card.name)).toEqual(names)
  expect(result.cards.map(card => card.tier)).toEqual([2, 2, 2, 2])
  expect(result.cards.map(card => card.symbols.map(symbol => symbol.visualId))).toEqual(symbols)
})

test.each(['Fates', 'CONFIRM'])('abstains without the real offer boundary %s', marker => {
  expect(analyzeVisualCapture({ ...press, ocr: { ...pressOcr, lines: pressOcr.lines.filter(line => line.text !== marker) } }))
    .toMatchObject({ status: 'unsupported', cards: [] })
})

test('abstains for malformed dimensions, missing OCR, and unsupported scale', () => {
  expect(analyzeVisualCapture({ ...press, data: new Uint8ClampedArray(1), ocr: pressOcr })).toMatchObject({ status: 'unsupported', cards: [] })
  expect(analyzeVisualCapture({ ...press, ocr: { ...pressOcr, status: 'error' } })).toMatchObject({ status: 'unavailable', cards: [] })
  expect(analyzeVisualCapture({ ...press, ocr: pressOcr, frameHeight: 2500 })).toMatchObject({ status: 'unsupported', cards: [] })
  expect(analyzeVisualCapture({ ...press, ocr: pressOcr, frameHeight: 700 })).toMatchObject({ status: 'unsupported', cards: [] })
})

const line = (text: string, x: number, y: number, width: number, height = 14) => ({ text, x, y, width, height })

function scene() {
  const width = 760
  const height = 500
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  const ocr: Capture['ocr'] = {
    status: 'ok', language: 'en-US', text: '', lines: [
      line('Fates', 350, 30, 50), line('Confirm', 350, 440, 60),
      line('Torchbearer', 178, 98, 80), line('Torchbearer', 428, 118, 80),
    ],
  }
  return { width, height, data, ocr, frameHeight: 1080 }
}

function paint(image: Image, x: number, y: number, w: number, h: number, sample: (index: number) => number[]) {
  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      const i = ((row + y) * image.width + x + column) * 4
      image.data.set(sample((row * w + column) * 3), i)
    }
  }
}

function stamp(image: Image, id: string, x: number, y: number, grayscale = false) {
  const entry = catalog.templates.find(template => template.visualId === id)!
  const rgb = Buffer.from(entry.rgbBase64, 'base64')
  paint(image, x, y, entry.box[2], entry.box[3], i => {
    const [r, g, b] = rgb.subarray(i, i + 3)
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    return grayscale ? [gray, gray, gray] : [r, g, b]
  })
}

test('keeps tier and motifs independent for duplicate names, including repeated motifs', () => {
  const input = scene()
  stamp(input, 'tier-2', 146, 133)
  stamp(input, 'tier-3', 396, 153)
  stamp(input, 'gold-ring', 198, 351)
  stamp(input, 'gold-ring', 236, 351)
  stamp(input, 'blue-diamond', 444, 371)
  const pixels = input.data.slice()
  const ocr = structuredClone(input.ocr)
  const result = analyzeVisualCapture(input)
  expect(result.cards.map(card => [card.name, card.tier, card.symbols.map(s => s.visualId)])).toEqual([
    ['Torchbearer', 2, ['gold-ring', 'gold-ring']],
    ['Torchbearer', 3, ['blue-diamond']],
  ])
  expect(input.data).toEqual(pixels)
  expect(input.ocr).toEqual(ocr)
})

test('leaves unsupported tiers and desaturated symbols unknown, and ignores unknown names', () => {
  const input = scene()
  paint(input, 143, 91, 150, 28, () => [150, 124, 86])
  stamp(input, 'blue-diamond', 198, 350, true)
  stamp(input, 'tier-3', 396, 153)
  stamp(input, 'gold-ring', 444, 371)
  input.ocr.lines[3].text = 'Torchearer'
  expect(analyzeVisualCapture(input).cards).toEqual([
    { name: 'Torchbearer', tier: null, symbols: [], header: { x: 178, y: 98, width: 80, height: 14 } },
  ])
})

test('abstains when no pixels anchor a name or several feathers compete for one header', () => {
  const input = scene()
  expect(analyzeVisualCapture(input)).toMatchObject({ status: 'unsupported', cards: [] })
  paint(input, 143, 91, 150, 28, () => [150, 124, 86])
  stamp(input, 'tier-2', 127, 133)
  stamp(input, 'tier-3', 164, 133)
  stamp(input, 'gold-ring', 198, 351)
  expect(analyzeVisualCapture(input)).toMatchObject({
    status: 'unsupported', cards: [], warnings: [expect.stringMatching(/conflicting feather/i)],
  })
})

test('keeps translucent tooltip regions and clipped reward strips unknown', () => {
  const input = scene()
  stamp(input, 'tier-2', 146, 133)
  stamp(input, 'tier-3', 396, 153)
  stamp(input, 'gold-ring', 198, 351)
  stamp(input, 'gold-axe', 444, 371)
  input.ocr.lines.push(line('Empowered Monster tooltip title', 90, 326, 236), line('Requires more feathers to claim', 92, 345, 231))
  input.ocr.lines[1].y = 398
  const result = analyzeVisualCapture(input)
  expect(result.cards.map(card => [card.tier, card.symbols])).toEqual([[2, []], [3, []]])
  expect(result.warnings.join(' ')).toMatch(/tooltip/)
  expect(result.warnings.join(' ')).toMatch(/clipped/)
})

test('does not recognize invoked cards even if their geometry and symbols would fit', () => {
  const input = scene()
  stamp(input, 'tier-2', 146, 133)
  stamp(input, 'gold-ring', 198, 351)
  input.ocr.lines.push(line('Invoke Fates', 350, 9, 100))
  expect(analyzeVisualCapture(input)).toMatchObject({ status: 'unsupported', cards: [] })
})
