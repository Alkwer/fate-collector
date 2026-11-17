import { DetailPanel, type DetailPanelHandle } from './DetailPanel'
import { useMemo, useRef } from 'react'
import { recommendPortfolio, solveInvocation, unweightedRewards, visceraFactors, type SolverPlan, type SolverProfile } from '../../shared/solver'
import { MAX_COLLECTED_FATES } from '../../shared/advisor'
import type { FateCard, Offer } from '../../shared/schema'
import { OfferPreview } from './OfferPreview'
import { GainMark, InvocationSequence, RewardSymbol } from './DecisionVisuals'
import { AppIcon } from './AppIcon'
import { BuildWarnings } from './BuildWarnings'

const number = (value: number) => new Intl.NumberFormat('en', { maximumSignificantDigits: 6 }).format(value)
const named = (card: FateCard | undefined) => card?.name.trim() || 'Unnamed Fate'
const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`

export function PortfolioPlan({ plan, cards, collected }: { plan: SolverPlan; cards: FateCard[]; collected: FateCard[] }) {
  return <div className="portfolio-plan">
    <InvocationSequence plan={plan} cards={cards} collected={collected} />
    <div className="plan-result"><AppIcon name="reward" /><strong>{number(plan.score)}</strong><div><span>priority points</span><small>{number(plan.progress)} combo progress · useful while collecting</small></div></div>
    {plan.rewards.some(reward => reward.uncertain || reward.count === null) && <p className="hint reward-uncertainty">Unresolved reward outcomes · check breakdown</p>}
    <DetailPanel className="plan-notes" title="Reward breakdown"><dl className="reward-breakdown" aria-label="Reward breakdown">{plan.rewards.map((reward, i) => <div key={`${reward.kind}:${reward.label}:${i}`}>
      <dt><RewardSymbol label={reward.label} identified={reward.kind !== 'unknown'} />{reward.label || 'Unidentified reward'} <span className="muted">{reward.kind}</span></dt>
      <dd><span>{reward.count === null ? 'Unresolved outcome' : reward.kind === 'combo' ? `${reward.count}/${reward.threshold ?? '?'} icons · ${reward.activated ? 'active once' : 'not activated'}` : `${reward.count} icon units`}{reward.uncertain ? ' · incomplete evidence' : ''}</span><span>{number(reward.weight)} weight → <strong>{number(reward.points)} points</strong></span></dd>
    </div>)}</dl></DetailPanel>
    {plan.warnings.length > 0 && <DetailPanel className="plan-notes" title="Plan limitations"><ul className="advisor-warnings">{plan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></DetailPanel>}
  </div>
}

interface Props {
  offer: Offer; collected: FateCard[]; mode: 'offer' | 'invoke'; profile: SolverProfile
  excludedCardIds: string[]; onExclude: (id: string) => void
  mapReady: boolean; offerReady: boolean; alreadyCollected: boolean; chosen: FateCard | undefined
  saved: boolean; automatic: boolean; onCollect: (card: FateCard) => void
  onInvoke: (plan: SolverPlan) => void; onPlan: () => void
  onPriorities: () => void
}
export function PortfolioAdvice(props: Props) {
  const { offer, collected, mode, profile, excludedCardIds, mapReady, offerReady, alreadyCollected, chosen } = props
  const portfolio = useMemo(() => mapReady && offerReady && mode === 'offer' ? recommendPortfolio(offer.cards, collected, profile, excludedCardIds) : null, [offer.cards, collected, profile, excludedCardIds, mapReady, offerReady, mode])
  const invocation = useMemo(() => mapReady && mode === 'invoke' ? solveInvocation(collected, profile, excludedCardIds) : null, [collected, profile, excludedCardIds, mapReady, mode])
  const result = mode === 'offer' ? portfolio : invocation
  const unweightedPanel = useRef<DetailPanelHandle>(null)
  const cards = [...collected, ...offer.cards]
  const selectedIds = !alreadyCollected ? portfolio?.recommendedCardIds ?? [] : []
  const featured = selectedIds.length === 1 ? offer.cards.find(card => card.id === selectedIds[0]) : undefined
  const excluded = new Map(result?.excluded.map(row => [row.cardId, row.reasons]) ?? [])
  const unweighted = result ? unweightedRewards((mode === 'offer' ? cards : collected).filter(card => !excluded.has(card.id)), profile) : []
  const status = result?.status ?? 'insufficient'
  const farming = profile.objective === 'viscera'
  const outcomeState = mode === 'offer' && alreadyCollected ? 'complete' : status === 'ready' ? 'ready' : status === 'provisional' ? 'provisional' : 'neutral'
  return <>
    {result && <>
      <div className="advisor-outcome" data-state={outcomeState} aria-live="polite" aria-atomic="true">
        {mode === 'offer' && alreadyCollected ? <><h3>{chosen ? `Choice added: ${named(chosen)}` : 'Invocation recorded'}</h3><p>Capture the next offer, or plan the Fates you have collected.</p>{!!collected.length && <button onClick={props.onPlan}>Plan this collection</button>}</>
          : !farming && !profile.goals.some(goal => goal.weight > 0) ? <><h3>Set your reward priorities.</h3><p>Add at least one reward with a positive weight in the profile above.</p></>
          : mode === 'invoke' && !!invocation?.collectingPlans?.length ? <><h3>Combo incomplete — collect more Fates</h3><p>No active reward for your priorities is established. Progress helps choose another Fate, but does not pay a completed combo now.</p></>
          : farming && mode === 'offer' && portfolio?.candidates.some(candidate => candidate.plan) && !selectedIds.length ? <><h3>No better known Viscera option.</h3><p>These offers do not improve the modeled Fate count, duplicates or reward points. Unknown outcomes may still change your choice.</p></>
          : mode === 'offer' && portfolio?.comparison === 'no-improvement' ? <><h3>No gain for these priorities.</h3><p>Your best known collection plan is at least as good. You can change your priorities or choose manually after checking the modifiers.</p></>
          : status === 'insufficient' || (mode === 'offer' && !selectedIds.length) ? <><h3>No supported portfolio recommendation.</h3><p>Identify rewards to compare these Fates. Unknown results are not a confirmed zero.</p></>
          : mode === 'offer' ? <><h3>{status === 'provisional' ? 'Provisional preference: ' : selectedIds.length > 1 ? 'Equal matches: ' : 'Recommended: '}{selectedIds.map(id => named(offer.cards.find(card => card.id === id))).join(' / ')}</h3>{status === 'provisional' && <p><AppIcon name="warning" />Missing data or unresolved mechanics may change this ranking.</p>}{selectedIds.length > 1 && <p>No single winner.</p>}</>
          : <h3>{farming ? 'Viscera farming options' : status === 'provisional' ? 'Provisional portfolio plan' : 'Suggested portfolio plan'}</h3>}
        {farming && <p>More Fates and duplicates improve the chance of boss Viscera. Exact odds and the trade-off between these factors are unknown. Check the boss and your build before invoking.</p>}
      </div>
      {!!unweighted.length && <DetailPanel ref={unweightedPanel} className="unweighted-rewards" title={`${unweighted.length} reward ${unweighted.length === 1 ? 'type has' : 'types have'} weight 0`} triggerLabel={`Unweighted rewards (${unweighted.length})`}>
        <p>These identified rewards add no priority points. Their value is not assumed to be zero; your profile does not currently prioritize them.</p>
        <ul>{unweighted.map(reward => <li key={`${reward.kind}:${reward.label}`}>{reward.label} · {reward.kind}</li>)}</ul>
        <button onClick={() => { unweightedPanel.current?.close(); props.onPriorities() }}>Set reward priorities</button>
      </DetailPanel>}
      {portfolio && !alreadyCollected && collected.length > 0 && <p className="advisor-baseline"><AppIcon name="reward" /><span>Collection best</span><strong>{number(portfolio.baseline?.score ?? 0)}</strong><span>priority points · {number(portfolio.baseline?.progress ?? 0)} combo progress</span></p>}
      {!!result.excluded.length && <DetailPanel className="advisor-caveats" title={<>Excluded by your settings ({result.excluded.length})</>}><ul>{result.excluded.map(row => <li key={row.cardId}><strong>{named(cards.find(card => card.id === row.cardId))}</strong>: {row.reasons.join(' · ')}</li>)}</ul></DetailPanel>}
      {!!result.warnings.length && <DetailPanel className="advisor-caveats" title={<>What limits this recommendation</>}><ul className="advisor-warnings">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></DetailPanel>}
    </>}
    {mode === 'offer' || !mapReady ? <OfferPreview offer={offer} saved={props.saved} automatic={props.automatic} embedded highlightedCardIds={selectedIds} provisional={status === 'provisional'} renderAdvice={offerReady ? card => {
      const candidate = portfolio?.candidates.find(row => row.cardId === card.id)
      return <div className="advisor-candidates">
        <label className="checkbox-row exclusion-control"><input type="checkbox" checked={excludedCardIds.includes(card.id)} onChange={() => props.onExclude(card.id)} />Exclude {named(card)} from plans</label>
        {excluded.has(card.id) && <p className="exclusion-reason">Excluded: {excluded.get(card.id)!.join(' · ')}</p>}
        <BuildWarnings cards={[card]} filters={profile} />
        {farming && candidate?.plan && <p>{visceraFactors(candidate.plan).inputs} input Fates · {visceraFactors(candidate.plan).duplicate ? 'duplicate included' : 'no duplicate'}</p>}
        {candidate && !alreadyCollected && <><GainMark gain={candidate.gain} label="priority points" provisional={status === 'provisional'} /><small>{signed(candidate.progressGain ?? 0)} combo progress</small></>}
        <button className={featured?.id === card.id ? 'primary-choice collect-fate' : 'collect-fate'} aria-label={`Add ${named(card)} to collected`} disabled={alreadyCollected || excluded.has(card.id) || collected.length >= MAX_COLLECTED_FATES} onClick={() => props.onCollect(card)}><AppIcon name="plus" />Collect Fate</button>
        {candidate?.plan && <DetailPanel className="candidate-plan" title="All rewards & invocation order" triggerLabel="Preview plan"><PortfolioPlan plan={candidate.plan} cards={cards} collected={collected} /></DetailPanel>}
      </div>
    } : undefined} /> : invocation && <div className="advisor-plans">
      {!!invocation.collectingPlans?.length && <div className="combo-progress"><h3>Progress while collecting</h3><ul>{invocation.collectingPlans[0].rewards.filter(reward => reward.kind === 'combo' && !reward.activated).map((reward, index) => <li key={index}>{reward.label}: {reward.count ?? '?'}/{reward.threshold ?? '?'} icons · not active</li>)}</ul></div>}
      {invocation.tiedBestPlanCount > 1 && <p className="hint">{farming ? 'These plans preserve different combinations of Fate count, duplicates or rewards. Their drop chances cannot be ranked.' : `${invocation.tiedBestPlanCount} equally ranked plans. Showing up to three alternatives.`}</p>}
      {invocation.plans.map((plan, index) => {
        const content = <article data-best={index === 0 || undefined} data-state={status}><h3 className={index === 0 ? 'sr-only' : undefined}>{farming ? `Viscera option ${index + 1}` : index === 0 ? 'Best supported portfolio' : `Alternative ${index + 1}`}</h3>
          {farming && <p>{visceraFactors(plan).inputs} input Fates · {visceraFactors(plan).duplicate ? 'duplicate included' : 'no duplicate'} · {number(Math.max(0, (invocation.rewardBaseline?.score ?? 0) - plan.score))} priority points below your best reward plan</p>}
          <BuildWarnings cards={collected.filter(card => plan.cardIds.includes(card.id))} filters={profile} merges={plan.merges} planWarnings={plan.warnings} />
          <PortfolioPlan plan={plan} cards={collected} collected={collected} /><button className={index === 0 ? 'primary-choice' : undefined} aria-label="Mark this invocation completed" onClick={() => props.onInvoke(plan)}><AppIcon name="check" />Done in game</button><p className="hint">Removes these cards. Undo is available.</p></article>
        return index === 0 ? <div key={plan.cardIds.join(':')}>{content}</div> : <DetailPanel className="alternative-plan" key={plan.cardIds.join(':')} title={<>Alternative {index + 1} · {number(plan.score)} points · {plan.cardIds.length} inputs</>}>{content}</DetailPanel>
      })}
    </div>}
  </>
}
