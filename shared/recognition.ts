import type { CaptureUpload, FateCard } from './schema'
import { newCard } from './offers.ts'
import { normalizeFateName } from './fate-names.ts'
import fateNames from './fate-names.json' with { type: 'json' }
import screenshots from './screenshot-catalog.json' with { type: 'json' }

export const PARSER_VERSION = 'counted-offers-16'

// Card names from prerelease materials, live screenshots and the dated PoEDB catalog.
// This is a recognition dictionary,
// not a reward mapping or an exhaustive catalog. Unknowns remain in the OCR evidence.
export const KNOWN_FATE_NAMES = fateNames
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '')
const byName = new Map(KNOWN_FATE_NAMES.map(name => [normalize(name), name]))
export const knownFateName = (text: string): string | undefined => byName.get(normalize(text))
type OcrLine = CaptureUpload['ocr']['lines'][number]
type OfferHeader = OcrLine & { caption?: string; inferred?: boolean }
const centerX = (line: OcrLine) => line.x + line.width / 2
const alignedControls = (a: OcrLine, b: OcrLine) =>
  Math.abs(centerX(a) - centerX(b)) <= Math.max(a.width, b.width) / 2
type OfferRegion = { lines: OcrLine[]; headers: OfferHeader[]; bottom: number; columnPitch?: number }

