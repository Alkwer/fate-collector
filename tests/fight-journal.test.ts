import { expect, test } from 'vitest'
import { newCard, newReward } from '../shared/offers'
import { startMapWorkspace, newAdvisorWorkspace, loadAdvisorWorkspace, saveAdvisorWorkspace } from '../src/lib/advisor-workspace'
import { challengeAdvice } from '../src/lib/challenge-advice'
import {
  createFightJournalBackup, fightOutcomeSchema, journalStorageKey, loadFightJournal, planFightJournalImport, putFightEntry,
  readFightJournalBackup, removeFightEntry, updateFightJournal, type FightEntry, type FightJournal,
} from '../src/lib/fight-journal'
import { omenMaps, profitObjectives } from '../src/lib/league-challenges'

function memory() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) }
}

function fight(): FightEntry {
  return {
    invocation: {
      id: crypto.randomUUID(), areaId: crypto.randomUUID(), invokedAt: '2026-11-18T17:00:00Z',
      mapName: 'Sanctuary', gameVersion: '3.30.0b', inputs: [{ name: 'Dryad', tier: 3 }], modeledPreview: 'Advisor preview · Exceptional Gem (inactive)',
    },
    outcome: {
      mapName: 'Sanctuary', gameVersion: '3.30.0b', boss: '', bossStatus: 'unknown', gamePreview: '',
      loot: { status: 'unchecked' },
    },
  }
}

function jsonFile(value: unknown) {
  return new Blob([JSON.stringify(value)], { type: 'application/json' })
}

test('round-trips fight outcomes, the selected goal and confirmed progress', async () => {
  const journal: FightJournal = {
    entries: [fight()], goal: { kind: 'profit', objective: 'maps' }, progress: { 'profit:maps': 8, 'omen:Sanctuary': 1 },
  }
  const backup = createFightJournalBackup(journal)
  expect(backup).toMatchObject({ kind: 'fate-collector.fight-journal', schemaVersion: 1 })
  expect(await readFightJournalBackup(jsonFile(backup))).toEqual(journal)
  await expect(readFightJournalBackup(jsonFile({ ...backup, schemaVersion: 2 }))).rejects.toThrow('version is unsupported')
  for (const changes of [
    { entries: [journal.entries[0], journal.entries[0]] },
    { progress: { 'profit:maps': 31 } },
    { progress: { 'omen:Sanctuary': 2 } },
    { progress: { 'profit:unknown': 1 } },
    { goal: { kind: 'omen', map: 'Wrong map' } },
  ]) {
    await expect(readFightJournalBackup(jsonFile({ ...backup, journal: { ...journal, ...changes } }))).rejects.toThrow('valid fight journal backup')
  }
})

test('plans an additive import and keeps local outcomes, progress corrections and goals on conflict', () => {
  const same = fight()
  const different = fight()
  const added = fight()
  const local: FightJournal = {
    entries: [same, different], goal: { kind: 'profit', objective: 'maps' }, progress: { 'profit:maps': 0, 'profit:gem': 3 },
  }
  const backup: FightJournal = {
    entries: [same, added, { ...different, outcome: { ...different.outcome, boss: 'Imported boss' } }],
    goal: { kind: 'omen', map: 'Sanctuary' },
    progress: { 'profit:maps': 10, 'profit:gem': 3, 'omen:Sanctuary': 1 },
  }
  const plan = planFightJournalImport(local, backup)
  expect(plan).toMatchObject({ fightsAdded: 1, progressAdded: 1, goalAdded: false, fightConflicts: 1, progressConflicts: 1, goalConflict: true })
  expect(plan.journal).toEqual({ ...local, entries: [same, different, added], progress: { ...local.progress, 'omen:Sanctuary': 1 } })
  expect(planFightJournalImport(plan.journal, backup)).toMatchObject({ fightsAdded: 0, progressAdded: 0, goalAdded: false })
  expect(local.entries).toHaveLength(2)
})

test('replaces a saved outcome for the same invocation and preserves manual progress after undo', () => {
  const storage = memory()
  const first = fight()
  const second = fight()
  const goal = { kind: 'omen', map: 'Sanctuary' } as const
  updateFightJournal(storage, journal => ({ ...putFightEntry(journal, first), goal, progress: { 'omen:Sanctuary': 1 } }))
  updateFightJournal(storage, journal => putFightEntry(journal, second))
  const changed: FightEntry = { ...first, outcome: { ...first.outcome, bossStatus: 'killed', loot: { status: 'none' } } }
  updateFightJournal(storage, journal => putFightEntry(journal, changed))
  expect(loadFightJournal(storage)).toEqual({ entries: [changed, second], goal, progress: { 'omen:Sanctuary': 1 } })
  updateFightJournal(storage, journal => removeFightEntry(journal, first.invocation.id))
  expect(loadFightJournal(storage)).toEqual({ entries: [second], goal, progress: { 'omen:Sanctuary': 1 } })
  expect(fightOutcomeSchema.safeParse({ ...first.outcome, loot: { status: 'items', items: ' ' } }).success).toBe(false)
})

