import type { CaptureUpload, FateCard } from './schema'
import { newCard } from './offers'
import fateNames from './fate-names.json' with { type: 'json' }

export const PARSER_VERSION = 'prerelease-names-1'

// Card names observed in pre-release materials. This is a recognition dictionary,
// not a reward mapping or an exhaustive catalog. Unknowns remain in the OCR evidence.
export const KNOWN_FATE_NAMES = fateNames
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '')
const byName = new Map(KNOWN_FATE_NAMES.map(name => [normalize(name), name]))

export function extractCards(capture: Pick<CaptureUpload, 'image' | 'ocr'>): { cards: FateCard[]; message: string } {
  if (capture.ocr.status !== 'ok' || !capture.ocr.lines.length) {
    return { cards: [], message: 'No positioned OCR is available. The screenshot is preserved; add cards only if you want to review it now.' }
  }
  const matches = capture.ocr.lines.flatMap(line => {
    const name = byName.get(normalize(line.text))
    return name && line.height > 0 ? [{ ...line, name }] : []
  }).sort((a, b) => a.y - b.y)
  if (!matches.length) return { cards: [], message: 'No known Fate names were found. Keep this capture for a later recognition update, or add cards manually.' }
  // The offer row is above the existing deck. A selected card can be raised a
  // little; group near the topmost header rather than matching every known name.
  const first = matches[0]
  const row = matches.filter(m => m.y - first.y <= Math.max(first.height * 4, capture.image.height * 0.06))
    .sort((a, b) => a.x - b.x)
  const headerBottom = Math.max(...row.map(m => m.y + m.height))
  const nextRow = matches.find(m => m.y > headerBottom + first.height * 4)
  const bottom = nextRow ? nextRow.y - first.height : capture.image.height
  const cards = row.map((header, index) => {
    const center = header.x + header.width / 2
    const previous = row[index - 1]
    const next = row[index + 1]
    const left = previous ? (previous.x + previous.width / 2 + center) / 2 : 0
    const right = next ? (next.x + next.width / 2 + center) / 2 : capture.image.width
    const description = capture.ocr.lines.filter(line => {
      const x = line.x + line.width / 2
      return line.y > headerBottom + first.height && line.y < bottom && x > left && x < right
        && !/^(confirm|select a fate|fates)$/i.test(line.text.trim())
        && line.text.trim().length > 2
    }).sort((a, b) => a.y - b.y || a.x - b.x).map(line => line.text.trim()).join(' ')
    return { ...newCard(), name: header.name, modifiers: description ? [description.slice(0, 1000)] : [] }
  })
  return { cards, message: `${cards.length} candidate ${cards.length === 1 ? 'card' : 'cards'} found. Check against the screenshot. Tiers and reward icons are not identified automatically.` }
}
