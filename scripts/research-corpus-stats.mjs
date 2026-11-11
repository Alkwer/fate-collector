import { readFile, stat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { exportSchema, formatValidationError, MAX_ARCHIVE_BYTES } from '../shared/schema.ts'
import { combineBackupParts } from '../shared/backups.ts'

function validateArchive(input) {
  const parsed = exportSchema.safeParse(input)
  if (!parsed.success) throw new Error(formatValidationError(parsed.error))

  const offerIds = new Set()
  const captureIds = new Set()
  for (const [index, { offer }] of parsed.data.offers.entries()) {
    const offerId = offer.id.toLowerCase()
    const captureId = offer.captureId?.toLowerCase()
    if (offerIds.has(offerId)) throw new Error(`offers.${index}.offer.id: Duplicate offer ID.`)
    if (captureId && captureIds.has(captureId)) throw new Error(`offers.${index}.offer.captureId: Duplicate capture ID.`)
    offerIds.add(offerId)
    if (captureId) captureIds.add(captureId)
  }
  return parsed.data.offers
}

function countEntries(entries) {
  const sessions = new Set()
  const counts = {
    offers: { total: entries.length, reviewed: 0, unreviewed: 0, complete: 0, partial: 0, unverified: 0, withoutRecordedCards: 0 },
    captures: { total: 0, sessions: 0, withoutSession: 0, possibleRepeatHints: 0 },
    evidence: {
      withImage: 0, withoutImage: 0, withSuccessfulOcrText: 0,
      ocrStatus: { ok: 0, unavailable: 0, error: 0, 'not-run': 0, missing: 0 },
    },
    cards: { recorded: 0, withoutName: 0, withoutTier: 0, withoutRewardAnnotations: 0 },
    rewards: { annotations: 0, unidentified: 0, unknownKind: 0 },
  }

  for (const { offer, evidence } of entries) {
    counts.offers[offer.reviewed ? 'reviewed' : 'unreviewed']++
    counts.offers[offer.completeness]++
    if (!offer.cards.length) counts.offers.withoutRecordedCards++

    if (offer.captureId) {
      counts.captures.total++
      const session = offer.captureContext?.session
      if (session) sessions.add(session.id.toLowerCase())
      else counts.captures.withoutSession++
      if (offer.captureContext?.possibleDuplicate) counts.captures.possibleRepeatHints++
    }

    counts.evidence[evidence ? 'withImage' : 'withoutImage']++
    counts.evidence.ocrStatus[evidence?.ocrStatus ?? 'missing']++
    if (evidence?.ocrStatus === 'ok' && (evidence.ocrText.trim() || evidence.ocrLines.some(line => line.text.trim()))) {
      counts.evidence.withSuccessfulOcrText++
    }

    for (const card of offer.cards) {
      counts.cards.recorded++
      if (!card.name.trim()) counts.cards.withoutName++
      if (card.tier === null) counts.cards.withoutTier++
      if (!card.rewards.length) counts.cards.withoutRewardAnnotations++
      for (const reward of card.rewards) {
        counts.rewards.annotations++
        if (!reward.identified) counts.rewards.unidentified++
        if (reward.kind === 'unknown') counts.rewards.unknownKind++
      }
    }
  }
  counts.captures.sessions = sessions.size
  return counts
}

export function summarizeResearchCorpus(input) {
  const entries = validateArchive(input)
  return {
    kind: 'fate-collector.research-corpus-stats',
    schemaVersion: 1,
    all: countEntries(entries),
    live: countEntries(entries.filter(({ offer }) => offer.origin === 'live')),
    test: countEntries(entries.filter(({ offer }) => offer.origin === 'test')),
  }
}

const markdownSections = [
  ['Offers', [
    ['Recorded offers', c => c.offers.total],
    ['Reviewed', c => c.offers.reviewed],
    ['Unreviewed', c => c.offers.unreviewed],
    ['Complete coverage', c => c.offers.complete],
    ['Partial coverage', c => c.offers.partial],
    ['Unverified coverage', c => c.offers.unverified],
    ['Offers without recorded cards', c => c.offers.withoutRecordedCards],
  ]],
  ['Captures and evidence', [
    ['Captures referenced', c => c.captures.total],
    ['Distinct helper sessions', c => c.captures.sessions],
    ['Captures without a session', c => c.captures.withoutSession],
    ['Possible repeat hints', c => c.captures.possibleRepeatHints],
    ['Offers with an embedded image', c => c.evidence.withImage],
    ['Offers without an embedded image', c => c.evidence.withoutImage],
    ['Successful OCR with nonblank text', c => c.evidence.withSuccessfulOcrText],
    ['OCR marked successful', c => c.evidence.ocrStatus.ok],
    ['OCR marked unavailable', c => c.evidence.ocrStatus.unavailable],
    ['OCR errors', c => c.evidence.ocrStatus.error],
    ['OCR not run', c => c.evidence.ocrStatus['not-run']],
    ['No OCR status in export', c => c.evidence.ocrStatus.missing],
  ]],
  ['Cards and rewards', [
    ['Recorded cards', c => c.cards.recorded],
    ['Cards without a name', c => c.cards.withoutName],
    ['Cards without a tier', c => c.cards.withoutTier],
    ['Cards without reward annotations', c => c.cards.withoutRewardAnnotations],
    ['Reward annotations', c => c.rewards.annotations],
    ['Unidentified reward annotations', c => c.rewards.unidentified],
    ['Reward annotations of unknown kind', c => c.rewards.unknownKind],
  ]],
]

export function renderResearchCorpusMarkdown(report) {
  const lines = ['# Fate Collector research corpus', '']
  for (const [title, rows] of markdownSections) {
    lines.push(`## ${title}`, '', '| Measure | All | Live | Test |', '| --- | ---: | ---: | ---: |')
    for (const [label, read] of rows) {
      lines.push(`| ${label} | ${read(report.all)} | ${read(report.live)} | ${read(report.test)} |`)
    }
    lines.push('')
  }
  lines.push(
    'Review status and coverage are separate. Partial and unverified offers can omit cards.',
    'Helper sessions group captures. Possible repeats remain included. These counts do not measure independent encounters.',
    'An empty reward list means no annotations were recorded. These counts do not estimate reward frequency.',
    '',
  )
  return lines.join('\n')
}

const usage = 'Usage: node scripts/research-corpus-stats.mjs <export.json> [--format markdown|json] [--check <report-file>]'

async function readArchive(path) {
  const file = await stat(path)
  if (!file.isFile()) throw new Error('The export path must be a regular file.')
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('The export exceeds 32 MiB.')
  const data = await readFile(path)
  if (data.length > MAX_ARCHIVE_BYTES) throw new Error('The export exceeds 32 MiB.')
  try {
    return JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('The export is not valid JSON.')
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      format: { type: 'string', default: 'markdown' },
      check: { type: 'string' },
    },
  })
  if (values.help) {
    console.log(usage)
    return
  }
  if (!positionals.length || positionals.length > 250 || !['markdown', 'json'].includes(values.format)) throw new Error(usage)
  const parts = []
  let bytes = 0
  for (const path of positionals) {
    bytes += (await stat(path)).size
    if (bytes > 512 * 1024 * 1024) throw new Error('The backup set exceeds 512 MiB.')
    parts.push(exportSchema.parse(await readArchive(path)))
  }
  const report = summarizeResearchCorpus(combineBackupParts(parts))
  const output = values.format === 'json' ? JSON.stringify(report, null, 2) + '\n' : renderResearchCorpusMarkdown(report)
  if (values.check === undefined) {
    process.stdout.write(output)
    return
  }
  const saved = (await readFile(values.check, 'utf8')).replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')
  if (saved !== output) throw new Error('The report differs from the current export summary.')
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
