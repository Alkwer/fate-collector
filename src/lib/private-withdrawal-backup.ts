import { z } from '../../shared/validation'
import { consentHistory, parsePrivateConsents, restorePrivateConsents } from './consent'

export const PRIVATE_WITHDRAWAL_LIMIT = 16 * 1024 * 1024
const schema = z.object({ kind: z.literal('fate-collector.private-withdrawal-backup'), schemaVersion: z.literal(1), origin: z.string().url(), exportedAt: z.string().datetime(), consents: z.array(z.unknown()).max(1000), diagnostics: z.array(z.unknown()).max(200) }).strict()
export async function exportPrivateWithdrawals() {
  const { diagnosticHistoryState } = await import('./diagnostics')
  const consents = consentHistory(), diagnostics = diagnosticHistoryState()
  if (consents.unreadableCount || diagnostics.unreadableCount) throw new Error('Some withdrawal records are unreadable. Keep site data; the private backup cannot safely include every credential.')
  const backup = schema.parse({ kind: 'fate-collector.private-withdrawal-backup', schemaVersion: 1, origin: location.origin, exportedAt: new Date().toISOString(), consents: consents.records, diagnostics: diagnostics.records })
  if (new TextEncoder().encode(JSON.stringify(backup)).byteLength > PRIVATE_WITHDRAWAL_LIMIT) throw new Error('Private withdrawal backup exceeds 16 MiB. Keep site data for recovery.')
  return backup
}
export async function importPrivateWithdrawals(text: string) {
  if (new TextEncoder().encode(text).byteLength > PRIVATE_WITHDRAWAL_LIMIT) throw new Error('Private withdrawal backup exceeds 16 MiB.')
  const backup = schema.parse(JSON.parse(text))
  if (backup.origin !== location.origin) throw new Error('This private backup belongs to a different collector address. Import it at its original address.')
  const { parsePrivateDiagnostics, restorePrivateDiagnostics } = await import('./diagnostics')
  parsePrivateConsents(backup.consents); parsePrivateDiagnostics(backup.diagnostics)
  const consents = restorePrivateConsents(backup.consents), diagnostics = restorePrivateDiagnostics(backup.diagnostics)
  return { restored: consents.restored + diagnostics.restored, conflicts: consents.conflicts + diagnostics.conflicts }
}
