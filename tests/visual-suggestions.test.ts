import { expect, test } from 'vitest'
import { newCard, newReward } from '../shared/offers'
import { applyVisualSuggestions } from '../shared/visual-suggestions'
import { planInvocation } from '../shared/advisor'
import { captureSchema, type Capture } from '../shared/schema'
import type { VisualAnalysis } from '../shared/visual-recognition'

const line = (text: string, x: number, y: number) => ({ text, x, y, width: 90, height: 15 })
const capture: Capture = { kind: 'fate-collector.capture', schemaVersion: 1, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), source: 'windows-helper', helperVersion: '0.3.2',
  image: { width: 1000, height: 600, mimeType: 'image/png', dataBase64: 'eA==', frameHeight: 1080 },
  ocr: { status: 'ok', language: 'en-US', text: '', lines: [line('Fates', 450, 10), line('Torchbearer', 40, 100), line('Torchbearer', 400, 100), line('CONFIRM', 450, 500)] } }
test('maps by header position rather than duplicate name and never asserts reward meaning', () => {
  const cards = [newCard(), newCard()].map(card => ({ ...card, name: 'Torchbearer' }))
  const result: VisualAnalysis = { version: 'fate-visual-browser-1', status: 'candidates', warnings: [], cards: [{
    name: 'Torchbearer', header: line('Torchbearer', 400, 100), tier: 2,
    symbols: [{ visualId: 'gold-grid', box: { x: 410, y: 400, width: 24, height: 24 }, score: .99, margin: .2 }],
  }] }
  const changed = applyVisualSuggestions(cards, capture, result)
  expect(changed[0]).toBe(cards[0])
  expect(changed[1]).toMatchObject({ tier: 2, visualReview: { tierReviewed: false, rewardsReviewed: false }, rewards: [{ label: 'Gold grid', kind: 'unknown', count: 1, identified: false, visualId: 'gold-grid' }] })
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
test('capture crop scale is optional, bounded and cannot be smaller than the crop', () => {
  expect(captureSchema.safeParse(capture).success).toBe(true)
  expect(captureSchema.safeParse({ ...capture, image: { ...capture.image, frameHeight: undefined } }).success).toBe(true)
  for (const frameHeight of [1, 8193, Infinity, -1, 700.5]) {
    expect(captureSchema.safeParse({ ...capture, image: { ...capture.image, frameHeight } }).success).toBe(false)
  }
})
