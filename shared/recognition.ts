import type { CaptureUpload, FateCard } from './schema'
import { newCard } from './offers.ts'
import fateNames from './fate-names.json' with { type: 'json' }
import screenshots from './screenshot-catalog.json' with { type: 'json' }

export const PARSER_VERSION = 'counted-offers-7'

// Card names from prerelease materials, live screenshots and the dated PoEDB catalog.
// This is a recognition dictionary,
// not a reward mapping or an exhaustive catalog. Unknowns remain in the OCR evidence.
export const KNOWN_FATE_NAMES = fateNames
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '')
const byName = new Map(KNOWN_FATE_NAMES.map(name => [normalize(name), name]))
export const knownFateName = (text: string): string | undefined => byName.get(normalize(text))
type OcrLine = CaptureUpload['ocr']['lines'][number]
const centerX = (line: OcrLine) => line.x + line.width / 2
const alignedControls = (a: OcrLine, b: OcrLine) =>
  Math.abs(centerX(a) - centerX(b)) <= Math.max(a.width, b.width) / 2
type OfferRegion = { lines: OcrLine[]; headers: OcrLine[]; bottom: number; columnPitch?: number }

function panelRows(lines: OcrLine[], axis: number, top: number, span: number, bottom: number, minimumKnown: number) {
  const pitch = span * .56
  const band = lines.filter(l => l.y >= top + .13 * span && l.y < top + .29 * span && l.width < pitch * .85)
  const matches: OfferRegion[] = []
  for (let count = minimumKnown; count <= 6; count++) {
    const row: OcrLine[] = []
    for (let slot = 0; slot < count; slot++) {
      const x = axis + (slot - (count - 1) / 2) * pitch
      const atSlot = band.filter(l => Math.abs(centerX(l) - x) < pitch * .15)
      if (atSlot.length !== 1) break
      row.push(atSlot[0])
    }
    if (row.length !== count || offeredCardHeaders(row).length !== count
      || row.filter(l => knownFateName(l.text)).length < minimumKnown) continue
    // A smaller grid embedded in a partial offer must not drop an unknown
    // outer slot. Keep the legacy partial-row path when both controls are visible.
    const hasOuterHeader = band.some(l => {
      if (row.includes(l)) return false
      if (knownFateName(l.text)) return true
      const offset = (centerX(l) - axis) / pitch
      const slot = offset + (count - 1) / 2
      return Math.abs(offset) < 2.65 && (slot < 0 || slot > count - 1) && Math.abs(slot - Math.round(slot)) < .15
        && offeredCardHeaders([...row, l]).includes(l)
    })
    if (hasOuterHeader) continue
    matches.push({ headers: row, bottom, columnPitch: pitch, lines: lines.filter(l => l.y > top && l.y + l.height < bottom) })
  }
  return matches
}

// The counter sits left of the central button. Header spacing, button offset and
// body positions scale with the panel, independently of the capture rectangle.
function countedOffer(lines: OcrLine[], headings: OcrLine[], confirms: OcrLine[]): OfferRegion | null {
  const counters = lines.filter(line => /^\d{1,2}\s*\/\s*\d{1,2}$/.test(line.text.trim()))
  const matches: OfferRegion[] = []
  for (const counter of counters) {
    const [current, total] = counter.text.split('/').map(Number)
    if (!total || current > total) continue
    const level = counter.y + counter.height / 2
    const nearbyButtons = confirms.filter(line => Math.abs(line.y + line.height / 2 - level) < counter.height
      && centerX(line) > centerX(counter) + 3 * counter.height && centerX(line) < centerX(counter) + 14 * counter.height)
    if (nearbyButtons.length > 1) continue
    const button = nearbyButtons[0]
    const titles = headings.filter(line => {
      const span = level - line.y
      const offset = centerX(line) - centerX(counter)
      return normalize(line.text) === 'fates' && span > 0 && offset > .25 * span && offset < .35 * span
    })
    if (titles.length > 1 || (!titles.length && !button)) continue
    const title = titles[0]
    if (title && button && !alignedControls(title, button)) continue
    const axis = centerX(title ?? button)
    const span = title ? level - title.y : (axis - centerX(counter)) / .30
    const top = level - span
    // A tooltip may mask the title. Require visible tooltip text across that
    // position and a complete, centered row of at least three named slots.
    if (!title && !lines.some(l => l.y >= top - .08 * span && l.y <= top + .09 * span
      && l.x < axis && l.x + l.width > axis && l.width > span * .56)) continue
    matches.push(...panelRows(lines, axis, top, span, button?.y ?? counter.y, title ? 2 : 3))
  }
  return matches.length === 1 ? matches[0] : null
}

