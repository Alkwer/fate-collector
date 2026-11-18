import { z } from '../../shared/validation'
import { normalizeRewardLabel, type AdvisorGoal } from '../../shared/advisor'
import { solverProfileSchema } from '../../shared/solver'
import { REWARD_CATALOG } from '../../shared/reward-catalog'

export const rewardDefinitionSchema = z.object({
  id: z.string().uuid(), label: z.string().trim().min(1).max(160),
  kind: z.enum(['regular', 'combo']), threshold: z.number().int().min(1).max(100).nullable(),
  note: z.string().max(500),
}).strict().refine(row => row.kind === 'combo' ? row.threshold !== null : row.threshold === null, 'A combo needs its tooltip threshold.')
export const solverSettingsSchema = z.object({
  kind: z.literal('fate-collector.solver-profile'), schemaVersion: z.literal(1),
  mode: z.enum(['single', 'portfolio']), profile: solverProfileSchema,
  singleGoal: z.object({ kind: z.enum(['regular', 'combo']), label: z.string().trim().min(1).max(160) }).strict().nullable().optional(),
  definitions: z.array(rewardDefinitionSchema).max(64),
}).strict().refine(value => {
  const keys = value.definitions.map(row => `${row.kind}:${normalizeRewardLabel(row.label)}`)
  return new Set(keys).size === keys.length && new Set(value.definitions.map(row => row.id)).size === keys.length
}, 'Use one definition per reward and kind.')

export type SolverSettings = z.infer<typeof solverSettingsSchema>
export type RewardDefinition = z.infer<typeof rewardDefinitionSchema>
export const SOLVER_SETTINGS_KEY = 'fate-collector.solver-profile.v1'
// Keep room for the explicit single-goal metadata on previously valid 64,000-byte profiles.
export const MAX_PROFILE_BYTES = 65_536

export function selectedRewardGoal(settings: SolverSettings, legacyGoal: AdvisorGoal | null) {
  return settings.singleGoal === undefined ? legacyGoal : settings.singleGoal
}

type Priority = SolverSettings['profile']['goals'][number]
// One point is the baseline for a confirmed reward, including ordinary rare gear
// whose base, affix tiers and sale price are unknown. IDs distinguish same-label variants.
const tradeWeights: Readonly<Record<string, number>> = {
  'exceptional-gem': 10,
  'observed-viscera-item': 8,
  'additional-valuable-currency-items': 6,
  'observed-valuable-unique-jewellery-item': 5,
  'item-rarity': 4,
  'observed-massively-increased-item-rarity': 4,
  'observed-additional-currency-items-combo': 4,
  'observed-many-additional-stacked-decks': 4,
  'observed-additional-gems-some-with-maximum-quality': 4,
  'greatly-increased-item-rarity': 3,
  'observed-additional-currency-items': 3,
  'observed-highly-increased-item-rarity': 2,
  'observed-additional-stacked-decks': 2,
  'observed-many-additional-threads': 2,
  'observed-hoards-of-gold': 2,
  'observed-gem-with-quality': 2,
  'additional-gems-with-quality': 2,
  'observed-rare-map': 2,
  'observed-rare-boots-with-a-speed-modifier': 2,
  'observed-unique-armour': 2,
  'observed-unique-flask': 2,
  'observed-unique-jewellery-item': 2,
  'observed-unique-weapon': 2,
  'dreadmaidens-sacrament': 2,
  'observed-doedres-tongue': 2,
  'observed-ordered-fate': 2,
}
const TRADE_STARTER_PRIORITIES: Priority[] = REWARD_CATALOG.flatMap(entry =>
  entry.kind === 'unknown' ? [] : [{ kind: entry.kind, label: entry.label, weight: tradeWeights[entry.id] ?? 1 }])
