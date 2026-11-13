import { afterEach, expect, test, vi } from 'vitest'
import { consentText, CONSENT_VERSION } from '../shared/consent'
import { consentRecords, retryWithdrawals, sharingConsent, withdrawConsent } from '../src/lib/consent'
import { exportPrivateWithdrawals, importPrivateWithdrawals } from '../src/lib/private-withdrawal-backup'
import { diagnosticHistory, generateDiagnostic, retryDiagnosticWithdrawals } from '../src/lib/diagnostics'
import { DIAGNOSTIC_VERSION, diagnosticText } from '../shared/diagnostics'

afterEach(() => vi.unstubAllGlobals())
test('confirmed backup advances pending local withdrawals without re-requesting or losing acknowledgements', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  vi.stubGlobal('location', { origin: 'https://collector.test' }); vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('navigator', { userAgent: 'Firefox/131 Windows', onLine: true })
  const now = '2026-11-13T10:00:00.000Z', confirmed = '2026-11-13T10:05:00.000Z'
  const consent = { id: crypto.randomUUID(), scope: 'observations', policyVersion: CONSENT_VERSION,
    acceptedAt: now, text: consentText('observations', location.origin), token: 'a'.repeat(64), recordedAt: now,
    withdrawnAt: now, withdrawalConfirmedAt: null, blocked: true }
  const diagnostic = { report: generateDiagnostic('local', 'off', 'off'),
    consent: { version: DIAGNOSTIC_VERSION, text: diagnosticText(location.origin), acceptedAt: now },
    token: 'b'.repeat(64), receipt: null, withdrawnAt: now, withdrawalConfirmedAt: null }
  values.set(`fate-collector.consent.observations.${consent.id}`, JSON.stringify(consent))
  values.set(`fate-collector.diagnostic-report.${diagnostic.report.id}`, JSON.stringify(diagnostic))
  const pending = await exportPrivateWithdrawals()
  const acknowledged = { ...pending, consents: [{ ...consent, withdrawalConfirmedAt: confirmed }],
    diagnostics: [{ ...diagnostic, withdrawalConfirmedAt: confirmed }] }
  expect(await importPrivateWithdrawals(JSON.stringify(acknowledged))).toEqual({ restored: 2, conflicts: 0 })
  for (const backup of [pending, acknowledged]) {
    await importPrivateWithdrawals(JSON.stringify(backup))
    expect(consentRecords()[0]).toMatchObject({ withdrawnAt: now, withdrawalConfirmedAt: confirmed })
    expect(diagnosticHistory()[0]).toMatchObject({ withdrawnAt: now, withdrawalConfirmedAt: confirmed })
  }
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await retryWithdrawals(); await retryDiagnosticWithdrawals()
  expect(fetch).not.toHaveBeenCalled()
  expect(sharingConsent()).toBeNull()
})

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
