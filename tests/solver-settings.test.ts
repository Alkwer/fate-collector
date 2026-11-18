import { expect, test } from 'vitest'
import { applyTradeStarter, newSolverSettings, parseSolverSettings, readSolverSettings, serializeSolverSettings, SOLVER_SETTINGS_KEY, upsertDefinition, writeSolverSettings, replaceStarterPriorities, STARTER_PROFILES } from '../src/lib/solver-settings'
import { loadAdvisorWorkspace, newAdvisorWorkspace, startMapWorkspace } from '../src/lib/advisor-workspace'
import { MAX_REWARD_PRIORITIES, solveInvocation } from '../shared/solver'
import { REWARD_CATALOG } from '../shared/reward-catalog'
import type { FateCard } from '../shared/schema'

function memory() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

const flexiblePatchPriorities = [
  ["Hinekora's Lock", 30],
  ['Mirror Shard', 25],
  ['Additional Divine Orbs', 12],
  ['Fracturing Orb', 8],
  ['Amulets with a Gem Modifier', 5],
  ['Rare Gloves with a Life Modifier', 1],
  ['Rare Helmets with a Life Modifier', 1],
] as const

test('new profiles cover live reward variants without changing an existing saved profile', () => {
  const store = memory()
  const starter = readSolverSettings(store).settings
  expect(starter).toMatchObject({ mode: 'portfolio', profile: { goals: expect.arrayContaining([
    { kind: 'combo', label: 'Exceptional Gem', weight: 10 },
    { kind: 'combo', label: 'Item Rarity', weight: 4 },
    { kind: 'combo', label: "Dreadmaidens' Sacrament", weight: 2 },
    { kind: 'regular', label: 'Additional Currency Items', weight: 3 },
    { kind: 'combo', label: 'Additional Currency Items', weight: 4 },
    { kind: 'combo', label: 'Massively Increased Item Rarity', weight: 4 },
    { kind: 'regular', label: 'Rare Body Armours with a Defence Modifier', weight: 1 },
    { kind: 'regular', label: 'Rare Shields with a Defence Modifier', weight: 1 },
    ...flexiblePatchPriorities.flatMap(([label, weight]) => [
      { kind: 'regular', label, weight }, { kind: 'combo', label, weight },
    ]),
  ]), avoidModifiers: [] }, definitions: [] })
  const known = REWARD_CATALOG.filter(entry => entry.kind !== 'unknown')
  const patchVariants = flexiblePatchPriorities.flatMap(([label]) => [['regular', label], ['combo', label]])
  expect(starter.profile.goals.map(({ kind, label }) => [kind, label]).sort())
    .toEqual([...known.map(({ kind, label }) => [kind, label]), ...patchVariants].sort())
  expect(starter.profile.goals.every(goal => goal.weight > 0)).toBe(true)
  starter.profile.goals.find(goal => goal.label === 'Exceptional Gem')!.weight = 99
  expect(newSolverSettings().profile.goals.find(goal => goal.label === 'Exceptional Gem')?.weight).toBe(10)
  expect(store.getItem(SOLVER_SETTINGS_KEY)).toBeNull()

  const previous = { ...newSolverSettings(), mode: 'single' as const, profile: {
    goals: [
      { kind: 'combo' as const, label: 'Exceptional Gem', weight: 50 },
      { kind: 'regular' as const, label: "Hinekora's Lock", weight: 0 },
    ], avoidModifiers: ['reflect'],
  } }
  const saved = writeSolverSettings(store, previous, null)
  expect(readSolverSettings(store)).toEqual({ settings: previous, ...saved })
  expect(store.getItem(SOLVER_SETTINGS_KEY)).toBe(saved.raw)
})

test('applying the starter updates matching weights and keeps unrelated priorities, filters and templates', () => {
  const previous = upsertDefinition({ ...newSolverSettings(), mode: 'single', profile: {
    goals: [
      { kind: 'combo', label: 'dreadmaidens’   sacrament', weight: 15 },
      { kind: 'combo', label: 'Additional Currency Items', weight: 20 },
      { kind: 'regular', label: 'Armour', weight: 9 },
      { kind: 'regular', label: 'Hinekora’s Lock', weight: 0 },
      { kind: 'regular', label: 'Rare Body Armours without Life Modifiers', weight: 7 },
    ],
    avoidModifiers: ['reflect'],
  } }, { id: crypto.randomUUID(), label: 'Custom Gem', kind: 'combo', threshold: 2, note: '' })

  const applied = applyTradeStarter(previous)
  expect(applied).toEqual({ ...previous, mode: 'portfolio', profile: { ...previous.profile, goals: [
    { ...previous.profile.goals[0], weight: 2 },
    { ...previous.profile.goals[1], weight: 4 },
    previous.profile.goals[2],
    { ...previous.profile.goals[3], weight: 30 },
    previous.profile.goals[4],
    ...newSolverSettings().profile.goals.filter(goal =>
      !(goal.kind === 'combo' && ["Dreadmaidens' Sacrament", 'Additional Currency Items'].includes(goal.label))
      && !(goal.kind === 'regular' && goal.label === "Hinekora's Lock")),
  ] } })
  expect(previous.profile.goals[0].weight).toBe(15)
  const store = memory()
  const saved = writeSolverSettings(store, applied!, null)
  expect(readSolverSettings(store)).toEqual({ settings: applied, ...saved })
  expect(applyTradeStarter(readSolverSettings(store).settings)).toEqual(applied)
})

