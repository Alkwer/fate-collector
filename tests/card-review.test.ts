import { expect, test } from 'vitest'
import { newCard, newReward } from '../shared/offers'
import { cardNeedsReview } from '../src/lib/card-review'

test('review progress keeps unknown rewards and each visual confirmation independent', () => {
  const card = { ...newCard(), name: 'Alchemist', tier: 2,
    rewards: [{ ...newReward(), label: 'Currency', kind: 'regular' as const, identified: true }],
    visualReview: { version: 'test', tierReviewed: false, rewardsReviewed: false } }
  expect(cardNeedsReview(card)).toBe(true)
  card.visualReview.tierReviewed = true
  expect(cardNeedsReview(card)).toBe(true)
  card.visualReview.rewardsReviewed = true
  expect(cardNeedsReview(card)).toBe(false)
  card.rewards[0].identified = false
  expect(cardNeedsReview(card)).toBe(true)
  expect(cardNeedsReview({ ...card, rewards: [] })).toBe(true)
  expect(cardNeedsReview({ ...card, name: '' })).toBe(true)
})