function panelRows(lines: OcrLine[], axis: number, top: number, span: number, bottom: number, minimumKnown: number) {
  const pitch = span * .56
  const band = lines.filter(l => l.y >= top + .08 * span && l.y < top + .29 * span && l.width < pitch * .85
    && normalize(l.text) !== 'selectafate')
  const matches: OfferRegion[] = []
  for (let count = minimumKnown; count <= 6; count++) {
    const row: OcrLine[] = []
    for (let slot = 0; slot < count; slot++) {
      const x = axis + (slot - (count - 1) / 2) * pitch
      const atSlot = band.filter(l => Math.abs(centerX(l) - x) < pitch * .15)
      if (atSlot.length !== 1) break
      row.push(atSlot[0])
    }
    if (row.length !== count) continue
    const headers = row.map(header => {
      if (knownFateName(header.text)) return header
      const name = corroboratedName(header.text, columnDescription(lines, header, pitch, bottom))
      return name ? { ...header, text: name } : header
    })
    if (offeredCardHeaders(headers).length !== count) continue
    const identified = headers.filter(header => knownFateName(header.text))
    if (identified.length < minimumKnown) continue
    // A smaller grid embedded in a partial offer must not drop an unknown
    // outer slot. Keep the legacy partial-row path when both controls are visible.
    const hasOuterHeader = band.some(l => {
      if (row.includes(l)) return false
      const offset = (centerX(l) - axis) / pitch
      const slot = offset + (count - 1) / 2
      if (Math.abs(offset) >= 2.65) return false
      if (knownFateName(l.text)) return true
      // A wrapped quest objective can end in a capitalized place name on
      // the header baseline. Its preceding line shares the left margin
      // and extends beyond the width of a card.
      const wrapsSidebarText = lines.some(previous => previous.width > pitch
        && Math.abs(previous.x - l.x) <= l.height * .45
        && previous.y < l.y && Math.abs(l.y - previous.y - previous.height) <= l.height * .45
        && previous.text.trim().split(/\s+/).length >= 3)
      if (wrapsSidebarText && !columnDescription(lines, l, pitch, bottom)) return false
      // Quest names can line up horizontally with an unused slot. An unknown
      // outer title must also share the row's baseline (including a raised card).
      return (slot < 0 || slot > count - 1) && Math.abs(slot - Math.round(slot)) < .15
        && row.some(header => Math.abs(header.y - l.y) <= pitch * .10)
        && offeredCardHeaders([...headers, l]).includes(l)
    })
    if (hasOuterHeader) continue
    matches.push({ headers, bottom, columnPitch: pitch, lines: lines.filter(l => l.y > top && l.y + l.height < bottom) })
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
    if (!title) {
      if (button && current > 0 && current < total) {
        const recovered = coveredOffer(lines, axis, level, span * .56, button.y, current)
        if (recovered) {
          matches.push(recovered)
          continue
        }
      }
      const atTitle = lines.filter(l => l.y >= top - .08 * span && l.y <= top + .09 * span)
      const fragment = atTitle.some(l => /^(fa|fat|fate|ates|tes|es)$/i.test(l.text.trim())
        && Math.abs(centerX(l) - axis) < .08 * span && l.width < .15 * span)
      const margin = fragment ? .12 * span : 0
      if (!atTitle.some(l => l.x < axis + margin && l.x + l.width > axis - margin && l.width > span * .56)) continue
    }
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
  // Windows OCR can split the invocation title vertically or horizontally.
  const invocation = lines.some(line => normalize(line.text) === 'invokefates' ||
    (normalize(line.text) === 'invoke' && headings.some(heading => {
      if (normalize(heading.text) !== 'fates') return false
      const height = Math.max(line.height, heading.height)
      const gap = heading.x - (line.x + line.width)
      return (alignedControls(line, heading) && heading.y >= line.y && heading.y - line.y - line.height <= height * 1.5)
        || (gap >= 0 && gap <= 2 * height && Math.abs(heading.y - line.y) <= height / 2)
    })))
  // A world-space "Select a Fate" label can coexist with the actual Fates title.
  // Pair controls on their shared horizontal axis instead of counting every title
  // in the frame. Several aligned pairs remain ambiguous; never choose by names.
  const panels = headings.flatMap(heading => confirms
    .filter(confirm => heading.y + heading.height < confirm.y && alignedControls(heading, confirm))
    .map(confirm => ({ heading, confirm })))
  // Establish the offered region independently of the name dictionary. A known
  // card below Confirm must never replace unreadable or missing offered headers.
  if (invocation) return null
  if (panels.length > 1) {
    // A world-space prompt may fall above or inside the panel. Require a
    // unique Fates title, the same button, and a grid anchored by the counter.
    const real = panels.filter(p => normalize(p.heading.text) === 'fates')
    if (real.length !== 1) return null
    const { heading, confirm } = real[0]
    if (!panels.every(p => p.confirm === confirm && (p.heading === heading || normalize(p.heading.text) === 'selectafate'))) return null
    return countedOffer(lines, [heading], [confirm])
  }
  const counted = countedOffer(lines, headings, confirms)
  if (counted) return counted
  if (panels.length !== 1) return coveredPanelButton(lines, headings, confirms)
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
const namesByCaption = new Map<string, string[]>()
for (const [name, variants] of shortDescriptions) for (const caption of variants) {
  if (!caption) continue
  const key = descriptionWords(caption)
  const names = namesByCaption.get(key) ?? []
  if (!names.includes(name)) namesByCaption.set(key, [...names, name])
}

// With a selected deck underneath Confirm, a tooltip can cover the top row's
// nameplates. Use the exact printed captions only inside a verified upper grid.
function coveredOffer(lines: OcrLine[], axis: number, level: number, pitch: number, bottom: number, owned: number): OfferRegion | null {
  if (owned > 6) return null
  const inBand = (l: OcrLine, from: number, to: number) => l.y >= level + from * pitch && l.y < level + to * pitch
  const ownedHeaders = lines.filter(l => inBand(l, .22, .52) && knownFateName(l.text))
  if (!Array.from({ length: owned }, (_, i) => axis + (i - (owned - 1) / 2) * pitch)
    .every(x => ownedHeaders.some(l => Math.abs(centerX(l) - x) < pitch * .15))) return null
  const wideLines = lines.filter(l => inBand(l, -1.68, -1.25) && l.width > pitch)
  const seeds = wideLines.filter(l => /empowered monster/i.test(l.text))
  if (!seeds.length) return null
  const tooltip = wideLines.filter(l => seeds.some(s => Math.abs(l.x - s.x) < s.height
    && Math.abs(l.y - s.y) <= 1.5 * s.height))
  const tooltipTitles = lines.filter(l => knownFateName(l.text) && seeds.some(body =>
    Math.abs(l.x - body.x) < l.height && body.y - l.y > l.height && body.y - l.y < 3.5 * l.height))
  const bodies = lines.filter(l => inBand(l, -.77, -.27) && l.width < .85 * pitch && /[a-z]/i.test(l.text))
  const titles = lines.filter(l => inBand(l, -1.58, -1.30) && l.width < .8 * pitch)
  const matches: OfferRegion[] = []
  for (let count = 3; count <= 6; count++) {
    const headers: OfferHeader[] = []
    const bodyTops: number[] = []
    let anchored = false
    for (let i = 0; i < count; i++) {
      const x = axis + (i - (count - 1) / 2) * pitch
      const body = bodies.filter(l => Math.abs(centerX(l) - x) < pitch * .18).sort((a, b) => a.y - b.y)
      let caption = captionText(body, pitch)
      const slot = titles.filter(l => Math.abs(centerX(l) - x) < pitch * .2)
      const visible = slot.filter(l => knownFateName(l.text))
      if (visible.length === 1) {
        caption = joinSplitCaptionWord(knownFateName(visible[0].text)!, caption)
      }
      const names = namesByCaption.get(descriptionWords(caption))
      if (!names) break
      bodyTops.push(body[0].y)
      if (visible.length) {
        if (visible.length !== 1 || !names.includes(knownFateName(visible[0].text)!)) break
        headers.push({ ...visible[0], caption })
        anchored = true
      } else {
        if (!tooltip.some(l => l.x < x && l.x + l.width > x)) break
        const height = body[0].height
        headers.push({ x: x - pitch * .2, y: body[0].y - pitch * .81, width: pitch * .4, height,
          text: names.length === 1 ? names[0] : '', inferred: true, caption })
      }
    }
    if (headers.length !== count) continue
    // The hovered card is raised above all its neighbours. Its own tooltip
    // can distinguish two names that have the same printed short description.
    const raised = bodyTops.findIndex((y, i) => bodyTops.every((other, j) =>
      j === i || other - y > headers[i].height * .75))
    if (raised !== -1 && tooltipTitles.length === 1) {
      const header = headers[raised], name = knownFateName(tooltipTitles[0].text)!
      if (namesByCaption.get(descriptionWords(header.caption!))?.includes(name) && (!header.text || header.text === name)) {
        header.text = name
        anchored = true
      }
    }
    if (!anchored) continue
    // A centered subgrid of a four- or six-card offer is not a second offer.
    const next = pitch * (count + 1) / 2
    if (bodies.some(l => Math.abs(Math.abs(centerX(l) - axis) - next) < pitch * .18)) continue
    matches.push({ headers, bottom, columnPitch: pitch, lines: bodies })
  }
  return matches.length === 1 ? matches[0] : null
}

// If the tooltip covers both controls completely, the centered lower row
// and its own printed captions must independently confirm the panel geometry.
function coveredPanelButton(lines: OcrLine[], headings: OcrLine[], confirms: OcrLine[]): OfferRegion | null {
  const titles = headings.filter(l => normalize(l.text) === 'fates')
  if (titles.length !== 1) return null
  const title = titles[0], axis = centerX(title)
  const upper = lines.filter(l => knownFateName(l.text) && l.y > title.y + title.height * 2.5
    && l.y < title.y + title.height * 6.5).sort((a, b) => a.x - b.x)
  if (upper.length < 3 || upper.length > 6) return null
  const pitch = (centerX(upper[upper.length - 1]) - centerX(upper[0])) / (upper.length - 1)
  if (pitch < title.height * 8 || pitch > title.height * 18) return null
  const span = pitch / .56, bottom = title.y + span
  const footer = confirms.some(c => c.y > bottom + pitch && lines.some(l => normalize(l.text) === 'close'
    && l.x > c.x && Math.abs(l.y - c.y) < c.height))
  const partial = lines.some(l => {
    if (!alignedControls(title, l) || Math.abs(l.y - bottom) >= pitch * .10
      || l.width <= pitch * .25 || l.width >= pitch * .45) return false
    const parts = /^([a-z]{2,})\s+([a-z]{2,})$/.exec(l.text.trim().toLowerCase())
    return parts && parts[1].length + parts[2].length === 'confirm'.length - 1
      && 'confirm'.startsWith(parts[1]) && 'confirm'.endsWith(parts[2])
  })
  const owned = lines.filter(l => knownFateName(l.text) && l.y > bottom + pitch * .2 && l.y < bottom + pitch * .6)
    .sort((a, b) => a.x - b.x)
  if (!owned.length || !lines.some(l => /empowered monster/i.test(l.text) && Math.abs(l.y - bottom) < pitch * .35)
    || !lines.some(l => l.x < axis && l.x + l.width > axis && Math.abs(l.y - bottom) < pitch * .12)) return null
  if (!footer && !partial) {
    const covered = lines.some(l => /empowered monster/i.test(l.text) && Math.abs(l.y - bottom) < pitch * .12
      && l.x < axis - .30 * span && l.x + l.width > axis)
    if (!covered || owned.length > 6 || !owned.every((h, i) =>
      Math.abs(centerX(h) - axis - (i - (owned.length - 1) / 2) * pitch) < pitch * .15
      && namesByCaption.get(descriptionWords(reviewedSpelling(knownFateName(h.text)!,
        columnDescription(lines, h, pitch, bottom + 2 * pitch), h, lines)))?.includes(knownFateName(h.text)!))) return null
  }
  const rows = panelRows(lines, axis, title.y, span, bottom, upper.length)
  return rows.length === 1 && rows[0].headers.every((h, i) => {
    const name = knownFateName(h.text)!
    const caption = reviewedSpelling(name, columnDescription(lines, h, pitch, bottom), h, lines)
    return h === upper[i] && namesByCaption.get(descriptionWords(caption))?.includes(name)
  }) ? rows[0] : null
}
const captionVocabulary = new Set([...shortDescriptions.values()].flat().flatMap(s => s ? descriptionWords(s).split(' ') : []))

// A gap inside a word can survive both OCR passes. Keep every printed letter
// and require the complete caption of the visible name in this column.
function joinSplitCaptionWord(name: string, text: string) {
  const words = descriptionWords(text).split(' ')
  const matches = (shortDescriptions.get(name) ?? []).filter(caption => {
    if (!caption) return false
    const expected = descriptionWords(caption).split(' ')
    if (words.length !== expected.length + 1) return false
    const i = expected.findIndex((word, index) => word !== words[index])
    if (i < 0 || expected[i].length < 4 || !/^[a-z]+$/.test(expected[i])) return false
    return words[i] + words[i + 1] === expected[i]
      && !(captionVocabulary.has(words[i]) && captionVocabulary.has(words[i + 1]))
      && expected.slice(i + 1).every((word, j) => word === words[i + j + 2])
  })
  return matches.length === 1 ? matches[0]! : text
}
// OCR ligatures can turn one glyph into two, e.g. "m" into "rn". Only a
// short contiguous difference is allowed. Never replace another catalog word.
function glyphDifference(seen: string, expected: string) {
  let left = 0, right = 0
  const limit = Math.min(seen.length, expected.length)
  while (left < limit && seen[left] === expected[left]) left++
  while (left + right < limit && seen.at(-1 - right) === expected.at(-1 - right)) right++
  return Math.max(seen.length, expected.length) - left - right
}

function matchesPrintedWords(seen: string, expected: string) {
  const a = seen.split(' '), b = expected.split(' ')
  if (a.length !== b.length || a.length < 3) return false
  let exact = 0, differences = 0
  for (const [i, word] of a.entries()) {
    if (word === b[i]) { exact++; continue }
    const target = b[i]
    // A single digit can replace a letter inside an otherwise intact word.
    // Standalone numbers, units and quantity-bearing variants remain literal.
    const digitInWord = /^[a-z]*\d[a-z]*$/.test(word) && /^[a-z]{5,}$/.test(target) && word.length === target.length
      && [...word].every((c, j) => c === target[j] || /\d/.test(c))
      && a.every((s, j) => j === i || s === b[j])
    if (captionVocabulary.has(word) || (/\d/.test(word + target) && !digitInWord) || word.length < 2) return false
    const difference = glyphDifference(word, b[i])
    const sameEnds = /^[a-z]{6,}$/.test(word) && word.slice(0, 2) === target.slice(0, 2)
      && word.slice(-2) === target.slice(-2) && a.length >= 4 && a.every((s, j) => j === i || s === b[j])
    const limit = Math.min(word.length, target.length) >= 5 ? 2 : 1
    if (difference > (sameEnds ? 3 : limit)) return false
    differences += difference
  }
  return exact >= Math.ceil(a.length / 2) && differences <= Math.min(4, expected.length * .12)
}

function corroboratedName(header: string, description: string): string | undefined {
  const seen = normalize(header)
  if (seen.length < 6 || !description) return
  const words = descriptionWords(description)
  const matches = [...shortDescriptions].filter(([name, variants]) => {
    if (!variants.some(v => v && descriptionWords(v) === words)) return false
    // A single blurred glyph can look like two letters. Require matching text
    // on both sides of that small difference and the whole description in this column.
    const target = normalize(name)
    if (glyphDifference(seen, target) <= 2) return true
    // Longer names can have a dropped letter and a separate misread glyph.
    // Both pieces still have to match the independently read whole caption.
    if (seen.length < 8 || target.length < 8 || seen[0] !== target[0] || seen.at(-1) !== target.at(-1)) return false
    const [shorter, longer] = seen.length < target.length ? [seen, target] : [target, seen]
    if (longer.length !== shorter.length + 1) return false
    for (let i = 1; i < longer.length - 1; i++) {
      if (glyphDifference(shorter, longer.slice(0, i) + longer.slice(i + 1)) <= 1) return true
    }
    return false
  })
  return matches.length === 1 ? matches[0][0] : undefined
}
function tooltipConfirmsWord(seen: string[], caption: string, body: string[]): boolean {
  const printed = descriptionWords(caption).split(' ')
  if (seen.length !== printed.length || seen.length < 3) return false
  const i = seen.findIndex((word, index) => word !== printed[index])
  if (i < 0 || seen.slice(i + 1).some((word, j) => word !== printed[i + 1 + j])) return false
  const repeats = (from: number, to: number) => body.some(line => line.includes(' ' + printed.slice(from, to + 1).join(' ') + ' '))
  if (seen[i] === '01' && printed[i] === 'of') return i > 0 && i + 1 < seen.length && repeats(i - 1, i + 1)
  // A covered word must still have visible initial letters. Require the rest
  // of the caption to agree and the named tooltip to repeat the whole word in context.
  if (!/^[a-z]{2,}$/.test(seen[i]) || !/^[a-z]+$/.test(printed[i]) ||
    !printed[i].startsWith(seen[i]) || captionVocabulary.has(seen[i])) return false
  return [-2, -1, 1, 2].some(offset => {
    const j = i + offset
    return /^[a-z]{4,}$/.test(printed[j] ?? '') && repeats(Math.min(i, j), Math.max(i, j))
  })
}

// A cursor can split a word on one line and obscure another on the next.
// Require evidence from both the printed column and that card's own tooltip.
function tooltipConfirmsFragments(words: string, caption: string, body: string[]) {
  const seen = words.replace(/([a-z]+)\s*•\s*([a-z]+)/g, '$1…$2').split(' ')
  const printed = descriptionWords(caption).split(' ')
  if (seen.length !== printed.length || seen.length < 5) return false
  const damaged = seen.map((w, i) => w !== printed[i] ? i : -1).filter(i => i >= 0)
  if (damaged.length !== 2) return false
  let confirmed = 0
  for (const i of damaged) {
    const fragment = seen[i], target = printed[i]
    if (!/^[a-z]+$/.test(target) || captionVocabulary.has(fragment)) return false
    const prefix = /^[a-z]{2,}$/.test(fragment) && target.startsWith(fragment)
    const split = /^([a-z]+)…([a-z]+)$/.exec(fragment)
    const inside = split && target.startsWith(split[1]) && target.endsWith(split[2])
      && split[1].length + split[2].length < target.length
    const blurred = /^[a-z]{6,}$/.test(fragment) && fragment.slice(-5) === target.slice(-5) && glyphDifference(fragment, target) <= 3
    if (!prefix && !inside && !blurred) return false
    const inPhrase = [-2, -1, 1, 2].some(offset => {
      const j = i + offset
      return /^[a-z]{4,}$/.test(printed[j] ?? '') && seen[j] === printed[j]
        && body.some(line => line.includes(' ' + printed.slice(Math.min(i, j), Math.max(i, j) + 1).join(' ') + ' '))
    })
    if (inPhrase) confirmed++
    else if (!prefix || i === 0 || i === seen.length - 1 || seen[i - 1] !== printed[i - 1] || seen[i + 1] !== printed[i + 1]) return false
  }
  return confirmed > 0
}

function reviewedSpelling(name: string, text: string, header: OcrLine, lines: OcrLine[]): string {
  text = joinSplitCaptionWord(name, text)
  const words = descriptionWords(text)
  const variants = shortDescriptions.get(name) ?? []
  const exact = variants.find(value => value && (descriptionWords(value) === words
    || (value.length >= 20 && /^[B-HJ-Z]\s/.test(text) && descriptionWords(value) === words.slice(2))))
  if (exact) return exact
  const supported = variants.filter(value => value && matchesPrintedWords(words, descriptionWords(value)))
  if (supported.length === 1) return supported[0]!
  if (!name || !variants.length) return text
  const nameKey = normalizeFateName(name)
  const sameName = lines.filter(l => normalizeFateName(knownFateName(l.text) ?? '') === nameKey)
  if (sameName.some(l => Math.abs(l.y - header.y) <= 2 * header.height &&
    Math.abs(centerX(l) - centerX(header)) > header.width)) return text
  const titles = sameName.filter(l => l.y < header.y - 2 * header.height)
  if (titles.length !== 1) return text
  const title = titles[0]
  // OCR sometimes includes a leading ornament in the title's bounding box.
  const margin = /^[^a-z\s]/i.test(title.text.trim()) ? title.height * 2 : title.height
  const body = lines.filter(l => l.y >= title.y + title.height && l.y <= title.y + 5 * title.height
    && l.y + l.height < header.y && Math.abs(l.x - title.x) < margin).map(l => ' ' + descriptionWords(l.text) + ' ')
  const seen = words.split(' ')
  const confirmed = variants.filter(value => value && (tooltipConfirmsWord(seen, value, body) || tooltipConfirmsFragments(words, value, body)))
  return confirmed.length === 1 ? confirmed[0]! : text
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
    const center = header.x + header.width / 2
    const previous = row[index - 1]
    const next = row[index + 1]
    const left = previous ? (previous.x + previous.width / 2 + center) / 2 : 0
    const right = next ? (next.x + next.width / 2 + center) / 2 : capture.image.width
    const description = header.caption ?? (region.columnPitch ? columnDescription(offerLines, header, region.columnPitch, region.bottom, capture.ocr.lines) : offerLines.filter(line => {
      const x = line.x + line.width / 2
      return line.y > headerBottom + first.height && x > left && x < right
        && !/^(confirm|select a fate|fates)$/i.test(line.text.trim())
        && line.text.trim().length > 2
    }).sort((a, b) => a.y - b.y || a.x - b.x).map(line => line.text.trim()).join(' '))
    const name = knownFateName(header.text) ?? corroboratedName(header.text, description)
    return [{ ...newCard(), name: name ?? '', modifiers: description ? [reviewedSpelling(name ?? '', description.slice(0, 1000), header, capture.ocr.lines)] : [] }]
  })
  if (!cards.length) return { cards: [], message: 'No known Fate names were found in the offered row. Keep this capture for a later recognition update, or add cards manually.' }
  return { cards, message: `${cards.length} candidate ${cards.length === 1 ? 'card' : 'cards'} found${cards.some(card => !card.name) ? ', including unknown headers' : ''}. Check coverage and names against the screenshot and original OCR. Tiers and reward icons are not identified automatically.` }
}

