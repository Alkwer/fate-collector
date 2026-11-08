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
  ingestionEnabled: true, captureIngestionEnabled: true,
}
const options = { url, expectedRevision, expectedReleaseId, captureKey, ingestKey }

function mockStaging(override?: (path: string, method: string) => Response | undefined) {
  const uploads = new Set<string>()
  return vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    const response = override?.(path, method)
    if (response) return response
    if (method === 'GET') {
      if (path === '/api/status') return Response.json(status)
      if (path === '/') return new Response('<!doctype html><html><title>Fate Collector</title></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      if (path === '/downloads/fate-collector-helper.zip') return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20]))
    }
    if (method !== 'POST' || (path !== '/api/captures' && path !== '/api/observations')) return new Response(null, { status: 404 })

    const isCapture = path === '/api/captures'
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${isCapture ? captureKey : ingestKey}`) {
      return new Response(null, { status: 401 })
    }
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

it('uploads a synthetic capture and linked observation, retries both and checks rejected posts', async () => {
  const fetch = mockStaging()
  await smokeStaging({ ...options, fetch })
  const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
  const capturePath = `${url}/api/captures`
  const observationPath = `${url}/api/observations`
  expect(posts.map(([input, init]) => [input, new Headers(init?.headers).get('Authorization')])).toEqual([
    [capturePath, `Bearer ${captureKey}`],
    [capturePath, `Bearer ${captureKey}`],
    [observationPath, `Bearer ${ingestKey}`],
    [observationPath, `Bearer ${ingestKey}`],
    [capturePath, null],
    [observationPath, null],
    [capturePath, `Bearer ${captureKey}`],
    [capturePath, `Bearer ${ingestKey}`],
    [observationPath, `Bearer ${captureKey}`],
  ])
  const capture = captureUploadSchema.parse(JSON.parse(String(posts[0][1]?.body)))
  expect(capture).toMatchObject({
    helperVersion: 'staging-smoke', context: { captureMode: 'game' }, image: { width: 64, height: 64 },
    ocr: { status: 'ok', text: '', lines: [], language: null },
  })
  const observation = offerSchema.parse(JSON.parse(String(posts[2][1]?.body)))
  expect(observation).toMatchObject({
    captureId: capture.captureId, origin: 'live', source: 'windows-helper', gameVersion: 'staging-smoke',
    reviewed: true, completeness: 'partial', cards: [{ name: 'Staging smoke test' }], notes: expect.stringMatching(/synthetic/i),
  })
  expect(submissionProblem(observation)).toBeNull()
  expect(posts[1][1]?.body).toBe(posts[0][1]?.body)
  expect(posts[3][1]?.body).toBe(posts[2][1]?.body)
  expect(captureUploadSchema.safeParse(JSON.parse(String(posts[6][1]?.body))).success).toBe(false)
  for (const [, init] of fetch.mock.calls) {
    expect(init).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) })
  }
})

it('stops before sending an observation when the capture receipt is wrong', async () => {
  const fetch = mockStaging((path, method) => path === '/api/captures' && method === 'POST'
    ? Response.json({ id: 'wrong-id', status: 'accepted', reviewed: false }, { status: 201 })
    : undefined)
  await expect(smokeStaging({ ...options, fetch })).rejects.toThrow('Capture upload returned an unexpected receipt id.')
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

it('rejects an HTML fallback at the helper download URL before posting', async () => {
  const fetch = mockStaging(path => path === '/downloads/fate-collector-helper.zip' ? new Response('<html>Fallback</html>') : undefined)
  await expect(smokeStaging({ ...options, fetch })).rejects.toThrow('nonempty ZIP archive')
  expect(fetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
})

it('reports an unexpected HTTP status without printing the response body', async () => {
  const fetch = mockStaging((path, method) => path === '/api/captures' && method === 'POST'
    ? new Response(captureKey, { status: 503 })
    : undefined)
  await expect(smokeStaging({ ...options, fetch })).rejects.toThrow(/^Capture upload returned HTTP 503, expected 201\.$/)
})
