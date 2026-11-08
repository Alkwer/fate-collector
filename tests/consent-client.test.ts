import { afterEach, expect, test, vi } from 'vitest'
import { acceptConsent, consentRecords, retryWithdrawals, sharingConsent, withdrawConsent } from '../src/lib/consent'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test('withdrawal persists Retry-After and blocks local sharing while retrying later without a collection key', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) },
  })
  vi.stubGlobal('location', { origin: 'https://collector.test' })
  vi.stubGlobal('window', new EventTarget())
  const transport = vi.fn(async (_url: string, options: RequestInit) => {
    const { token: _token, ...grant } = JSON.parse(String(options.body))
    return Response.json({ ...grant, recordedAt: new Date().toISOString(), withdrawnAt: null }, { status: 201 })
  })
  vi.stubGlobal('fetch', transport)
  await acceptConsent('collection-key', true)
  const id = sharingConsent()!.id
  transport.mockImplementation(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } }))
  await expect(withdrawConsent(id)).rejects.toThrow('withdrawal is pending')
  expect(sharingConsent()).toBeNull()
  expect(consentRecords()[0].withdrawalRetryAt).toBe('2026-11-08T13:00:00.000Z')
  await retryWithdrawals()
  expect(transport).toHaveBeenCalledTimes(2)
  vi.setSystemTime(new Date('2026-11-08T13:00:01Z'))
  transport.mockImplementation(async (_url: string, options: RequestInit) => {
    expect(new Headers(options.headers).has('Authorization')).toBe(false)
    return Response.json({ id, status: 'withdrawn', withdrawnAt: new Date().toISOString() })
  })
  await retryWithdrawals()
  expect(consentRecords()[0].withdrawalConfirmedAt).toBe('2026-11-08T13:00:01.000Z')
  expect(transport).toHaveBeenCalledTimes(3)
})