function captionText(sorted: OcrLine[], pitch: number) {
  // Reward circles below the last baseline can be recognized as a row of O's.
  return sorted.filter((l, i) => !(i > 0 && i === sorted.length - 1 && /^o(?:\s*o)+$/i.test(l.text.trim())
    && l.height >= pitch * .085 && l.y > sorted[i - 1].y + sorted[i - 1].height + pitch * .07))
    .map(l => l.text.trim()).join(' ')
}

function columnDescription(lines: OcrLine[], header: OcrLine, pitch: number, bottom: number, context = lines) {
  const center = centerX(header)
  const column = lines.filter(l => Math.abs(centerX(l) - center) < pitch * .43 && l.width < pitch
    && l.y >= header.y + pitch * .62 && l.y < header.y + pitch * 1.23 && l.y + l.height < bottom && /[a-z]/i.test(l.text)
    && normalize(l.text) !== 'selectafate')
    .sort((a, b) => a.y - b.y || a.x - b.x)
  // A lower-card tooltip may begin inside this column. Its detached name
  // and aligned body must follow an independently verified caption.
  const last = column.at(-1)
  if (last && column.length > 1 && knownFateName(last.text)
    && last.y - (column.at(-2)!.y + column.at(-2)!.height) > pitch * .16) {
    const caption = captionText(column.slice(0, -1), pitch)
    const next = context.some(l => l.width > pitch && Math.abs(l.x - last.x) < last.height
      && l.y > last.y + last.height && l.y < last.y + last.height * 4)
    if (next && namesByCaption.get(descriptionWords(caption))?.includes(knownFateName(header.text) ?? '')) return caption
  }
  // HUD labels can also fall inside the column, away from its centered caption.
  const middle = column.filter(l => Math.abs(centerX(l) - center) < .20 * pitch)
  if (middle.length && middle.length < column.length && column.every(l => middle.includes(l)
    || (Math.abs(centerX(l) - center) > .30 * pitch && (l.y + l.height < middle[0].y || l.y > middle.at(-1)!.y + middle.at(-1)!.height)))) {
    const words = descriptionWords(captionText(middle, pitch))
    const supported = shortDescriptions.get(knownFateName(header.text) ?? '')?.filter(v => v &&
      (descriptionWords(v) === words || matchesPrintedWords(words, descriptionWords(v))))
    if (supported?.length === 1) return captionText(middle, pitch)
  }
  return captionText(column, pitch)
}

// Preserve unknown name slots only alongside a known anchor, with matching text
// size and a separate column. All-unknown/overlapping/body-text rows still abstain.
export function offeredCardHeaders(row: OfferHeader[]): OfferHeader[] {
  const known = row.filter(header => knownFateName(header.text))
  if (!known.length) return []
  return row.filter(header => {
    if (knownFateName(header.text) || header.inferred) return true
    if (row.length > 6 || !/^[A-Z][a-zA-Z’'-]+(?: [A-Z][a-zA-Z’'-]+){0,2}$/.test(header.text.trim())) return false
    if (!known.some(anchor => header.height >= anchor.height * .75 && header.height <= anchor.height * 1.35)) return false
    return row.every(other => other === header || header.x + header.width <= other.x || other.x + other.width <= header.x)
  })
}
