import { expect, test } from 'vitest'
import { newCard, newReward } from '../shared/offers'
import { bindOfferToMap, loadAdvisorWorkspace, newAdvisorWorkspace, offerBelongsToMap, saveAdvisorWorkspace,
  startMapWorkspace, workspaceInvocationLimit, type AdvisorWorkspace } from '../src/lib/advisor-workspace'

const key = 'fate-collector.advisor-area.v2'
const legacyKey = 'fate-collector.advisor-area.v1'

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, text: string) => { data.set(key, text) } }
}

function legacyBytes({ collection, sources, goal, mode }: AdvisorWorkspace) {
  return JSON.stringify({ collection, sources, goal, mode })
}

test('restores the map, goal and explicitly associated offer', () => {
  const storage = memory()
  const offerId = crypto.randomUUID()
  const workspace = bindOfferToMap(startMapWorkspace(newAdvisorWorkspace()), offerId)
  workspace.lastOfferId = offerId
  workspace.collection.cards = [{ ...newCard(), name: 'Torchbearer', rewards: [newReward()] }]
  workspace.sources[workspace.collection.cards[0].id] = offerId
  workspace.goal = { kind: 'combo', label: 'Exceptional Gem' }
  workspace.mode = 'invoke'
  expect(saveAdvisorWorkspace(storage, workspace)).toBeNull()
  expect(loadAdvisorWorkspace(storage)).toEqual({ workspace, restored: true, error: null })
})

test('requires confirmation for an active empty map and after its last card is removed', () => {
  const storage = memory()
  const workspace = startMapWorkspace(newAdvisorWorkspace())
  expect(saveAdvisorWorkspace(storage, workspace)).toBeNull()
  expect(loadAdvisorWorkspace(storage)).toEqual({ workspace, restored: true, error: null })

  const card = newCard()
  const offerId = crypto.randomUUID()
  const populated = bindOfferToMap({ ...workspace, collection: { ...workspace.collection, cards: [card] }, sources: { [card.id]: offerId } }, offerId)
  expect(saveAdvisorWorkspace(storage, populated)).toBeNull()
  const { workspace: restored } = loadAdvisorWorkspace(storage)
  expect(saveAdvisorWorkspace(storage, { ...restored, collection: { ...restored.collection, cards: [] } })).toBeNull()
  expect(loadAdvisorWorkspace(storage)).toEqual({ workspace: { ...workspace, offerIds: [offerId] }, restored: true, error: null })
})

