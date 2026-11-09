import type { CaptureUpload, FateCard } from './schema'
import { newCard } from './offers'
import fateNames from './fate-names.json' with { type: 'json' }

export const PARSER_VERSION = 'prerelease-names-2'

// Card names observed in pre-release materials. This is a recognition dictionary,
// not a reward mapping or an exhaustive catalog. Unknowns remain in the OCR evidence.
export const KNOWN_FATE_NAMES = fateNames
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '')
const byName = new Map(KNOWN_FATE_NAMES.map(name => [normalize(name), name]))

export function extractCards(capture: Pick<CaptureUpload, 'image' | 'ocr'>): { cards: FateCard[]; message: string } {
  if (capture.ocr.status !== 'ok' || !capture.ocr.lines.length) {
    return { cards: [], message: 'No positioned OCR is available. The screenshot is preserved; add cards only if you want to review it now.' }
  }
  const lines = capture.ocr.lines.filter(line => line.width > 0 && line.height > 0
    && line.x + line.width <= capture.image.width && line.y + line.height <= capture.image.height)
  const headings = lines.filter(line => ['fates', 'selectafate'].includes(normalize(line.text)))
  const confirms = lines.filter(line => normalize(line.text) === 'confirm')
  // Establish the offered region independently of the name dictionary. A known
  // card below Confirm must never replace unreadable or missing offered headers.
  if (headings.length !== 1 || confirms.length !== 1 || headings[0].y + headings[0].height >= confirms[0].y
    || lines.some(line => normalize(line.text) === 'invokefates')) {
    return { cards: [], message: 'The offered-card area could not be established. Include the Fates heading and Confirm button in the capture, or add cards manually.' }
  }
  const offerLines = lines.filter(line => line.y >= headings[0].y + headings[0].height
    && line.y + line.height < confirms[0].y && /[a-z]/i.test(line.text)).sort((a, b) => a.y - b.y)
  const first = offerLines[0]
  if (!first) return { cards: [], message: 'No card text was read in the offered area. The screenshot is preserved for review.' }
  // Anchor the header row to all text, including unknown names, before looking
  // up candidates. A selected card may be raised slightly above its neighbours.
  const row = offerLines.filter(m => m.y - first.y <= Math.max(first.height * 4, capture.image.height * 0.06))
    .sort((a, b) => a.x - b.x)
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
