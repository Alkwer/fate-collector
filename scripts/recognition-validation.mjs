import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { COVERAGE_POLICY_VERSION, labelCoverage, measure, MINIMUM_LABELS, MINIMUM_RECALL, MINIMUM_SCENES, PROFILES, SCENES, summarize } from './recognition-validation-metrics.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const defaultManifest = resolve(root, 'tests/fixtures/recognition-validation-holdout.json')
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = async file => JSON.parse((await readFile(resolve(root, file), 'utf8')).replace(/^\uFEFF/, ''))
const text = z.string().trim().min(1)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const size = z.number().int().positive()
const cropSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: size, height: size }).strict()
const motif = z.enum(['blue-diamond', 'gold-stack', 'gold-grid', 'gold-ring', 'silver-cluster', 'orange-feathers', 'three-gems', 'gold-axe'])
const cardSchema = z.object({
  group: z.enum(['offered', 'collected', 'invoked', 'tooltip']),
  headerBox: z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().positive(), z.number().positive()]),
  name: text.nullable(), observedName: text.optional(), tier: z.union([z.literal(2), z.literal(3)]).nullable(),
  visualIds: z.array(motif).nullable(),
}).strict()
const native = z.object({
  source: z.literal('native-f9'), gameBuild: text, windowsBuild: text, windowMode: text, uiScaleSetting: text,
  uiScale: z.enum(['default', 'alternate']), clientSize: z.tuple([size, size]), displayScaling: size,
  hdrActive: z.boolean(), captureColorPath: text, configuredBackend: z.literal('auto'),
  occluded: z.boolean(), observedBackend: z.enum(['gdi', 'wgc']).optional(), calibration: text,
  independentlyLabeled: z.literal(true),
}).strict()
const sampleSchema = z.object({
  sceneId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), profile: z.enum(Object.keys(PROFILES)).optional(), scene: z.enum(SCENES),
  provenance: z.union([native, z.object({ source: z.enum(['press-replay', 'historical-f9']), description: text }).strict()]),
  tooltip: z.boolean(), cards: z.array(cardSchema),
  capture: z.union([
    z.object({ outcome: z.literal('captured'), file: text, bundleSha256: digest, pngSha256: digest, crop: cropSchema.optional() }).strict(),
    z.object({ outcome: z.literal('refused'), reason: text }).strict(),
  ]),
}).strict()
const manifestSchema = z.object({
  schemaVersion: z.literal(1), mode: z.enum(['holdout', 'replay']),
  release: z.object({ revision: z.string().regex(/^[0-9a-f]{40}$/), helperVersion: text, releaseId: digest }).strict().nullable(),
  scenes: z.array(sampleSchema),
}).strict()

async function previousImageHashes() {
  const base = 'prototypes/vision/fixtures/'
  const [development, oldHoldout, archived, templates, presentation] = await Promise.all(
    [`${base}dataset.json`, `${base}holdout-v2.json`, `${base}native-candidates.json`, 'shared/visual-templates.json',
      'tests/fixtures/presentation-ocr.json'].map(readJson))
  return new Set([...development.images, ...oldHoldout.images].flatMap(image => [image.sha256, image.sourceSha256])
    .concat(archived.map(image => image.sha256), Object.values(templates.sources),
      Object.values(presentation.cases).map(image => image.sourceSha256)))
}

function validateScene(sample, mode) {
  const { scene, cards, tooltip, provenance, profile } = sample
  const expectedGroup = { offer: 'offered', invoke: 'invoked' }[scene]
  if (scene === 'negative' ? cards.length || tooltip : !cards.some(card => card.group === expectedGroup)) throw new Error('Scene annotations do not match its type.')
  if (scene !== 'offer' && cards.some(card => card.group === 'offered')) throw new Error('Only an offer can label offered cards.')
  if (mode === 'holdout') {
    const plan = PROFILES[profile]
    if (!plan || provenance.source !== 'native-f9' || provenance.uiScale !== plan.uiScale || provenance.hdrActive !== plan.hdrActive
      || provenance.clientSize.some((side, index) => side !== plan.clientSize[index])) throw new Error('Native provenance differs from the profile.')
    if (sample.capture.outcome === 'captured' && !sample.capture.crop) throw new Error('Record the calibrated crop in client pixel coordinates.')
  } else if (provenance.source === 'native-f9') throw new Error('Use a holdout manifest for release F9 samples.')
  for (const card of cards) {
    if ((card.name !== null && card.observedName) || ((card.group !== 'offered' || card.name === null)
      && (card.tier !== null || card.visualIds !== null))) throw new Error('Use tier and motif labels for offered, dictionary-known names only.')
    if (card.group === 'tooltip' && !tooltip) throw new Error('A tooltip label needs tooltip evidence.')
  }
}

function checkBoxes(cards, { width, height }) {
  const boxes = []
  for (const { headerBox: [x, y, w, h] } of cards) {
    const right = x + w
    const bottom = y + h
    if (right > width || bottom > height || boxes.some(box => x < box.right && right > box.x && y < box.bottom && bottom > box.y)) {
      throw new Error('A header box overlaps another label or extends outside the captured PNG.')
    }
    boxes.push({ x, y, right, bottom })
  }
}

