import { z } from './validation.ts'
import sourceCatalog from './poedb-catalog.json' with { type: 'json' }

const date = z.iso.date()
const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const source = z.strictObject({
  id: identifier,
  url: z.url({ protocol: /^https$/ }),
  label: z.string().min(1),
  checkedAt: date,
})
const correction = z.strictObject({
  description: z.string().min(1),
  sourceId: identifier,
  superseded: z.array(z.string().min(1)).min(1).optional(),
})
const fate = z.strictObject({
  id: identifier,
  name: z.string().min(1),
  tier: z.literal(3),
  description: z.string().min(1),
  effects: z.array(z.string().min(1)),
  sourceId: identifier,
  status: z.enum(['reference', 'corrected']),
  corrections: z.array(correction).min(1).optional(),
}).refine(entry => (entry.status === 'corrected') === Boolean(entry.corrections), {
  message: 'Fate correction status must match the correction notes',
})
const reward = z.strictObject({
  id: identifier,
  description: z.string().min(1),
  iconUrl: z.string().regex(/^https:\/\/cdn\.poedb\.tw\/image\/Art\/2DArt\/UIImages\/InGame\/Augury\/[\w/]+\.webp$/),
  minLevel: z.number().int().nonnegative().nullable(),
  sourceId: identifier,
})
const portrait = z.strictObject({
  name: z.string().min(1),
  path: z.string().regex(/^\/game-art\/poedb\/[a-z-]+\.webp$/),
  sourceUrl: z.string().regex(/^https:\/\/cdn\.poedb\.tw\/image\/Art\/2DArt\/UIImages\/InGame\/Augury\/CardArt\/\w+\.webp$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const poedbCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  checkedAt: date,
  gameVersion: z.string().min(1),
  sources: z.array(source).min(1),
  fates: z.array(fate),
  rewards: z.array(reward),
  portraits: z.array(portrait),
})

// Reference data only. Reward definitions do not identify a card's rewards.
export const POEDB_CATALOG = poedbCatalogSchema.parse(sourceCatalog)

function normalizeText(value: string): string {
  return value.normalize().trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')
}

export function getPoedbFate(name: string, tier: number | null) {
  const key = normalizeText(name)
  return POEDB_CATALOG.fates.find(entry => entry.tier === tier && normalizeText(entry.name) === key)
}

export function getPoedbRewardReferences(query = '') {
  const key = normalizeText(query.slice(0, 120))
  return POEDB_CATALOG.rewards.filter(entry => normalizeText(entry.description).includes(key)).slice(0, 30)
}
