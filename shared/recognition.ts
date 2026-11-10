import type { CaptureUpload, FateCard } from './schema'
import { newCard } from './offers'
import fateNames from './fate-names.json' with { type: 'json' }

export const PARSER_VERSION = 'prerelease-names-3'

// Card names observed in pre-release materials. This is a recognition dictionary,
// not a reward mapping or an exhaustive catalog. Unknowns remain in the OCR evidence.
export const KNOWN_FATE_NAMES = fateNames
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '')
const byName = new Map(KNOWN_FATE_NAMES.map(name => [normalize(name), name]))
export const knownFateName = (text: string): string | undefined => byName.get(normalize(text))
type OcrLine = CaptureUpload['ocr']['lines'][number]
const centerX = (line: OcrLine) => line.x + line.width / 2
const alignedControls = (a: OcrLine, b: OcrLine) =>
  Math.abs(centerX(a) - centerX(b)) <= Math.max(a.width, b.width) / 2

export function findOfferedRegion(capture: Pick<CaptureUpload, 'image' | 'ocr'>): { lines: CaptureUpload['ocr']['lines']; headers: CaptureUpload['ocr']['lines']; bottom: number } | null {
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
  if (invocation || panels.length !== 1) return null
  const { heading, confirm } = panels[0]
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

export function extractCards(capture: Pick<CaptureUpload, 'image' | 'ocr'>): { cards: FateCard[]; message: string } {
  if (capture.ocr.status !== 'ok' || !capture.ocr.lines.length) {
    return { cards: [], message: 'No positioned OCR is available. The screenshot is preserved; add cards only if you want to review it now.' }
  }
  const region = findOfferedRegion(capture)
  if (!region) return { cards: [], message: 'The offered-card area could not be established. Include the Fates heading and Confirm button in the capture, or add cards manually.' }
  const { lines: offerLines, headers: row } = region
  const first = offerLines[0]
  if (!first) return { cards: [], message: 'No card text was read in the offered area. The screenshot is preserved for review.' }
  const headerBottom = Math.max(...row.map(m => m.y + m.height))
  const cards = row.flatMap((header, index) => {
    const name = byName.get(normalize(header.text))
    if (!name) return []
    const center = header.x + header.width / 2
    const previous = row[index - 1]
    const next = row[index + 1]
    const left = previous ? (previous.x + previous.width / 2 + center) / 2 : 0
    const right = next ? (next.x + next.width / 2 + center) / 2 : capture.image.width
    const description = offerLines.filter(line => {
      const x = line.x + line.width / 2
      return line.y > headerBottom + first.height && x > left && x < right
        && !/^(confirm|select a fate|fates)$/i.test(line.text.trim())
        && line.text.trim().length > 2
    }).sort((a, b) => a.y - b.y || a.x - b.x).map(line => line.text.trim()).join(' ')
    return [{ ...newCard(), name, modifiers: description ? [description.slice(0, 1000)] : [] }]
  })
  if (!cards.length) return { cards: [], message: 'No known Fate names were found in the offered row. Keep this capture for a later recognition update, or add cards manually.' }
  return { cards, message: `${cards.length} candidate ${cards.length === 1 ? 'card' : 'cards'} found. Check against the screenshot. Tiers and reward icons are not identified automatically.` }
}
