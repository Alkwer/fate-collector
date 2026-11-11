import { expect, test } from 'vitest'
import { newCard, newReward } from '../shared/offers'
import { applyVisualSuggestions } from '../shared/visual-suggestions'
import { planInvocation, recommendFates } from '../shared/advisor'
import { captureSchema, type Capture } from '../shared/schema'
import type { VisualAnalysis } from '../shared/visual-recognition'
import { REWARD_CATALOG, visualRewardFields } from '../shared/reward-catalog'

const line = (text: string, x: number, y: number) => ({ text, x, y, width: 90, height: 15 })
const capture: Capture = { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.3.2',
  image: { width: 1000, height: 600, mimeType: 'image/png', dataBase64: 'eA==', frameHeight: 1080 },
  ocr: { status: 'ok', language: 'en-US', text: '', lines: [line('Fates', 450, 10), line('Torchbearer', 40, 100), line('Torchbearer', 400, 100), line('CONFIRM', 450, 500)] } }
test('maps by header position rather than duplicate name and keeps ambiguous currency kind unknown', () => {
  const cards = [newCard(), newCard()].map(card => ({ ...card, name: 'Torchbearer' }))
  const result: VisualAnalysis = { version: 'fate-visual-browser-1', status: 'candidates', warnings: [], cards: [{
    name: 'Torchbearer', header: line('Torchbearer', 400, 100), tier: 2,
    symbols: [{ visualId: 'gold-grid', box: { x: 410, y: 400, width: 24, height: 24 }, score: .99, margin: .2 }],
  }] }
  const changed = applyVisualSuggestions(cards, capture, result)
  expect(changed[0]).toBe(cards[0])
  expect(changed[1]).toMatchObject({ tier: 2, visualReview: { tierReviewed: false, rewardsReviewed: false }, rewards: [{ label: 'Additional Currency Items', kind: 'unknown', count: 1, identified: false, visualId: 'gold-grid' }] })
  expect(cards.every(card => card.tier === null && card.rewards.length === 0)).toBe(true)
  expect(planInvocation(changed, { kind: 'regular', label: 'Currency' }).status).toBe('insufficient')
})
test('partial reward coverage stays provisional and unreviewed tiers cannot enable a duplicate merge', () => {
  const cards = [newCard(), newCard()].map(card => ({ ...card, name: 'Torchbearer', tier: 2,
    rewards: [{ ...newReward(), label: 'Currency', kind: 'regular' as const, identified: true }],
    visualReview: { version: 'fate-visual-browser-1', tierReviewed: false, rewardsReviewed: false } }))
  const goal = { kind: 'regular' as const, label: 'Currency' }
  const unchecked = planInvocation(cards, goal)
  expect(unchecked.status).toBe('provisional')
  expect(unchecked.plans.every(plan => plan.targetCount === 1 && plan.merges.length === 0)).toBe(true)
  cards.forEach(card => { card.visualReview.tierReviewed = true })
  expect(planInvocation(cards, goal).status).toBe('provisional')
  expect(planInvocation(cards, goal).plans[0].targetCount).toBe(3)
  cards.forEach(card => { card.visualReview.rewardsReviewed = true })
  expect(planInvocation(cards, goal).status).toBe('ready')
  expect(planInvocation(cards, goal).plans[0].targetCount).toBe(3)
})
test('tooltip-backed flask suggestions reach both advisor stages without approving the image review', () => {
  const cards = [newCard(), newCard()].map(card => ({ ...card, name: 'Torchbearer' }))
  const result: VisualAnalysis = { version: 'browser-v1', status: 'candidates', warnings: [], cards: [{
    name: 'Torchbearer', header: line('Torchbearer', 40, 100), tier: 2,
    symbols: [{ visualId: 'orange-feathers', box: { x: 40, y: 400, width: 24, height: 24 }, score: .99, margin: .2 }],
  }] }
  const [first] = applyVisualSuggestions(cards, capture, result)
  expect(first).toMatchObject({ rewards: [{ label: "Dreadmaidens' Sacrament", kind: 'combo', threshold: 2, identified: true, count: 1 }],
    visualReview: { version: 'browser-v1/rewards-v1', rewardsReviewed: false, tierReviewed: false } })
  const second = { ...first, id: crypto.randomUUID(), name: 'Wildfire' }
  const goal = { kind: 'combo' as const, label: "Dreadmaidens' Sacrament" }
  expect(recommendFates([second], [first], goal)).toMatchObject({ status: 'provisional', recommendedCardIds: [second.id] })
  const plan = planInvocation([first, second], goal)
  expect(plan.status).toBe('provisional')
  expect(plan.plans[0]).toMatchObject({ targetCount: 2, threshold: 2, activated: true })
  const reviewed = [first, second].map(card => ({ ...card, visualReview: { ...card.visualReview!, rewardsReviewed: true } }))
  expect(planInvocation(reviewed, goal).status).toBe('ready')
  expect(cards.every(card => !card.rewards.length)).toBe(true)
})
test('motif-only rarity/currency and three coloured gems never imply a combo', () => {
  for (const visualId of ['gold-ring', 'gold-grid'] as const) {
    const reward = { ...newReward(), ...visualRewardFields(visualId) }
    expect(reward).toMatchObject({ kind: 'unknown', identified: false, threshold: null })
    const fate = { ...newCard(), name: 'Tempest', rewards: [reward] }
    expect(planInvocation([fate], { kind: 'combo', label: reward.label }).status).toBe('insufficient')
  }
  for (const visualId of ['three-gems', 'blue-diamond', 'gold-stack', 'silver-cluster', 'gold-axe'] as const) {
    expect(visualRewardFields(visualId)).toEqual({})
  }
  const exceptional = REWARD_CATALOG.find(entry => entry.id === 'exceptional-gem')!
  expect(exceptional).toMatchObject({ kind: 'combo', threshold: 3, label: 'Exceptional Gem' })
})
test('capture crop scale is optional, bounded and cannot be smaller than the crop', () => {
  expect(captureSchema.safeParse(capture).success).toBe(true)
  expect(captureSchema.safeParse({ ...capture, image: { ...capture.image, frameHeight: undefined } }).success).toBe(true)
  for (const frameHeight of [1, 8193, Infinity, -1, 700.5]) {
    expect(captureSchema.safeParse({ ...capture, image: { ...capture.image, frameHeight } }).success).toBe(false)
  }
})
