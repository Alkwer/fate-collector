import { z } from 'zod'
import { offerSchema } from '../../shared/schema'
import { newOffer } from '../../shared/offers'
import { MAX_COLLECTED_FATES } from '../../shared/advisor'

const workspaceSchema = z.object({
  collection: offerSchema.refine(offer => offer.cards.length <= MAX_COLLECTED_FATES, 'Too many collected Fates.'),
  sources: z.record(z.string().uuid(), z.string().uuid()).refine(sources => Object.keys(sources).length <= MAX_COLLECTED_FATES),
  goal: z.object({ kind: z.enum(['regular', 'combo']), label: z.string().trim().min(1).max(160) }).strict().nullable(),
  mode: z.enum(['offer', 'invoke']),
}).strict()
export type AdvisorWorkspace = z.infer<typeof workspaceSchema>
export function newAdvisorWorkspace(): AdvisorWorkspace {
  return { collection: newOffer(), sources: {}, goal: null, mode: 'offer' }
}
const storageKey = 'fate-collector.advisor-area.v1'
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function loadAdvisorWorkspace(storage: Storage): { workspace: AdvisorWorkspace; restored: boolean; error: string | null } {
  try {
    const text = storage.getItem(storageKey)
    if (!text) return { workspace: newAdvisorWorkspace(), restored: false, error: null }
    if (text.length > 256_000) throw new Error('Oversized planning notes')
    const workspace = workspaceSchema.parse(JSON.parse(text))
    return { workspace, restored: workspace.collection.cards.length > 0, error: null }
  } catch {
    return { workspace: newAdvisorWorkspace(), restored: false, error: 'The saved area could not be restored. Existing stored notes are unchanged until your next valid planning edit.' }
  }
}
export function saveAdvisorWorkspace(storage: Storage, workspace: AdvisorWorkspace): string | null {
  const sources = Object.fromEntries(Object.entries(workspace.sources).filter(([id]) => workspace.collection.cards.some(card => card.id === id)))
  const parsed = workspaceSchema.safeParse({ ...workspace, sources })
  if (!parsed.success) return 'Some planning changes are not saved. Correct invalid card fields before reloading; the last valid area is preserved.'
  try {
    const text = JSON.stringify(parsed.data)
    if (text.length > 256_000) throw new Error('Oversized planning notes')
    storage.setItem(storageKey, text)
    return null
  } catch { return 'Planning changes are only in memory because browser storage is unavailable. Keep this page open.' }
}
