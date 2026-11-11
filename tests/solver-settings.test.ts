import { expect, test } from 'vitest'
import { newSolverSettings, parseSolverSettings, readSolverSettings, serializeSolverSettings, SOLVER_SETTINGS_KEY, upsertDefinition, writeSolverSettings } from '../src/lib/solver-settings'
import { loadAdvisorWorkspace, newAdvisorWorkspace, startMapWorkspace } from '../src/lib/advisor-workspace'

function memory() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
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
  const next = { ...initial, mode: 'portfolio' as const }
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
