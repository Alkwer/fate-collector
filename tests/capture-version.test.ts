import { expect, test } from 'vitest'
import { newOffer } from '../shared/offers'
import { applyCaptureVersion } from '../src/lib/capture-version'

test('session version annotates only new live captures and retains its user-entered source', () => {
  const now = Date.now(), setting = { version: '3.30.0b', startedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() }
  const live = { ...newOffer(), source: 'windows-helper' as const, origin: 'live' as const, gameVersion: 'unknown' }
  expect(applyCaptureVersion(live, setting)).toMatchObject({ gameVersion: setting.version, notes: expect.stringContaining('entered by the user') })
  for (const offer of [{ ...live, capturedAt: new Date(now - 3600_000).toISOString() }, { ...live, gameVersion: '3.29.0' }, { ...live, origin: 'test' as const }, { ...live, capturedAt: new Date(now + 3600_000).toISOString() }]) expect(applyCaptureVersion(offer, setting)).toEqual(offer)
  expect(applyCaptureVersion(live, null)).toEqual(live)
})
