import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { newCard, newOffer, newReward } from '../shared/offers'
import type { Archive, Evidence, Offer } from '../shared/schema'
// @ts-expect-error Standalone Node scripts are plain JavaScript.
import { renderResearchCorpusMarkdown, summarizeResearchCorpus } from '../scripts/research-corpus-stats.mjs'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='

function capturedOffer(ocrStatus: Evidence['ocrStatus'], fields: Partial<Offer> = {}) {
  const offer = { ...newOffer(), source: 'windows-helper', ...fields } satisfies Offer
  offer.captureId = offer.id
  const evidence: Evidence = { id: offer.id, imageDataUrl: png, ocrStatus, ocrText: '', ocrLines: [], helperVersion: '0.2.0' }
  return { offer, evidence }
}

function archive(): Archive {
  const session = { id: crypto.randomUUID(), startedAt: '2026-11-08T18:00:00Z', sequence: 1 }
  const complete = capturedOffer('ok', {
    origin: 'live',
    reviewed: true,
    completeness: 'complete',
    cards: [
      { ...newCard(), name: 'Sanguine', rewards: [{ ...newReward(), label: 'Chaos Orb', identified: true, count: 9 }] },
      { ...newCard(), name: 'Alchemist', tier: 1 },
    ],
    captureContext: { captureMode: 'game', session },
  })
  complete.evidence.ocrLines.push({ text: 'Sanguine', x: 0, y: 0, width: 1, height: 1 })
  const partial = capturedOffer('unavailable', {
    origin: 'live',
    reviewed: true,
    completeness: 'partial',
    cards: [{ ...newCard(), name: '  ', rewards: [{ ...newReward(), kind: 'regular' }] }],
    captureContext: {
      captureMode: 'game',
      session: { ...session, id: session.id.toUpperCase(), sequence: 2 },
      possibleDuplicate: { ofCaptureId: complete.offer.id, reason: 'same-ocr-within-15s' },
    },
  })
  const legacy = capturedOffer('error', { origin: 'live' })
  legacy.evidence.ocrText = 'untrusted text from a failed OCR run'
  const screenshot = capturedOffer('not-run', { source: 'screenshot' })
  const fixture = capturedOffer('ok', {
    captureContext: { captureMode: 'fixture', session: { ...session, id: crypto.randomUUID() } },
  })
  fixture.evidence.ocrText = '  '
  return {
    kind: 'fate-collector.export',
    schemaVersion: 1,
    offers: [complete, partial, legacy, screenshot, fixture, { offer: newOffer(), evidence: null }],
  }
}

test('reports quality and evidence across origin cohorts without removing repeat hints', () => {
  const input = archive()
  const report = summarizeResearchCorpus(input)
  expect(report.all).toEqual({
    offers: { total: 6, reviewed: 2, unreviewed: 4, complete: 1, partial: 1, unverified: 4, withoutRecordedCards: 4 },
    captures: { total: 5, sessions: 2, withoutSession: 2, possibleRepeatHints: 1 },
    evidence: {
      withImage: 5, withoutImage: 1, withSuccessfulOcrText: 1,
      ocrStatus: { ok: 2, unavailable: 1, error: 1, 'not-run': 1, missing: 1 },
    },
    cards: { recorded: 3, withoutName: 1, withoutTier: 2, withoutRewardAnnotations: 1 },
    rewards: { annotations: 2, unidentified: 1, unknownKind: 1 },
  })
  expect(report.live).toMatchObject({ offers: { total: 3, reviewed: 2 }, captures: { sessions: 1, possibleRepeatHints: 1 } })
  expect(report.test).toMatchObject({ offers: { total: 3, reviewed: 0 }, captures: { sessions: 1, possibleRepeatHints: 0 } })
  expect(summarizeResearchCorpus({ ...input, offers: [...input.offers].reverse() })).toEqual(report)
  const markdown = renderResearchCorpusMarkdown(report)
  expect(markdown).toContain('| Possible repeat hints | 1 | 1 | 0 |')
  expect(markdown).toContain('| Cards without reward annotations | 1 | 1 | 0 |')
  expect(markdown).toContain('Partial and unverified offers can omit cards.')
  expect(JSON.stringify(report)).not.toContain('Sanguine')
  expect(JSON.stringify(report)).not.toContain(png)
})

test('allows omitted evidence and retains hints whose source capture is outside the export', () => {
  const input = archive()
  input.offers = [{ offer: input.offers[1].offer, evidence: null }]
  const report = summarizeResearchCorpus(input)
  expect(report.all).toMatchObject({
    offers: { total: 1, partial: 1 },
    captures: { total: 1, sessions: 1, possibleRepeatHints: 1 },
    evidence: { withoutImage: 1, ocrStatus: { missing: 1 } },
  })
  expect(report.test.offers.total).toBe(0)
})

test('validates the export version and nested contracts before counting', () => {
  const input = archive()
  expect(() => summarizeResearchCorpus({ ...input, schemaVersion: 2 })).toThrow('schemaVersion')
  expect(() => summarizeResearchCorpus({ ...input, kind: 'fate-collector.capture' })).toThrow('kind')
  input.offers[0].offer.reviewed = false
  expect(() => summarizeResearchCorpus(input)).toThrow('A complete offer needs named cards and a manual review.')
  input.offers[0].offer.reviewed = true
  input.offers[0].evidence!.id = crypto.randomUUID()
  expect(() => summarizeResearchCorpus(input)).toThrow('Evidence must match the offer capture ID.')
})

test('rejects repeated offer IDs across revisions and multiple offers referencing the same capture', () => {
  const input = archive()
  const first = input.offers[0]
  input.offers.push({ offer: { ...first.offer, id: first.offer.id.toUpperCase(), revision: 2 }, evidence: null })
  expect(() => summarizeResearchCorpus(input)).toThrow('Duplicate offer ID.')
  input.offers.at(-1)!.offer.id = crypto.randomUUID()
  expect(() => summarizeResearchCorpus(input)).toThrow('Duplicate capture ID.')
})

test('CLI prints both formats and checks an existing Markdown report without changing it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fate-corpus-test-'))
  const exportPath = join(directory, 'export.json')
  const reportPath = join(directory, 'report.md')
  const script = fileURLToPath(new URL('../scripts/research-corpus-stats.mjs', import.meta.url))
  const run = (...args: string[]) => spawnSync(process.execPath, [script, exportPath, ...args], { encoding: 'utf8', timeout: 10_000 })

  try {
    const input = archive()
    await writeFile(exportPath, '\uFEFF' + JSON.stringify(input))
    const json = run('--format', 'json')
    expect(json.status, json.stderr).toBe(0)
    expect(JSON.parse(json.stdout)).toEqual(summarizeResearchCorpus(input))
    const markdown = run()
    expect(markdown.status, markdown.stderr).toBe(0)
    expect(markdown.stdout).toBe(renderResearchCorpusMarkdown(summarizeResearchCorpus(input)))
    await writeFile(reportPath, markdown.stdout.replaceAll('\n', '\r\n'))
    const check = run('--check', reportPath)
    expect(check.status, check.stderr).toBe(0)
    await writeFile(reportPath, '# Stale report\n')
    expect(run('--check', reportPath)).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('differs') })
    await writeFile(exportPath, '{ broken')
    expect(run()).toMatchObject({ status: 1, stdout: '', stderr: expect.stringContaining('valid JSON') })
  } finally {
    await rm(reportPath, { force: true })
    await rm(exportPath, { force: true })
    await rmdir(directory)
  }
})
