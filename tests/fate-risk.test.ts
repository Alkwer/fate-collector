import { expect, test } from 'vitest'
import { assessFateRisk, riskSettingsSchema } from '../shared/fate-risk'
import { newCard } from '../shared/offers'

test('risk settings accept only named categories with supported actions', () => {
  expect(riskSettingsSchema.parse({})).toEqual({})
  expect(riskSettingsSchema.parse({ chaos: 'exclude', extraBoss: 'allow' })).toEqual({ chaos: 'exclude', extraBoss: 'allow' })
  expect(riskSettingsSchema.safeParse({ chaos: 'avoid' }).success).toBe(false)
  expect(riskSettingsSchema.safeParse({ other: 'warn' }).success).toBe(false)
})

test('recorded modifiers receive their configured warning and exclusion actions', () => {
  const card = { ...newCard(), modifiers: [
    'Pools deal Physical Damage\n over time',
    'Empowered Monster has 50% chance to Poison on Hit',
    'Empowered Monster has 50% chance to inflict Bleeding on Hit with Attacks',
    'Empowered Monster inflicts Conductivity on Hit',
    'Empowered Monster will regenerate 1% of Life per second',
    'Spawns an additional Boss from Campaign Areas without an Atlas equivalent',
  ] }

  expect(assessFateRisk(card, {})).toEqual({ excluded: false, reasons: [], warnings: [] })
  const assessed = assessFateRisk(card, {
    physicalDot: 'exclude', chaos: 'warn', bleeding: 'exclude', curses: 'warn', bossRecovery: 'warn', extraBoss: 'allow',
  })
  expect(assessed).toEqual({
    excluded: true,
    reasons: ['Physical damage over time (recorded modifier).', 'Bleeding (recorded modifier).'],
    warnings: ['Chaos damage and poison (recorded modifier).', 'Curses (recorded modifier).', 'Boss life recovery (recorded modifier).'],
  })
  expect(assessFateRisk(card, { extraBoss: 'exclude' }).reasons).toEqual(['Additional boss (recorded modifier).'])
})

test('physical hits, repeated hits and a cursed name are not classified as physical damage over time or a curse', () => {
  const crowkeeper = { ...newCard(), name: 'Crowkeeper', tier: 3 }
  expect(assessFateRisk(crowkeeper, { physicalDot: 'exclude' })).toEqual({ excluded: false, reasons: [], warnings: [] })

  const rotted = { ...newCard(), name: 'Rotted', tier: 3, modifiers: ['Deals repeated Physical Damage with Hits'] }
  expect(assessFateRisk(rotted, { physicalDot: 'exclude', curses: 'exclude' })).toEqual({ excluded: false, reasons: [], warnings: [] })
})

test('reference risk supplements recorded modifiers and identifies its source and tier', () => {
  const sanguine = { ...newCard(), name: 'Sanguine', tier: 3, modifiers: ['Regenerate 2% of Life per second'] }
  expect(assessFateRisk(sanguine, { physicalDot: 'exclude', bossRecovery: 'warn' })).toEqual({
    excluded: true,
    reasons: ['Physical damage over time (Tier 3 source reference, PoEDB).'],
    warnings: ['Boss life recovery (recorded modifier).'],
  })
  const golemancer = { ...newCard(), name: 'Golemancer', tier: 3 }
  expect(assessFateRisk(golemancer, { bleeding: 'warn' }).warnings).toEqual(['Bleeding (Tier 3 source reference, PoEDB).'])
})

test('unknown and unreviewed tiers do not use references but recorded hazards still apply', () => {
  const sanguine = { ...newCard(), name: 'Sanguine', modifiers: ['   '] }
  const unreviewed = { ...sanguine, tier: 3, visualReview: { version: 'test', tierReviewed: false, rewardsReviewed: true } }
  for (const card of [sanguine, { ...sanguine, tier: 1 }, { ...sanguine, tier: 2 }, unreviewed]) {
    expect(assessFateRisk(card, { physicalDot: 'exclude' })).toMatchObject({
      excluded: false,
      reasons: [],
      warnings: [expect.stringContaining('Build risk is unverified')],
    })
  }
  expect(assessFateRisk(unreviewed, { physicalDot: 'exclude' }, 3).excluded).toBe(false)
  expect(assessFateRisk({ ...unreviewed, modifiers: ['Deals Physical Damage over time'] }, { physicalDot: 'exclude' }).excluded).toBe(true)
})

test('a caller can assess Tier 3 effects for a confirmed Tier 2 merge', () => {
  const savage = { ...newCard(), name: 'Savage', tier: 2, visualReview: { version: 'test', tierReviewed: true, rewardsReviewed: false } }
  const settings = { extraBoss: 'exclude' } as const
  expect(assessFateRisk(savage, settings).excluded).toBe(false)
  expect(assessFateRisk(savage, settings, 3)).toEqual({
    excluded: true,
    reasons: ['Additional boss (Tier 3 source reference, PoEDB).'],
    warnings: [],
  })
})
test('matches explicit T3 fire damage over time, Brittle and critical bonuses', () => {
  const filter = { fireDot: 'exclude', brittleCrit: 'warn' } as const
  expect(assessFateRisk({ ...newCard(), name: 'Wildfire', tier: 3 }, filter).excluded).toBe(true)
  expect(assessFateRisk({ ...newCard(), name: 'Houndmaster', tier: 3 }, filter).warnings).toContain('Brittle and critical strikes (Tier 3 source reference, PoEDB).')
  expect(assessFateRisk({ ...newCard(), name: 'Other', tier: 2, modifiers: ['Unaffected by Brittle', 'Deals fire damage on hit'] }, filter)).toEqual({ excluded: false, reasons: [], warnings: [] })
})

test('recognizes a recorded critical multiplier with or without a modifier prefix', () => {
  for (const modifier of ['+40% to Critical Strike Multiplier', 'Empowered Monster has +40% to Global Critical Strike Multiplier']) {
    const card = { ...newCard(), tier: 2, modifiers: [modifier] }
    expect(assessFateRisk(card, { brittleCrit: 'warn' }).warnings).toEqual(['Brittle and critical strikes (recorded modifier).'])
    expect(assessFateRisk(card, { brittleCrit: 'exclude' }).excluded).toBe(true)
  }
})
