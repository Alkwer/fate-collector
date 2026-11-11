import { z } from 'zod'

export const MAX_IMPORT_BYTES = 12 * 1024 * 1024
// Full backups may contain both a maximum-sized capture and corrected metadata.
// Capture/image imports keep their smaller limit; decoded image limits do not change.
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
export const MAX_API_BYTES = 128 * 1024
const uuid = z.string().uuid().toLowerCase()
const timestamp = z.string().datetime({ offset: true })
const shortText = z.string().max(160)
const coordinate = z.number().finite().min(0).max(16384)

const captureContextSchema = z.object({
  captureMode: z.enum(['game', 'fixture']),
  session: z.object({
    id: uuid,
    startedAt: timestamp,
    sequence: z.number().int().min(1).max(1_000_000_000),
  }).strict().optional(),
  possibleDuplicate: z.object({
    ofCaptureId: uuid,
    reason: z.literal('same-ocr-within-15s'),
  }).strict().optional(),
}).strict()

function validateCaptureContext(context: z.infer<typeof captureContextSchema> | undefined, captureId: string | null, ctx: z.RefinementCtx, field: string) {
  if (!context) return
  if (!captureId) {
    ctx.addIssue({ code: 'custom', message: 'Capture context requires a capture ID.', path: [field] })
  } else if (context.possibleDuplicate?.ofCaptureId.toLowerCase() === captureId.toLowerCase()) {
    ctx.addIssue({ code: 'custom', message: 'A possible repeat must refer to a different capture.', path: [field, 'possibleDuplicate', 'ofCaptureId'] })
  }
}

export const rewardSchema = z.object({
  id: uuid,
  label: z.string().max(160),
  kind: z.enum(['regular', 'combo', 'unknown']),
  count: z.number().int().min(1).max(100),
  threshold: z.number().int().min(1).max(100).nullable(),
  identified: z.boolean(),
  visualId: z.enum(['blue-diamond', 'gold-stack', 'gold-grid', 'gold-ring', 'silver-cluster', 'orange-feathers', 'three-gems', 'gold-axe']).optional(),
}).strict().refine(r => !r.identified || r.label.trim().length > 0, 'An identified reward needs a label.')

export const cardSchema = z.object({
  id: uuid,
  name: shortText,
  tier: z.number().int().min(1).max(100).nullable(),
  modifiers: z.array(z.string().max(1000)).max(40),
  rewards: z.array(rewardSchema).max(30),
  visualReview: z.object({ version: z.string().min(1).max(60), tierReviewed: z.boolean(), rewardsReviewed: z.boolean() }).strict().optional(),
}).strict()

export const offerSchema = z.object({
  kind: z.literal('fate-collector.offer'),
  schemaVersion: z.literal(1),
  id: uuid,
  revision: z.number().int().min(1).max(100000),
  capturedAt: timestamp,
  updatedAt: timestamp,
  captureId: uuid.nullable(),
  captureContext: captureContextSchema.optional(),
  source: z.enum(['manual', 'screenshot', 'windows-helper', 'example']),
  origin: z.enum(['test', 'live']),
  gameVersion: z.string().max(64),
  area: shortText,
  areaLevel: z.number().int().min(1).max(100).nullable(),
  encounterNumber: z.number().int().min(1).max(10000),
  completeness: z.enum(['unverified', 'partial', 'complete']),
  reviewed: z.boolean(),
  cards: z.array(cardSchema).max(30),
  selectedCardId: uuid.nullable(),
  notes: z.string().max(4000),
}).strict().superRefine((offer, ctx) => {
  validateCaptureContext(offer.captureContext, offer.captureId, ctx, 'captureContext')
  if (new Set(offer.cards.map(c => c.id)).size !== offer.cards.length) {
    ctx.addIssue({ code: 'custom', message: 'Card IDs must be unique.', path: ['cards'] })
  }
  for (const [index, card] of offer.cards.entries()) {
    if (new Set(card.rewards.map(r => r.id)).size !== card.rewards.length) {
      ctx.addIssue({ code: 'custom', message: 'Reward IDs must be unique.', path: ['cards', index, 'rewards'] })
    }
  }
  if (offer.selectedCardId && !offer.cards.some(c => c.id === offer.selectedCardId)) {
    ctx.addIssue({ code: 'custom', message: 'The chosen card must belong to this offer.', path: ['selectedCardId'] })
  }
  if (offer.source === 'example' && offer.origin !== 'test') {
    ctx.addIssue({ code: 'custom', message: 'Examples must remain test observations.', path: ['origin'] })
  }
  if (offer.completeness === 'complete' && (!offer.reviewed || !offer.cards.length || offer.cards.some(c => !c.name.trim()))) {
    ctx.addIssue({ code: 'custom', message: 'A complete offer needs named cards and a manual review.', path: ['completeness'] })
  }
})

