import { afterEach, expect, test, vi } from 'vitest'
import { consentText, CONSENT_VERSION } from '../shared/consent'
import { consentRecords, sharingConsent, withdrawConsent } from '../src/lib/consent'
import { exportPrivateWithdrawals, importPrivateWithdrawals } from '../src/lib/private-withdrawal-backup'

afterEach(() => vi.unstubAllGlobals())
test('private credentials survive a clean profile restore, never reactivate consent or roll back withdrawal', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  vi.stubGlobal('location', { origin: 'https://collector.test' }); vi.stubGlobal('window', new EventTarget())
  const now = new Date().toISOString(), id = crypto.randomUUID(), token = 'a'.repeat(64)
  const record = { id, scope: 'observations', policyVersion: CONSENT_VERSION, acceptedAt: now, text: consentText('observations', location.origin), token, recordedAt: now, withdrawnAt: null, withdrawalConfirmedAt: null, blocked: false }
  values.set(`fate-collector.consent.observations.${id}`, JSON.stringify(record))
  const original = await exportPrivateWithdrawals(), backup = JSON.stringify(original)
  expect(backup).toContain(token)
  values.clear()
  expect(await importPrivateWithdrawals(backup)).toEqual({ restored: 1, conflicts: 0 })
  expect(sharingConsent()).toBeNull()
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get('X-Consent-Token')).toBe(token)
    return Response.json({ id, status: 'withdrawn', withdrawnAt: now })
  })
  vi.stubGlobal('fetch', fetch)
  await withdrawConsent(id)
  await importPrivateWithdrawals(backup)
  expect(consentRecords()[0].withdrawalConfirmedAt).toBe(now)
  const conflicting = { ...original, consents: [{ ...record, token: 'b'.repeat(64) }] }
  expect(await importPrivateWithdrawals(JSON.stringify(conflicting))).toEqual({ restored: 0, conflicts: 1 })
  expect(consentRecords()[0].token).toBe(token)
  await expect(importPrivateWithdrawals(JSON.stringify({ ...original, origin: 'https://elsewhere.test' }))).rejects.toThrow('different collector')
  await expect(importPrivateWithdrawals(JSON.stringify({ ...original, diagnostics: [{ invalid: true }] }))).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
})