test('applying the starter is atomic at the profile capacity limit', () => {
  const starter = newSolverSettings()
  const unrelated = Array.from({ length: MAX_REWARD_PRIORITIES - starter.profile.goals.length }, (_, index) => ({ kind: 'regular' as const, label: `Reward ${index + 1}`, weight: 1 }))
  const available = { ...starter, mode: 'single' as const, profile: { ...starter.profile, goals: unrelated } }
  const atLimit = applyTradeStarter(available)
  expect(atLimit?.profile.goals).toHaveLength(MAX_REWARD_PRIORITIES)
  expect(applyTradeStarter(atLimit!)).toEqual(atLimit)
  const full = { ...available, profile: { ...available.profile, goals: [
    ...unrelated, { kind: 'regular' as const, label: 'Extra reward', weight: 1 },
  ] } }
  expect(applyTradeStarter(full)).toBeNull()
  expect(full.profile.goals).toHaveLength(unrelated.length + 1)
  expect(full.mode).toBe('single')
})

test('the starter scores confirmed regular currency and completed combos', () => {
  const label = 'Additional Currency Items'
  const card: FateCard = { id: 'starter', name: 'Rot', tier: 2, modifiers: [], rewards: [
    { id: 'currency', label, kind: 'regular', identified: true, count: 2, threshold: null },
    { id: 'unconfirmed', label, kind: 'unknown', identified: false, count: 1, threshold: null },
    { id: 'currency-combo', label, kind: 'combo', identified: true, count: 2, threshold: 2 },
    { id: 'gem', label: 'Exceptional Gem', kind: 'combo', identified: true, count: 3, threshold: 3 },
  ] }
  expect(solveInvocation([card], newSolverSettings().profile).plans[0]).toMatchObject({
    score: 20,
    rewards: expect.arrayContaining([
      expect.objectContaining({ kind: 'regular', label, points: 6 }),
      expect.objectContaining({ kind: 'combo', label, points: 4 }),
      expect.objectContaining({ kind: 'unknown', label, points: 0 }),
      expect.objectContaining({ kind: 'combo', label: 'Exceptional Gem', points: 10 }),
    ]),
  })
})

test.each([
  { kind: 'unknown', identified: false, count: 1, threshold: null, points: 0 },
  { kind: 'regular', identified: false, count: 1, threshold: null, points: 0 },
  { kind: 'regular', identified: true, count: 2, threshold: null, points: 60 },
  { kind: 'combo', identified: true, count: 3, threshold: null, points: 0 },
  { kind: 'combo', identified: true, count: 2, threshold: 3, points: 0 },
  { kind: 'combo', identified: true, count: 3, threshold: 3, points: 30 },
] as const)('the patch starter gives $points active points to a $kind reward (identified: $identified, count: $count, threshold: $threshold)', ({ points, ...observation }) => {
  const label = 'Hinekora’s Lock'
  const card: FateCard = { id: 'starter', name: 'Rot', tier: 2, modifiers: [], rewards: [
    { id: 'patch-reward', label, ...observation },
    { id: 'gold', label: 'Gold', kind: 'regular', identified: true, count: 1, threshold: null },
  ] }
  expect(solveInvocation([card], newSolverSettings().profile).plans[0]).toMatchObject({
    score: 1 + points,
    rewards: expect.arrayContaining([expect.objectContaining({ label, points })]),
  })
})

