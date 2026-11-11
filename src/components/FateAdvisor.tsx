import { DetailPanel, type DetailPanelHandle } from './DetailPanel'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { getAdvisorGoals, normalizeRewardLabel, planInvocation, recommendFates, MAX_COLLECTED_FATES,
  type AdvisorGoal, type InvocationPlan } from '../../shared/advisor'
import type { FateCard, Offer } from '../../shared/schema'
import { OfferEditor } from './OfferEditor'
import { OfferPreview } from './OfferPreview'
import { offerBelongsToMap, type AdvisorWorkspace } from '../lib/advisor-workspace'
import { cardReviewReasons } from '../lib/card-review'
import { SolverControls, type SolverSettingsControl } from './SolverControls'
import { PortfolioAdvice } from './PortfolioAdvice'
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
  solverControl: SolverSettingsControl
  offer: Offer
  workspace: AdvisorWorkspace
  onChange: (workspace: AdvisorWorkspace) => void
  onEditOffer: (cardId?: string) => void
  busy: boolean
  needsMapConfirmation: boolean
  onUseOffer: () => void
  source: ReactNode
  saved: boolean
  automatic: boolean
  savedOffers: Offer[]
}
export function FateAdvisor({ offer, workspace, onChange, onEditOffer, busy, needsMapConfirmation, onUseOffer, source, saved, automatic, savedOffers, solverControl }: Props) {
  const { collection, goal, mode, sources } = workspace
  const portfolioMode = solverControl.settings.mode === 'portfolio'
  const collectionEditor = useRef<DetailPanelHandle>(null)
  const priorities = useRef<DetailPanelHandle>(null)
  const reviewList = useRef<DetailPanelHandle>(null)
  const [manualEntry, setManualEntry] = useState(false)
  const [collectionReview, setCollectionReview] = useState<{ cardId: string; sequence: number } | null>(null)
  const mapReady = !!workspace.map && !needsMapConfirmation
  const offerReady = mapReady && offerBelongsToMap(workspace, offer.id)
  const goals = getAdvisorGoals([...offer.cards, ...collection.cards])
  for (const row of solverControl.settings.definitions) if (!goals.some(goal => goalKey(goal) === goalKey(row))) goals.push({ kind: row.kind, label: row.label })
  if (goal && !goals.some(option => goalKey(option) === goalKey(goal))) goals.unshift(goal)
  const recommendations = useMemo(() => !portfolioMode && goal && mode === 'offer' && offerReady ? recommendFates(offer.cards, collection.cards, goal) : null, [offer.cards, collection.cards, goal, mode, offerReady, portfolioMode])
  const invocation = useMemo(() => !portfolioMode && goal && mode === 'invoke' && mapReady ? planInvocation(collection.cards, goal) : null, [collection.cards, goal, mode, mapReady, portfolioMode])
  const result = mode === 'offer' ? recommendations : invocation
  const allCards = [...collection.cards, ...offer.cards]
  const alreadyCollected = workspace.usedOfferIds.includes(offer.id) || collection.cards.some(card => sources[card.id] === offer.id || offer.cards.some(offered => offered.id === card.id))
  const chosen = collection.cards.find(card => sources[card.id] === offer.id)
  const reviewCards = [
    ...(mode === 'offer' && !alreadyCollected ? offer.cards.map(card => ({ card, collected: false })) : []),
    ...collection.cards.map(card => ({ card, collected: true })),
  ].map(item => ({ ...item, reasons: cardReviewReasons(item.card) })).filter(item => item.reasons.length)
  const nextReview = reviewCards[0]
  const featuredId = !alreadyCollected && recommendations?.recommendedCardIds.length === 1 ? recommendations.recommendedCardIds[0] : null
  const featured = offer.cards.find(card => card.id === featuredId)
  const outcomeState = mode === 'offer' && alreadyCollected ? 'complete' : result?.status === 'ready' ? 'ready' : result?.status === 'provisional' ? 'provisional' : 'neutral'
  function reviewCard(cardId: string, collected: boolean) {
    reviewList.current?.close()
    if (!collected) { onEditOffer(cardId); return }
    if (collectionEditor.current) collectionEditor.current.show()
    setCollectionReview(previous => ({ cardId, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const corrections = collection.cards.flatMap(card => {
    const source = savedOffers.find(item => item.id === sources[card.id])
    const corrected = source?.cards.find(item => item.id === card.id)
    return corrected && JSON.stringify(corrected) !== JSON.stringify(card) ? [{ card, corrected }] : []
  })
  function completeInvocation(plan: { cardIds: string[] }) {
    if (!mapReady || busy || !plan.cardIds.length || !plan.cardIds.every(id => collection.cards.some(card => card.id === id))) return
    const usedOfferIds = [...new Set([...workspace.usedOfferIds, ...plan.cardIds.flatMap(id => sources[id] ? [sources[id]] : [])])]
    onChange({ ...workspace, usedOfferIds, collection: { ...collection, cards: collection.cards.filter(card => !plan.cardIds.includes(card.id)) }, sources: Object.fromEntries(Object.entries(sources).filter(([id]) => !plan.cardIds.includes(id))) })
  }
  function collect(card: FateCard) {
    if (alreadyCollected || collection.cards.length >= MAX_COLLECTED_FATES || busy || !offerReady) return
    onChange({ ...workspace, collection: { ...collection, cards: [...collection.cards, structuredClone(card)] }, sources: { ...sources, [card.id]: offer.id } })
  }
  function toggleExcluded(cardId: string) {
    onChange({ ...workspace, excludedCardIds: workspace.excludedCardIds.includes(cardId)
      ? workspace.excludedCardIds.filter(id => id !== cardId) : [...workspace.excludedCardIds, cardId] })
  }
  const empty = !offer.cards.length && (!collection.cards.length || manualEntry) && !offer.captureId
  if (empty) return <div className={`capture-start ${busy ? 'is-busy' : ''}`} aria-busy={busy} inert={busy}>
    <div className="capture-intro"><h2 id="advisor-heading" tabIndex={-1}>Bring your next offer into focus.</h2><p>Capture a Fate offer. Check its rewards. Make your next choice.</p></div>
    {source}
    <p className="capture-start-note">Use the Windows helper for local text recognition, or keep a screenshot as evidence.</p>
    <DetailPanel className="reward-settings" autoOpen={!!solverControl.error} title="Reward priorities"><SolverControls control={solverControl} availableGoals={goals} /></DetailPanel>
    {mapReady && <DetailPanel className="collection-editor" title="Edit collected cards" onOpenChange={setManualEntry}><OfferEditor solverControl={solverControl} offer={collection} purpose="collection" onChange={patch => onChange({ ...workspace, collection: { ...collection, ...patch } })} /></DetailPanel>}
  </div>
  return <div className={`collector-grid map-layout ${busy ? 'is-busy' : ''}`} aria-busy={busy} inert={busy}>
      <section className="panel advisor-main" aria-labelledby="advisor-heading">
        <div className="decision-toolbar">
          <h2 id="advisor-heading" className="sr-only" tabIndex={-1}>Choose & invoke</h2>
          {mapReady ? <div className="decision-switch" role="group" aria-label="Decision"><button aria-pressed={mode === 'offer'} onClick={() => onChange({ ...workspace, mode: 'offer' })}>Choose a Fate</button><button aria-pressed={mode === 'invoke'} onClick={() => onChange({ ...workspace, mode: 'invoke' })}>Plan invocation</button></div> : <h2>Review this offer</h2>}
          <button className="text-button" onClick={() => onEditOffer()}>Edit current offer</button>
        </div>
        <DetailPanel trigger={mapReady} ref={priorities} className="reward-settings" autoOpen={!!solverControl.error} title={<>Reward priorities<span className="summary-detail">{portfolioMode ? `${solverControl.settings.profile.goals.length} priorities` : goal?.label || 'Choose a reward'}</span></>}>

          {!portfolioMode && <label className="reward-goal">Reward goal<select value={goal ? goalKey(goal) : ''} onChange={event => onChange({ ...workspace, goal: goals.find(option => goalKey(option) === event.target.value) ?? null })}>
            <option value="">Select a reward</option>{goals.map(option => <option key={goalKey(option)} value={goalKey(option)}>{option.label} · {option.kind === 'combo' ? 'Combo' : 'Regular'}</option>)}
          </select></label>}
          <SolverControls control={solverControl} availableGoals={goals} />
        </DetailPanel>
        {mapReady && mode === 'offer' && !offerReady && offer.cards.length > 0 && <div className="map-offer-confirmation"><strong>Is this offer from your current map?</strong><p>New imports and folder captures need confirmation before they affect advice.</p><button className="outline-button" onClick={onUseOffer}>Use this offer in current map</button></div>}
        {!workspace.map && offer.cards.length > 0 && <div className="map-offer-confirmation"><strong>No active map</strong><p>Start with this offer. Fates can only be used in the instance where you collect them.</p><button className="outline-button" onClick={onUseOffer}>Start map with this offer</button></div>}
        {mapReady && (mode === 'invoke' || offerReady) && <>
        {nextReview && <section className="advisor-review" aria-label="Data to check"><div className="review-next"><div><strong>{reviewCards.length} {reviewCards.length === 1 ? 'card needs' : 'cards need'} a check</strong><p>{cardName(nextReview.card)}{nextReview.collected ? ' · collected' : ''}: {nextReview.reasons.join(' · ')}</p></div><button onClick={() => reviewCard(nextReview.card.id, nextReview.collected)}>Review {cardName(nextReview.card)}</button></div>{reviewCards.length > 1 && <DetailPanel ref={reviewList} title={<>See the other {reviewCards.length - 1} {reviewCards.length === 2 ? 'card' : 'cards'}</>}><ul>{reviewCards.slice(1).map(({ card, collected, reasons }) => <li key={`${collected}:${card.id}`}><div><strong>{cardName(card)}{collected ? ' · collected' : ''}</strong><span>{reasons.join(' · ')}</span></div><button onClick={() => reviewCard(card.id, collected)}>Review {cardName(card)}</button></li>)}</ul></DetailPanel>}</section>}
        {!portfolioMode && <><div className="advisor-outcome" data-state={outcomeState} aria-live="polite" aria-atomic="true">
          {mode === 'offer' && alreadyCollected ? <><h3>{chosen ? `Choice added: ${cardName(chosen)}` : 'Invocation recorded'}</h3><p>Capture the next offer, or plan the Fates you have collected.</p>{!!collection.cards.length && <button className="outline-button" onClick={() => onChange({ ...workspace, mode: 'invoke' })}>Plan this collection</button>}</>
            : !goal ? <><h3>Select the reward you want.</h3><p>Choose a goal to compare specific Fates. Unknown icons stay unknown.</p><button className="outline-button" onClick={() => { if (priorities.current) { priorities.current.show(); priorities.current.element?.querySelector('select')?.focus() } }}>Set reward goal</button></>
            : mode === 'offer' && recommendations?.comparison === 'no-improvement' ? <><h3>No improvement for this goal.</h3><p>{recommendations.baseline?.activated ? 'Your collection already reaches this combo threshold.' : 'None of these Fates improves the best known plan from your collection.'} Choose another reward goal, or pick based on the modifiers in game.</p></>
            : result?.status === 'insufficient' ? <><h3>No supported recommendation yet.</h3><p>{mode === 'offer' ? `No offered Fate has a confirmed improvement for ${goal.label}. Check the cards and identify their rewards.` : `No confirmed progress toward ${goal.label} can be ranked. Add collected Fates and identify their rewards.`}</p></>
            : mode === 'offer' && recommendations ? <>
              <h3>{recommendations.status === 'provisional' ? 'Provisional preference: ' : recommendations.recommendedCardIds.length > 1 ? 'Equal matches: ' : 'Recommended: '}{recommendations.recommendedCardIds.map(id => cardName(offer.cards.find(card => card.id === id))).join(' / ')}</h3>
              <p>{recommendations.status === 'provisional' ? 'Missing data or unresolved mechanics could change this ranking.' : 'Best match for the selected reward among the supplied cards.'} {recommendations.recommendedCardIds.length > 1 && 'There is no single winner.'}</p>
              {featured && <button className="primary-choice" onClick={() => collect(featured)} disabled={collection.cards.length >= MAX_COLLECTED_FATES}>Add {cardName(featured)} to collected</button>}
            </> : <><h3>{invocation?.status === 'provisional' ? 'Provisional invocation plan' : 'Suggested invocation plan'}</h3><p>Uses only the Fates collected in this map.</p></>}
        </div>
        {goal && recommendations && !alreadyCollected && <p className="advisor-baseline">Best known from your collection: <strong>{recommendations.baseline?.targetCount ?? 0}{goal.kind === 'combo' ? `/${recommendations.baseline?.threshold ?? recommendations.candidates.find(item => item.plan)?.plan?.threshold ?? '?'}` : ''}</strong> matching {goal.kind === 'combo' ? 'combo icons' : 'reward icon units'} · up to 3 inputs{goal.kind === 'combo' ? ' · gain stops at the combo threshold' : ''}.</p>}
        {result && result.warnings.length > 0 && <DetailPanel className="advisor-caveats" title={<>What limits this recommendation</>}><ul className="advisor-warnings">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></DetailPanel>}</>}
        </>}
        {portfolioMode ? <PortfolioAdvice offer={offer} collected={collection.cards} mode={mode} profile={solverControl.settings.profile} excludedCardIds={workspace.excludedCardIds} onExclude={toggleExcluded} mapReady={mapReady} offerReady={offerReady} alreadyCollected={alreadyCollected} chosen={chosen} saved={saved} automatic={automatic} onCollect={collect} onInvoke={completeInvocation} onPlan={() => onChange({ ...workspace, mode: 'invoke' })} /> : mode === 'offer' || !mapReady ? <OfferPreview offer={offer} saved={saved} automatic={automatic} embedded provisional={recommendations?.status === 'provisional'} highlightedCardIds={!alreadyCollected ? recommendations?.recommendedCardIds : undefined} renderAdvice={offerReady ? card => {
          const candidate = recommendations?.candidates.find(item => item.cardId === card.id)
          return <div className="advisor-candidates">
            {candidate && !alreadyCollected && <p className="candidate-gain">{candidate.gain === null ? 'No known progress for this goal' : candidate.gain > 0 ? `+${candidate.gain} toward ${goal?.label} vs your collection` : candidate.gain < 0 ? `${candidate.gain} toward ${goal?.label} if this card is used` : 'No gain over your collection'}{recommendations?.status === 'provisional' || recommendations?.comparison === 'unknown' ? ' · provisional' : ''}</p>}
            {featuredId !== card.id && <button className="collect-fate" onClick={() => collect(card)} disabled={alreadyCollected || collection.cards.length >= MAX_COLLECTED_FATES}>Add {cardName(card)} to collected</button>}
            {candidate?.plan && goal && <DetailPanel className="candidate-plan" title={<>Reward progress & invocation order</>}><PlanDetails plan={candidate.plan} cards={allCards} collected={collection.cards} goal={goal} /></DetailPanel>}
          </div>
        } : undefined} /> : invocation && goal && <div className="advisor-plans">{invocation.plans.map((plan, index) => {
          const content = <article data-best={index === 0 || undefined} data-state={invocation.status}><h3>{index === 0 ? 'Best supported plan' : `Alternative ${index + 1}`}</h3><PlanDetails plan={plan} cards={collection.cards} collected={collection.cards} goal={goal} /><button className={index === 0 ? 'primary-choice' : undefined} onClick={() => completeInvocation(plan)}>Mark this invocation completed</button><p className="hint">After invoking in game, remove these cards from your collection. You can undo this change.</p></article>
          return index === 0 ? <div key={plan.cardIds.join(':')}>{content}</div> : <DetailPanel className="alternative-plan" key={plan.cardIds.join(':')} title={<>Alternative {index + 1} · {plan.targetCount}{plan.threshold ? `/${plan.threshold}` : ''} icons · {plan.cardIds.length} inputs</>}>{content}</DetailPanel>
        })}</div>}

        {offerReady && mode === 'offer' && <p className="hint">{workspace.usedOfferIds.includes(offer.id) ? 'A Fate from this offer has already been invoked.' : alreadyCollected ? 'A Fate from this offer is already collected. Remove it before changing your choice.' : 'Add only the Fate you actually chose in game. This does not control the game.'}</p>}
        <DetailPanel className="advice-notes" title={<>Advice notes & mechanics</>}><section className="advisor-caveats"><h3>How advice works</h3><p>Choose one reward, or compare a weighted portfolio of rewards with your build filters. Points reflect your priorities, not measured prices or expected profit. Item quantities, automatic danger estimates and future offers remain unknown. Check the modifiers before choosing.</p><p>Duplicate combo scaling, mixed-tier merges and a third duplicate remain unresolved. Sources were checked on 11 November 2026; live-game validation is pending.</p><p><a href="https://www.youtube.com/watch?v=8CEAhCzmXJM&t=11220s" target="_blank" rel="noreferrer">GGG Fate mechanics Q&A</a></p></section>
        <section className="advisor-caveats"><h3>Viscera and boss rewards</h3><p>GGG confirms that Grim-Fate empowered Pinnacle bosses always drop their Viscera. Regular Fate-empowered bosses have a higher chance with more invoked Fates, and a further benefit from duplicates. Exact chances and duplicate interactions are unknown, so this does not change the icon ranking.</p><p><a href="https://www.pathofexile.com/forum/view-thread/4013527/page/1" target="_blank" rel="noreferrer">GGG Covens FAQ · 10 November 2026</a></p></section></DetailPanel>
      </section>
      <div className="map-sidebar">{source}<aside className="panel advisor-collection" aria-labelledby="collection-heading">
        <div className="section-heading"><h2 id="collection-heading">Collected in this map</h2><span className="muted">{collection.cards.length}/{MAX_COLLECTED_FATES}</span></div>
        <p className="hint">Only for this map instance.</p>
        {!!corrections.length && <div className="snapshot-corrections" role="status"><strong>Saved source offers have different card details.</strong><p>Your collected snapshots remain unchanged until you apply a correction.</p>{corrections.map(({ card, corrected }) => <button key={card.id} disabled={!mapReady} onClick={() => onChange({ ...workspace, collection: { ...collection, cards: collection.cards.map(item => item.id === card.id ? structuredClone(corrected) : item) } })}>Apply source correction: {cardName(card)}</button>)}</div>}
        {collection.cards.length ? <ul className="collected-fates">{collection.cards.map((card, index) => <li key={card.id}><div><strong>#{index + 1} {cardName(card)}</strong>{portfolioMode && <label className="checkbox-row exclusion-control"><input type="checkbox" disabled={!mapReady} checked={workspace.excludedCardIds.includes(card.id)} onChange={() => toggleExcluded(card.id)} />Exclude collected {cardName(card)} #{index + 1} from plans</label>}<span className="cell-sub">{card.tier === null ? 'Tier unknown' : `Tier ${card.tier}`} · {card.rewards.filter(reward => reward.identified).length} identified reward rows</span></div><button disabled={!mapReady} className="text-button" aria-label={`Remove collected ${cardName(card)} ${index + 1}`} onClick={() => onChange({ ...workspace, collection: { ...collection, cards: collection.cards.filter(item => item.id !== card.id) } })}>Remove</button></li>)}</ul> : <p className="advisor-empty">No collected Fates yet.</p>}
        {mapReady && <DetailPanel ref={collectionEditor} className="collection-editor" title={<>Edit collected cards</>}><OfferEditor solverControl={solverControl} offer={collection} purpose="collection" reviewRequest={collectionReview} onChange={patch => onChange({ ...workspace, collection: { ...collection, ...patch } })} /></DetailPanel>}
        {mapReady && !!collection.cards.length && mode === 'offer' && !alreadyCollected && <button className="outline-button" onClick={() => onChange({ ...workspace, mode: 'invoke' })}>Plan this collection</button>}
      </aside></div>
    </div>
}
