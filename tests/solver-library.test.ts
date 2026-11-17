import { expect, test } from 'vitest'
import { activeProfile, changeActiveSettings, MAX_SAVED_PROFILES, newSolverLibrary, parseSolverLibrary, readSolverLibrary, serializeSolverLibrary, SOLVER_LIBRARY_KEY, updateSolverLibrary, writeSolverLibrary } from '../src/lib/solver-library'
import { newSolverSettings, serializeSolverSettings, SOLVER_SETTINGS_KEY } from '../src/lib/solver-settings'

function memory() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
function customSettings() {
  return { ...newSolverSettings(), mode: 'single' as const, profile: { goals: [{ kind: 'combo' as const, label: 'My reward', weight: 42 }],
    avoidModifiers: ['reflect'], objective: 'viscera' as const, risks: { bleeding: 'exclude' as const } },
    singleGoal: { kind: 'combo' as const, label: 'My reward' },
    definitions: [{ id: crypto.randomUUID(), label: 'Personal reward', kind: 'combo' as const, threshold: 3, note: 'My tooltip' }] }
}

test('migration preserves every legacy setting and leaves the old bytes intact', () => {
  const storage = memory(), settings = customSettings(), legacy = serializeSolverSettings(settings)
  storage.setItem(SOLVER_SETTINGS_KEY, legacy)
  const state = readSolverLibrary(storage)
  expect(activeProfile(state.library)).toMatchObject({ name: 'My build', settings })
  expect(storage.getItem(SOLVER_LIBRARY_KEY)).toBeNull()
  const result = writeSolverLibrary(storage, state.library, state)
  expect(result.error).toBeNull()
  expect(readSolverLibrary(storage).library).toEqual(state.library)
  expect(storage.getItem(SOLVER_SETTINGS_KEY)).toBe(legacy)
})

test('duplicated profiles are independent and switching restores full settings', () => {
  const first = newSolverLibrary(customSettings()), firstId = first.activeProfileId
  const copy = updateSolverLibrary(first, { type: 'duplicate' })
  expect(activeProfile(copy).settings).toEqual(activeProfile(first).settings)
  expect(activeProfile(copy).settings).not.toBe(activeProfile(first).settings)
  const edited = changeActiveSettings(copy, newSolverSettings())
  expect(activeProfile(edited).settings.profile.objective).toBeUndefined()
  expect(activeProfile(updateSolverLibrary(edited, { type: 'select', id: firstId })).settings).toEqual(activeProfile(first).settings)
  expect(parseSolverLibrary(serializeSolverLibrary(edited))).toEqual(edited)
})

test('renaming normalizes surrounding whitespace and rejects ambiguous names', () => {
  const original = newSolverLibrary(), duplicate = updateSolverLibrary(original, { type: 'duplicate' })
  const renamed = updateSolverLibrary(duplicate, { type: 'rename', name: '  Boss / SSF  ' })
  expect(activeProfile(renamed).name).toBe('Boss / SSF')
  for (const name of ['', ' '.repeat(10), 'x'.repeat(61), 'MY BUILD', 'Ｍｙ ｂｕｉｌｄ']) {
    expect(() => updateSolverLibrary(renamed, { type: 'rename', name })).toThrow()
  }
  expect(() => updateSolverLibrary(renamed, { type: 'select', id: crypto.randomUUID() })).toThrow()
})

test('new profiles use defaults; deleting selects a survivor and protects the last profile', () => {
  const first = newSolverLibrary(customSettings()), added = updateSolverLibrary(first, { type: 'new' })
  expect(activeProfile(added).settings).toEqual({ ...newSolverSettings(), singleGoal: null })
  expect(updateSolverLibrary(added, { type: 'delete' })).toEqual(first)
  expect(() => updateSolverLibrary(first, { type: 'delete' })).toThrow(/at least one/)
})

test('the library limit and generated names remain exportable with long names', () => {
  let library = updateSolverLibrary(newSolverLibrary(), { type: 'rename', name: 'Ł'.repeat(60) })
  const firstId = library.activeProfileId
  for (let i = 1; i < MAX_SAVED_PROFILES; i++) {
    library = updateSolverLibrary(updateSolverLibrary(library, { type: 'select', id: firstId }), { type: 'duplicate' })
  }
  expect(parseSolverLibrary(serializeSolverLibrary(library)).profiles).toHaveLength(MAX_SAVED_PROFILES)
  expect(() => updateSolverLibrary(library, { type: 'new' })).toThrow(/20 profiles/)
})