async function loadCapture(sample, directory, seen, mode, release) {
  const { capture, provenance, cards } = sample
  const path = await realpath(resolve(directory, capture.file))
  const fromDirectory = relative(directory, path)
  if (isAbsolute(capture.file) || isAbsolute(fromDirectory) || fromDirectory === '..' || fromDirectory.startsWith(`..${sep}`)
    || !path.toLowerCase().endsWith('.json')) throw new Error('Use a relative bundle JSON path inside the manifest directory.')
  if ((await stat(path)).size > 12 * 1024 * 1024) throw new Error('Bundle exceeds the production import size limit.')
  const bytes = await readFile(path)
  if (sha256(bytes) !== capture.bundleSha256) throw new Error('Bundle SHA-256 does not match.')
  const input = bytes.toString('utf8')
  const bundle = JSON.parse(input.replace(/^\uFEFF/, ''))
  const image = bundle?.image
  if (typeof image?.dataBase64 !== 'string') throw new Error('Bundle does not contain the original image.')
  const png = Buffer.from(image.dataBase64, 'base64')
  if (sha256(png) !== capture.pngSha256) throw new Error('Embedded PNG SHA-256 does not match.')
  if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature) || png.toString('ascii', 12, 16) !== 'IHDR'
    || png.readUInt32BE(16) !== image.width || png.readUInt32BE(20) !== image.height) {
    throw new Error('Embedded PNG header does not match bundle dimensions.')
  }
  if (seen.pngs.has(capture.pngSha256) || seen.captureIds.has(bundle.captureId)) throw new Error('Duplicate capture or previously used PNG hash.')
  seen.pngs.add(capture.pngSha256)
  seen.captureIds.add(bundle.captureId)
  if (mode === 'holdout') {
    const { x, y, width, height } = capture.crop
    const [clientWidth, clientHeight] = provenance.clientSize
    if (bundle.context?.captureMode !== 'game' || !bundle.context.session || bundle.helperVersion !== release?.helperVersion) {
      throw new Error('Bundle must come from an F9 session of the selected game-mode staging helper.')
    }
    if (x + width > clientWidth || y + height > clientHeight || image.width !== width || image.height !== height
      || image.frameHeight !== clientHeight) throw new Error('Bundle dimensions or full-frame height differ from the calibrated client crop.')
  }
  checkBoxes(cards, image)
  return { input, helperVersion: bundle.helperVersion }
}

async function openBrowser() {
  const [{ createServer }, { chromium }] = await Promise.all([import('vite'), import('@playwright/test')])
  const server = await createServer({ root, configFile: false, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  let browser
  try {
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    browser = await chromium.launch({ channel: process.env.FATE_VALIDATION_BROWSER_CHANNEL })
    const page = await browser.newPage({ serviceWorkers: 'block' })
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin || route.request().method() !== 'GET') return route.abort()
      return url.pathname === '/__recognition_validation__'
        ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local recognition validation</title>' }) : route.continue()
    })
    await page.goto(`${origin}/__recognition_validation__`)
    return { page, version: browser.version(), close: async () => { await browser.close(); await server.close() } }
  } catch (error) {
    await browser?.close()
    await server.close()
    throw error
  }
}

function recognize(page, input, cards) {
  return page.evaluate(async ({ input, cards }) => {
    const [{ importJson }, { findOfferedRegion, knownFateName, PARSER_VERSION }, { VISUAL_VERSION }] = await Promise.all([
      import('/src/lib/imports.ts'), import('/shared/recognition.ts'), import('/shared/visual-recognition.ts'),
    ])
    if (cards.some(card => (card.name && knownFateName(card.name) !== card.name) || (card.observedName && knownFateName(card.observedName)))) {
      throw new Error('Manual names do not agree with the frozen dictionary.')
    }
    const { entries: [{ offer, evidence }] } = await importJson(input, true)
    const capture = JSON.parse(input.replace(/^\uFEFF/, ''))
    const headers = findOfferedRegion(capture)?.headers.filter(header => knownFateName(header.text)) ?? []
    const locationsAvailable = headers.length === offer.cards.length && offer.cards.every((card, index) => knownFateName(headers[index].text) === card.name)
    return {
      parserVersion: PARSER_VERSION, visualVersion: VISUAL_VERSION,
      imagePreserved: evidence.imageDataUrl === `data:image/png;base64,${capture.image.dataBase64}`,
      ocrPreserved: evidence.ocrText === capture.ocr.text && evidence.ocrStatus === capture.ocr.status
        && evidence.ocrLines.length === capture.ocr.lines.length && evidence.ocrLines.every((line, index) =>
          Object.entries(line).every(([key, value]) => capture.ocr.lines[index][key] === value)),
      ocrStatus: evidence.ocrStatus, ocrLines: evidence.ocrLines.length,
      visual: evidence.visualRecognition ?? { status: 'not-run', warnings: [] }, locationsAvailable,
      reviewRequired: !offer.reviewed && offer.cards.every(card =>
        (card.tier === null || card.visualReview?.tierReviewed === false)
        && (!card.rewards.length || card.visualReview?.rewardsReviewed === false)),
      suggestions: offer.cards.map((card, index) => {
        const line = locationsAvailable ? headers[index] : null
        return { name: card.name, tier: card.tier, visualIds: card.rewards.map(reward => reward.visualId),
          header: line && { x: line.x, y: line.y, width: line.width, height: line.height } }
      }),
    }
  }, { input, cards })
}

