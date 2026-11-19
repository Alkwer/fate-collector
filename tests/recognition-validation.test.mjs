import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { COVERAGE_POLICY_VERSION, labelCoverage, measure, MINIMUM_SCENES, MOTIFS, PROFILES,
  REPORT_SCHEMA_VERSION, SCENES, summarize } from '../scripts/recognition-validation-metrics.mjs'
import { verifyRecognitionReport } from '../scripts/verify-recognition-release.mjs'
import { knownFateName } from '../shared/recognition'

const label = (x, fields = {}) => ({ headerBox: [x, 30, 40, 12], group: 'offered', name: 'Torchbearer', tier: 2,
  visualIds: ['gold-ring'], ...fields })
const unknownReward = visualId => ({ visualId, kind: 'unknown' })
const reward = (visualId, label, threshold = null) => ({ visualId, label, kind: threshold === null ? 'regular' : 'combo', threshold })
const predicted = expected => expected.kind === 'unknown'
  ? { ...expected, label: 'Generic visual hint', identified: false, threshold: null } : { ...expected, identified: true }
const suggestion = (x, { visualIds = ['gold-ring'], ...fields } = {}) => ({
  header: { x, y: 31, width: 38, height: 10 }, name: 'Torchbearer', tier: 2,
  rewards: visualIds.map(visualId => predicted(unknownReward(visualId))), ...fields,
})
const completeRows = () => Object.keys(PROFILES).flatMap(profile => SCENES.flatMap(scene => Array.from({ length: MINIMUM_SCENES[scene] }, (_, index) => {
  const visualId = MOTIFS[index % MOTIFS.length]
  const labels = scene === 'offer' ? Array.from({ length: 3 }, (_, card) => {
    const rewards = [reward(visualId, 'Fixture label', card === 0 ? null : card + 1)]
    if (card === 0) rewards.push(unknownReward(visualId))
    return label(10 + card * 60, { name: `Name${(index + card) % 5}`, tier: index % 2 ? 2 : 3,
      visualIds: rewards.map(entry => entry.visualId), rewards })
  }) : []
  const suggestions = labels.map(card => suggestion(card.headerBox[0], { name: card.name, tier: card.tier, rewards: card.rewards.map(predicted) }))
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

test('a captured unknown slot is an abstention only when it contains no recognition claims', () => {
  const labels = [label(10, { name: null, observedName: 'Uncatalogued', tier: null, visualIds: null })]
  const empty = suggestion(10, { name: '', tier: null, visualIds: [] })
  expect(measure(labels, [empty]).metrics).toMatchObject({ unknownNameAbstentions: 1, names: { unexpected: 0 } })
  expect(measure(labels, [suggestion(10, { name: '', tier: 2 })]).metrics).toMatchObject({
    unknownNameAbstentions: 0, tiers: { unexpected: 1 }, motifs: { unexpected: 1 },
  })
})

test('semantic rewards compare the exact fields and consume repeated motifs one occurrence at a time', () => {
  const regular = reward('gold-grid', 'Additional Currency Items')
  const comboTwo = reward('gold-grid', 'Additional Currency Items', 2)
  const comboThree = reward('gold-grid', 'Additional Valuable Currency Items', 3)
  const visualIds = Array(3).fill('gold-grid')
  const labels = [label(10, { visualIds, rewards: [regular, comboTwo, comboThree] })]
  const score = rewards => measure(labels, [suggestion(10, { rewards })])
  expect(score([comboThree, comboTwo, regular].map(predicted)).metrics.rewards).toMatchObject({
    expected: 3, correct: 3, omitted: 0, unexpected: 0, abstained: 0,
  })
  for (const fields of [{ label: 'Other label' }, { kind: 'regular' }, { threshold: 3 }, { identified: false }]) {
    const { metrics } = score([predicted(regular), { ...predicted(comboTwo), ...fields }, predicted(comboThree)])
    expect(metrics.motifs).toMatchObject({ correct: 3, unexpected: 0 })
    expect(metrics.rewards).toMatchObject({ correct: 2, omitted: 1, unexpected: 1 })
  }
  expect(score([regular, comboTwo, comboThree, comboThree].map(predicted)).metrics.rewards).toMatchObject({
    correct: 3, omitted: 0, unexpected: 1,
  })
  expect(score([regular].map(predicted)).metrics.rewards).toMatchObject({ correct: 1, omitted: 2, unexpected: 0 })
  expect(score([regular, comboTwo, unknownReward('gold-grid')].map(predicted)).metrics.rewards).toMatchObject({
    correct: 2, omitted: 1, unexpected: 0, abstained: 1,
  })
  expect(labelCoverage(labels).rewards).toEqual(['gold-grid/combo-2', 'gold-grid/combo-3', 'gold-grid/regular'])
})

test('semantic abstention distinguishes a safe motif hint from an unsafe claim in an ambiguous region', () => {
  const faint = unknownReward('gold-ring')
  const claim = predicted(reward('gold-ring', 'Extremely Increased Item Rarity', 3))
  const labels = [label(10, { rewards: [faint] }), label(60, { visualIds: null, rewards: null })]
  expect(measure(labels, [suggestion(10), suggestion(60, { rewards: [] })]).metrics.rewards).toMatchObject({
    expected: 0, annotatedCards: 2, abstentionExpected: 2, abstentionCorrect: 2, unexpected: 0, abstained: 1,
  })
  expect(measure(labels, [suggestion(10, { rewards: [claim] }), suggestion(60, { rewards: [claim] })]).metrics.rewards).toMatchObject({
    expected: 0, abstentionExpected: 2, abstentionCorrect: 0, unexpected: 2, abstained: 0,
  })
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
  const badRewardRows = rows.map(row => row.profile === '1080p-sdr-default' && row.scene === 'offer'
    ? { ...row, metrics: { ...row.metrics, rewards: { ...row.metrics.rewards, correct: 0, omitted: row.metrics.rewards.expected } } } : row)
  expect(summarize('holdout', badRewardRows).failures).toContain('1080p-sdr-default/rewards recall below 0.9')
})

test('a legacy replay retains motif metrics without measuring semantic rewards or earning holdout credit', () => {
  const labels = [label(10)]
  const rows = [{ profile: '1080p-sdr-default', scene: 'offer', sceneId: 'legacy', outcome: 'measured', problems: [],
    coverage: { unknownName: false, collectedRow: false, tooltip: false }, labelCoverage: labelCoverage(labels),
    metrics: measure(labels, [suggestion(10)]).metrics }]
  expect(summarize('replay', rows)).toMatchObject({ status: 'PASS', rewardEvaluation: 'NOT_EVALUATED',
    summary: { rewards: { unannotatedCards: 1 }, recall: { motifs: 1, rewards: null } } })
  expect(summarize('holdout', rows)).toMatchObject({ status: 'FAIL', rewardEvaluation: 'NOT_EVALUATED',
    missingCoverage: expect.arrayContaining(['offer/complete-semantic-reward-annotations', 'offer/same-motif-different-reward-frames']) })
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
  const report = { reportSchemaVersion: REPORT_SCHEMA_VERSION, coveragePolicyVersion: COVERAGE_POLICY_VERSION, execution: 'local-native-replay',
    mode: 'holdout', revision, release: { ...release, helperVersion: 'test' }, productionFilesModified: false,
    manifestSha256: digest, dictionarySha256: digest, templatesSha256: digest, browserVersion: '148.0.7778.167', status: 'FAIL',
    scenes: completeRows().map((row, i) => ({ ...row, issues: [{ expected: 'Private tooltip text' }],
      provenance: { source: 'native-f9', independentlyLabeled: true, ...PROFILES[row.profile], calibration: 'Private tooltip text' },
      capture: { outcome: 'captured', pngSha256: i.toString(16).padStart(64, '0'), bundleSha256: i.toString(16).padStart(64, '0'),
        file: 'Private tooltip text', dataBase64: 'Private tooltip text' },
      helperVersion: 'test', imagePreserved: true, ocrPreserved: true, reviewRequired: true, ocrStatus: 'ok', ocrLines: 1,
      visual: { status: row.scene === 'offer' ? 'candidates' : 'not-run' },
    })) }
  const sanitized = verifyRecognitionReport(report, release, expected)
  expect(sanitized.status).toBe('PASS')
  expect(JSON.stringify(sanitized)).not.toContain('Private tooltip text')
  expect(verifyRecognitionReport(sanitized, release, expected)).toEqual(sanitized)
  expect(() => verifyRecognitionReport({ ...report, reportSchemaVersion: 2 }, release, expected)).toThrow()
  const withRewardMetrics = fields => ({ ...report, scenes: report.scenes.map((row, i) =>
    i === 0 ? { ...row, metrics: { ...row.metrics, rewards: { ...row.metrics.rewards, ...fields } } } : row) })
  expect(() => verifyRecognitionReport(withRewardMetrics({ unexpected: 1 }), release, expected)).toThrow(/unsafe/)
  expect(() => verifyRecognitionReport(withRewardMetrics({ abstentionCorrect: 0 }), release, expected)).toThrow(/semantic reward/)
  expect(() => verifyRecognitionReport(withRewardMetrics({ annotatedCards: 0 }), release, expected)).toThrow(/semantic reward/)
  expect(() => verifyRecognitionReport(withRewardMetrics({ expected: 100, correct: 100 }), release, expected)).toThrow(/semantic reward/)
  expect(() => verifyRecognitionReport({ ...report, scenes: [], status: 'PASS' }, release, expected)).toThrow()
  expect(() => verifyRecognitionReport(report, { ...release, releaseId: 'c'.repeat(64) }, expected)).toThrow(/exact release/)
  expect(() => verifyRecognitionReport(report, release, { ...expected, helperVersion: 'wrong' })).toThrow(/exact release/)
  expect(() => verifyRecognitionReport({ ...report, scenes: [report.scenes[0], ...report.scenes] }, release, expected)).toThrow(/Duplicate/)
  const withStatus = (scene, status) => ({ ...report, scenes: report.scenes.map(row => row.scene === scene ? { ...row, visual: { status } } : row) })
  expect(() => verifyRecognitionReport(withStatus('offer', 'not-run'), release, expected)).toThrow(/visual recognition/)
  expect(() => verifyRecognitionReport(withStatus('offer', 'unsupported'), release, expected)).toThrow(/candidate result/)
  for (const scene of SCENES) expect(() => verifyRecognitionReport(withStatus(scene, 'unavailable'), release, expected)).toThrow()
  expect(() => verifyRecognitionReport(withStatus('negative', 'made-up-status'), release, expected)).toThrow()
})

test('the checked-in empty holdout exits nonzero with a machine-readable failure', () => {
  const result = spawnSync(process.execPath, ['scripts/recognition-validation.mjs'], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(1)
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
    expect(result.status, result.stderr).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'FAIL', measuredScenes: 0, browserVersion: null,
      scenes: [expect.objectContaining({ outcome: 'failed', problems: ['Bundle SHA-256 does not match.'] })] })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
