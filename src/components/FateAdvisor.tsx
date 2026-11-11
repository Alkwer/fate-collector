import { useMemo, type ReactNode } from 'react'
import { getAdvisorGoals, normalizeRewardLabel, planInvocation, recommendFates, MAX_COLLECTED_FATES,
  type AdvisorGoal, type InvocationPlan } from '../../shared/advisor'
import type { FateCard, Offer } from '../../shared/schema'
import { OfferEditor } from './OfferEditor'
import { OfferPreview } from './OfferPreview'
import { offerBelongsToMap, type AdvisorWorkspace } from '../lib/advisor-workspace'
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
  needsMapConfirmation: boolean
  onUseOffer: () => void
  source: ReactNode
  saved: boolean
  automatic: boolean
}
export function FateAdvisor({ offer, workspace, onChange, onEditOffer, busy, needsMapConfirmation, onUseOffer, source, saved, automatic }: Props) {
  const { collection, goal, mode, sources } = workspace
  const mapReady = !!workspace.map && !needsMapConfirmation
  const offerReady = mapReady && offerBelongsToMap(workspace, offer.id)
  const goals = getAdvisorGoals([...offer.cards, ...collection.cards])
  if (goal && !goals.some(option => goalKey(option) === goalKey(goal))) goals.unshift(goal)
  const recommendations = useMemo(() => goal && mode === 'offer' && offerReady ? recommendFates(offer.cards, collection.cards, goal) : null, [offer.cards, collection.cards, goal, mode, offerReady])
  const invocation = useMemo(() => goal && mode === 'invoke' && mapReady ? planInvocation(collection.cards, goal) : null, [collection.cards, goal, mode, mapReady])
  const result = mode === 'offer' ? recommendations : invocation
  const allCards = [...collection.cards, ...offer.cards]
  const alreadyCollected = collection.cards.some(card => sources[card.id] === offer.id || offer.cards.some(offered => offered.id === card.id))
  function collect(card: FateCard) {
    if (alreadyCollected || collection.cards.length >= MAX_COLLECTED_FATES || busy || !offerReady) return
    onChange({ ...workspace, collection: { ...collection, cards: [...collection.cards, structuredClone(card)] }, sources: { ...sources, [card.id]: offer.id } })
  }
  return <div className={`collector-grid map-layout ${busy ? 'is-busy' : ''}`} aria-busy={busy} inert={busy}>
      <section className="panel advisor-main" aria-labelledby="advisor-heading">
        <div className="section-heading"><h2 id="advisor-heading">Choose & invoke</h2><button className="text-button" onClick={onEditOffer}>Edit current offer</button></div>
        {mapReady && <div className="advisor-controls">
          <label>Decision<select value={mode} onChange={event => onChange({ ...workspace, mode: event.target.value as AdvisorWorkspace['mode'] })}><option value="offer">Choose from current offer</option><option value="invoke">Plan collected Fates</option></select></label>
          <label>Reward goal<select value={goal ? goalKey(goal) : ''} onChange={event => onChange({ ...workspace, goal: goals.find(option => goalKey(option) === event.target.value) ?? null })}>
            <option value="">Select a reward</option>{goals.map(option => <option key={goalKey(option)} value={goalKey(option)}>{option.label} · {option.kind === 'combo' ? 'Combo' : 'Regular'}</option>)}
          </select></label>
        </div>}
        {mapReady && mode === 'offer' && !offerReady && offer.cards.length > 0 && <div className="map-offer-confirmation"><strong>Is this offer from your current map?</strong><p>New imports and folder captures need confirmation before they affect advice.</p><button className="outline-button" onClick={onUseOffer}>Use this offer in current map</button></div>}
        {!workspace.map && offer.cards.length > 0 && <div className="map-offer-confirmation"><strong>No active map</strong><p>Start with this offer. Fates can only be used in the instance where you collect them.</p><button className="outline-button" onClick={onUseOffer}>Start map with this offer</button></div>}
        {mapReady && (mode === 'invoke' || offerReady) && <>
        <div className="advisor-outcome" aria-live="polite" aria-atomic="true">
          {!goal ? <><h3>Select the reward you want.</h3><p>Choose a goal to compare specific Fates. Unknown icons stay unknown.</p></>
            : result?.status === 'insufficient' ? <><h3>No supported recommendation yet.</h3><p>{mode === 'offer' ? `No offered Fate has a confirmed improvement for ${goal.label}. Check the cards and identify their rewards.` : `No confirmed progress toward ${goal.label} can be ranked. Add collected Fates and identify their rewards.`}</p></>
            : mode === 'offer' && recommendations ? <>
              <h3>{recommendations.status === 'provisional' ? 'Provisional preference: ' : recommendations.recommendedCardIds.length > 1 ? 'Equal matches: ' : 'Recommended: '}{recommendations.recommendedCardIds.map(id => cardName(offer.cards.find(card => card.id === id))).join(' / ')}</h3>
              <p>{recommendations.status === 'provisional' ? 'Missing data or unresolved mechanics could change this ranking.' : 'Best match for the selected reward among the supplied cards.'} {recommendations.recommendedCardIds.length > 1 && 'There is no single winner.'}</p>
            </> : <><h3>{invocation?.status === 'provisional' ? 'Provisional invocation plan' : 'Suggested invocation plan'}</h3><p>Uses only the Fates collected in this map.</p></>}
        </div>
        {result && result.warnings.length > 0 && <details className="advisor-caveats"><summary>What limits this recommendation</summary><ul className="advisor-warnings">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
        </>}
        {mode === 'offer' || !mapReady ? <OfferPreview offer={offer} saved={saved} automatic={automatic} embedded renderAdvice={offerReady ? card => {
          const candidate = recommendations?.candidates.find(item => item.cardId === card.id)
          return <div className="advisor-candidates">
            <button className="collect-fate" onClick={() => collect(card)} disabled={alreadyCollected || collection.cards.length >= MAX_COLLECTED_FATES}>Add {cardName(card)} to collected</button>
            {candidate?.plan && goal && <details className="candidate-plan"><summary>Reward progress & invocation order</summary><PlanDetails plan={candidate.plan} cards={allCards} collected={collection.cards} goal={goal} /></details>}
            {!!candidate?.warnings.length && <ul className="advisor-warnings">{candidate.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          </div>
        } : undefined} /> : invocation && goal && <div className="advisor-plans">{invocation.plans.map((plan, index) => <article key={plan.cardIds.join(':')}><h3>{index === 0 ? 'Best supported plan' : `Alternative ${index + 1}`}</h3><PlanDetails plan={plan} cards={collection.cards} collected={collection.cards} goal={goal} /></article>)}</div>}
        {offerReady && mode === 'offer' && <p className="hint">{alreadyCollected ? 'A Fate from this offer is already collected. Remove it before changing your choice.' : 'Add only the Fate you actually chose in game. This does not control the game.'}</p>}
        <details className="advisor-caveats"><summary>How advice works</summary><p>Ranks matching reward icons toward your goal, not item quantities or market prices. Combat danger, build suitability and future offers are not scored. Check the modifiers before choosing.</p><p>Duplicate combo scaling, mixed-tier merges and a third duplicate remain unresolved. Advice uses prerelease research checked on 8 November 2026.</p><p><a href="https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11220s" target="_blank" rel="noreferrer">GGG Fate mechanics Q&A</a></p></details>
      </section>
      <div className="map-sidebar"><aside className="panel advisor-collection" aria-labelledby="collection-heading">
        <div className="section-heading"><h2 id="collection-heading">Collected in this map</h2><span className="muted">{collection.cards.length}/{MAX_COLLECTED_FATES}</span></div>
        <p className="hint">These Fates can only be invoked in the instance where you collected them.</p>
        {collection.cards.length ? <ul className="collected-fates">{collection.cards.map((card, index) => <li key={card.id}><div><strong>#{index + 1} {cardName(card)}</strong><span className="cell-sub">{card.tier === null ? 'Tier unknown' : `Tier ${card.tier}`} · {card.rewards.filter(reward => reward.identified).length} identified reward rows</span></div><button disabled={!mapReady} className="text-button" aria-label={`Remove collected ${cardName(card)} ${index + 1}`} onClick={() => onChange({ ...workspace, collection: { ...collection, cards: collection.cards.filter(item => item.id !== card.id) } })}>Remove</button></li>)}</ul> : <p className="advisor-empty">No collected Fates yet.</p>}
        {mapReady && <details className="collection-editor"><summary>Edit collected cards</summary><OfferEditor offer={collection} purpose="collection" onChange={patch => onChange({ ...workspace, collection: { ...collection, ...patch } })} /></details>}
        <p className="hint">New map clears this collection. Saved offers stay in the archive.</p>
      </aside>{source}</div>
    </div>
}
