import { z } from '../../shared/validation'
import { normalizeRewardLabel } from '../../shared/advisor'
import { solverProfileSchema } from '../../shared/solver'

export const rewardDefinitionSchema = z.object({
  id: z.string().uuid(), label: z.string().trim().min(1).max(160),
  kind: z.enum(['regular', 'combo']), threshold: z.number().int().min(1).max(100).nullable(),
  note: z.string().max(500),
}).strict().refine(row => row.kind === 'combo' ? row.threshold !== null : row.threshold === null, 'A combo needs its tooltip threshold.')
export const solverSettingsSchema = z.object({
  kind: z.literal('fate-collector.solver-profile'), schemaVersion: z.literal(1),
  mode: z.enum(['single', 'portfolio']), profile: solverProfileSchema,
  definitions: z.array(rewardDefinitionSchema).max(64),
}).strict().refine(value => {
  const keys = value.definitions.map(row => `${row.kind}:${normalizeRewardLabel(row.label)}`)
  return new Set(keys).size === keys.length && new Set(value.definitions.map(row => row.id)).size === keys.length
}, 'Use one definition per reward and kind.')

export type SolverSettings = z.infer<typeof solverSettingsSchema>
export type RewardDefinition = z.infer<typeof rewardDefinitionSchema>
export const SOLVER_SETTINGS_KEY = 'fate-collector.solver-profile.v1'
export const MAX_PROFILE_BYTES = 64_000

type Priority = SolverSettings['profile']['goals'][number]
const TRADE_STARTER_PRIORITIES: readonly Priority[] = [
  { kind: 'combo', label: 'Exceptional Gem', weight: 10 },
  { kind: 'combo', label: 'Item Rarity', weight: 4 },
  { kind: 'combo', label: "Dreadmaidens' Sacrament", weight: 2 },
  { kind: 'regular', label: 'Additional Currency Items', weight: 3 },
]
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

export function parseSolverSettings(text: string): SolverSettings {
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) throw new Error('Profile is too large (64 KB maximum).')
  const result = solverSettingsSchema.safeParse(JSON.parse(text))
  if (!result.success) throw new Error('Invalid profile. Check reward names, weights (0–1,000,000), modifier filters and combo thresholds.')
  return result.data
}
export function serializeSolverSettings(value: SolverSettings): string {
  const text = JSON.stringify(solverSettingsSchema.parse(value), null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) throw new Error('Profile is too large (64 KB maximum).')
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
