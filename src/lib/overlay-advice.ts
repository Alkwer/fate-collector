import { MAX_COLLECTED_FATES, recommendFates } from '../../shared/advisor'
import { completionCondition, recommendPortfolio, unweightedRewards, type SolverPortfolio } from '../../shared/solver'
import type { Offer } from '../../shared/schema'
import type { OverlayCapture, OverlayView } from '../../shared/overlay'
import { cardReviewReasons } from './card-review'
import { offerBelongsToMap, workspaceInvocationLimit, type AdvisorWorkspace } from './advisor-workspace'
import { selectedRewardGoal, type SolverSettings } from './solver-settings'
import { tooltipAdvice } from './tooltip-advice'
import type { LeagueGoal } from './league-challenges'

export interface OverlayInputs {
  offer: Offer; workspace: AdvisorWorkspace; settings: SolverSettings
  capture: OverlayCapture | null; needsMapConfirmation: boolean
  blocked: boolean; canUndo: boolean; confirmNewArea: boolean
  leagueGoal?: LeagueGoal
}
const shorten = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text
const number = (value: number) => new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }).format(value)

function weightedHeader(portfolio: SolverPortfolio, cards: Offer['cards']) {
  const choices = cards.flatMap((card, i) => {
    const candidate = portfolio.candidates.find(item => item.cardId === card.id)
    if (!candidate?.plan) return []
    const name = shorten(card.name.replace(/\s+/g, ' ').trim() || 'Unnamed Fate', 60)
    return [{ id: card.id, name, slot: i + 1, score: candidate.plan.score, progress: candidate.plan.progress, option: candidate.opportunities?.[0] }]
  })
  if (!choices.length || (portfolio.status === 'provisional' && !choices.some(c => c.score || c.progress || c.option))) return null

  const best = Math.max(...choices.map(c => c.score))
  const leaders = choices.filter(c => c.score === best)
  const baseline = portfolio.baseline?.score
  const collectionWins = baseline !== undefined && baseline >= best
  const score = Math.max(best, baseline ?? 0)
  const points = `${number(score)}${portfolio.status === 'provisional' ? ' known' : ''} ${score === 1 ? 'pt' : 'pts'}`
  let title = `Now: #${leaders[0].slot} ${leaders[0].name} · ${points}`
  if (leaders.length > 1) {
    const slots = leaders.length === cards.length ? '' : ` (#${leaders.map(c => c.slot).join(', #')})`
    title = `Now: tie${slots} · ${points}`
  }
  if (collectionWins && (baseline > best || leaders.length === 1)) title = `Now: keep collection · ${points}`

  // Each card's first opportunity is its nearest strictly winning completion.
  // Prefer fewer missing icons across the offer, then the larger resulting score.
  const alternatives = choices.flatMap(c => c.option ? [{ ...c.option, name: c.name, now: c.score }] : [])
  const next = alternatives.sort((a, b) => a.icons - b.icons || b.points - a.points)[0]
  let second = portfolio.status === 'provisional' ? 'Review missing data for another option.' : 'No known combo puts another choice ahead.'
  if (next) {
    const condition = next.duplicateName ? completionCondition(next) : `${next.icons}× ${next.label.replace(/\s+/g, ' ').trim()}`
    second = `${next.name} ${number(next.now)}→${number(next.points)} pts with ${condition}`
  }
  return { title, second, winner: !collectionWins && leaders.length === 1 ? leaders[0].id : null }
}

