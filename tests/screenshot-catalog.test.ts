import { expect, test } from 'vitest'
import screenshots from '../shared/screenshot-catalog.json'
import names from '../shared/fate-names.json'
import { POEDB_CATALOG } from '../shared/poedb-catalog'
import { catalogFields, REWARD_CATALOG, selectedCatalogReward, visualRewardFields } from '../shared/reward-catalog'
import { newCard, newReward } from '../shared/offers'
import { solveInvocation } from '../shared/solver'
import { extractCards } from '../shared/recognition'
import { rewardSchema } from '../shared/schema'

test('published evidence has valid source references and complete tooltip conditions', () => {
  const sourceIds = new Set(screenshots.sources.map(source => source.id))
  expect(sourceIds.size).toBe(screenshots.sources.length)
  for (const source of screenshots.sources) expect(source.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(new Set(REWARD_CATALOG.map(reward => reward.id)).size).toBe(REWARD_CATALOG.length)
  for (const reward of REWARD_CATALOG) {
    const fields = { ...newReward(), ...catalogFields(reward) }
    expect(rewardSchema.safeParse(fields).success).toBe(true)
    expect(selectedCatalogReward(fields)?.id).toBe(reward.id)
  }
  for (const entry of [...screenshots.rewards, ...screenshots.fates.flatMap(fate => fate.variants)]) {
    expect(entry.sourceIds.length).toBeGreaterThan(0)
    for (const source of entry.sourceIds) expect(sourceIds.has(source)).toBe(true)
  }
  for (const reward of screenshots.rewards) {
    const condition = reward.tooltip.find(line => line === 'To claim this reward, invoke two copies of it')
    expect(reward.kind).toBe(condition ? 'combo' : 'regular')
    expect(reward.threshold).toBe(condition ? 2 : null)
  }
  const sourcedNames = new Set([...screenshots.fates, ...POEDB_CATALOG.fates].map(fate => fate.name))
  expect([...names].sort()).toEqual([...sourcedNames].sort())
  expect(JSON.stringify(screenshots)).not.toMatch(/C:\\|C:\/|data:image|arkid|OneDrive/)
})

test('conditional rewards activate from two different Fates without pooling the regular variant', () => {
  const regular = REWARD_CATALOG.find(entry => entry.id === 'observed-additional-currency-items')!
  const combo = REWARD_CATALOG.find(entry => entry.id === 'observed-additional-currency-items-combo')!
  const cards = ['Pestilent', 'Sadist'].map(name => ({ ...newCard(), name, tier: 2,
    rewards: [{ ...newReward(), ...catalogFields(combo) }] }))
  const profile = { goals: [{ kind: 'combo' as const, label: combo.label, weight: 1 }], avoidModifiers: [] }
  expect(solveInvocation(cards, profile).plans[0].rewards).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: combo.label, threshold: 2, count: 2, activated: true }),
  ]))
  cards[1].rewards = [{ ...newReward(), ...catalogFields(regular) }]
  const incomplete = solveInvocation(cards, profile)
  expect(incomplete.plans).toEqual([])
  expect(incomplete.collectingPlans?.[0].rewards.find(reward => reward.kind === 'combo')?.activated).toBe(false)
  expect(visualRewardFields('gold-grid')).toMatchObject({ kind: 'unknown', threshold: null, identified: false })
})

test('new names are recognized only in offered headers and receive no catalog rewards or effects', () => {
  const line = (text: string, x: number, y: number) => ({ text, x, y, width: 160, height: 20 })
  const result = extractCards({ image: { width: 1000, height: 800 },
    ocr: { status: 'ok', text: '', language: 'en-US', lines: [line('Fates', 450, 0), line('Pestilent', 30, 100),
      line('Sadist', 350, 100), line('Black Frost', 650, 100), line('CONFIRM', 450, 450), line('Blood Moon', 30, 600)] } })
  expect(result.cards.map(card => card.name)).toEqual(['Pestilent', 'Sadist', 'Black Frost'])
  expect(result.cards.every(card => !card.rewards.length && !card.modifiers.length && card.tier === null)).toBe(true)
  const sadist = screenshots.fates.find(fate => fate.name === 'Sadist')!
  expect(sadist.variants).toMatchObject([{ tier: 2, completeness: 'short-only', lines: [] }])
  const deathbringer = screenshots.fates.find(fate => fate.name === 'Deathbringer')!
  expect(deathbringer.variants.find(variant => variant.tier === 1)?.lines).toContain('Empowered Monster will have 20% increased Maximum Life')
  expect(deathbringer.variants.find(variant => variant.tier === 2)?.lines).toContain('Empowered Monster will have 40% increased Maximum Life')
})
