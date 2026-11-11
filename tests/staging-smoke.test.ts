import { CONSENT_VERSION, consentText } from '../shared/consent'
import { RETENTION_MS, diagnosticSubmissionSchema, diagnosticText } from '../shared/diagnostics'
import { expect, it, vi } from 'vitest'
import { submissionProblem } from '../shared/offers'
import { captureUploadSchema, offerSchema } from '../shared/schema'
// @ts-expect-error The standalone Node CLI does not have a TypeScript declaration.
import { smokeStaging } from '../scripts/smoke-staging.mjs'

const url = 'https://app-staging.collector.workers.dev'
const expectedRevision = 'a'.repeat(40)
const expectedReleaseId = 'b'.repeat(64)
const captureKey = 'capture-test-key'
const ingestKey = 'ingest-test-key'
const status = {
  environment: 'staging', revision: expectedRevision, releaseId: expectedReleaseId,
  ingestionEnabled: true, captureIngestionEnabled: true, consentRequired: true, consentPolicyVersion: CONSENT_VERSION, diagnosticsEnabled: true,
}
const options = { url, expectedRevision, expectedReleaseId, captureKey, ingestKey }

function mockStaging(override?: (path: string, method: string, init?: RequestInit) => Response | undefined) {
  const uploads = new Set<string>()
  const grants = new Map<string, { id: string; token: string; scope: string }>()
  const withdrawn = new Set<string>()
  const diagnostics = new Map<string, { token: string; receipt: unknown }>()
  return vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    const response = override?.(path, method, init)
    if (response) return response
    if (method === 'GET') {
      if (path === '/api/status') return Response.json(status)
      if (path === '/') return new Response('<!doctype html><html><title>Fate Collector</title></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      if (path === '/downloads/fate-collector-helper.zip') return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20]))
    }
    if (method === 'POST' && path === '/api/consents') {
      const grant = JSON.parse(String(init?.body))
      if (withdrawn.has(grant.id)) return new Response(null, { status: 403 })
      expect(grant.text).toBe(consentText(grant.scope, url))
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ' + (grant.scope === 'captures' ? captureKey : ingestKey))
      grants.set(grant.id, grant)
      const { token: _secret, ...receipt } = grant
      return Response.json({ ...receipt, recordedAt: new Date().toISOString(), withdrawnAt: null }, { status: 201 })
    }
    if (method === 'POST' && path === '/api/diagnostics') {
      if (new Headers(init?.headers).get('Authorization') !== 'Bearer ' + ingestKey) return new Response(null, { status: 401 })
      const parsed = diagnosticSubmissionSchema.safeParse(JSON.parse(String(init?.body)))
      if (!parsed.success) return new Response(null, { status: 400 })
      const { report, consent, token } = parsed.data
      expect(consent.text).toBe(diagnosticText(url))
      if (withdrawn.has(report.id)) return new Response(null, { status: 410 })
      const existing = diagnostics.get(report.id)
      if (existing) return Response.json(existing.receipt)
      const receivedAt = new Date().toISOString()
      const receipt = { id: report.id, status: 'received', receivedAt, expiresAt: new Date(Date.parse(receivedAt) + RETENTION_MS).toISOString(), consent: { ...consent, recordedAt: receivedAt } }
      diagnostics.set(report.id, { token, receipt })
      return Response.json(receipt, { status: 201 })
    }
    if (method === 'POST' && path.endsWith('/withdraw')) {
      const id = path.split('/')[3]
      if (path.startsWith('/api/diagnostics/')) expect(new Headers(init?.headers).get('X-Diagnostic-Token')).toBe(diagnostics.get(id)?.token)
      else expect(new Headers(init?.headers).get('X-Consent-Token')).toBe(grants.get(id)?.token)
      withdrawn.add(id)
      return Response.json({ id, status: 'withdrawn', withdrawnAt: new Date().toISOString() })
    }
    if (method !== 'POST' || (path !== '/api/captures' && path !== '/api/observations')) return new Response(null, { status: 404 })

    const isCapture = path === '/api/captures'
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${isCapture ? captureKey : ingestKey}`) {
      return new Response(null, { status: 401 })
    }
    const headers = new Headers(init?.headers)
    const id = headers.get('X-Consent-Id')
    if (!id) return new Response(null, { status: 428 })
    const consent = grants.get(id)
    if (!consent || withdrawn.has(id) || consent.token !== headers.get('X-Consent-Token') || consent.scope !== (isCapture ? 'captures' : 'observations')) return new Response(null, { status: 403 })
    const body: unknown = JSON.parse(String(init?.body))
    const parsed = isCapture ? captureUploadSchema.safeParse(body) : offerSchema.safeParse(body)
    if (!parsed.success) return new Response(null, { status: 400 })
    const key = `${path}:${init?.body}`
    const duplicate = uploads.has(key)
    uploads.add(key)
    const receipt = 'id' in parsed.data
      ? { id: parsed.data.id, revision: parsed.data.revision }
      : { id: parsed.data.captureId, reviewed: false }
    return Response.json({ ...receipt, status: duplicate ? 'duplicate' : 'accepted' }, { status: duplicate ? 200 : 201 })
  })
}

it.each([
  'https://app.collector.workers.dev',
  'https://app-staging.collector.workers.dev.example.com',
  'https://app-staging.workers.dev',
  'http://app-staging.collector.workers.dev',
  'https://user@app-staging.collector.workers.dev',
  'https://app-staging.collector.workers.dev:8443',
  `${url}/nested/..`,
  `${url}/?`,
  `${url}/#`,
])('rejects a non-staging origin before fetching %s', async (target) => {
  const fetch = mockStaging()
  await expect(smokeStaging({ ...options, url: target, fetch })).rejects.toThrow('STAGING_URL')
  expect(fetch).not.toHaveBeenCalled()
})