export function overlayAdvice(input: OverlayInputs): OverlayView {
  const { offer, workspace, settings, capture } = input
  const view: OverlayView = { captureId: capture?.captureId ?? null, status: 'idle', title: 'Ready for your next Fate', detail: 'Open a calibrated Fate panel in game. The updated helper detects offers automatically; F9 captures manually. Keep the advisor connected.', rows: [], actions: [] }
  if (!capture) return view
  if (capture.phase === 'watching') return { ...view, title: 'Watching for Fate cards', detail: 'Keep the Fate heading, card names and Confirm button visible. A stable recognized offer appears automatically. Use F9 if detection misses it.' }
  if (capture.phase === 'paused') return { ...view, title: 'Automatic detection paused', detail: 'Check calibration with F6/F7 and Auto-detect Fate cards in the helper tray. F9 remains available for manual captures.' }
  if (capture.phase === 'error' || capture.phase === 'cancelled') return { ...view, status: 'error', title: capture.phase === 'error' ? 'Capture failed' : 'Capture cancelled', detail: 'Check the helper message, then capture the offer again with F9.' }
  if (capture.phase === 'capturing' || capture.captureId !== offer.captureId) return { ...view, status: 'busy', title: 'Analyzing your capture…', detail: 'Waiting for this capture to be imported. If this persists, open Fate Collector and check local review.' }
  if (input.blocked) return { ...view, status: 'check', title: 'Finish the current edit', detail: 'Close the editor and resolve any unsaved changes or connection problem before using overlay controls.' }
  view.actions.push({ id: 'new-area', label: 'New area', slot: 11 })
  if (input.canUndo) view.actions.push({ id: 'undo', label: 'Undo collection change', slot: 12 })
  if (input.confirmNewArea) return { ...view, status: 'confirm-area', title: 'Start a new area?', detail: 'This clears the current collection and offer bindings. Saved offers stay in your journal. Capture again after entering the new area.', actions: [{ id: 'confirm-new-area', label: 'Confirm new area', slot: 11 }, { id: 'cancel-new-area', label: 'Keep this area', slot: 10 }] }
  if (input.needsMapConfirmation) return { ...view, status: 'confirm-area', title: 'Still in the same area?', detail: 'Your previous collection was restored. Continue only if you are playing the same instance, or start a new area.', actions: [...view.actions.filter(action => action.id !== 'undo'), { id: 'continue-area', label: 'Continue this area', slot: 10 }] }
  if (!offer.cards.length) return { ...view, status: 'check', title: 'No offered cards recognized', detail: 'Check that the capture includes the Fates heading, offered cards and Confirm button. Review the screenshot in Fate Collector.' }
  if (!offerBelongsToMap(workspace, offer.id)) return { ...view, status: 'confirm-area', title: workspace.map ? 'Offer from your current area?' : 'Start with this offer?', detail: 'Confirm the area before comparing Fates. This does not choose a card in game.', actions: [...view.actions, { id: 'use-offer', label: workspace.map ? 'Use offer in this area' : 'Start area with offer', slot: 10 }] }
  const chosen = workspace.collection.cards.find(card => workspace.sources[card.id] === offer.id)
  const collected = chosen || workspace.usedOfferIds.includes(offer.id) || workspace.collection.cards.some(card => offer.cards.some(offered => offered.id === card.id))
  if (collected) return { ...view, status: 'collected', title: chosen ? shorten(`Recorded: ${chosen.name || 'Unnamed Fate'}`, 240) : 'Choice already used', detail: `${workspace.collection.cards.length}/${MAX_COLLECTED_FATES} Fates collected. Open the next offer for automatic detection, or use F9. Invocation planning is available in Fate Collector.` }
  if (offer.cards.length > 9) return { ...view, status: 'check', title: 'Review this offer in Fate Collector', detail: 'More than nine cards were recognized. Check which cards belong to the offered row before recording a choice.' }
  const farming = settings.profile.objective === 'viscera'
  const limit = workspaceInvocationLimit(workspace, offer)
  const lastOffer = workspace.lastOfferId === offer.id
  if (!farming) view.actions.push(lastOffer
    ? { id: 'more-offers', label: 'Allow later offers', slot: 10 }
    : { id: 'last-offer', label: 'Mark as last offer', slot: 10 })
  const goal = selectedRewardGoal(settings, workspace.goal)
  const portfolio = settings.mode === 'portfolio' || farming ? recommendPortfolio(offer.cards, workspace.collection.cards, settings.profile, workspace.excludedCardIds, lastOffer, limit) : null
  const single = settings.mode === 'single' && !farming && goal ? recommendFates(offer.cards, workspace.collection.cards, goal, { ...settings.profile, excludedCardIds: workspace.excludedCardIds }, lastOffer, limit) : null
  const result = portfolio ?? single
  const excluded = new Map(result?.excluded?.map(item => [item.cardId, item.reasons.join(' · ')]))
  const recommended = result?.recommendedCardIds ?? []
  const hasGoal = farming || (portfolio ? settings.profile.goals.some(goal => goal.weight > 0) : !!goal)
  const header = portfolio && !farming && hasGoal ? weightedHeader(portfolio, offer.cards) : null
  const tooltip = tooltipAdvice({ offered: offer.cards, collected: workspace.collection.cards, profile: settings.profile,
    excludedCardIds: workspace.excludedCardIds, lastOffer, limit, leagueGoal: input.leagueGoal,
    ranking: portfolio ? { mode: 'portfolio', result: portfolio } : single && goal ? { mode: 'single', goal, result: single } : null })
  const reviews = [...offer.cards, ...workspace.collection.cards].flatMap(card => {
    const reasons = cardReviewReasons(card)
    return reasons.length ? [`${card.name || 'Unnamed Fate'}: ${reasons.join(', ')}`] : []
  })
  view.rows = offer.cards.map((card, index) => {
    const candidate = result?.candidates.find(item => item.cardId === card.id)
    const gain = candidate?.gain
    const weighted = !farming && portfolio?.candidates.find(item => item.cardId === card.id)
    const option = weighted && weighted.opportunities?.[0]
    const score = weighted && weighted.plan ? `${number(weighted.plan.score)} known plan pts now` : gain == null ? 'Gain unknown' : `${gain > 0 ? '+' : ''}${number(gain)} ${portfolio ? 'priority points' : 'goal icons'}`
    const projection = option ? `${number(option.points)} pts with ${completionCondition(option)}` : ''
    const reason = excluded.has(card.id) ? `Excluded: ${excluded.get(card.id)}` : [score, projection, cardReviewReasons(card).join(', ') || 'Check modifiers in game'].filter(Boolean).join(' · ')
    if (!excluded.has(card.id) && workspace.collection.cards.length < MAX_COLLECTED_FATES) view.actions.push({ id: `collect:${card.id}`, label: shorten(`Record ${card.name || 'Unnamed Fate'}`, 160), slot: index + 1 })
    return { label: shorten(`${index + 1}. ${card.name || 'Unnamed Fate'}`, 240), detail: shorten(reason, 500), recommended: header ? header.winner === card.id : recommended.includes(card.id) }
  })
  view.status = !hasGoal || (!header && !recommended.length) ? 'check' : result?.status === 'ready' ? 'ready' : result?.status === 'provisional' ? 'provisional' : 'check'
  view.title = header ? header.title : !hasGoal ? 'Set reward priorities in Fate Collector'
    : farming && !recommended.length && result?.candidates.some(candidate => candidate.plan) ? 'No better known Viscera option'
    : result?.comparison === 'no-improvement' ? 'No improvement for your goal'
    : !recommended.length || result?.status === 'insufficient' ? 'Check rewards before choosing'
    : `${result?.status === 'provisional' ? 'Provisional: ' : recommended.length > 1 ? 'Equal matches: ' : 'Recommended: '}${recommended.map(id => {
      const index = offer.cards.findIndex(card => card.id === id)
      return `${index + 1}. ${offer.cards[index]?.name || 'Unnamed Fate'}`
    }).join(' / ')}`
  const unweighted = portfolio ? unweightedRewards([...offer.cards, ...workspace.collection.cards].filter(card => !excluded.has(card.id)), settings.profile) : []
  view.detail = [
    !header && recommended.length > 1 ? 'No single winner.' : '',
    view.status === 'provisional' ? 'Missing data may change this ranking.' : '',
    farming ? 'Viscera farming: Fate count and duplicates; drop chances unknown.' : portfolio ? 'Compared with your collection using your reward priorities.' : goal ? `Goal: ${goal.label}. Compared with your collection.` : '',
    reviews.length ? `Check ${reviews[0]}${reviews.length > 1 ? `; ${reviews.length - 1} more cards need review` : ''}.` : '',
    result?.warnings.length ? result.warnings[0] : '',
    unweighted.length ? `${unweighted.length} identified reward types have weight 0.` : '',
    workspace.collection.cards.length >= MAX_COLLECTED_FATES ? 'Collection full. Review it in Fate Collector.' : 'Record only the card you actually choose in game.',
  ].filter(Boolean).join(' ')
  // Keep the two header lines readable to protocol v1 clients. New helpers
  // draw the first detail line above the review notes in both panel sizes.
  const outlook = lastOffer && !farming ? 'Last offer. Only active rewards count.' : header?.second
  if (tooltip || outlook) view.detail = [tooltip, outlook, view.detail].filter(Boolean).join('\n')
  return { ...view, title: shorten(view.title, 240), detail: shorten(view.detail, 1200) }
}
