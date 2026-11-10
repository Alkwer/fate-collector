import { expect, test } from 'vitest'
import { newCard, newReward } from '../shared/offers'
import { loadAdvisorWorkspace, newAdvisorWorkspace, saveAdvisorWorkspace } from '../src/lib/advisor-workspace'

function memory(initial: string | null = null) {
  let value = initial
  return { getItem: () => value, setItem: (_key: string, text: string) => { value = text } }
}
test('restores a valid area and goal while requiring confirmation for a nonempty collection', () => {
  const storage = memory()
  const workspace = newAdvisorWorkspace()
  workspace.collection.cards = [{ ...newCard(), name: 'Torchbearer', rewards: [newReward()] }]
  workspace.goal = { kind: 'combo', label: 'Exceptional Gem' }
  workspace.mode = 'invoke'
  expect(saveAdvisorWorkspace(storage, workspace)).toBeNull()
  expect(loadAdvisorWorkspace(storage)).toEqual({ workspace, restored: true, error: null })
})
test('invalid edits and corrupt stored data preserve the previous bytes instead of silently replacing them', () => {
  const storage = memory()
  const workspace = newAdvisorWorkspace()
  workspace.collection.cards = [newCard()]
  saveAdvisorWorkspace(storage, workspace)
  const previous = storage.getItem()
  expect(saveAdvisorWorkspace(storage, { ...workspace, collection: { ...workspace.collection, cards: [{ ...newCard(), tier: 0 }] } })).toContain('not saved')
  expect(storage.getItem()).toBe(previous)
  const corrupt = memory('{invalid')
  expect(loadAdvisorWorkspace(corrupt).error).toContain('could not be restored')
  expect(corrupt.getItem()).toBe('{invalid')
})
test('new area clears old cards and orphan source references; storage errors remain explicit', () => {
  const storage = memory()
  const workspace = newAdvisorWorkspace()
  workspace.sources[crypto.randomUUID()] = crypto.randomUUID()
  expect(saveAdvisorWorkspace(storage, workspace)).toBeNull()
  expect(loadAdvisorWorkspace(storage)).toMatchObject({ restored: false, workspace: { sources: {}, collection: { cards: [] } } })
  const denied = { getItem: () => { throw new Error('Denied') }, setItem: () => { throw new Error('Denied') } }
  expect(loadAdvisorWorkspace(denied).error).toBeTruthy()
  expect(saveAdvisorWorkspace(denied, workspace)).toContain('only in memory')
})