export function findOfferedRegion(capture: Pick<CaptureUpload, 'image' | 'ocr'>): OfferRegion | null {
  if (capture.ocr.status !== 'ok' || !capture.ocr.lines.length) return null
  const lines = capture.ocr.lines.filter(line => line.x >= 0 && line.y >= 0 && line.width > 0 && line.height > 0
    && line.x + line.width <= capture.image.width && line.y + line.height <= capture.image.height)
  const headings = lines.filter(line => ['fates', 'selectafate'].includes(normalize(line.text)))
  const confirms = lines.filter(line => normalize(line.text) === 'confirm')
  // Windows OCR can split the invocation title into two adjacent lines.
  const invocation = lines.some(line => normalize(line.text) === 'invokefates'
    || (normalize(line.text) === 'invoke' && headings.some(heading => normalize(heading.text) === 'fates'
      && alignedControls(line, heading) && heading.y >= line.y
      && heading.y - (line.y + line.height) <= Math.max(line.height, heading.height) * 1.5)))
  // A world-space "Select a Fate" label can coexist with the actual Fates title.
  // Pair controls on their shared horizontal axis instead of counting every title
  // in the frame. Several aligned pairs remain ambiguous; never choose by names.
  const panels = headings.flatMap(heading => confirms
    .filter(confirm => heading.y + heading.height < confirm.y && alignedControls(heading, confirm))
    .map(confirm => ({ heading, confirm })))
  // Establish the offered region independently of the name dictionary. A known
  // card below Confirm must never replace unreadable or missing offered headers.
  if (invocation || panels.length > 1) return null
  const counted = countedOffer(lines, headings, confirms)
  if (counted) return counted
  if (panels.length !== 1) return null
  const { heading, confirm } = panels[0]
  const rows = panelRows(lines, centerX(heading), heading.y, confirm.y - heading.y, confirm.y, 2)
  if (rows.length === 1) return rows[0]
  const offerLines = lines.filter(line => line.y >= heading.y + heading.height
    && line.y + line.height < confirm.y && /[a-z]/i.test(line.text)
    && !['fates', 'selectafate', 'confirm'].includes(normalize(line.text))).sort((a, b) => a.y - b.y)
  const first = offerLines[0]
  if (!first) return { lines: offerLines, headers: [], bottom: confirm.y }
  // Anchor the header row to all text, including unknown names, before looking
  // up candidates. A selected card may be raised slightly above its neighbours.
  const row = offerLines.filter(m => m.y - first.y <= Math.max(first.height * 4, capture.image.height * 0.06))
    .sort((a, b) => a.x - b.x)
  return { lines: offerLines, headers: row, bottom: confirm.y }
}

// Correct case and OCR edge noise only if all words of a documented short
// description are present in its own column. Missing or different words stay raw.
const descriptionWords = (text: string) => text.toLowerCase().replace(/(?<!\d)[.,](?!\d)/g, '').replace(/\s+/g, ' ').trim()
const shortDescriptions = new Map(screenshots.fates.map(fate => [fate.name, [...new Set(fate.variants.map(v => v.shortDescription))]]))
function reviewedSpelling(name: string, text: string): string {
  const words = descriptionWords(text)
  return shortDescriptions.get(name)?.find(value => value && (descriptionWords(value) === words
    || (value.length >= 20 && /^[B-HJ-Z]\s/.test(text) && descriptionWords(value) === words.slice(2)))) ?? text
}

export function extractCards(capture: Pick<CaptureUpload, 'image' | 'ocr'>): { cards: FateCard[]; message: string } {
  if (capture.ocr.status !== 'ok' || !capture.ocr.lines.length) {
    return { cards: [], message: 'No positioned OCR is available. The screenshot is preserved; add cards only if you want to review it now.' }
  }
  const region = findOfferedRegion(capture)
  if (!region) return { cards: [], message: 'The offered-card area could not be established. Move the pointer away from the cards so tooltips clear the Fates heading, then capture both the heading and Confirm button. You can also add cards manually.' }
  const offerLines = region.lines, row = region.headers
  const candidates = new Set(offeredCardHeaders(row))
  const first = offerLines[0]
  if (!first) return { cards: [], message: 'No card text was read in the offered area. The screenshot is preserved for review.' }
  const headerBottom = Math.max(...row.map(m => m.y + m.height))
  const cards = row.flatMap((header, index) => {
    if (!candidates.has(header)) return []
    const name = byName.get(normalize(header.text))
    const center = header.x + header.width / 2
    const previous = row[index - 1]
    const next = row[index + 1]
    const left = previous ? (previous.x + previous.width / 2 + center) / 2 : 0
    const right = next ? (next.x + next.width / 2 + center) / 2 : capture.image.width
    const description = offerLines.filter(line => {
      const x = line.x + line.width / 2
      if (region.columnPitch) {
        const pitch = region.columnPitch
        return Math.abs(x - center) < pitch * .43 && line.width < pitch
          && line.y >= header.y + pitch * .62 && line.y < header.y + pitch * 1.23
          && /[a-z]/i.test(line.text)
      }
      return line.y > headerBottom + first.height && x > left && x < right
        && !/^(confirm|select a fate|fates)$/i.test(line.text.trim())
        && line.text.trim().length > 2
    }).sort((a, b) => a.y - b.y || a.x - b.x).map(line => line.text.trim()).join(' ')
    return [{ ...newCard(), name: name ?? '', modifiers: description ? [reviewedSpelling(name ?? '', description.slice(0, 1000))] : [] }]
  })
  if (!cards.length) return { cards: [], message: 'No known Fate names were found in the offered row. Keep this capture for a later recognition update, or add cards manually.' }
  return { cards, message: `${cards.length} candidate ${cards.length === 1 ? 'card' : 'cards'} found${cards.some(card => !card.name) ? ', including unknown headers' : ''}. Check coverage and names against the screenshot and original OCR. Tiers and reward icons are not identified automatically.` }
}

// Preserve unknown name slots only alongside a known anchor, with matching text
// size and a separate column. All-unknown/overlapping/body-text rows still abstain.
export function offeredCardHeaders(row: OcrLine[]): OcrLine[] {
  const known = row.filter(header => knownFateName(header.text))
  if (!known.length) return []
  return row.filter(header => {
    if (knownFateName(header.text)) return true
    if (row.length > 6 || !/^[A-Z][a-zA-Z’'-]+(?: [A-Z][a-zA-Z’'-]+){0,2}$/.test(header.text.trim())) return false
    if (!known.some(anchor => header.height >= anchor.height * .75 && header.height <= anchor.height * 1.35)) return false
    return row.every(other => other === header || header.x + header.width <= other.x || other.x + other.width <= header.x)
  })
}