test('explicit starter replacement preserves filters and personal definitions but removes other goals', () => {
  const previous = upsertDefinition({ ...newSolverSettings(), profile: { goals: [{ kind: 'regular', label: 'Custom', weight: 100 }], avoidModifiers: ['reflect'] } },
    { id: crypto.randomUUID(), label: 'My gem', kind: 'regular', threshold: null, note: '' })
  const replaced = replaceStarterPriorities(previous, 'viscera')
  expect(replaced.profile).toEqual({ goals: [{ kind: 'combo', label: 'Viscera Item', weight: 10 }], avoidModifiers: ['reflect'] })
  expect(replaced.definitions).toEqual(previous.definitions)
  expect(previous.profile.goals[0].label).toBe('Custom')
  for (const id of Object.keys(STARTER_PROFILES) as (keyof typeof STARTER_PROFILES)[]) {
    expect(() => serializeSolverSettings(replaceStarterPriorities(previous, id))).not.toThrow()
  }
})
test('round-trips a reusable profile without any observations or map state', () => {
  const profile = { ...newSolverSettings(), mode: 'portfolio' as const, profile: { goals: [{ label: 'Currency', kind: 'regular' as const, weight: 2.5 }], avoidModifiers: ['reflect'] } }
  const withDefinition = upsertDefinition(profile, { id: crypto.randomUUID(), label: 'Custom Gem', kind: 'combo', threshold: 2, note: 'My tooltip, build 3.30' })
  expect(parseSolverSettings(serializeSolverSettings(withDefinition))).toEqual(withDefinition)
  const store = memory()
  expect(writeSolverSettings(store, withDefinition, null).error).toBeNull()
  expect(readSolverSettings(store).settings).toEqual(withDefinition)
  expect(serializeSolverSettings(withDefinition)).not.toMatch(/collected|capturedAt|imageBase64/)
})
test('rejects malformed imports, duplicate normalized goals, duplicate templates and invalid combo rules', () => {
  const base = newSolverSettings()
  for (const text of ['{bad', ' '.repeat(64_001), 'ą'.repeat(32_001), JSON.stringify({ ...base, schemaVersion: 2 }), JSON.stringify({ ...base, offers: [] }),
    JSON.stringify({ ...base, profile: { goals: [{ kind: 'regular', label: ' Currency ', weight: 1 }, { kind: 'regular', label: 'currency', weight: 2 }], avoidModifiers: [] } })]) {
    expect(() => parseSolverSettings(text)).toThrow()
  }
  const one = upsertDefinition(base, { id: crypto.randomUUID(), label: 'Custom', kind: 'combo', threshold: 3, note: '' })
  expect(() => parseSolverSettings(JSON.stringify({ ...one, definitions: [...one.definitions, { ...one.definitions[0], id: crypto.randomUUID() }] }))).toThrow()
  expect(() => upsertDefinition(base, { id: crypto.randomUUID(), label: 'Custom', kind: 'combo', threshold: null, note: '' })).toThrow()
})
test('updating a personal definition keeps its identity and does not change the official catalog', () => {
  const first = upsertDefinition(newSolverSettings(), { id: crypto.randomUUID(), label: 'Custom', kind: 'combo', threshold: 3, note: '' })
  const updated = upsertDefinition(first, { id: crypto.randomUUID(), label: 'custom', kind: 'combo', threshold: 2, note: 'Corrected tooltip' })
  expect(updated.definitions).toEqual([{ ...first.definitions[0], label: 'custom', threshold: 2, note: 'Corrected tooltip' }])
  expect(first.definitions[0].threshold).toBe(3)
})
test('a stale profile writer cannot overwrite settings saved by a second tab', () => {
  const store = memory(), initial = newSolverSettings()
  const saved = writeSolverSettings(store, initial, null)
  const next = { ...initial, mode: 'single' as const }
  const newer = writeSolverSettings(store, next, saved.raw)
  expect(newer.error).toBeNull()
  expect(writeSolverSettings(store, initial, saved.raw).error).toMatch(/another tab/)
  expect(store.getItem(SOLVER_SETTINGS_KEY)).toBe(newer.raw)
})
test('corrupt bytes and failed writes remain recoverable', () => {
  const store = memory(); store.setItem(SOLVER_SETTINGS_KEY, '{damaged')
  expect(readSolverSettings(store)).toMatchObject({ raw: '{damaged', error: expect.any(String) })
  expect(store.getItem(SOLVER_SETTINGS_KEY)).toBe('{damaged')
  expect(writeSolverSettings({ ...store, setItem: () => { throw new Error('quota') } }, newSolverSettings(), '{damaged')).toMatchObject({ raw: '{damaged', error: expect.any(String) })
  expect(store.getItem(SOLVER_SETTINGS_KEY)).toBe('{damaged')
})
test('old map workspaces migrate exclusions and a new map clears only map exclusions', () => {
  const previous = startMapWorkspace(newAdvisorWorkspace())
  const { excludedCardIds: _ignored, ...old } = previous
  const store = memory(); store.setItem('fate-collector.advisor-area.v2', JSON.stringify(old))
  expect(loadAdvisorWorkspace(store).workspace.excludedCardIds).toEqual([])
  const reset = startMapWorkspace({ ...previous, excludedCardIds: [crypto.randomUUID()] })
  expect(reset.excludedCardIds).toEqual([])
})
test('denied storage access is distinct from corrupt profile data', () => {
  const unavailable = { getItem: () => { throw new Error('Denied') }, setItem: () => { throw new Error('Denied') } }
  expect(readSolverSettings(unavailable)).toMatchObject({ settings: newSolverSettings(), raw: null, error: 'Browser profile storage is unavailable. Export your settings before leaving.' })
  expect(writeSolverSettings(unavailable, newSolverSettings(), null).error).toContain('could not be saved')
})
