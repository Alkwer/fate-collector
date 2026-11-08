import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { newCard, newOffer } from '../shared/offers.ts'

const STATUS = '/api/status'
const CAPTURES = '/api/captures'
const OBSERVATIONS = '/api/observations'
const HELPER = '/downloads/fate-collector-helper.zip'

function stagingOrigin(value) {
  const url = typeof value === 'string' ? URL.parse(value) : null
  if (!url || value.trim() !== value || !/^https:\/\/app-staging\.(?:[a-z0-9-]+\.)+workers\.dev\/?$/i.test(value)) {
    throw new Error('STAGING_URL must be an HTTPS app-staging.*.workers.dev origin.')
  }
  return url.origin
}

async function readJson(response, operation) {
  try {
    return await response.json()
  } catch {
    throw new Error(`${operation} did not return readable JSON.`)
  }
}

async function verifyReceipt(response, operation, expected) {
  const receipt = await readJson(response, operation)
  for (const [field, value] of Object.entries(expected)) {
    if (receipt?.[field] !== value) throw new Error(`${operation} returned an unexpected receipt ${field}.`)
  }
}

export async function smokeStaging({ url, expectedRevision, expectedReleaseId, captureKey, ingestKey, readOnly = false, fetch: fetchRequest = fetch }) {
  const origin = stagingOrigin(url)
  if (!/^[0-9a-f]{40}$/i.test(expectedRevision ?? '')) throw new Error('EXPECTED_REVISION must be a 40-digit hexadecimal SHA.')
  if (!/^[0-9a-f]{64}$/i.test(expectedReleaseId ?? '')) throw new Error('EXPECTED_RELEASE_ID must be a 64-digit hexadecimal ID.')
  if (!readOnly) {
    for (const [name, key] of [['COLLECTOR_CAPTURE_KEY', captureKey], ['COLLECTOR_INGEST_KEY', ingestKey]]) {
      if (typeof key !== 'string' || !key || key.trim() !== key) {
        throw new Error(`${name} must be nonempty and have no surrounding whitespace.`)
      }
    }
    if (captureKey === ingestKey) throw new Error('The capture and ingestion keys must be different.')
  }

  async function request(path, operation, expectedStatus, init = {}) {
    let response
    try {
      response = await fetchRequest(`${origin}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new Error(`${operation} failed to fetch (network error, timeout or redirect).`)
    }
    if (response.status !== expectedStatus) {
      throw new Error(`${operation} returned HTTP ${response.status}, expected ${expectedStatus}.`)
    }
    return response
  }

  const status = await readJson(await request(STATUS, 'Staging status', 200), 'Staging status')
  if (status?.environment !== 'staging') throw new Error('Staging status did not report the staging environment.')
  if (status.revision !== expectedRevision) throw new Error('Staging status revision does not match EXPECTED_REVISION.')
  if (status.releaseId !== expectedReleaseId) throw new Error('Staging status release ID does not match EXPECTED_RELEASE_ID.')
  if (status.ingestionEnabled !== true || status.captureIngestionEnabled !== true) {
    throw new Error('Staging status must report both ingestion endpoints enabled.')
  }

  const homepage = await request('/', 'Staging homepage', 200)
  if (!/^text\/html(?:\s*;|$)/i.test(homepage.headers.get('content-type') ?? '') || !/<html[\s>]/i.test(await homepage.text())) {
    throw new Error('Staging homepage did not return an HTML document.')
  }
  const helper = await request(HELPER, 'Staging helper download', 200)
  const zip = new Uint8Array(await helper.arrayBuffer())
  if (zip.length <= 4 || zip[0] !== 0x50 || zip[1] !== 0x4b || zip[2] !== 0x03 || zip[3] !== 0x04) {
    throw new Error('Staging helper download did not return a nonempty ZIP archive.')
  }
  if (readOnly) return

  function post(path, operation, expectedStatus, payload, key) {
    return request(path, operation, expectedStatus, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify(payload),
    })
  }

  const capture = {
    kind: 'fate-collector.upload',
    schemaVersion: 1,
    captureId: randomUUID(),
    capturedAt: new Date().toISOString(),
    source: 'windows-helper',
    helperVersion: 'staging-smoke',
    context: { captureMode: 'game' },
    image: { width: 64, height: 64 },
    ocr: { status: 'ok', text: '', lines: [], language: null },
  }
  const captureReceipt = { id: capture.captureId, status: 'accepted', reviewed: false }
  await verifyReceipt(await post(CAPTURES, 'Capture upload', 201, capture, captureKey), 'Capture upload', captureReceipt)
  await verifyReceipt(await post(CAPTURES, 'Capture retry', 200, capture, captureKey), 'Capture retry', { ...captureReceipt, status: 'duplicate' })

  const offer = {
    ...newOffer(),
    id: capture.captureId,
    captureId: capture.captureId,
    captureContext: capture.context,
    capturedAt: capture.capturedAt,
    origin: 'live',
    source: 'windows-helper',
    gameVersion: 'staging-smoke',
    reviewed: true,
    completeness: 'partial',
    cards: [{ ...newCard(), name: 'Staging smoke test' }],
    notes: 'Synthetic staging smoke test observation.',
  }
  const observationReceipt = { id: offer.id, revision: offer.revision, status: 'accepted' }
  await verifyReceipt(await post(OBSERVATIONS, 'Observation upload', 201, offer, ingestKey), 'Observation upload', observationReceipt)
  await verifyReceipt(await post(OBSERVATIONS, 'Observation retry', 200, offer, ingestKey), 'Observation retry', { ...observationReceipt, status: 'duplicate' })

  await post(CAPTURES, 'Capture without a key', 401, capture)
  await post(OBSERVATIONS, 'Observation without a key', 401, offer)
  await post(CAPTURES, 'Invalid capture schema', 400, { ...capture, image: { ...capture.image, width: 0 } }, captureKey)
  await post(CAPTURES, 'Capture with the ingestion key', 401, capture, ingestKey)
  await post(OBSERVATIONS, 'Observation with the capture key', 401, offer, captureKey)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env
    if (env.STAGING_READ_ONLY && !['true', 'false'].includes(env.STAGING_READ_ONLY)) {
      throw new Error('STAGING_READ_ONLY must be true or false.')
    }
    const readOnly = env.STAGING_READ_ONLY === 'true'
    await smokeStaging({
      url: env.STAGING_URL,
      expectedRevision: env.EXPECTED_REVISION,
      expectedReleaseId: env.EXPECTED_RELEASE_ID,
      captureKey: env.COLLECTOR_CAPTURE_KEY,
      ingestKey: env.COLLECTOR_INGEST_KEY,
      readOnly,
    })
    console.log(readOnly ? 'Read-only staging smoke passed.' : 'Staging ingestion smoke passed.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
