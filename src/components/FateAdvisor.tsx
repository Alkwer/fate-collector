import { useMemo } from 'react'
import { getAdvisorGoals, normalizeRewardLabel, planInvocation, recommendFates, MAX_COLLECTED_FATES,
  type AdvisorGoal, type InvocationPlan } from '../../shared/advisor'
import { newOffer } from '../../shared/offers'
import type { FateCard, Offer } from '../../shared/schema'
import { OfferEditor } from './OfferEditor'
import type { AdvisorWorkspace } from '../lib/advisor-workspace'
const goalKey = (goal: AdvisorGoal) => `${goal.kind}:${normalizeRewardLabel(goal.label)}`
const cardName = (card: FateCard | undefined) => card?.name.trim() || 'Unnamed Fate'

function PlanDetails({ plan, cards, collected, goal }: { plan: InvocationPlan; cards: FateCard[]; collected: FateCard[]; goal: AdvisorGoal }) {
  const names = new Map(cards.map(card => {
    const collectedIndex = collected.findIndex(item => item.id === card.id)
    const offeredIndex = cards.filter(item => !collected.some(owned => owned.id === item.id)).findIndex(item => item.id === card.id)
    return [card.id, `${cardName(card)} (${collectedIndex >= 0 ? `collected #${collectedIndex + 1}` : `offer #${offeredIndex + 1}`})`]
  }))
  return <div className="advisor-plan">
    <p className="advisor-value">{goal.kind === 'combo'
      ? `${plan.targetCount}/${plan.threshold ?? '?'} matching icons · ${plan.threshold === null ? 'Activation unresolved' : plan.activated ? 'Combo ready' : 'Combo incomplete'}`
      : `${plan.targetCount} matching reward icon units`}</p>
    <p className="hint">Invoke in this order · {plan.cardIds.length} of 3 input slots</p>
    <ol className="invocation-order">{plan.cardIds.map(id => <li key={id}>{names.get(id) || 'Unknown Fate'}</li>)}</ol>
    {plan.merges.map(merge => <p className="advisor-merge" key={merge.firstId}>
      {names.get(merge.firstId)}: T2 + T2 → T3. First card’s regular rewards ×3; second card’s rewards discarded. Both input slots are used.
    </p>)}
    {plan.warnings.length > 0 && <ul className="advisor-warnings">{plan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
  </div>
}

interface Props {
  offer: Offer
  workspace: AdvisorWorkspace
  onChange: (workspace: AdvisorWorkspace) => void
  onEditOffer: () => void
  busy: boolean
  needsAreaConfirmation: boolean
  onConfirmArea: () => void
  storageError: string | null
}
export function FateAdvisor({ offer, workspace, onChange, onEditOffer, busy, needsAreaConfirmation, onConfirmArea, storageError }: Props) {
  const { collection, goal, mode, sources } = workspace
  const goals = getAdvisorGoals([...offer.cards, ...collection.cards])
  if (goal && !goals.some(option => goalKey(option) === goalKey(goal))) goals.unshift(goal)
  // Only the explicit area collection is eligible. Saved offers are never silently pooled.
  const recommendations = useMemo(() => goal && mode === 'offer' && !needsAreaConfirmation ? recommendFates(offer.cards, collection.cards, goal) : null, [offer.cards, collection.cards, goal, mode, needsAreaConfirmation])
  const invocation = useMemo(() => goal && mode === 'invoke' && !needsAreaConfirmation ? planInvocation(collection.cards, goal) : null, [collection.cards, goal, mode, needsAreaConfirmation])
  const result = mode === 'offer' ? recommendations : invocation
  const allCards = [...collection.cards, ...offer.cards]
  const alreadyCollected = collection.cards.some(card => sources[card.id] === offer.id || offer.cards.some(offered => offered.id === card.id))
  function collect(card: FateCard) {
    if (alreadyCollected || collection.cards.length >= MAX_COLLECTED_FATES || busy || needsAreaConfirmation) return
    onChange({ ...workspace, collection: { ...collection, cards: [...collection.cards, structuredClone(card)] }, sources: { ...sources, [card.id]: offer.id } })
  }
  return <>
    <div className="page-heading"><div><h1>Choose your next Fate.</h1><p>Compare the rewards on your cards and plan up to three invocations.</p></div><button onClick={onEditOffer} disabled={busy}>Edit current offer</button></div>
    {storageError && <p className="notice error" role="alert">{storageError}</p>}
    {needsAreaConfirmation && <div className="notice advisor-restore"><p>Your collected Fates were restored. Are you still in the same area?</p><div><button onClick={onConfirmArea}>Continue this area</button><button onClick={() => onChange({ ...workspace, collection: newOffer(), sources: {} })}>Start a new area</button></div></div>}
    <div className="advisor-layout" inert={busy}>
      <section className="panel advisor-main" aria-labelledby="advisor-heading">
        <div className="section-heading"><h2 id="advisor-heading">Fate advisor</h2><span className="muted">Preview rules</span></div>
        <div className="advisor-controls">
          <label>Decision<select value={mode} onChange={event => onChange({ ...workspace, mode: event.target.value as AdvisorWorkspace['mode'] })}><option value="offer">Choose from current offer</option><option value="invoke">Plan collected Fates</option></select></label>
          <label>Reward goal<select value={goal ? goalKey(goal) : ''} onChange={event => onChange({ ...workspace, goal: goals.find(option => goalKey(option) === event.target.value) ?? null })}>
            <option value="">Select a reward</option>{goals.map(option => <option key={goalKey(option)} value={goalKey(option)}>{option.label} · {option.kind === 'combo' ? 'Combo' : 'Regular'}</option>)}
          </select></label>
        </div>
        <p className="hint">Goals use identified reward labels. Add missing icons in Edit current offer → Modifiers & rewards. Names alone do not reveal rewards.</p>
        <div className="advisor-outcome" aria-live="polite" aria-atomic="true">
          {needsAreaConfirmation ? <><h3>Confirm your current area.</h3><p>Restored cards are excluded from advice until you confirm the area or start a new one.</p></> : !goal ? <><h3>Select the reward you want.</h3><p>Choose a goal to compare specific Fates. Unknown icons stay unknown.</p></>
            : result?.status === 'insufficient' ? <><h3>No supported recommendation yet.</h3><p>{mode === 'offer' ? `No offered Fate has a confirmed improvement for ${goal.label}. Check the cards and identify their rewards.` : `No confirmed progress toward ${goal.label} can be ranked. Add collected Fates and identify their rewards.`}</p></>
            : mode === 'offer' && recommendations ? <>
              <h3>{recommendations.status === 'provisional' ? 'Provisional preference: ' : recommendations.recommendedCardIds.length > 1 ? 'Equal matches: ' : 'Recommended: '}{recommendations.recommendedCardIds.map(id => cardName(offer.cards.find(card => card.id === id))).join(' / ')}</h3>
              <p>{recommendations.status === 'provisional' ? 'Missing data or unresolved mechanics could change this ranking.' : 'Best match for the selected reward among the supplied cards.'} {recommendations.recommendedCardIds.length > 1 && 'There is no single winner.'}</p>
            </> : <><h3>{invocation?.status === 'provisional' ? 'Provisional invocation plan' : 'Suggested invocation plan'}</h3><p>Uses only the Fates explicitly added to this area.</p></>}
        </div>
        {result && result.warnings.length > 0 && <details className="advisor-caveats"><summary>What limits this recommendation</summary><ul className="advisor-warnings">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
        {mode === 'offer' ? <>
          <h3 className="advisor-list-heading">Current offer</h3>
          {offer.cards.length === 0 ? <p className="muted">Capture or import an offer in Collector to compare cards.</p> : <ul className="advisor-candidates">{(recommendations?.candidates.length ? recommendations.candidates.map(candidate => ({ card: offer.cards.find(card => card.id === candidate.cardId)!, candidate })) : offer.cards.map(card => ({ card, candidate: null }))).map(({ card, candidate }) => <li key={card.id}>
            <div className="advisor-card-heading"><h3>{cardName(card)} <span className="muted">Offer #{offer.cards.findIndex(item => item.id === card.id) + 1} · {card.tier === null ? 'Tier unknown' : `T${card.tier}`}</span></h3><button onClick={() => collect(card)} disabled={needsAreaConfirmation || alreadyCollected || collection.cards.length >= MAX_COLLECTED_FATES}>Add {cardName(card)} to collected</button></div>
            {card.modifiers.length > 0 && <p className="advisor-modifiers">{card.modifiers.join(' ')}</p>}
            {candidate?.plan && goal ? <PlanDetails plan={candidate.plan} cards={allCards} collected={collection.cards} goal={goal} /> : <p className="hint">{goal ? 'No confirmed target progress.' : 'Select a reward goal to compare this Fate.'}</p>}
            {!!candidate?.warnings.length && <ul className="advisor-warnings">{candidate.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          </li>)}</ul>}
          {alreadyCollected && <p className="hint">A Fate from this offer is already in your collection. Remove it before changing your choice.</p>}
          <p className="hint">Add only the card you actually collected in game. This updates the area planner; it does not record an observed choice or control the game.</p>
        </> : invocation && goal && <div className="advisor-plans">{invocation.plans.map((plan, index) => <article key={plan.cardIds.join(':')}><h3>{index === 0 ? 'Best supported plan' : `Alternative ${index + 1}`}</h3><PlanDetails plan={plan} cards={collection.cards} collected={collection.cards} goal={goal} /></article>)}</div>}
        <details className="advisor-caveats"><summary>How advice works</summary><p>Ranks matching reward icons toward your goal, not item quantities or market prices. Combat danger, build suitability and future offers are not scored. Check the modifiers before choosing.</p><p>Duplicate combo scaling, mixed-tier merges and a third duplicate remain unresolved. Advice uses prerelease research checked on 8 November 2026.</p><p><a href="https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11220s" target="_blank" rel="noreferrer">GGG Fate mechanics Q&A</a></p></details>
      </section>
      <aside className="panel advisor-collection" aria-labelledby="collection-heading">
        <div className="section-heading"><h2 id="collection-heading">Collected in this area</h2><span className="muted">{collection.cards.length}/{MAX_COLLECTED_FATES}</span></div>
        <p className="hint">Keep this list in sync with the game. It is saved in this browser tab and restored after reload. Confirm the area when returning; start a new area when you leave the instance.</p>
        {collection.cards.length ? <ul className="collected-fates">{collection.cards.map((card, index) => <li key={card.id}><div><strong>#{index + 1} {cardName(card)}</strong><span className="cell-sub">{card.tier === null ? 'Tier unknown' : `Tier ${card.tier}`} · {card.rewards.filter(reward => reward.identified).length} identified reward rows</span></div><button className="text-button" aria-label={`Remove collected ${cardName(card)} ${index + 1}`} onClick={() => onChange({ ...workspace, collection: { ...collection, cards: collection.cards.filter(item => item.id !== card.id) } })}>Remove</button></li>)}</ul> : <p className="advisor-empty">No collected Fates yet. Add a card you chose, or enter cards already in your area.</p>}
        <details className="collection-editor"><summary>Edit collected cards</summary><OfferEditor offer={collection} purpose="collection" onChange={patch => onChange({ ...workspace, collection: { ...collection, ...patch } })} /></details>
        {!needsAreaConfirmation && <button className="outline-button" disabled={!collection.cards.length} onClick={() => onChange({ ...workspace, collection: newOffer(), sources: {} })}>Start a new area</button>}
        <p className="hint">Collected cards are local planning notes. They are not uploaded or added to observation history.</p>
      </aside>
    </div>
  </>
}
