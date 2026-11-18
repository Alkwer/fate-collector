import { z } from '../../shared/validation'
import { leagueGoalSchema, omenMaps } from './league-challenges'

const text = (limit: number) => z.string().trim().max(limit)
export const invocationSnapshotSchema = z.object({
  id: z.string().uuid(),
  areaId: z.string().uuid(),
  invokedAt: z.string().datetime({ offset: true }),
  mapName: text(160),
  gameVersion: text(64),
  inputs: z.array(z.object({ name: text(160), tier: z.number().int().min(1).max(100).nullable() })).min(1).max(3),
  modeledPreview: text(1800),
}).strict()
export type InvocationSnapshot = z.infer<typeof invocationSnapshotSchema>
export type InvocationAction = Pick<InvocationSnapshot, 'mapName' | 'gameVersion' | 'modeledPreview'> & { cardIds: string[] }

export const fightOutcomeSchema = z.object({
  boss: text(160),
  bossStatus: z.enum(['unknown', 'killed', 'not-killed']),
  mapName: text(160),
  gameVersion: text(64),
  gamePreview: text(1800),
  loot: z.discriminatedUnion('status', [
    z.object({ status: z.literal('unchecked') }),
    z.object({ status: z.literal('none') }),
    z.object({ status: z.literal('items'), items: text(1800).min(1) }),
  ]),
}).strict()
export type FightOutcome = z.infer<typeof fightOutcomeSchema>
const fightEntrySchema = z.object({ invocation: invocationSnapshotSchema, outcome: fightOutcomeSchema }).strict()
export type FightEntry = z.infer<typeof fightEntrySchema>

const journalSchema = z.object({
  entries: z.array(fightEntrySchema),
  goal: leagueGoalSchema,
  progress: z.record(z.string().max(80), z.number().int().min(0).max(60)),
}).strict()
export type FightJournal = z.infer<typeof journalSchema>
export type OmenMap = typeof omenMaps[number]
export const omenMapSchema = z.enum(omenMaps).nullable()
export const journalStorageKey = 'fate-collector.fight-journal.v1'

export function loadFightJournal(storage: Pick<Storage, 'getItem'>): FightJournal {
  const stored = storage.getItem(journalStorageKey)
  return stored === null ? { entries: [], goal: null, progress: {} } : journalSchema.parse(JSON.parse(stored))
}

export function updateFightJournal(storage: Pick<Storage, 'getItem' | 'setItem'>, update: (journal: FightJournal) => FightJournal): FightJournal {
  const current = loadFightJournal(storage)
  const changed = update(current)
  if (changed === current) return current
  const next = journalSchema.parse(changed)
  storage.setItem(journalStorageKey, JSON.stringify(next))
  return next
}

export function putFightEntry(journal: FightJournal, entry: FightEntry): FightJournal {
  return { ...journal, entries: [entry, ...journal.entries.filter(row => row.invocation.id !== entry.invocation.id)] }
}

export function removeFightEntry(journal: FightJournal, invocationId: string): FightJournal {
  const entries = journal.entries.filter(row => row.invocation.id !== invocationId)
  return entries.length === journal.entries.length ? journal : { ...journal, entries }
}
