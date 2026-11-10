import { findOfferedRegion, knownFateName } from './recognition'
import type { Capture } from './schema'
import catalog from './visual-templates.json' with { type: 'json' }

export const VISUAL_VERSION = 'browser-v1'
const MAX_PIXELS = 16_777_216
const MAX_SIDE = 8192
const MAX_HEADERS = 8
const PROPOSAL_SCORE = 0.72
const MIN_SCORE = 0.86
const MIN_MARGIN = 0.07

export interface VisualBox {
  x: number
  y: number
  width: number
  height: number
}

export interface VisualSymbol {
  visualId: string
  box: VisualBox
  /** RGB similarity and distance from the runner-up class. Neither is a probability. */
  score: number
  margin: number
}

export interface VisualCard {
  name: string
  header: VisualBox
  tier: 2 | 3 | null
  symbols: VisualSymbol[]
}

export interface VisualAnalysis {
  version: string
  status: 'candidates' | 'unavailable' | 'unsupported'
  cards: VisualCard[]
  warnings: string[]
}

interface Input {
  width: number
  height: number
  data: Uint8ClampedArray
  ocr: Capture['ocr']
  frameHeight?: number
}

type Family = 'tier' | 'reward'
type Point = { x: number; y: number }
type Match = VisualSymbol & { tier: VisualCard['tier'] }
type PixelArray = Uint8Array | Uint8ClampedArray | Float32Array

const box = (x: number, y: number, width: number, height: number): VisualBox => ({ x, y, width, height })
const right = (value: VisualBox) => value.x + value.width
const bottom = (value: VisualBox) => value.y + value.height
const center = (value: VisualBox): Point => ({ x: value.x + value.width / 2, y: value.y + value.height / 2 })
const inside = (value: VisualBox, width: number, height: number) =>
  value.x >= 0 && value.y >= 0 && right(value) <= width && bottom(value) <= height
const intersection = (a: VisualBox, b: VisualBox) =>
  Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y))

function measure(pixels: PixelArray) {
  let total = 0
  let squares = 0
  let saturation = 0
  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    total += r + g + b
    squares += r * r + g * g + b * b
    const high = Math.max(r, g, b)
    saturation += (high - Math.min(r, g, b)) / (high + 12.75)
  }
  return { pixels, mean: total / pixels.length, squares, saturation: saturation * 3 / pixels.length }
}

const references = catalog.templates.map(entry => {
  const [, , width, height] = entry.box
  const rgb = Uint8Array.from(atob(entry.rgbBase64), character => character.charCodeAt(0))
  const tier: VisualCard['tier'] = entry.tier === 2 || entry.tier === 3 ? entry.tier : null
  return { family: entry.family, visualId: entry.visualId, tier, width, height, rgb, saturation: measure(rgb).saturation }
})

function resample(pixels: PixelArray, stride: number, channels: number, region: VisualBox, width: number, height: number) {
  const sampled = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, (y + 0.5) * region.height / height - 0.5)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, region.height - 1)
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, (x + 0.5) * region.width / width - 0.5)
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, region.width - 1)
      const fx = sx - x0
      const a = ((region.y + y0) * stride + region.x + x0) * channels
      const b = a + (x1 - x0) * channels
      const c = a + (y1 - y0) * stride * channels
      const d = c + (x1 - x0) * channels
      const destination = (y * width + x) * 3
      for (let k = 0; k < 3; k++) {
        const top = pixels[a + k] * (1 - fx) + pixels[b + k] * fx
        const base = pixels[c + k] * (1 - fx) + pixels[d + k] * fx
        sampled[destination + k] = top * (1 - fy) + base * fy
      }
    }
  }
  return sampled
}

function comparisonPatch(pixels: PixelArray, stride: number, channels: number, region: VisualBox, width: number, height: number) {
  // Use the same available resolution for both sides before comparing RGB values.
  const native = resample(pixels, stride, channels, region, width, height)
  return measure(resample(native, width, 3, box(0, 0, width, height), 24, 24))
}

function similarity(a: ReturnType<typeof measure>, b: ReturnType<typeof measure>) {
  let product = 0
  for (let i = 0; i < a.pixels.length; i++) product += a.pixels[i] * b.pixels[i]
  const size = a.pixels.length
  const denominator = Math.sqrt(Math.max(0, a.squares - size * a.mean ** 2) * Math.max(0, b.squares - size * b.mean ** 2))
  if (denominator < 1e-8) return 0
  const shape = (product - size * a.mean * b.mean) / denominator
  const colour = Math.max(0, 1 - 2 * Math.sqrt(Math.max(0, (a.squares + b.squares - 2 * product) / size)) / 255)
  return Math.min(1, 0.8 * shape + 0.2 * colour)
}

