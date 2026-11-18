import { z } from '../../shared/validation'
import { leagueGoalSchema, omenMaps, profitObjectives } from './league-challenges'

const text = (limit: number) => z.string().trim().max(limit)
export const invocationSnapshotSchema = z.object({
  id: z.string().uuid(),
  areaId: z.string().uuid(),
  invokedAt: z.string().datetime({ offset: true }),
  mapName: text(160),
  gameVersion: text(64),
  inputs: z.array(z.object({ name: text(160), tier: z.number().int().min(1).max(100).nullable() }).strict()).min(1).max(3),
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
    z.object({ status: z.literal('unchecked') }).strict(),
    z.object({ status: z.literal('none') }).strict(),
    z.object({ status: z.literal('items'), items: text(1800).min(1) }).strict(),
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

const progressLimits = new Map<string, number>([
  ...profitObjectives.map(row => [`profit:${row.id}`, row.target] as const),
  ...omenMaps.map(map => [`omen:${map}`, 1] as const),
])
const backupSchema = z.object({
  kind: z.literal('fate-collector.fight-journal'),
  schemaVersion: z.literal(1),
  journal: journalSchema.extend({
    entries: journalSchema.shape.entries.refine(entries => new Set(entries.map(row => row.invocation.id.toLowerCase())).size === entries.length),
    progress: z.strictObject(Object.fromEntries([...progressLimits].map(([key, limit]) => [key, z.number().int().min(0).max(limit).optional()]))),
  }),
}).strict()

export function createFightJournalBackup(journal: FightJournal) {
  return backupSchema.parse({ kind: 'fate-collector.fight-journal', schemaVersion: 1, journal })
}

export async function readFightJournalBackup(file: Pick<File, 'size' | 'text'>): Promise<FightJournal> {
  if (file.size > 16 * 1024 * 1024) throw new Error('Choose a fight journal backup no larger than 16 MiB.')
  let value: unknown
  try { value = JSON.parse(await file.text()) }
  catch { throw new Error('The fight journal backup could not be read as JSON.') }
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'fate-collector.fight-journal'
    && 'schemaVersion' in value && value.schemaVersion !== 1) {
    throw new Error('This fight journal backup version is unsupported.')
  }
  const backup = backupSchema.safeParse(value)
  if (!backup.success) throw new Error('Choose a valid fight journal backup. Check for invalid values or duplicate fight IDs.')
  return backup.data.journal as FightJournal
}

export function planFightJournalImport(local: FightJournal, backup: FightJournal) {
  const existing = new Map(local.entries.map(row => [row.invocation.id.toLowerCase(), row]))
  const added: FightEntry[] = []
  let fightConflicts = 0
  for (const row of backup.entries) {
    const id = row.invocation.id.toLowerCase()
    const saved = existing.get(id)
    if (!saved) added.push(row)
    else if (JSON.stringify({ ...saved, invocation: { ...saved.invocation, id } }) !== JSON.stringify({ ...row, invocation: { ...row.invocation, id } })) fightConflicts++
  }
  const progress = { ...local.progress }
  let progressAdded = 0
  let progressConflicts = 0
  for (const [key, count] of Object.entries(backup.progress)) {
    if (!Object.hasOwn(progress, key)) {
      progress[key] = count
      progressAdded++
    } else if (progress[key] !== count) progressConflicts++
  }
  const goalAdded = !local.goal && !!backup.goal
  const goalConflict = !!local.goal && !!backup.goal && JSON.stringify(local.goal) !== JSON.stringify(backup.goal)
  return {
    journal: { entries: [...local.entries, ...added], progress, goal: local.goal ?? backup.goal },
    fightsAdded: added.length, progressAdded, goalAdded, fightConflicts, progressConflicts, goalConflict,
  }
}

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
