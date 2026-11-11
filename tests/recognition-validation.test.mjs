import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { COVERAGE_POLICY_VERSION, labelCoverage, measure, MINIMUM_SCENES, MOTIFS, PROFILES, SCENES, summarize } from '../scripts/recognition-validation-metrics.mjs'
import { verifyRecognitionReport } from '../scripts/verify-recognition-release.mjs'
import { knownFateName } from '../shared/recognition'

const label = (x, fields = {}) => ({ headerBox: [x, 30, 40, 12], group: 'offered', name: 'Torchbearer', tier: 2,
  visualIds: ['gold-ring'], ...fields })
const suggestion = (x, fields = {}) => ({ header: { x, y: 31, width: 38, height: 10 }, name: 'Torchbearer', tier: 2,
  visualIds: ['gold-ring'], ...fields })
const completeRows = () => Object.keys(PROFILES).flatMap(profile => SCENES.flatMap(scene => Array.from({ length: MINIMUM_SCENES[scene] }, (_, index) => {
  const labels = scene === 'offer' ? Array.from({ length: 3 }, (_, card) => label(10 + card * 60, {
    name: `Name${(index + card) % 5}`, tier: index % 2 ? 2 : 3, visualIds: [MOTIFS[index % MOTIFS.length]],
  })) : []
  const suggestions = labels.map(card => suggestion(card.headerBox[0], { name: card.name, tier: card.tier, visualIds: card.visualIds }))
  return { profile, scene, sceneId: `${profile}-${scene}-${index}`, outcome: 'measured', problems: [],
    coverage: { unknownName: true, collectedRow: true, tooltip: true }, labelCoverage: labelCoverage(labels),
    metrics: measure(labels, suggestions).metrics }
})))

test('new primary-evidence names are exact dictionary entries without fuzzy matching', () => {
  expect(knownFateName('Dryad')).toBe('Dryad')
  expect(knownFateName('Avalanche')).toBe('Avalanche')
  expect(knownFateName('Avalanchee')).toBeUndefined()
})

test('scores physical card locations even for duplicate names and motifs', () => {
  const labels = [label(10, { visualIds: ['gold-ring', 'gold-ring'] }), label(60, { tier: 3, visualIds: ['gold-axe'] }),
    label(110, { group: 'collected', tier: null, visualIds: null })]
  const { metrics, issues } = measure(labels, [suggestion(60, { tier: 3, visualIds: ['gold-axe'] }), suggestion(10), suggestion(110)])
  expect(metrics.names).toMatchObject({ expected: 2, correct: 2, unexpected: 1 })
  expect(metrics.tiers).toMatchObject({ expected: 2, correct: 2, unexpected: 1 })
  expect(metrics.motifs).toMatchObject({ expected: 3, correct: 2, omitted: 1, unexpected: 1 })
  expect(metrics.wrongRows).toBe(1)
  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: 'omitted-motifs', labelIndex: 0, expected: ['gold-ring'] }),
    expect.objectContaining({ reason: 'wrong-row', group: 'collected', labelIndex: 2 }),
  ]))
})

test('distinguishes unknown-name abstention, wrong names and unsafe matches in an obscured area', () => {
  const labels = [label(10, { visualIds: null }), label(60, { name: null, observedName: 'Uncatalogued', tier: null, visualIds: null }), label(110)]
  const { metrics, issues } = measure(labels, [suggestion(10, { tier: null }), suggestion(110, { name: 'Tempest' })])
  expect(metrics.visibleUnknownNames).toBe(1)
  expect(metrics.unknownNameAbstentions).toBe(1)
  expect(metrics.names).toMatchObject({ omitted: 1, unexpected: 1, abstained: 0 })
  expect(metrics.tiers).toMatchObject({ omitted: 2, unexpected: 1, abstained: 1 })
  expect(issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: 'unexpected-motif', attributable: false }),
    expect.objectContaining({ reason: 'wrong-name' }),
  ]))
})

test('the independent gate requires every profile, positive denominators and successful measurements', () => {
  const rows = completeRows()
  expect(summarize('holdout', rows).status).toBe('PASS')
  const missingOffer = { ...rows[0], outcome: 'refused', problems: ['calibration refused'] }
  expect(summarize('holdout', [missingOffer, ...rows.slice(1)])).toMatchObject({ status: 'FAIL',
    missingCoverage: expect.arrayContaining(['1080p-sdr-default/offer', '1080p-sdr-default/names-minimum-30']) })
  const missedRows = rows.map(row => row.profile === '1080p-sdr-default' && row.scene === 'offer'
    ? { ...row, metrics: measure([label(10)], [suggestion(10, { tier: null, visualIds: [] })]).metrics } : row)
  expect(summarize('holdout', missedRows).failures).toEqual(expect.arrayContaining([
    '1080p-sdr-default/tiers recall below 0.9', '1080p-sdr-default/motifs recall below 0.9',
  ]))
})

