import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { expect, test } from 'vitest'

const channel = process.env.FATE_VALIDATION_BROWSER_CHANNEL
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const cases = [
  { tile: 8, visualId: 'gold-grid', kind: 'regular', label: 'Additional Currency Items', threshold: null },
  { tile: 3, visualId: 'gold-grid', kind: 'combo', label: 'Additional Currency Items', threshold: 2 },
  { tile: 4, visualId: 'gold-grid', kind: 'combo', label: 'Additional Valuable Currency Items', threshold: 3 },
  { tile: 2, visualId: 'gold-stack', kind: 'unknown' },
]
const width = 1000
const height = 950

async function makeImages() {
  const frames = await readFile(new URL('./fixtures/reward-frames.png', import.meta.url), 'base64')
  const browser = await chromium.launch({ channel })
  try {
    const page = await browser.newPage()
    return await page.evaluate(async ({ frames, cases, width, height }) => {
      const bytes = Uint8Array.from(atob(frames), character => character.charCodeAt(0))
      const sheet = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      return cases.map(({ tile, kind }) => {
        // Reuse real pixels with the fixed 2160p header and motif geometry of the visual unit fixture.
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { alpha: false })
        context.fillStyle = 'rgb(150, 124, 86)'
        context.fillRect(290, 150, 320, 60)
        context.drawImage(sheet, tile * 96, 0, 96, 96, 410, 645, 96, 96)
        if (kind === 'unknown') {
          context.fillStyle = 'black'
          context.fillRect(424, 717, 72, 20)
        }
        return canvas.toDataURL('image/png').split(',')[1]
      })
    }, { frames, cases, width, height })
  } finally {
    await browser.close()
  }
}

test.skipIf(!channel)('the local browser replay validates semantic claims and safe abstention from real reward crops', { timeout: 60_000 }, async () => {
  const images = await makeImages()
  const directory = await mkdtemp(join(tmpdir(), 'fate-validation-frames-'))
  try {
    const scenes = await Promise.all(cases.map(async ({ tile, ...reward }, index) => {
      const dataBase64 = images[index]
      const lines = [
        { text: 'Fates', x: 420, y: 70, width: 60, height: 24 },
        { text: 'Black Frost', x: 400, y: 165, width: 100, height: 30 },
        { text: 'Confirm', x: 420, y: 880, width: 60, height: 25 },
      ]
      const bundle = JSON.stringify({ kind: 'fate-collector.capture', schemaVersion: 1,
        captureId: randomUUID(), capturedAt: '2026-11-18T00:00:00.000Z', source: 'windows-helper', helperVersion: '0.10.6',
        context: { captureMode: 'fixture' },
        image: { mimeType: 'image/png', width, height, frameHeight: 2160, dataBase64 },
        ocr: { status: 'ok', text: lines.map(line => line.text).join('\n'), lines, language: 'en-US' } })
      const file = `frame-${tile}.json`
      await writeFile(join(directory, file), bundle)
      return { sceneId: `frame-${tile}`, scene: 'offer', tooltip: false,
        provenance: { source: 'fixture-replay', description: 'Isolated gameplay crop with controlled OCR and geometry' },
        cards: [{ group: 'offered', headerBox: [400, 165, 100, 30], name: 'Black Frost', tier: null,
          visualIds: [reward.visualId], rewards: [reward] }],
        capture: { outcome: 'captured', file, bundleSha256: sha256(bundle), pngSha256: sha256(Buffer.from(dataBase64, 'base64')) } }
    }))
    const manifestPath = join(directory, 'manifest.json')
    const replay = async expectedStatus => {
      await writeFile(manifestPath, JSON.stringify({ schemaVersion: 2, mode: 'replay', release: null, scenes }))
      const run = spawnSync(process.execPath, ['scripts/recognition-validation.mjs', manifestPath], { encoding: 'utf8', timeout: 25_000 })
      expect(run.status, run.error?.message || run.stderr || run.stdout).toBe(expectedStatus)
      return JSON.parse(run.stdout)
    }
    const report = await replay(0)
    expect(report).toMatchObject({ status: 'PASS', independentReleaseGate: 'NOT_EVALUATED', rewardEvaluation: 'MEASURED', measuredScenes: 4,
      summary: { recall: { rewards: 1 }, rewards: { expected: 3, correct: 3, omitted: 0, unexpected: 0,
        abstentionExpected: 1, abstentionCorrect: 1, abstained: 1 } } })
    expect(report.scenes.flatMap(row => row.labelCoverage.rewards)).toEqual(['gold-grid/regular', 'gold-grid/combo-2', 'gold-grid/combo-3'])
    expect(report.scenes.every(row => row.imagePreserved && row.ocrPreserved && row.reviewRequired)).toBe(true)
    scenes[1].cards[0].rewards[0].threshold = 3
    const wrongThreshold = await replay(1)
    expect(wrongThreshold).toMatchObject({ status: 'FAIL', summary: { recall: { motifs: 1 }, rewards: { expected: 3, correct: 2,
      omitted: 1, unexpected: 1 } } })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