export const captureSchema = z.object({
  kind: z.literal('fate-collector.capture'),
  schemaVersion: z.literal(1),
  captureId: uuid,
  capturedAt: timestamp,
  source: z.literal('windows-helper'),
  helperVersion: z.string().min(1).max(40),
  context: captureContextSchema.optional(),
  image: z.object({
    mimeType: z.literal('image/png'),
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
    dataBase64: z.string().min(1).max(MAX_IMPORT_BYTES).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    frameHeight: z.number().int().positive().max(8192).optional(),
  }).strict().refine(i => i.width * i.height <= 16_777_216, 'The image is too large.')
    .refine(i => i.frameHeight === undefined || i.frameHeight >= i.height, 'Frame height must include the full crop.'),
  ocr: z.object({
    status: z.enum(['ok', 'unavailable', 'error']),
    text: z.string().max(20000),
    lines: z.array(z.object({ text: z.string().max(2000), x: coordinate, y: coordinate, width: coordinate, height: coordinate }).strict()).max(500),
    language: z.string().max(40).nullable(),
  }).strict(),
}).strict().superRefine((capture, ctx) => validateCaptureContext(capture.context, capture.captureId, ctx, 'context'))

// Network-only projection of a helper capture. Image bytes are deliberately absent.
export const captureUploadSchema = z.object({
  kind: z.literal('fate-collector.upload'),
  schemaVersion: z.literal(1),
  captureId: uuid,
  capturedAt: timestamp,
  source: z.literal('windows-helper'),
  helperVersion: captureSchema.shape.helperVersion,
  context: captureContextSchema,
  image: z.object({
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
  }).strict().refine(i => i.width * i.height <= 16_777_216, 'The image is too large.'),
  ocr: captureSchema.shape.ocr,
}).strict().superRefine((capture, ctx) => validateCaptureContext(capture.context, capture.captureId, ctx, 'context'))

export const evidenceSchema = z.object({
  id: uuid,
  imageDataUrl: z.string().max(MAX_IMPORT_BYTES).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/),
  ocrText: z.string().max(20000),
  ocrStatus: z.enum(['ok', 'unavailable', 'error', 'not-run']),
  helperVersion: z.string().max(40).nullable(),
  ocrLines: captureSchema.shape.ocr.shape.lines,
  cardRegions: z.array(z.object({
    cardId: uuid,
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().positive().max(1), height: z.number().positive().max(1),
  }).strict().refine(box => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001)).max(30).optional(),
  visualRecognition: z.object({
    version: z.string().min(1).max(60), status: z.enum(['candidates', 'unsupported', 'unavailable']),
    warnings: z.array(z.string().max(500)).max(20),
  }).strict().optional(),
}).strict()

export const exportSchema = z.object({
  kind: z.literal('fate-collector.export'),
  schemaVersion: z.literal(1),
  offers: z.array(z.object({ offer: offerSchema, evidence: evidenceSchema.nullable() }).strict()).min(1).max(250),
  backup: z.object({ setId: uuid, part: z.number().int().min(1).max(250), total: z.number().int().min(1).max(250) })
    .strict().refine(part => part.part <= part.total).optional(),
}).strict().superRefine((archive, ctx) => {
  for (const [index, entry] of archive.offers.entries()) {
    if (entry.evidence && entry.offer.captureId !== entry.evidence.id) {
      ctx.addIssue({ code: 'custom', path: ['offers', index], message: 'Evidence must match the offer capture ID.' })
    }
  }
})

export type Offer = z.infer<typeof offerSchema>
export type FateCard = z.infer<typeof cardSchema>
export type Reward = z.infer<typeof rewardSchema>
export type Capture = z.infer<typeof captureSchema>
export type CaptureUpload = z.infer<typeof captureUploadSchema>
export type Evidence = z.infer<typeof evidenceSchema>
export type Archive = z.infer<typeof exportSchema>

export function formatValidationError(error: z.ZodError): string {
  return error.issues.slice(0, 3).map(i => `${i.path.join('.') || 'File'}: ${i.message}`).join(' ')
}
