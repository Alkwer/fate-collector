import { z } from 'zod'
import policy from './diagnostics-policy.json' with { type: 'json' }

export const DIAGNOSTIC_VERSION = policy.version
export const APP_VERSION = policy.appVersion
export const DIAGNOSTIC_LIMIT = 64 * 1024
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const diagnosticText = (origin: string) => `${policy.text}\n\nDestination: ${origin}`
const date = z.string().datetime({ offset: true })
export const diagnosticId = z.string().uuid()
export const diagnosticToken = z.string().regex(/^[a-f0-9]{64}$/)
export const diagnosticEventSchema = z.object({
  at: date, code: z.enum(policy.eventCodes as [string, ...string[]]),
  outcome: z.enum(['ok', 'error', 'pending', 'blocked']),
  httpStatus: z.number().int().min(100).max(599).nullable(),
}).strict()
const count = z.number().int().min(0).max(10000)
export const diagnosticReportSchema = z.object({
  kind: z.literal('fate-collector.diagnostics'), schemaVersion: z.literal(1), id: diagnosticId,
  generatedAt: date, source: z.enum(['website', 'windows-helper']),
  appVersion: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  environment: z.enum(['local', 'staging', 'production', 'unknown']),
  runtime: z.object({
    family: z.enum(['chromium', 'firefox', 'safari', 'other', 'windows-powershell']),
    version: z.string().max(32).regex(/^\d{1,5}(?:\.\d{1,5}){0,3}$/).nullable(),
    platform: z.enum(['windows', 'macos', 'linux', 'other']), online: z.boolean().nullable(),
  }).strict(),
  state: z.object({
    storage: z.enum(['available', 'unavailable', 'unknown']),
    folderConnection: z.enum(['off', 'connecting', 'active', 'permission', 'error', 'not-applicable']),
    sharing: z.enum(['off', 'active', 'pending', 'withdrawal-pending', 'error', 'unknown']),
    queue: z.object({ pending: count, accepted: count, rejected: count, ignored: count }).strict(),
  }).strict(),
  events: z.array(diagnosticEventSchema).max(100),
}).strict()
export const diagnosticConsentSchema = z.object({ version: z.string().max(40), text: z.string().max(8000), acceptedAt: date }).strict()
export const diagnosticSubmissionSchema = z.object({ report: diagnosticReportSchema, consent: diagnosticConsentSchema, token: diagnosticToken }).strict()
export const diagnosticReceiptSchema = z.object({
  id: diagnosticId, status: z.literal('received'), receivedAt: date, expiresAt: date,
  consent: diagnosticConsentSchema.extend({ recordedAt: date }).strict(),
}).strict()
export const diagnosticWithdrawalSchema = z.object({ id: diagnosticId, status: z.literal('withdrawn'), withdrawnAt: date }).strict()
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>
export type DiagnosticSubmission = z.infer<typeof diagnosticSubmissionSchema>
export type DiagnosticReceipt = z.infer<typeof diagnosticReceiptSchema>
