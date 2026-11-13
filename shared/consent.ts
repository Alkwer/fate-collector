import { z } from './validation.ts'
import policy from './consent-policy.json' with { type: 'json' }

export type ConsentScope = 'captures' | 'observations'
export const CONSENT_VERSION = policy.version
export function consentText(scope: ConsentScope, origin: string): string {
  return `${policy.common}\n\n${policy.scopes[scope]}\n\nDestination: ${origin}`
}
export const consentGrantSchema = z.object({
  id: z.string().uuid().transform(value => value.toLowerCase()), scope: z.enum(['captures', 'observations']),
  policyVersion: z.string().max(40), acceptedAt: z.string().datetime({ offset: true }),
  text: z.string().min(1).max(8000), token: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type ConsentGrant = z.infer<typeof consentGrantSchema>
export interface ConsentReceipt {
  id: string; scope: ConsentScope; policyVersion: string; text: string
  acceptedAt: string; recordedAt: string; withdrawnAt: string | null
}