test('a perfect but tiny corpus cannot pass; coverage includes distinct names, both tiers and every supported motif', () => {
  const rows = completeRows()
  expect(summarize('holdout', rows.filter(row => row.sceneId.endsWith('-0'))).status).toBe('FAIL')
  const narrowed = rows.map(row => ({ ...row, labelCoverage: { names: ['Torchbearer'], tiers: [2], motifs: ['gold-ring'] } }))
  expect(summarize('holdout', narrowed).missingCoverage).toEqual(expect.arrayContaining([
    '1080p-sdr-default/five-distinct-names', '4k-hdr-default/tier-3', 'offer/motif-blue-diamond',
  ]))
})

test('release verifier recomputes the gate and refuses spoofed status, wrong identity and duplicate captures', () => {
  const revision = 'a'.repeat(40), digest = 'b'.repeat(64)
  const release = { revision, releaseId: digest }
  const expected = { helperVersion: 'test', dictionarySha256: digest, templatesSha256: digest,
    fateNames: Array.from({ length: 5 }, (_, i) => `Name${i}`) }
  const report = { reportSchemaVersion: 2, coveragePolicyVersion: COVERAGE_POLICY_VERSION, execution: 'local-native-replay',
    mode: 'holdout', revision, release: { ...release, helperVersion: 'test' }, productionFilesModified: false,
    manifestSha256: digest, dictionarySha256: digest, templatesSha256: digest, browserVersion: 'test', status: 'FAIL',
    scenes: completeRows().map((row, i) => ({ ...row, provenance: { source: 'native-f9', independentlyLabeled: true, ...PROFILES[row.profile] },
      capture: { outcome: 'captured', pngSha256: i.toString(16).padStart(64, '0'), bundleSha256: i.toString(16).padStart(64, '0') },
      helperVersion: 'test', imagePreserved: true, ocrPreserved: true, reviewRequired: true, ocrStatus: 'ok', ocrLines: 1, visual: { status: 'candidates' },
    })) }
  expect(verifyRecognitionReport(report, release, expected).status).toBe('PASS')
  expect(() => verifyRecognitionReport({ ...report, scenes: [], status: 'PASS' }, release, expected)).toThrow()
  expect(() => verifyRecognitionReport(report, { ...release, releaseId: 'c'.repeat(64) }, expected)).toThrow(/exact release/)
  expect(() => verifyRecognitionReport(report, release, { ...expected, helperVersion: 'wrong' })).toThrow(/exact release/)
  expect(() => verifyRecognitionReport({ ...report, scenes: [report.scenes[0], ...report.scenes] }, release, expected)).toThrow(/Duplicate/)
})

test('the checked-in empty holdout exits nonzero with a machine-readable failure', () => {
  const result = spawnSync(process.execPath, ['scripts/recognition-validation.mjs'], { encoding: 'utf8' })
  expect(result.status).toBe(1)
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'FAIL', independentReleaseGate: 'FAIL', measuredScenes: 0,
    summary: { recall: { names: null, tiers: null, motifs: null } },
    missingCoverage: expect.arrayContaining(['4k-hdr-default/offer', 'offer/visible-unknown-name']) })
})

test('hash mismatches fail before any browser or measurement is attempted', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fate-validation-'))
  try {
    const path = join(directory, 'manifest.json')
    writeFileSync(join(directory, 'capture.json'), '{}')
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, mode: 'replay', release: null, scenes: [{
      sceneId: 'changed-bundle', scene: 'negative', tooltip: false, cards: [],
      provenance: { source: 'historical-f9', description: 'Hash test input' },
      capture: { outcome: 'captured', file: 'capture.json', bundleSha256: 'a'.repeat(64), pngSha256: 'b'.repeat(64) },
    }] }))
    const result = spawnSync(process.execPath, ['scripts/recognition-validation.mjs', path], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'FAIL', measuredScenes: 0, browserVersion: null,
      scenes: [expect.objectContaining({ outcome: 'failed', problems: ['Bundle SHA-256 does not match.'] })] })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