const gray = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
const GRID_SIDE = 9

function prepare(family: Family, scale: number) {
  return references.filter(reference => reference.family === family).map(reference => {
    const source = box(0, 0, reference.width, reference.height)
    const width = Math.round(reference.width * scale)
    const height = Math.round(reference.height * scale)
    const sampleWidth = Math.min(24, reference.width, width)
    const sampleHeight = Math.min(24, reference.height, height)
    const rgb = resample(reference.rgb, reference.width, 3, source, width, height)
    const samples = []
    for (let y = 0; y < GRID_SIDE; y++) {
      for (let x = 0; x < GRID_SIDE; x++) {
        const dx = Math.floor((x + 0.5) * width / GRID_SIDE)
        const dy = Math.floor((y + 0.5) * height / GRID_SIDE)
        const i = (dy * width + dx) * 3
        samples.push({ dx, dy, value: gray(rgb[i], rgb[i + 1], rgb[i + 2]) })
      }
    }
    const mean = samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length
    for (const sample of samples) sample.value -= mean
    return { ...reference, width, height, sampleWidth, sampleHeight, samples,
      norm: Math.sqrt(samples.reduce((sum, sample) => sum + sample.value ** 2, 0)),
      patch: comparisonPatch(reference.rgb, reference.width, 3, source, sampleWidth, sampleHeight) }
  })
}

function fraction(input: Input, region: VisualBox, step: number, predicate: (r: number, g: number, b: number) => boolean) {
  let total = 0
  let matched = 0
  for (let y = region.y; y < bottom(region); y += step) {
    for (let x = region.x; x < right(region); x += step) {
      const i = (y * input.width + x) * 4
      total++
      if (input.data[i + 3] === 255 && predicate(input.data[i], input.data[i + 1], input.data[i + 2])) matched++
    }
  }
  return total ? matched / total : 0
}

function tooltipMasks(input: Input, scale: number, lines: Capture['ocr']['lines']) {
  const seeds = lines.filter(line => /empowered|to claim|number of feathers/i.test(line.text))
  if (seeds.length > 24) return null
  const masks: VisualBox[] = []
  for (const seed of seeds) {
    // Grow a vertically connected OCR block from the seed, including its title.
    const aligned = lines.filter(line => Math.abs(line.x - seed.x) <= 14 * scale)
      .sort((a, b) => center(a).y - center(b).y)
    let first = aligned.indexOf(seed)
    let last = first
    const adjacent = (a: VisualBox, b: VisualBox) =>
      center(b).y - center(a).y <= Math.max(55 * scale, 3 * Math.max(a.height, b.height))
    while (first > 0 && adjacent(aligned[first - 1], aligned[first])) first--
    while (last < aligned.length - 1 && adjacent(aligned[last], aligned[last + 1])) last++
    const block = aligned.slice(first, last + 1)
    const x = Math.max(0, Math.floor(Math.min(...block.map(line => line.x)) - 10 * scale))
    const y = Math.max(0, Math.floor(Math.min(...block.map(line => line.y)) - 10 * scale))
    const r = Math.min(input.width, Math.ceil(Math.max(...block.map(right)) + 10 * scale))
    const b = Math.min(input.height, Math.ceil(Math.max(...block.map(bottom)) + 10 * scale))
    const region = box(x, y, r - x, b - y)
    if (region.width < 200 * scale || region.height > 400 * scale) continue
    if (masks.some(mask => intersection(mask, region) >= 0.8 * region.width * region.height)) continue
    if (fraction(input, region, Math.max(2, Math.round(3 * scale)), (r, g, b) => Math.max(r, g, b) < 32) >= 0.6) masks.push(region)
  }
  return masks
}

function classify(input: Input, region: VisualBox, bank: ReturnType<typeof prepare>) {
  const { sampleWidth, sampleHeight, family } = bank[0]
  const patch = comparisonPatch(input.data, input.width, 4, region, sampleWidth, sampleHeight)
  const choices = new Map<string, { reference: typeof bank[number]; score: number }>()
  for (const reference of bank) {
    const score = similarity(patch, reference.patch)
    if (score > (choices.get(reference.visualId)?.score ?? -Infinity)) choices.set(reference.visualId, { reference, score })
  }
  const [first, second] = [...choices.values()].sort((a, b) => b.score - a.score)
  const { reference, score } = first
  const margin = second ? score - second.score : 0
  const colourMissing = family === 'reward' && reference.saturation >= 0.12
    && patch.saturation < Math.max(0.08, reference.saturation * 0.5)
  const match: Match = { visualId: reference.visualId, tier: reference.tier, box: region, score, margin }
  return { match, accepted: score >= MIN_SCORE && margin >= MIN_MARGIN && !colourMissing }
}