async function main() {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/recognition-validation.mjs [manifest.json]')
  const manifest = await realpath(resolve(process.argv[2] ?? defaultManifest))
  const manifestBytes = await readFile(manifest)
  const { mode, release, scenes } = manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, '')))
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const revision = git('rev-parse', 'HEAD')
  const productionFilesModified = Boolean(git('status', '--porcelain', '--', 'src', 'shared', 'helpers', 'package.json', 'package-lock.json', 'vite.config.ts'))
  const dictionarySha256 = sha256(await readFile(resolve(root, 'shared/fate-names.json')))
  const templatesSha256 = sha256(await readFile(resolve(root, 'shared/visual-templates.json')))
  const releaseProblems = mode === 'holdout' ? [
    ...(!release || release.revision !== revision ? ['matching staging release required'] : []),
    ...(productionFilesModified ? ['production source differs from the checked out revision'] : []),
  ] : []
  const seen = { ids: new Set(), captureIds: new Set(), pngs: mode === 'holdout' ? await previousImageHashes() : new Set() }
  const rows = []
  let browser
  let browserLaunch
  try {
    for (const sample of scenes) {
      const { sceneId, profile, scene, provenance, capture, cards, tooltip } = sample
      const expectedBackend = provenance.source === 'native-f9' ? (provenance.hdrActive || provenance.occluded ? 'wgc' : 'gdi') : null
      const { file: _privatePath, reason: _privateReason, ...captureEvidence } = capture
      const row = { sceneId, profile, scene, provenance, capture: captureEvidence, expectedBackend, outcome: 'failed', problems: [] }
      rows.push(row)
      try {
        if (seen.ids.has(sceneId)) throw new Error('Duplicate scene ID.')
        seen.ids.add(sceneId)
        validateScene(sample, mode)
        if (provenance.observedBackend && provenance.observedBackend !== expectedBackend) row.problems.push('Observed backend disagrees with the expected auto path.')
        if (capture.outcome === 'refused') {
          row.outcome = 'refused'
          row.problems.push(capture.reason)
          continue
        }
        const { input, helperVersion } = await loadCapture(sample, dirname(manifest), seen, mode, release)
        row.helperVersion = helperVersion
        browser = await (browserLaunch ??= openBrowser())
        const { suggestions, locationsAvailable, ...result } = await recognize(browser.page, input, cards)
        Object.assign(row, result, measure(cards, suggestions), { labelCoverage: labelCoverage(cards) })
        if (!result.imagePreserved || !result.ocrPreserved || !result.reviewRequired || !locationsAvailable) row.problems.push('Import evidence, coordinate mapping or manual review check failed.')
        if (result.ocrStatus !== 'ok' || result.ocrLines === 0 || result.visual.status === 'unavailable') {
          row.outcome = 'unavailable'
          row.problems.push('Positioned OCR or the browser visual worker was unavailable.')
          continue
        }
        row.outcome = 'measured'
        row.coverage = {
          unknownName: cards.some(card => card.group === 'offered' && card.name === null && card.observedName),
          collectedRow: cards.some(card => card.group === 'collected' && card.name !== null),
          tooltip: tooltip && cards.some(card => card.group === 'offered' && card.name !== null && card.visualIds === null),
        }
      } catch (error) {
        row.problems.push(error.code ? `Local read failed (${error.code}).` : String(error.message).split('\n')[0])
      }
    }
  } finally {
    await browser?.close()
  }
  const verdict = summarize(mode, rows, releaseProblems)
  console.log(JSON.stringify({ reportSchemaVersion: 2, coveragePolicyVersion: COVERAGE_POLICY_VERSION,
    execution: 'local-native-replay', mode, independentReleaseGate: mode === 'holdout' ? verdict.status : 'NOT_EVALUATED',
    manifestSha256: sha256(manifestBytes), revision, productionFilesModified, dictionarySha256, templatesSha256,
    release, browserVersion: browser?.version ?? null, minimumRecallPerProfile: mode === 'holdout' ? MINIMUM_RECALL : null,
    minimumScenesPerProfile: mode === 'holdout' ? MINIMUM_SCENES : null, minimumLabelsPerProfile: mode === 'holdout' ? MINIMUM_LABELS : null,
    ...verdict, scenes: rows }, null, 2))
  return verdict.status === 'PASS' ? 0 : 1
}

main().then(code => { process.exitCode = code }).catch(error => {
  console.log(JSON.stringify({ status: 'FAIL', problems: [String(error.message)] }, null, 2))
  process.exitCode = 2
})
