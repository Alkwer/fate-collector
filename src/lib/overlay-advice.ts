import { MAX_COLLECTED_FATES, recommendFates } from '../../shared/advisor'
import { recommendPortfolio, unweightedRewards } from '../../shared/solver'
import type { Offer } from '../../shared/schema'
import type { OverlayCapture, OverlayView } from '../../shared/overlay'
import { cardReviewReasons } from './card-review'
import { offerBelongsToMap, type AdvisorWorkspace } from './advisor-workspace'
import type { SolverSettings } from './solver-settings'

export interface OverlayInputs {
  offer: Offer; workspace: AdvisorWorkspace; settings: SolverSettings
  capture: OverlayCapture | null; needsMapConfirmation: boolean
  blocked: boolean; canUndo: boolean; confirmNewArea: boolean
}
const shorten = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text
const number = (value: number) => new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }).format(value)

export function overlayAdvice(input: OverlayInputs): OverlayView {
  const { offer, workspace, settings, capture } = input
  const view: OverlayView = { captureId: capture?.captureId ?? null, status: 'idle', title: 'Ready for your next Fate', detail: 'Open a calibrated Fate panel in game. The updated helper detects offers automatically; F9 captures manually. Keep the website open.', rows: [], actions: [] }
  if (!capture) return view
  if (capture.phase === 'watching') return { ...view, title: 'Watching for Fate cards', detail: 'Keep the Fate heading, card names and Confirm button visible. A stable recognized offer appears automatically. Use F9 if detection misses it.' }
  if (capture.phase === 'paused') return { ...view, title: 'Automatic detection paused', detail: 'Check calibration with F6/F7 and Auto-detect Fate cards in the helper tray. F9 remains available for manual captures.' }
  if (capture.phase === 'error' || capture.phase === 'cancelled') return { ...view, status: 'error', title: capture.phase === 'error' ? 'Capture failed' : 'Capture cancelled', detail: 'Check the helper message, then capture the offer again with F9.' }
  if (capture.phase === 'capturing' || capture.captureId !== offer.captureId) return { ...view, status: 'busy', title: 'Analyzing your capture…', detail: 'Waiting for this capture to be imported. If this persists, open the website and check local review.' }
  if (input.blocked) return { ...view, status: 'check', title: 'Finish the website edit', detail: 'Close the editor and resolve any unsaved changes or connection problem before using overlay controls.' }
  view.actions.push({ id: 'new-area', label: 'New area', slot: 11 })
  if (input.canUndo) view.actions.push({ id: 'undo', label: 'Undo collection change', slot: 12 })
  if (input.confirmNewArea) return { ...view, status: 'confirm-area', title: 'Start a new area?', detail: 'This clears the current collection and offer bindings. Saved offers stay in your journal. Capture again after entering the new area.', actions: [{ id: 'confirm-new-area', label: 'Confirm new area', slot: 11 }, { id: 'cancel-new-area', label: 'Keep this area', slot: 10 }] }
  if (input.needsMapConfirmation) return { ...view, status: 'confirm-area', title: 'Still in the same area?', detail: 'Your previous collection was restored. Continue only if you are playing the same instance, or start a new area.', actions: [...view.actions.filter(action => action.id !== 'undo'), { id: 'continue-area', label: 'Continue this area', slot: 10 }] }
  if (!offer.cards.length) return { ...view, status: 'check', title: 'No offered cards recognized', detail: 'Check that the capture includes the Fates heading, offered cards and Confirm button. Review the screenshot on the website.' }
  if (!offerBelongsToMap(workspace, offer.id)) return { ...view, status: 'confirm-area', title: workspace.map ? 'Offer from your current area?' : 'Start with this offer?', detail: 'Confirm the area before comparing Fates. This does not choose a card in game.', actions: [...view.actions, { id: 'use-offer', label: workspace.map ? 'Use offer in this area' : 'Start area with offer', slot: 10 }] }
  const chosen = workspace.collection.cards.find(card => workspace.sources[card.id] === offer.id)
  const collected = chosen || workspace.usedOfferIds.includes(offer.id) || workspace.collection.cards.some(card => offer.cards.some(offered => offered.id === card.id))
  if (collected) return { ...view, status: 'collected', title: chosen ? shorten(`Recorded: ${chosen.name || 'Unnamed Fate'}`, 240) : 'Choice already used', detail: `${workspace.collection.cards.length}/${MAX_COLLECTED_FATES} Fates collected. Open the next offer for automatic detection, or use F9. Invocation planning is available on the website.` }
  if (offer.cards.length > 9) return { ...view, status: 'check', title: 'Review this offer on the website', detail: 'More than nine cards were recognized. Check which cards belong to the offered row before recording a choice.' }
  const portfolio = settings.mode === 'portfolio' ? recommendPortfolio(offer.cards, workspace.collection.cards, settings.profile, workspace.excludedCardIds) : null
  const single = settings.mode === 'single' && workspace.goal ? recommendFates(offer.cards, workspace.collection.cards, workspace.goal) : null
  const result = portfolio ?? single
  const excluded = new Map(portfolio?.excluded.map(item => [item.cardId, item.reasons.join(' · ')]))
  const recommended = result?.recommendedCardIds ?? []
  const reviews = [...offer.cards, ...workspace.collection.cards].flatMap(card => {
    const reasons = cardReviewReasons(card)
    return reasons.length ? [`${card.name || 'Unnamed Fate'}: ${reasons.join(', ')}`] : []
  })
  view.rows = offer.cards.map((card, index) => {
    const candidate = result?.candidates.find(item => item.cardId === card.id)
    const gain = candidate?.gain
    const reason = excluded.get(card.id) ? `Excluded: ${excluded.get(card.id)}` : `${gain == null ? 'Gain unknown' : `${gain > 0 ? '+' : ''}${number(gain)} ${portfolio ? 'priority points' : 'goal icons'}`} · ${cardReviewReasons(card).join(', ') || 'Check modifiers in game'}`
    if (!excluded.has(card.id) && workspace.collection.cards.length < MAX_COLLECTED_FATES) view.actions.push({ id: `collect:${card.id}`, label: shorten(`Record ${card.name || 'Unnamed Fate'}`, 160), slot: index + 1 })
    return { label: shorten(`${index + 1}. ${card.name || 'Unnamed Fate'}`, 240), detail: shorten(reason, 500), recommended: recommended.includes(card.id) }
  })
  const hasGoal = portfolio ? settings.profile.goals.some(goal => goal.weight > 0) : !!workspace.goal
  view.status = !hasGoal || !recommended.length ? 'check' : result?.status === 'ready' ? 'ready' : result?.status === 'provisional' ? 'provisional' : 'check'
  view.title = !hasGoal ? 'Set reward priorities on the website'
    : result?.comparison === 'no-improvement' ? 'No improvement for your goal'
    : !recommended.length || result?.status === 'insufficient' ? 'Check rewards before choosing'
    : `${result?.status === 'provisional' ? 'Provisional: ' : recommended.length > 1 ? 'Equal matches: ' : 'Recommended: '}${recommended.map(id => {
      const index = offer.cards.findIndex(card => card.id === id)
      return `${index + 1}. ${offer.cards[index]?.name || 'Unnamed Fate'}`
    }).join(' / ')}`
  const unweighted = portfolio ? unweightedRewards([...offer.cards, ...workspace.collection.cards].filter(card => !excluded.has(card.id)), settings.profile) : []
  view.detail = [
    recommended.length > 1 ? 'No single winner.' : '',
    view.status === 'provisional' ? 'Missing data may change this ranking.' : '',
    portfolio ? 'Compared with your collection using your reward priorities.' : workspace.goal ? `Goal: ${workspace.goal.label}. Compared with your collection.` : '',
    reviews.length ? `Check ${reviews[0]}${reviews.length > 1 ? `; ${reviews.length - 1} more cards need review` : ''}.` : '',
    result?.warnings.length ? result.warnings[0] : '',
    unweighted.length ? `${unweighted.length} identified reward types have weight 0.` : '',
    workspace.collection.cards.length >= MAX_COLLECTED_FATES ? 'Collection full. Review it on the website.' : 'Record only the card you actually choose in game.',
  ].filter(Boolean).join(' ')
  return { ...view, title: shorten(view.title, 240), detail: shorten(view.detail, 1200) }
}