function search(input: Input, area: VisualBox, bank: ReturnType<typeof prepare>, scale: number, masks: VisualBox[]): Match[] {
  const { width, height, family } = bank[0]
  const x0 = Math.ceil(area.x)
  const y0 = Math.ceil(area.y)
  const x1 = Math.floor(right(area))
  const y1 = Math.floor(bottom(area))
  const span = x1 - x0 + width
  const grayPixels = new Float32Array(span * (y1 - y0 + height))
  for (let y = y0; y < y1 + height; y++) {
    for (let x = x0; x < x1 + width; x++) {
      const i = (y * input.width + x) * 4
      grayPixels[(y - y0) * span + x - x0] = gray(input.data[i], input.data[i + 1], input.data[i + 2])
    }
  }
  const tileWidth = Math.max(1, Math.floor(width / 2))
  const tileHeight = Math.max(1, Math.floor(height / 2))
  const step = Math.max(1, Math.floor(scale))
  const proposals = new Map<string, Point>()
  for (const reference of bank) {
    const samples = reference.samples.map(sample => ({ index: sample.dy * span + sample.dx, value: sample.value }))
    const peaks = new Map<string, Point & { score: number }>()
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const offset = (y - y0) * span + x - x0
        let sum = 0
        let squares = 0
        let product = 0
        for (const sample of samples) {
          const value = grayPixels[offset + sample.index]
          sum += value
          squares += value * value
          product += sample.value * value
        }
        if (product <= 0) continue
        const denominator = reference.norm * Math.sqrt(Math.max(0, squares - sum * sum / samples.length))
        if (denominator < 1e-8) continue
        const score = product / denominator
        if (score < PROPOSAL_SCORE) continue
        const tile = `${Math.floor((x - x0) / tileWidth)}:${Math.floor((y - y0) / tileHeight)}`
        if (score > (peaks.get(tile)?.score ?? -Infinity)) peaks.set(tile, { x, y, score })
      }
    }
    // Fixed-size areas and tiles bound the proposal count, including repeated icons.
    for (const point of peaks.values()) proposals.set(`${point.x}:${point.y}`, point)
  }
  const allowed = (patch: VisualBox) => inside(patch, input.width, input.height)
    && !masks.some(mask => intersection(patch, mask))
    && fraction(input, patch, 1, () => true) === 1
  const matches: Match[] = []
  for (const point of proposals.values()) {
    const patch = box(point.x, point.y, width, height)
    if (!allowed(patch)) continue
    const result = classify(input, patch, bank)
    if (result.accepted) {
      matches.push(result.match)
    } else if (family === 'reward' && result.match.score >= MIN_SCORE - 0.08) {
      // Grayscale and RGB peaks can disagree by a pixel. Accept a local correction
      // only when all accepted alignments point to the same motif.
      const aligned: Match[] = []
      for (const dy of [-1, 0, 1]) {
        for (const dx of [-1, 0, 1]) {
          if (!dx && !dy || point.x + dx < x0 || point.x + dx > x1 || point.y + dy < y0 || point.y + dy > y1) continue
          const neighbor = box(point.x + dx, point.y + dy, width, height)
          if (!allowed(neighbor)) continue
          const alternative = classify(input, neighbor, bank)
          if (alternative.accepted) aligned.push(alternative.match)
        }
      }
      if (new Set(aligned.map(match => match.visualId)).size === 1) {
        matches.push(aligned.sort((a, b) => b.score - a.score)[0])
      }
    }
  }
  const overlaps = (a: Match, b: Match) => intersection(a.box, b.box) > 0.35 * width * height
  const distinct: Match[] = []
  for (const match of matches.sort((a, b) => b.score - a.score)) {
    if (distinct.some(previous => overlaps(previous, match))) continue
    if (matches.some(other => other.visualId !== match.visualId && overlaps(other, match))) continue
    distinct.push(match)
  }
  return distinct
}