it.each([
  [{ environment: 'production' }, 'environment'],
  [{ revision: 'c'.repeat(40) }, 'EXPECTED_REVISION'],
  [{ releaseId: 'c'.repeat(64) }, 'EXPECTED_RELEASE_ID'],
  [{ ingestionEnabled: false }, 'ingestion endpoints enabled'],
  [{ captureIngestionEnabled: 'true' }, 'ingestion endpoints enabled'],
])('rejects mismatched deployment status %j before posting', async (mismatch, message) => {
  const fetch = mockStaging(() => Response.json({ ...status, ...mismatch }))
  await expect(smokeStaging({ ...options, fetch })).rejects.toThrow(message)
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`${url}/api/status`, expect.objectContaining({ redirect: 'error' }))
})

it.each([
  [{ captureKey: '' }, 'COLLECTOR_CAPTURE_KEY'],
  [{ ingestKey: ' ' }, 'COLLECTOR_INGEST_KEY'],
  [{ ingestKey: captureKey }, 'must be different'],
])('rejects invalid key configuration before fetching', async (keys, message) => {
  const fetch = mockStaging()
  await expect(smokeStaging({ ...options, ...keys, fetch })).rejects.toThrow(message)
  expect(fetch).not.toHaveBeenCalled()
})

it('performs only unauthenticated GET requests in read-only mode', async () => {
  const fetch = mockStaging()
  await smokeStaging({ url: `${url}/`, expectedRevision, expectedReleaseId, readOnly: true, fetch })
  expect(fetch.mock.calls.map(([input, init]) => [input, init?.method ?? 'GET', init?.headers])).toEqual([
    [`${url}/api/status`, 'GET', undefined],
    [`${url}/`, 'GET', undefined],
    [`${url}/downloads/fate-collector-helper.zip`, 'GET', undefined],
  ])
})

