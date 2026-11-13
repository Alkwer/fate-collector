import { z } from '../../shared/validation'
import type { Offer } from '../../shared/schema'

const key = 'fate-collector.capture-version.v1'
const schema = z.object({ version: z.string().trim().min(1).max(64), startedAt: z.string().datetime(), expiresAt: z.string().datetime() }).strict()
export type CaptureVersion = z.infer<typeof schema>
export function readCaptureVersion(): CaptureVersion | null {
  const text = localStorage.getItem(key)
  if (!text) return null
  const result = schema.parse(JSON.parse(text))
  return Date.parse(result.expiresAt) > Date.now() ? result : null
}
export function saveCaptureVersion(version: string): CaptureVersion | null {
  if (!version.trim()) { localStorage.removeItem(key); return null }
  const now = Date.now()
  const value = schema.parse({ version, startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 24 * 3600_000).toISOString() })
  localStorage.setItem(key, JSON.stringify(value))
  return value
}
export function applyCaptureVersion(offer: Offer, setting?: CaptureVersion | null): Offer {
  if (setting === undefined) { try { setting = readCaptureVersion() } catch { return offer } }
  const captured = Date.parse(offer.capturedAt)
  if (!setting || offer.source !== 'windows-helper' || offer.origin !== 'live' || !['', 'unknown'].includes(offer.gameVersion)
    || captured < Date.parse(setting.startedAt) || captured >= Date.parse(setting.expiresAt) || captured > Date.now()) return offer
  const provenance = `Game version entered by the user for captures since ${setting.startedAt}: ${setting.version}.`
  if (offer.notes.length + provenance.length + 1 > 4000) return offer
  return { ...offer, gameVersion: setting.version, notes: [offer.notes, provenance].filter(Boolean).join('\n') }
}
