import { expect, test } from 'vitest'
import { newCard } from '../shared/offers'
import { VISCERA_TARGETS, getVisceraTarget, isVisceraSourceHere, resolveVisceraArea, visceraCompanion } from '../shared/viscera-target'

test('the target catalog groups same-name variants and preserves their known sources', () => {
  const ids = VISCERA_TARGETS.map(target => target.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(VISCERA_TARGETS.every(target => target.sources.length > 0)).toBe(true)
  expect(VISCERA_TARGETS.filter(target => target.name === 'Artificial Appendage')).toHaveLength(1)
  expect(getVisceraTarget('Scorched_Arm')?.sources).toEqual([
    { boss: 'Fire Fury', act: 1, area: 'The Coast' },
    { boss: 'Megaera', area: 'Crater' },
  ])
  expect(getVisceraTarget('Bloodied_Arm')?.sources).toEqual([{ boss: 'Aurel the Hungry?' }])
  expect(getVisceraTarget('unrecognized')).toBeUndefined()
})

test('map matching uses exact sourced identifiers or names', () => {
  const source = { boss: 'Megaera', area: 'Crater' }
  expect(isVisceraSourceHere(source, resolveVisceraArea({ area: 'MapWorldsTribunal', areaCategory: 'map' }))).toBe(true)
  expect(isVisceraSourceHere(source, resolveVisceraArea({ area: ' Crater Map ' }))).toBe(true)
  expect(isVisceraSourceHere(source, resolveVisceraArea({ area: 'MapWorldsDunes' }))).toBe(false)
  expect(resolveVisceraArea({ area: 'MapWorldsCrater' })).toBeUndefined()
  expect(resolveVisceraArea({ area: 'MapWorldsTribunal', areaCategory: 'campaign' })).toBeUndefined()
  expect(resolveVisceraArea({ area: 'Synthesis_MapBoss' })).toBeUndefined()
  expect(resolveVisceraArea(null)).toBeUndefined()
})

test('campaign matches distinguish repeated names and the underlying act', () => {
  const source = { boss: 'Fire Fury', act: 1, area: 'The Coast' }
  expect(resolveVisceraArea({ area: 'The Coast' })).toBeUndefined()
  expect(isVisceraSourceHere(source, resolveVisceraArea({ area: 'Act 1, The Coast' }))).toBe(true)
  expect(isVisceraSourceHere(source, resolveVisceraArea({ area: '1_1_2' }))).toBe(true)
  expect(isVisceraSourceHere(source, resolveVisceraArea({ area: '2_6_2' }))).toBe(false)
})

test('Hydra and Chimera source names follow their world-area records', () => {
  for (const [targetId, area] of [['Hydras_Head', 'MapWorldsHydra'], ['Chimeras_Head', 'MapWorldsChimera']]) {
    const source = getVisceraTarget(targetId)!.sources[0]
    expect(isVisceraSourceHere(source, resolveVisceraArea({ area }))).toBe(true)
  }
  expect(resolveVisceraArea({ area: 'Pit of the Hydra' })).toBeUndefined()
})

test('companion references require a supported tier and apply planning filters', () => {
  const card = { ...newCard(), name: 'Savage', tier: 3 }
  expect(visceraCompanion({ ...card, name: 'Other' }, {})).toBeUndefined()
  expect(visceraCompanion({ ...card, tier: 2 }, {})).toBeUndefined()
  expect(visceraCompanion({ ...card, visualReview: { version: 'test', tierReviewed: false, rewardsReviewed: true } }, {})).toBeUndefined()
  expect(visceraCompanion(card, { risks: { extraBoss: 'exclude' } })).toMatchObject({
    name: 'Savage', tier: 3, excluded: true, reasons: ['Additional boss (Tier 3 source reference, PoEDB).'],
  })
  for (const name of ['Pestilent', 'Sadist']) {
    const reviewed = { ...card, name, visualReview: { version: 'test', tierReviewed: true, rewardsReviewed: false } }
    expect(visceraCompanion(reviewed, { risks: { extraBoss: 'warn' } })).toMatchObject({
      name, excluded: false, warnings: ['Additional boss (Tier 3 source reference, PoEDB).'],
    })
    expect(visceraCompanion(reviewed, { excludedCardIds: [card.id] })?.excluded).toBe(true)
    expect(visceraCompanion({ ...reviewed, tier: 2 }, {})).toMatchObject({ name, tier: 2, excluded: false })
  }
})