test('preserves an unreadable journal and resets only area eligibility when a new area starts', () => {
  const storage = memory()
  storage.setItem(journalStorageKey, 'invalid')
  expect(() => updateFightJournal(storage, journal => putFightEntry(journal, fight()))).toThrow()
  expect(storage.getItem(journalStorageKey)).toBe('invalid')

  const workspace = startMapWorkspace(newAdvisorWorkspace())
  const invocation = { ...fight().invocation, areaId: workspace.map!.id }
  const updated = { ...workspace, lastInvocation: invocation, confirmedOmenMap: 'Sanctuary' as const }
  expect(saveAdvisorWorkspace(storage, updated)).toBeNull()
  expect(loadAdvisorWorkspace(storage).workspace).toEqual(updated)
  expect(startMapWorkspace(updated)).toMatchObject({ lastInvocation: invocation, confirmedOmenMap: null })
})

test('only suggests eligible Tier 3 options when the selected Omens area is confirmed', () => {
  const tierTwo = { ...newCard(), name: 'Dryad', tier: 2 }
  const tierThree = { ...newCard(), name: 'Crowkeeper', tier: 3 }
  const copy = { ...tierTwo, id: crypto.randomUUID() }
  const options = {
    goal: { kind: 'omen', map: 'Sanctuary' } as const, mode: 'offer' as const, offered: [tierThree, copy], collected: [tierTwo],
    confirmedOmenMap: 'Sanctuary' as const, profile: { goals: [], avoidModifiers: [] }, excludedCardIds: [],
  }
  expect(challengeAdvice({ ...options, collected: [{ ...tierTwo, tier: 1 }, { ...copy, tier: 1 }], offered: [], mode: 'invoke' })).toMatch(/^No supported Tier 3/)
  expect(challengeAdvice(options)).toContain('Crowkeeper + Dryad')
  expect(challengeAdvice({ ...options, excludedCardIds: [copy.id] })).not.toContain('Dryad')
  expect(challengeAdvice({ ...options, offered: [tierThree], collected: [], confirmedOmenMap: 'Citadel' })).toMatch(/^Check the map/)
  expect(challengeAdvice({ ...options, offered: [], collected: [tierTwo, copy], mode: 'invoke' })).toContain('Dryad + Dryad')
})

test('Promised Profits requires a modeled active reward and leaves unknown visual uniques unresolved', () => {
  const exceptional = { ...newReward(), kind: 'combo' as const, label: 'Exceptional Gem', threshold: 3, identified: true }
  const one = { ...newCard(), name: 'Dryad', tier: 1, rewards: [exceptional] }
  const two = { ...newCard(), name: 'Crowkeeper', tier: 1, rewards: [exceptional] }
  const three = { ...newCard(), name: 'Blood Moon', tier: 1, rewards: [exceptional] }
  const options = {
    goal: { kind: 'profit', objective: 'gem' } as const, mode: 'offer' as const, offered: [three], collected: [one, two],
    confirmedOmenMap: null, profile: { goals: [], avoidModifiers: [] }, excludedCardIds: [],
  }
  expect(challengeAdvice(options)).toContain('Blood Moon')
  expect(challengeAdvice({ ...options, limit: 2 })).toMatch(/^No active/)
  const tongue = { ...exceptional, label: "Doedre's Tongue", threshold: 2 }
  for (const objective of ['doedres', 'unique']) {
    const pair = [one, two].map(card => ({ ...card, rewards: [tongue] }))
    expect(challengeAdvice({ ...options, collected: pair, offered: [], mode: 'invoke', goal: { kind: 'profit', objective: objective as 'doedres' | 'unique' } })).toContain('Dryad + Crowkeeper')
  }
  expect(challengeAdvice({ ...options, collected: [one] })).toMatch(/^No active/)
  const unknown = {
    ...one, rewards: [{ ...newReward(), label: "Dreadmaidens' Sacrament", kind: 'combo' as const, threshold: 2, count: 2, identified: true, visualId: 'orange-feathers' as const }],
  }
  expect(challengeAdvice({ ...options, collected: [unknown], offered: [], mode: 'invoke', goal: { kind: 'profit', objective: 'dreadmaidens' } })).toMatch(/^No active/)
  expect(profitObjectives).toHaveLength(15)
  expect(omenMaps).toHaveLength(17)
})

test('Promised Profits recognizes regular rewards, retaining tied choices only when the collection needs them', () => {
  const map = { ...newReward(), kind: 'regular' as const, label: 'Rare Map', identified: true }
  const one = { ...newCard(), name: 'Dryad', tier: 1, rewards: [map] }
  const two = { ...newCard(), name: 'Crowkeeper', tier: 1, rewards: [map] }
  const neutral = { ...newCard(), name: 'Blood Moon', tier: 1 }
  const options = {
    goal: { kind: 'profit', objective: 'maps' } as const, mode: 'offer' as const, offered: [one, two, neutral], collected: [],
    confirmedOmenMap: null, profile: { goals: [], avoidModifiers: [] }, excludedCardIds: [],
  }
  expect(challengeAdvice(options)).toBe('Choices with a modeled Promised Profits match: Dryad + Crowkeeper.')
  expect(challengeAdvice({ ...options, offered: [two, neutral], collected: [one] })).toBe('Plan with a modeled Promised Profits match: Dryad.')
})