it('requires consent, uploads both channels, and rejects reuse after withdrawing both grants', async () => {
  const fetch = mockStaging()
  await smokeStaging({ ...options, fetch })
  const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
  const grants = posts.filter(([input]) => String(input).endsWith('/api/consents'))
  expect(grants).toHaveLength(4) // two registrations, two rejected attempts to reuse withdrawn IDs
  const captures = posts.filter(([input, init]) => String(input).endsWith('/api/captures') && JSON.parse(String(init?.body)).kind && new Headers(init?.headers).get('Authorization') === 'Bearer ' + captureKey)
  const observations = posts.filter(([input, init]) => String(input).endsWith('/api/observations') && JSON.parse(String(init?.body)).kind && new Headers(init?.headers).get('Authorization') === 'Bearer ' + ingestKey)
  const capture = captureUploadSchema.parse(JSON.parse(String(captures[0][1]?.body)))
  const observation = offerSchema.parse(JSON.parse(String(observations[0][1]?.body)))
  expect(capture.helperVersion).toBe('staging-smoke')
  expect(observation.captureId).toBe(capture.captureId)
  expect(observation.notes).toMatch(/synthetic/i)
  expect(submissionProblem(observation)).toBeNull()
  expect(captures[1][1]?.body).toBe(captures[0][1]?.body)
  expect(observations[1][1]?.body).toBe(observations[0][1]?.body)
  expect(posts.filter(([input]) => String(input).endsWith('/withdraw'))).toHaveLength(3)
  for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) })
})

it('stops before sending an observation when the capture receipt is wrong', async () => {
  const fetch = mockStaging((path, method, init) => path === '/api/captures' && method === 'POST' && String(init?.body) !== '{}'
    ? Response.json({ id: 'wrong-id', status: 'accepted', reviewed: false }, { status: 201 })
    : undefined)
  await expect(smokeStaging({ ...options, fetch })).rejects.toThrow('Capture upload returned an unexpected receipt id.')
  expect(fetch.mock.calls.some(([input, init]) => String(input).endsWith('/api/observations') && JSON.parse(String(init?.body || '{}')).kind)).toBe(false)
  expect(fetch.mock.calls.filter(([input]) => String(input).endsWith('/withdraw'))).toHaveLength(2)
})

it('withdraws diagnostics after a failed receipt and reports cleanup failure separately without credentials', async () => {
  const fetch = mockStaging((path, method, init) => {
    if (path === '/api/diagnostics' && method === 'POST' && new Headers(init?.headers).get('Authorization') === 'Bearer ' + ingestKey && JSON.parse(String(init?.body)).token && !JSON.parse(String(init?.body)).report.rawLog)
      return Response.json({ id: 'invalid-receipt' }, { status: 201 })
    if (path.startsWith('/api/diagnostics/') && path.endsWith('/withdraw')) return new Response(null, { status: 503 })
  })
  let failure: unknown
  try { await smokeStaging({ ...options, fetch }) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as Error).message).toContain('cleanup failed')
  expect(String(failure)).not.toContain(ingestKey)
  expect(fetch.mock.calls.some(([input]) => String(input).includes('/api/diagnostics/') && String(input).endsWith('/withdraw'))).toBe(true)
})

it('withdraws a grant even when the server accepted it but its acknowledgement was lost', async () => {
  const server = mockStaging()
  let loseAcknowledgement = true
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const response = await server(input, init)
    if (String(input).endsWith('/api/consents') && loseAcknowledgement) {
      loseAcknowledgement = false
      throw new Error('lost response')
    }
    return response
  })
  await expect(smokeStaging({ ...options, fetch })).rejects.toThrow('Register consent failed to fetch')
  expect(fetch.mock.calls.filter(([input]) => String(input).endsWith('/withdraw'))).toHaveLength(1)
})

it('rejects an HTML fallback at the helper download URL before posting', async () => {
  const fetch = mockStaging(path => path === '/downloads/fate-collector-helper.zip' ? new Response('<html>Fallback</html>') : undefined)
  await expect(smokeStaging({ ...options, fetch })).rejects.toThrow('nonempty ZIP archive')
  expect(fetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
})

it('reports an unexpected HTTP status without printing the response body', async () => {
  const fetch = mockStaging((path, method, init) => path === '/api/captures' && method === 'POST' && String(init?.body) !== '{}'
    ? new Response(captureKey, { status: 503 })
    : undefined)
  await expect(smokeStaging({ ...options, fetch })).rejects.toThrow(/^Capture upload returned HTTP 503, expected 201\.$/)
})