test('malformed imports never resolve an absent selection or silently drop duplicate profiles', () => {
  const valid = newSolverLibrary()
  for (const invalid of [
    { ...valid, activeProfileId: crypto.randomUUID() }, { ...valid, profiles: [] },
    { ...valid, profiles: [...valid.profiles, { ...valid.profiles[0], id: crypto.randomUUID() }] },
    { ...valid, profiles: [...valid.profiles, { ...valid.profiles[0], name: 'Other' }] },
    { ...valid, profiles: [{ ...valid.profiles[0], settings: { ...newSolverSettings(), mode: 'bad' } }] },
    { ...valid, captures: [] },
  ]) expect(() => parseSolverLibrary(JSON.stringify(invalid))).toThrow(/Invalid profile library/)
  expect(() => parseSolverLibrary('x'.repeat(1_500_001))).toThrow(/too large/)
})

test('concurrent library writers and a legacy edit during migration are rejected', () => {
  const storage = memory(), initial = readSolverLibrary(storage)
  storage.setItem(SOLVER_SETTINGS_KEY, serializeSolverSettings(customSettings()))
  expect(writeSolverLibrary(storage, initial.library, initial)).toMatchObject({ conflict: true })
  const migrated = readSolverLibrary(storage)
  const first = writeSolverLibrary(storage, migrated.library, migrated)
  const newer = updateSolverLibrary(migrated.library, { type: 'duplicate' })
  const second = writeSolverLibrary(storage, newer, { ...migrated, raw: first.raw })
  expect(second.error).toBeNull()
  expect(writeSolverLibrary(storage, migrated.library, { ...migrated, raw: first.raw })).toMatchObject({ conflict: true })
  expect(readSolverLibrary(storage).library).toEqual(newer)
})

test('unreadable libraries take precedence over legacy settings and remain recoverable', () => {
  const storage = memory()
  storage.setItem(SOLVER_SETTINGS_KEY, serializeSolverSettings(customSettings()))
  storage.setItem(SOLVER_LIBRARY_KEY, '{broken')
  expect(readSolverLibrary(storage)).toMatchObject({ raw: '{broken', unreadable: true, error: expect.any(String) })
  expect(storage.getItem(SOLVER_LIBRARY_KEY)).toBe('{broken')
  const unreadableLegacy = memory(); unreadableLegacy.setItem(SOLVER_SETTINGS_KEY, '{broken legacy')
  expect(readSolverLibrary(unreadableLegacy)).toMatchObject({ legacyRaw: '{broken legacy', unreadable: true })
})

test('quota and unavailable storage do not claim a durable save or overwrite existing data', () => {
  const storage = memory(), state = readSolverLibrary(storage)
  const deny = { ...storage, setItem: () => { throw new Error('quota') } }
  expect(writeSolverLibrary(deny, state.library, state)).toMatchObject({ raw: null, conflict: false, error: expect.stringContaining('could not be saved') })
  expect(storage.getItem(SOLVER_LIBRARY_KEY)).toBeNull()
  expect(readSolverLibrary({ ...deny, getItem: () => { throw new Error('denied') } })).toMatchObject({ unreadable: false, error: expect.stringContaining('unavailable') })
})

test('a legacy profile at the old byte limit can migrate its goal and still be exported', () => {
  const storage = memory(), settings = newSolverSettings()
  settings.profile.avoidModifiers = Array.from({ length: 30 }, (_, index) => `${index}:`.padEnd(1000, 'x'))
  settings.definitions = Array.from({ length: 64 }, (_, index) => ({ id: crypto.randomUUID(), label: `Reward ${index}`, kind: 'regular', threshold: null, note: 'x'.repeat(500) }))
  let excess = new TextEncoder().encode(JSON.stringify(settings, null, 2)).byteLength - 64_000
  expect(excess).toBeGreaterThan(0)
  for (const row of settings.definitions) {
    const removed = Math.min(excess, row.note.length)
    row.note = row.note.slice(removed); excess -= removed
  }
  const raw = JSON.stringify(settings, null, 2)
  expect(new TextEncoder().encode(raw)).toHaveLength(64_000)
  storage.setItem(SOLVER_SETTINGS_KEY, raw)
  const goal = { kind: 'combo' as const, label: '漢'.repeat(160) }
  const migrated = readSolverLibrary(storage, goal)
  expect(activeProfile(migrated.library).settings.singleGoal).toEqual(goal)
  expect(() => serializeSolverSettings(activeProfile(migrated.library).settings)).not.toThrow()
  expect(writeSolverLibrary(storage, migrated.library, migrated).error).toBeNull()
  expect(storage.getItem(SOLVER_SETTINGS_KEY)).toBe(raw)
})

test('library imports normalize omitted single goals without inheriting the current map', () => {
  const library = newSolverLibrary()
  delete library.profiles[0].settings.singleGoal
  expect(activeProfile(parseSolverLibrary(JSON.stringify(library))).settings.singleGoal).toBeNull()
})