test('starts a new map with its own identity, empty collection and explicitly associated offers', () => {
  const inactive = newAdvisorWorkspace()
  const firstOffer = crypto.randomUUID()
  const secondOffer = crypto.randomUUID()
  expect(bindOfferToMap(inactive, firstOffer)).toBe(inactive)

  const first = bindOfferToMap(startMapWorkspace(inactive), firstOffer)
  const card = newCard()
  first.collection.cards = [card]
  first.sources[card.id] = firstOffer
  first.goal = { kind: 'regular', label: 'Currency' }
  first.mode = 'invoke'
  expect(bindOfferToMap(first, firstOffer)).toBe(first)
  expect(bindOfferToMap(first, 'invalid')).toBe(first)

  const reset = startMapWorkspace(first)
  expect(reset.map?.id).not.toBe(first.map?.id)
  expect(reset.map?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect(reset).toMatchObject({ collection: { cards: [] }, sources: {}, offerIds: [], goal: first.goal, mode: 'offer' })
  const second = bindOfferToMap(reset, secondOffer)
  expect(offerBelongsToMap(first, firstOffer)).toBe(true)
  expect(offerBelongsToMap(first, secondOffer)).toBe(false)
  expect(offerBelongsToMap(second, firstOffer)).toBe(false)
  expect(offerBelongsToMap(second, secondOffer)).toBe(true)
})

test('campaign capacity survives unknown offers and reload, and resets for a new area', () => {
  const storage = memory()
  const campaign = { id: crypto.randomUUID(), areaCategory: 'campaign' as const }
  const nextOffer = { id: crypto.randomUUID() }
  const map = startMapWorkspace(newAdvisorWorkspace())
  expect(workspaceInvocationLimit(map, campaign)).toBe(3)
  const olderWorkspace = bindOfferToMap(map, campaign.id)
  expect(workspaceInvocationLimit(olderWorkspace, campaign)).toBe(2)
  const current = bindOfferToMap(bindOfferToMap(map, campaign.id, 'campaign'), nextOffer.id)
  expect(saveAdvisorWorkspace(storage, current)).toBeNull()
  expect(workspaceInvocationLimit(loadAdvisorWorkspace(storage).workspace, nextOffer)).toBe(2)
  expect(workspaceInvocationLimit(startMapWorkspace(current), campaign)).toBe(3)
})

test('manual area survives conflicting offers, corrections and reload until cleared or reset', () => {
  const storage = memory()
  const offer = { id: crypto.randomUUID(), areaCategory: 'map' as const }
  const area = startMapWorkspace(newAdvisorWorkspace())
  const bound = bindOfferToMap({ ...area, planningAreaOverride: 'campaign' }, offer.id, offer.areaCategory)
  expect(saveAdvisorWorkspace(storage, bound)).toBeNull()
  const restored = loadAdvisorWorkspace(storage).workspace
  expect(workspaceInvocationLimit(restored, offer)).toBe(2)
  expect(workspaceInvocationLimit({ ...restored, planningAreaOverride: null }, offer)).toBe(3)
  expect(startMapWorkspace(restored).planningAreaOverride).toBeNull()

  const previous = JSON.parse(storage.getItem(key)!)
  delete previous.planningAreaOverride
  previous.collection.areaCategory = 'campaign'
  storage.setItem(key, JSON.stringify(previous))
  const upgraded = loadAdvisorWorkspace(storage).workspace
  const next = bindOfferToMap(upgraded, crypto.randomUUID(), 'map')
  expect(workspaceInvocationLimit(next, offer)).toBe(2)
})

test('migrates legacy cards with unknown map start time, preserves the goal and never revives them after reset', () => {
  const legacy = newAdvisorWorkspace()
  const card = newCard()
  const offerId = crypto.randomUUID()
  legacy.collection.cards = [card]
  legacy.collection.notes = 'Map notes'
  legacy.collection.areaCategory = 'campaign'
  legacy.sources = { [card.id]: offerId, [crypto.randomUUID()]: crypto.randomUUID() }
  legacy.goal = { kind: 'combo', label: 'Exceptional Gem' }
  legacy.mode = 'invoke'
  const raw = legacyBytes(legacy)
  const storage = memory({ [legacyKey]: raw })

  const migrated = loadAdvisorWorkspace(storage)
  expect(migrated).toMatchObject({
    restored: true, error: null,
    workspace: { map: { id: expect.any(String), startedAt: null }, planningAreaOverride: 'campaign', collection: legacy.collection, sources: { [card.id]: offerId }, offerIds: [offerId], goal: legacy.goal, mode: legacy.mode },
  })
  expect(loadAdvisorWorkspace(storage)).toEqual(migrated)
  const reset = startMapWorkspace(migrated.workspace)
  expect(saveAdvisorWorkspace(storage, reset)).toBeNull()
  expect(loadAdvisorWorkspace(storage)).toEqual({ workspace: reset, restored: true, error: null })
  expect(storage.getItem(legacyKey)).toBe(raw)
})

test('keeps empty legacy notes and their goal without activating a map', () => {
  const legacy = newAdvisorWorkspace()
  legacy.collection.notes = 'Map notes'
  legacy.goal = { kind: 'regular', label: 'Currency' }
  const storage = memory({ [legacyKey]: legacyBytes(legacy) })
  expect(loadAdvisorWorkspace(storage)).toEqual({ workspace: legacy, restored: false, error: null })
  expect(storage.getItem(key)).toBeTruthy()
})

test('invalid edits and corrupt stored data preserve the previous bytes instead of silently replacing them', () => {
  const storage = memory()
  const workspace = startMapWorkspace(newAdvisorWorkspace())
  workspace.collection.cards = [newCard()]
  expect(saveAdvisorWorkspace(storage, workspace)).toBeNull()
  const previous = storage.getItem(key)
  expect(saveAdvisorWorkspace(storage, { ...workspace, collection: { ...workspace.collection, cards: [{ ...newCard(), tier: 0 }] } })).toContain('not saved')
  expect(saveAdvisorWorkspace(storage, { ...workspace, map: null })).toContain('not saved')
  expect(saveAdvisorWorkspace(storage, { ...newAdvisorWorkspace(), offerIds: [crypto.randomUUID()] })).toContain('not saved')
  expect(storage.getItem(key)).toBe(previous)

  for (const invalid of ['{invalid', ' '.repeat(256_001)]) {
    const corrupt = memory({ [key]: invalid, [legacyKey]: legacyBytes(workspace) })
    expect(loadAdvisorWorkspace(corrupt)).toMatchObject({ restored: false, error: expect.stringContaining('could not be restored'), workspace: { map: null, collection: { cards: [] } } })
    expect(corrupt.getItem(key)).toBe(invalid)
  }
})

test('removes orphan source references and reports denied storage access', () => {
  const storage = memory()
  const workspace = newAdvisorWorkspace()
  workspace.sources[crypto.randomUUID()] = crypto.randomUUID()
  expect(saveAdvisorWorkspace(storage, workspace)).toBeNull()
  expect(loadAdvisorWorkspace(storage)).toMatchObject({ restored: false, workspace: { sources: {}, collection: { cards: [] } } })
  const denied = { getItem: () => { throw new Error('Denied') }, setItem: () => { throw new Error('Denied') } }
  expect(loadAdvisorWorkspace(denied).error).toBeTruthy()
  expect(saveAdvisorWorkspace(denied, workspace)).toContain('only in memory')
})
