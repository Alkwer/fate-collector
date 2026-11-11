import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { z } from 'zod'
import { COVERAGE_POLICY_VERSION, MOTIFS, PROFILES, SCENES, summarize } from './recognition-validation-metrics.mjs'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().min(0).max(100000)
const metric = z.object({ expected: count, correct: count, omitted: count, unexpected: count, abstained: count })
const row = z.object({
  sceneId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), profile: z.enum(Object.keys(PROFILES)), scene: z.enum(SCENES),
  outcome: z.literal('measured'), problems: z.array(z.string()).length(0),
  provenance: z.object({ source: z.literal('native-f9'), independentlyLabeled: z.literal(true),
    clientSize: z.tuple([count, count]), hdrActive: z.boolean(), uiScale: z.enum(['default', 'alternate']) }),
  capture: z.object({ outcome: z.literal('captured'), bundleSha256: digest, pngSha256: digest }),
  helperVersion: z.string().min(1), imagePreserved: z.literal(true), ocrPreserved: z.literal(true),
  reviewRequired: z.literal(true), ocrStatus: z.literal('ok'), ocrLines: count.min(1),
  visual: z.object({ status: z.string().refine(value => value !== 'unavailable' && value !== 'not-run') }),
  metrics: z.object({ names: metric, tiers: metric, motifs: metric, wrongRows: count,
    visibleUnknownNames: count, unknownNameAbstentions: count }),
  coverage: z.object({ unknownName: z.boolean(), collectedRow: z.boolean(), tooltip: z.boolean() }),
  labelCoverage: z.object({ names: z.array(z.string().min(1)).max(100), tiers: z.array(z.union([z.literal(2), z.literal(3)])),
    motifs: z.array(z.enum(MOTIFS)).max(8) }),
})
const reportSchema = z.object({
  reportSchemaVersion: z.literal(2), coveragePolicyVersion: z.literal(COVERAGE_POLICY_VERSION),
  execution: z.literal('local-native-replay'), mode: z.literal('holdout'),
  revision: z.string().regex(/^[a-f0-9]{40}$/), productionFilesModified: z.literal(false),
  manifestSha256: digest, dictionarySha256: digest, templatesSha256: digest,
  release: z.object({ revision: z.string(), releaseId: digest, helperVersion: z.string().min(1) }),
  browserVersion: z.string().min(1), scenes: z.array(row).min(1).max(500),
})
const hash = value => createHash('sha256').update(value).digest('hex')

// Verifies a maintainer-submitted local measurement, not a server-side native replay.
// GitHub workflow identity and artifact ownership are verified by promote.yml.
export function verifyRecognitionReport(input, release, expected) {
  const report = reportSchema.parse(input)
  if (report.revision !== release.revision || report.release.revision !== release.revision
    || report.release.releaseId !== release.releaseId || report.release.helperVersion !== expected.helperVersion
    || report.dictionarySha256 !== expected.dictionarySha256 || report.templatesSha256 !== expected.templatesSha256) {
    throw new Error('Recognition report does not match the exact release, helper or frozen recognition assets.')
  }
  const ids = new Set(), pngs = new Set(), bundles = new Set()
  for (const scene of report.scenes) {
    const profile = PROFILES[scene.profile]
    if (ids.has(scene.sceneId) || pngs.has(scene.capture.pngSha256) || bundles.has(scene.capture.bundleSha256)) throw new Error('Duplicate native scene or capture.')
    ids.add(scene.sceneId); pngs.add(scene.capture.pngSha256); bundles.add(scene.capture.bundleSha256)
    if (scene.helperVersion !== expected.helperVersion || scene.provenance.hdrActive !== profile.hdrActive
      || scene.provenance.uiScale !== profile.uiScale || scene.provenance.clientSize.some((side, i) => side !== profile.clientSize[i])) throw new Error('Native profile or helper mismatch.')
    if (scene.metrics.wrongRows || scene.metrics.visibleUnknownNames !== scene.metrics.unknownNameAbstentions) throw new Error('Unsafe row or unknown-name acceptance.')
    for (const field of ['names', 'tiers', 'motifs']) {
      const metric = scene.metrics[field]
      if (metric.correct > metric.expected || metric.omitted !== metric.expected - metric.correct || metric.unexpected) throw new Error('Inconsistent or unsafe recognition metrics.')
      if (new Set(scene.labelCoverage[field]).size !== scene.labelCoverage[field].length
        || scene.labelCoverage[field].length > metric.expected) throw new Error('Inconsistent distinct-label coverage.')
    }
    if (scene.labelCoverage.names.some(name => !expected.fateNames.includes(name))) throw new Error('Coverage name is outside the frozen dictionary.')
    if (scene.scene !== 'offer' && ['names', 'tiers', 'motifs'].some(field => scene.metrics[field].expected || scene.metrics[field].correct)) throw new Error('Positive suggestions outside the offered row.')
  }
  const verdict = summarize('holdout', report.scenes)
  if (verdict.status !== 'PASS') throw new Error(`Recognition holdout failed: ${[...verdict.failures, ...verdict.missingCoverage].join(', ')}`)
  return { ...report, independentReleaseGate: 'PASS', ...verdict }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = new URL('../', import.meta.url)
  const readJson = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
  const reportPath = process.argv[2]
  if (!reportPath) throw new Error('Usage: node scripts/verify-recognition-release.mjs report.json [release.json]')
  const [input, release, helper, dictionary, templates] = await Promise.all([
    readJson(reportPath), readJson(process.argv[3] ?? '.release/release.json'),
    readJson(new URL('shared/helper-release.json', root)), readFile(new URL('shared/fate-names.json', root)),
    readFile(new URL('shared/visual-templates.json', root)),
  ])
  const result = JSON.stringify(verifyRecognitionReport(input, release, { helperVersion: helper.version, fateNames: JSON.parse(dictionary.toString('utf8')),
    dictionarySha256: hash(dictionary), templatesSha256: hash(templates) }))
  console.log(process.argv[4] === '--github-input' ? gzipSync(result).toString('base64') : result)
}