/** Propose tiers and visual motifs for the OCR-bounded offered row. Coordinates use the PNG's own pixel space. */
export function analyzeVisualCapture(input: Input): VisualAnalysis {
  const stop = (status: 'unsupported' | 'unavailable', warning: string): VisualAnalysis =>
    ({ version: VISUAL_VERSION, status, cards: [], warnings: [warning] })
  const { width, height, ocr } = input
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS || input.data.length !== width * height * 4) {
    return stop('unsupported', 'Decoded screenshot dimensions are unavailable or exceed visual recognition limits.')
  }
  if (ocr.status !== 'ok' || !ocr.lines.length) return stop('unavailable', 'Positioned OCR is unavailable.')
  if (ocr.lines.length > 500) return stop('unsupported', 'Too many OCR lines for visual recognition.')
  const frameHeight = input.frameHeight ?? (width * 9 === height * 16 ? height : undefined)
  if (frameHeight === undefined) return stop('unavailable', 'Full-frame height is unavailable for the screenshot crop.')
  if (!Number.isInteger(frameHeight) || frameHeight < height || frameHeight < 540 || frameHeight > 2160) {
    return stop('unsupported', 'The screenshot scale is outside the supported range.')
  }
  const scale = frameHeight / 1080
  const lines = ocr.lines.filter(line => line.width > 0 && line.height > 0 && inside(line, width, height))
  const region = findOfferedRegion({ image: { width, height }, ocr: { ...ocr, lines } })
  if (!region) return stop('unsupported', 'The offered-card area could not be established.')
  const headers = region.headers.flatMap(line => {
    const name = knownFateName(line.text)
    return name && line.width <= 180 * scale && line.height <= 30 * scale ? [{ line, name }] : []
  })
  if (!headers.length || headers.length > MAX_HEADERS) return stop('unsupported', 'Supported offered card headers could not be established.')
  const masks = tooltipMasks(input, scale, lines)
  if (!masks) return stop('unsupported', 'The screenshot has too much possible tooltip text.')
  const tiers = prepare('tier', scale)
  const rewards = prepare('reward', scale)
  const warnings = new Set<string>()
  const anchored: { card: VisualCard; rewardRegion: VisualBox }[] = []
  for (const { line, name } of headers) {
    const { x, y, width: w, height: h } = line
    const header = box(x, y, w, h)
    if (masks.some(mask => intersection(mask, header))) {
      warnings.add('A tooltip obscures an offered card header.')
      continue
    }
    const middle = center(header)
    // Geometry from the visual prototype. OCR centers the search, a matched feather
    // gives the card's own origin and accounts for a raised selected card.
    const estimate = { x: middle.x - 72 * scale, y: middle.y + 28 * scale }
    const featherArea = box(estimate.x - 25 * scale, estimate.y - 18 * scale, 50 * scale, 36 * scale)
    const featherFootprint = box(featherArea.x, featherArea.y, featherArea.width + tiers[0].width, featherArea.height + tiers[0].height)
    if (!inside(featherFootprint, width, region.bottom)) {
      warnings.add('An offered card is clipped before its feather area.')
      continue
    }
    const feathers = search(input, featherArea, tiers, scale, masks)
    if (feathers.length > 1) {
      warnings.add('Conflicting feather locations obscure an offered card anchor.')
      continue
    }
    const feather = feathers[0]
    if (!feather) {
      const parchment = box(Math.floor(middle.x - 75 * scale), Math.floor(middle.y - 14 * scale),
        Math.round(150 * scale), Math.round(28 * scale))
      if (!inside(parchment, width, height) || masks.some(mask => intersection(mask, parchment))
        || fraction(input, parchment, Math.max(1, Math.round(2 * scale)),
          (r, g, b) => r > 80 && r > g && g > b * 1.08) < 0.45) continue
    }
    const anchor = feather?.box ?? estimate
    anchored.push({
      card: { name, header, tier: feather?.tier ?? null, symbols: [] },
      rewardRegion: box(anchor.x - 14 * scale, anchor.y + 208 * scale, 180 * scale, 42 * scale),
    })
  }
  if (!anchored.length) return stop('unsupported', warnings.values().next().value ?? 'No offered card had a supported pixel anchor.')
  for (const { card, rewardRegion } of anchored) {
    const { width: w, height: h } = rewards[0]
    const footprint = box(rewardRegion.x - w / 2, rewardRegion.y - h / 2, rewardRegion.width + w, rewardRegion.height + h)
    if (!inside(footprint, width, region.bottom)) {
      warnings.add('An offered card reward area is clipped.')
      continue
    }
    if (masks.some(mask => intersection(mask, footprint))) {
      warnings.add('A tooltip obscures an offered card reward area.')
      continue
    }
    if (anchored.some(other => other.card !== card && intersection(other.rewardRegion, rewardRegion))) {
      warnings.add('Overlapping reward areas could not be assigned to individual cards.')
      continue
    }
    const area = box(footprint.x, footprint.y, rewardRegion.width, rewardRegion.height)
    card.symbols = search(input, area, rewards, scale, masks).sort((a, b) => a.box.x - b.box.x)
      .map(({ visualId, box, score, margin }) => ({ visualId, box, score, margin }))
  }
  warnings.add('Only supported motifs and tiers are proposed. Missing evidence leaves the card details unknown.')
  return { version: VISUAL_VERSION, status: 'candidates', cards: anchored.map(entry => entry.card), warnings: [...warnings] }
}
