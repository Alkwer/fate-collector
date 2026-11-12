import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { SYMBOL_REPORT_VERSION, symbolConsentText } from '../shared/symbol-reports.ts'
import { pathToFileURL } from 'node:url'
import { newCard, newOffer } from '../shared/offers.ts'
import policy from '../shared/consent-policy.json' with { type: 'json' }
import { APP_VERSION, DIAGNOSTIC_VERSION, RETENTION_MS, diagnosticText, diagnosticReceiptSchema, diagnosticWithdrawalSchema } from '../shared/diagnostics.ts'

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
  const symbolConfig = await readJson(await request('/api/symbol-reports/config', 'Symbol verification configuration', 200), 'Symbol verification configuration')
  if (status.symbolReportingEnabled !== true || symbolConfig.enabled !== true || !/^0x[a-zA-Z0-9_-]+$/.test(symbolConfig.sitekey || '')) throw new Error('Staging symbol verification must be configured with a real sitekey.')
  if (readOnly) return
  if (status.consentRequired !== true || status.consentPolicyVersion !== policy.version) throw new Error('Staging must require the current consent policy.')
  if (status.diagnosticsEnabled !== true) throw new Error('Staging diagnostics must be enabled.')

  const grants = {}
  const cleanup = new Map()
  let failure
  try {
  function post(path, operation, expectedStatus, payload, key, extraHeaders = {}) {
    const consent = grants[path]
    return request(path, operation, expectedStatus, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(key && { Authorization: `Bearer ${key}` }), ...(consent && { 'X-Consent-Id': consent.id, 'X-Consent-Token': consent.token }), ...extraHeaders },
      body: JSON.stringify(payload),
    })
  }
  await post(CAPTURES, 'Capture without consent', 428, {}, captureKey)
  await post(OBSERVATIONS, 'Observation without consent', 428, {}, ingestKey)
  for (const [scope, key] of [['captures', captureKey], ['observations', ingestKey]]) {
    const grant = { id: randomUUID(), token: randomBytes(32).toString('hex'), scope, policyVersion: policy.version, acceptedAt: new Date().toISOString(), text: `${policy.common}\n\n${policy.scopes[scope]}\n\nDestination: ${origin}` }
    cleanup.set(`/api/consents/${grant.id}/withdraw`, { token: grant.token, header: 'X-Consent-Token', id: grant.id })
    const response = await post('/api/consents', 'Register consent', 201, grant, key)
    const receipt = await readJson(response, 'Register consent')
    for (const field of ['id', 'scope', 'policyVersion', 'acceptedAt', 'text']) if (receipt[field] !== grant[field]) throw new Error(`Register consent returned an unexpected receipt ${field}.`)
    if (receipt.withdrawnAt !== null || !Number.isFinite(Date.parse(receipt.recordedAt))) throw new Error('Register consent returned an invalid date or withdrawn receipt.')
    grants[`/api/${scope}`] = grant
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
  for (const [path, key, payload] of [[CAPTURES, captureKey, capture], [OBSERVATIONS, ingestKey, offer]]) {
    const grant = grants[path]
    const response = await post(`/api/consents/${grant.id}/withdraw`, 'Withdraw consent', 200, { withdrawnAt: new Date().toISOString() }, undefined, { 'X-Consent-Token': grant.token })
    await verifyReceipt(response, 'Withdraw consent', { id: grant.id, status: 'withdrawn' })
    cleanup.delete(`/api/consents/${grant.id}/withdraw`)
    await post(path, 'Upload after withdrawal', 403, payload, key)
    await post('/api/consents', 'Reusing withdrawn consent', 403, grant, key)
  }
  const report = {
    kind: 'fate-collector.diagnostics', schemaVersion: 1, id: randomUUID(), generatedAt: new Date().toISOString(), source: 'website', appVersion: APP_VERSION, environment: 'staging',
    runtime: { family: 'other', version: null, platform: 'other', online: true },
    state: { storage: 'unknown', folderConnection: 'off', sharing: 'off', queue: { pending: 0, accepted: 0, rejected: 0, ignored: 0 } }, events: [],
  }
  const diagnostic = { report, consent: { version: DIAGNOSTIC_VERSION, text: diagnosticText(origin), acceptedAt: new Date().toISOString() }, token: randomBytes(32).toString('hex') }
  cleanup.set(`/api/diagnostics/${report.id}/withdraw`, { token: diagnostic.token, header: 'X-Diagnostic-Token', id: report.id })
  await post('/api/diagnostics', 'Diagnostic without consent', 400, { report }, ingestKey)
  await post('/api/diagnostics', 'Diagnostic without key', 401, diagnostic)
  await post('/api/diagnostics', 'Diagnostic with raw log', 400, { ...diagnostic, report: { ...report, rawLog: 'SYNTHETIC_SECRET_MUST_BE_REJECTED' } }, ingestKey)
  const received = diagnosticReceiptSchema.parse(await readJson(await post('/api/diagnostics', 'Diagnostic upload', 201, diagnostic, ingestKey), 'Diagnostic upload'))
  if (received.id !== report.id || received.consent.text !== diagnostic.consent.text || received.consent.version !== diagnostic.consent.version || received.consent.acceptedAt !== diagnostic.consent.acceptedAt || received.consent.recordedAt !== received.receivedAt || Date.parse(received.expiresAt) - Date.parse(received.receivedAt) !== RETENTION_MS) throw new Error('Diagnostic receipt does not match the consent or retention.')
  const duplicate = await readJson(await post('/api/diagnostics', 'Diagnostic retry', 200, diagnostic, ingestKey), 'Diagnostic retry')
  if (JSON.stringify(duplicate) !== JSON.stringify(received)) throw new Error('Diagnostic retry changed the receipt.')
  const deleted = diagnosticWithdrawalSchema.parse(await readJson(await post(`/api/diagnostics/${report.id}/withdraw`, 'Diagnostic withdrawal', 200, { withdrawnAt: new Date().toISOString() }, undefined, { 'X-Diagnostic-Token': diagnostic.token }), 'Diagnostic withdrawal'))
  if (deleted.id !== report.id) throw new Error('Diagnostic withdrawal returned a different ID.')
  cleanup.delete(`/api/diagnostics/${report.id}/withdraw`)
  await post('/api/diagnostics', 'Diagnostic replay after withdrawal', 410, diagnostic, ingestKey)
  const png = readFileSync(new URL('../public/game-art/reward-gold-grid.png', import.meta.url))
  const image = { mimeType: 'image/png', width: png.readUInt32BE(16), height: png.readUInt32BE(20), dataBase64: png.toString('base64') }
  const symbol = { report: { kind: 'fate-collector.symbol-report', schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString(),
    offer: { id: offer.id, revision: offer.revision, captureId: capture.captureId, cardId: offer.cards[0].id, cardName: 'SYNTHETIC STAGING', rewardId: null, gameVersion: 'staging-smoke', origin: 'test', areaLevel: null },
    label: 'SYNTHETIC symbol test', rewardKind: 'unknown', threshold: null, description: 'Synthetic staging validation, not a game observation.', icon: image, tooltip: image },
    token: randomBytes(32).toString('hex'), consent: { version: SYMBOL_REPORT_VERSION, text: symbolConsentText(origin), acceptedAt: new Date().toISOString() } }
  // Real widgets are never bypassed by automation. Positive live verification is
  // performed in the staging browser with a fresh challenge before promotion.
  await post('/api/symbol-reports', 'Symbol without verification', 403, symbol)
  await post('/api/symbol-reports', 'Symbol key cannot bypass verification', 403, symbol, ingestKey)
  await post('/api/symbol-reports', 'Symbol forged verification', 403, symbol, undefined, { 'X-Turnstile-Token': 'synthetic-invalid-token' })
  } catch (error) { failure = error }
  finally {
    const failures = []
    for (const [path, entry] of cleanup) {
      try {
        const response = await request(path, 'Staging cleanup withdrawal', 200, {
          method: 'POST', headers: { 'Content-Type': 'application/json', [entry.header]: entry.token, ...(entry.key ? { Authorization: `Bearer ${entry.key}` } : {}) },
          body: JSON.stringify({ withdrawnAt: new Date().toISOString() }),
        })
        await verifyReceipt(response, 'Staging cleanup withdrawal', { id: entry.id, status: 'withdrawn' })
      } catch {
        // Never print request credentials, tokens or payloads in CI errors.
        failures.push(new Error(`Staging cleanup could not confirm withdrawal for ${path}.`))
      }
    }
    if (failures.length) throw new AggregateError([...(failure ? [failure] : []), ...failures],
      [failure?.message, 'Staging cleanup failed; synthetic data may remain in staging.'].filter(Boolean).join(' '))
  }
  if (failure) throw failure
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