export const STARTER_PROFILES = {
  trade: { label: 'Trade / mapping', description: 'Weights for every tooltip-confirmed reward, including equipment and completed combos.', priorities: TRADE_STARTER_PRIORITIES },
  campaign: { label: 'Campaign / SSF', description: 'Currency, quality gems, equipment and early progression.', priorities: [
    { kind: 'regular', label: 'Additional Currency Items', weight: 3 },
    { kind: 'combo', label: 'Additional Currency Items', weight: 4 },
    { kind: 'regular', label: 'Gem with Quality', weight: 2 },
    { kind: 'combo', label: 'Additional Gems, Some with Maximum Quality', weight: 4 },
    { kind: 'regular', label: 'Rare Boots with a Speed Modifier', weight: 3 },
    { kind: 'regular', label: 'Rare Weapons with a Physical Modifier', weight: 2 },
    { kind: 'regular', label: 'Rare Map', weight: 2 },
  ] as readonly Priority[] },
  viscera: { label: 'Viscera rewards', description: 'The identified Viscera reward combo. This does not estimate the extra drop chance from Fate count or duplicates.', priorities: [
    { kind: 'combo', label: 'Viscera Item', weight: 10 },
  ] as readonly Priority[] },
} as const
export type StarterProfileId = keyof typeof STARTER_PROFILES
const priorityKey = ({ kind, label }: Priority) => `${kind}:${normalizeRewardLabel(label)}`

export function newSolverSettings(): SolverSettings {
  return {
    kind: 'fate-collector.solver-profile',
    schemaVersion: 1,
    mode: 'portfolio',
    profile: { goals: TRADE_STARTER_PRIORITIES.map(priority => ({ ...priority })), avoidModifiers: [] },
    definitions: [],
  }
}

export function applyTradeStarter(settings: SolverSettings): SolverSettings | null {
  const missing = new Map(TRADE_STARTER_PRIORITIES.map(priority => [priorityKey(priority), priority]))
  const goals = settings.profile.goals.map(priority => {
    const key = priorityKey(priority)
    const starter = missing.get(key)
    if (!starter) return priority
    missing.delete(key)
    return { ...priority, weight: starter.weight }
  })
  goals.push(...Array.from(missing.values(), priority => ({ ...priority })))
  if (!solverProfileSchema.shape.goals.safeParse(goals).success) return null
  return { ...settings, mode: 'portfolio', profile: { ...settings.profile, goals } }
}

// Explicit replacement action only. Loading an existing profile never applies it.
export function replaceStarterPriorities(settings: SolverSettings, id: StarterProfileId): SolverSettings {
  return { ...settings, mode: 'portfolio', profile: { ...settings.profile,
    goals: STARTER_PROFILES[id].priorities.map(priority => ({ ...priority })),
  } }
}

export function parseSolverSettings(text: string): SolverSettings {
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) throw new Error('Profile is too large (64 KiB maximum).')
  const result = solverSettingsSchema.safeParse(JSON.parse(text))
  if (!result.success) throw new Error('Invalid profile. Check reward names, weights (0–1,000,000), modifier filters and combo thresholds.')
  return result.data
}
export function serializeSolverSettings(value: SolverSettings): string {
  const text = JSON.stringify(solverSettingsSchema.parse(value), null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) throw new Error('Profile is too large (64 KiB maximum).')
  return text
}
export function upsertDefinition(settings: SolverSettings, definition: RewardDefinition): SolverSettings {
  const existing = settings.definitions.find(row => row.kind === definition.kind && normalizeRewardLabel(row.label) === normalizeRewardLabel(definition.label))
  return solverSettingsSchema.parse({ ...settings, definitions: existing
    ? settings.definitions.map(row => row.id === existing.id ? { ...definition, id: existing.id } : row)
    : [...settings.definitions, definition] })
}

interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function readSolverSettings(storage: Storage) {
  let raw: string | null = null
  try { raw = storage.getItem(SOLVER_SETTINGS_KEY) }
  catch { return { settings: newSolverSettings(), raw, error: 'Browser profile storage is unavailable. Export your settings before leaving.' } }
  try {
    return { settings: raw === null ? newSolverSettings() : parseSolverSettings(raw), raw, error: null as string | null }
  } catch {
    return { settings: newSolverSettings(), raw, error: 'Your saved profile could not be read. Its stored copy is unchanged. Import a backup or reset the profile to replace it.' }
  }
}
export function writeSolverSettings(storage: Storage, settings: SolverSettings, expectedRaw: string | null): { raw: string | null; error: string | null } {
  try {
    const raw = serializeSolverSettings(settings)
    if (storage.getItem(SOLVER_SETTINGS_KEY) !== expectedRaw) return { raw: expectedRaw, error: 'The profile changed in another tab. Reload the saved profile before editing it.' }
    storage.setItem(SOLVER_SETTINGS_KEY, raw)
    return { raw, error: null }
  } catch {
    return { raw: expectedRaw, error: 'The profile could not be saved. Keep this tab open or export the profile before leaving.' }
  }
}
