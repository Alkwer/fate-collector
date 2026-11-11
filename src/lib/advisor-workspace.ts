import { z } from 'zod'
import { offerSchema } from '../../shared/schema'
import { newOffer } from '../../shared/offers'
import { MAX_COLLECTED_FATES } from '../../shared/advisor'

const legacyWorkspaceSchema = z.object({
  collection: offerSchema.refine(offer => offer.cards.length <= MAX_COLLECTED_FATES, 'Too many collected Fates.'),
  sources: z.record(z.string().uuid(), z.string().uuid()).refine(sources => Object.keys(sources).length <= MAX_COLLECTED_FATES),
  goal: z.object({ kind: z.enum(['regular', 'combo']), label: z.string().trim().min(1).max(160) }).strict().nullable(),
  mode: z.enum(['offer', 'invoke']),
}).strict()
const offerIdSchema = z.string().uuid()
const workspaceSchema = legacyWorkspaceSchema.extend({
  map: z.object({ id: z.string().uuid(), startedAt: z.string().datetime({ offset: true }).nullable() }).strict().nullable(),
  offerIds: z.array(offerIdSchema).refine(ids => new Set(ids).size === ids.length),
}).refine(workspace => workspace.map !== null || (
  workspace.collection.cards.length === 0 && workspace.offerIds.length === 0 && Object.keys(workspace.sources).length === 0
)).refine(workspace => Object.entries(workspace.sources).every(([cardId, offerId]) => (
  workspace.collection.cards.some(card => card.id === cardId) && workspace.offerIds.includes(offerId)
)))

export type AdvisorWorkspace = z.infer<typeof workspaceSchema>

export function newAdvisorWorkspace(): AdvisorWorkspace {
  return { collection: newOffer(), sources: {}, goal: null, mode: 'offer', map: null, offerIds: [] }
}

export function startMapWorkspace(current: AdvisorWorkspace): AdvisorWorkspace {
  return { ...newAdvisorWorkspace(), goal: current.goal, map: { id: crypto.randomUUID(), startedAt: new Date().toISOString() } }
}

export function offerBelongsToMap(workspace: AdvisorWorkspace, offerId: string): boolean {
  return workspace.map !== null && workspace.offerIds.includes(offerId)
}

export function bindOfferToMap(workspace: AdvisorWorkspace, offerId: string): AdvisorWorkspace {
  if (!workspace.map || offerBelongsToMap(workspace, offerId) || !offerIdSchema.safeParse(offerId).success) return workspace
  return { ...workspace, offerIds: [...workspace.offerIds, offerId] }
}

const storageKey = 'fate-collector.advisor-area.v2'
const legacyStorageKey = 'fate-collector.advisor-area.v1'
const maxStorageLength = 256_000
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }

function collectedSources(workspace: z.infer<typeof legacyWorkspaceSchema>) {
  return Object.fromEntries(Object.entries(workspace.sources).filter(([id]) => workspace.collection.cards.some(card => card.id === id)))
}

export function loadAdvisorWorkspace(storage: Storage): { workspace: AdvisorWorkspace; restored: boolean; error: string | null } {
  try {
    const current = storage.getItem(storageKey)
    const text = current ?? storage.getItem(legacyStorageKey)
    if (text === null) return { workspace: newAdvisorWorkspace(), restored: false, error: null }
    if (text.length > maxStorageLength) throw new Error('Oversized planning notes')
    const data: unknown = JSON.parse(text)
    if (current !== null) {
      const workspace = workspaceSchema.parse(data)
      return { workspace, restored: workspace.map !== null, error: null }
    }
    const legacy = legacyWorkspaceSchema.parse(data)
    const sources = collectedSources(legacy)
    const map = legacy.collection.cards.length ? { id: crypto.randomUUID(), startedAt: null } : null
    const workspace = { ...legacy, sources, map, offerIds: [...new Set(Object.values(sources))] }
    return { workspace, restored: map !== null, error: saveAdvisorWorkspace(storage, workspace) }
  } catch {
    return { workspace: newAdvisorWorkspace(), restored: false, error: 'The saved area could not be restored. Existing stored notes are unchanged until your next valid planning edit.' }
  }
}

export function saveAdvisorWorkspace(storage: Storage, workspace: AdvisorWorkspace): string | null {
  const parsed = workspaceSchema.safeParse({ ...workspace, sources: collectedSources(workspace) })
  if (!parsed.success) return 'Some planning changes are not saved. Correct invalid card fields before reloading; the last valid area is preserved.'
  try {
    const text = JSON.stringify(parsed.data)
    if (text.length > maxStorageLength) throw new Error('Oversized planning notes')
    storage.setItem(storageKey, text)
    return null
  } catch { return 'Planning changes are only in memory because browser storage is unavailable. Keep this page open.' }
}
