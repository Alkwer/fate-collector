import { useMemo } from 'react'
import { recommendPortfolio, solveInvocation, type SolverPlan, type SolverProfile } from '../../shared/solver'
import { MAX_COLLECTED_FATES } from '../../shared/advisor'
import type { FateCard, Offer } from '../../shared/schema'
import { OfferPreview } from './OfferPreview'

const number = (value: number) => new Intl.NumberFormat('en', { maximumSignificantDigits: 6 }).format(value)
const named = (card: FateCard | undefined) => card?.name.trim() || 'Unnamed Fate'
const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`

export function PortfolioPlan({ plan, cards, collected }: { plan: SolverPlan; cards: FateCard[]; collected: FateCard[] }) {
  const name = (id: string) => {
    const card = cards.find(item => item.id === id)
    const index = collected.findIndex(item => item.id === id)
    const offerIndex = cards.filter(item => !collected.some(owned => owned.id === item.id)).findIndex(item => item.id === id)
    return `${named(card)} (${index >= 0 ? `collected #${index + 1}` : `offer #${offerIndex + 1}`})`
  }
  return <div className="portfolio-plan">
    <p className="advisor-value">{number(plan.score)} priority points <span className="cell-sub">{number(plan.progress)} combo progress · tie-breaker only</span></p>
    <p className="hint">Invoke in this order · {plan.cardIds.length} of 3 input slots · {plan.retained.length} Fates after supported merges</p>
    <ol className="invocation-order">{plan.cardIds.map(id => <li key={id}>{name(id)}</li>)}</ol>
    {plan.merges.map(merge => <p className="advisor-merge" key={merge.firstId}>{name(merge.firstId)}: T2 + T2 → T3; regular rewards ×3. {name(merge.consumedId)} is consumed and its rewards are discarded. Both input slots remain used.</p>)}
    <dl className="reward-breakdown" aria-label="Reward breakdown">{plan.rewards.map((reward, i) => <div key={`${reward.kind}:${reward.label}:${i}`}>
      <dt>{reward.label || 'Unidentified reward'} <span className="muted">{reward.kind}</span></dt>
      <dd><span>{reward.count === null ? 'Unresolved outcome' : reward.kind === 'combo' ? `${reward.count}/${reward.threshold ?? '?'} icons · ${reward.activated ? 'active once' : 'not activated'}` : `${reward.count} icon units`}{reward.uncertain ? ' · incomplete evidence' : ''}</span><span>{number(reward.weight)} weight → <strong>{number(reward.points)} points</strong></span></dd>
    </div>)}</dl>
    {plan.warnings.length > 0 && <ul className="advisor-warnings">{plan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
  </div>
}

interface Props {
  offer: Offer; collected: FateCard[]; mode: 'offer' | 'invoke'; profile: SolverProfile
  excludedCardIds: string[]; onExclude: (id: string) => void
  mapReady: boolean; offerReady: boolean; alreadyCollected: boolean; chosen: FateCard | undefined
  saved: boolean; automatic: boolean; onCollect: (card: FateCard) => void
  onInvoke: (plan: SolverPlan) => void; onPlan: () => void
}
export function PortfolioAdvice(props: Props) {
  const { offer, collected, mode, profile, excludedCardIds, mapReady, offerReady, alreadyCollected, chosen } = props
  const portfolio = useMemo(() => mapReady && offerReady && mode === 'offer' ? recommendPortfolio(offer.cards, collected, profile, excludedCardIds) : null, [offer.cards, collected, profile, excludedCardIds, mapReady, offerReady, mode])
  const invocation = useMemo(() => mapReady && mode === 'invoke' ? solveInvocation(collected, profile, excludedCardIds) : null, [collected, profile, excludedCardIds, mapReady, mode])
  const result = mode === 'offer' ? portfolio : invocation
  const cards = [...collected, ...offer.cards]
  const selectedIds = !alreadyCollected ? portfolio?.recommendedCardIds ?? [] : []
  const featured = selectedIds.length === 1 ? offer.cards.find(card => card.id === selectedIds[0]) : undefined
  const excluded = new Map(result?.excluded.map(row => [row.cardId, row.reasons]) ?? [])
  const status = result?.status ?? 'insufficient'
  const outcomeState = mode === 'offer' && alreadyCollected ? 'complete' : status === 'ready' ? 'ready' : status === 'provisional' ? 'provisional' : 'neutral'
  return <>
    {result && <>
      <div className="advisor-outcome" data-state={outcomeState} aria-live="polite" aria-atomic="true">
        {mode === 'offer' && alreadyCollected ? <><h3>{chosen ? `Choice added: ${named(chosen)}` : 'Invocation recorded'}</h3><p>Capture the next offer, or plan the Fates you have collected.</p>{!!collected.length && <button onClick={props.onPlan}>Plan this collection</button>}</>
          : !profile.goals.some(goal => goal.weight > 0) ? <><h3>Set your reward priorities.</h3><p>Add at least one reward with a positive weight in the profile above.</p></>
          : mode === 'offer' && portfolio?.comparison === 'no-improvement' ? <><h3>No gain for these priorities.</h3><p>Your best known collection plan is at least as good. You can change your priorities or choose manually after checking the modifiers.</p></>
          : status === 'insufficient' || (mode === 'offer' && !selectedIds.length) ? <><h3>No supported portfolio recommendation.</h3><p>Check missing rewards, the collection and your exclusions. Unknown results are not treated as a confirmed zero.</p></>
          : mode === 'offer' ? <><h3>{status === 'provisional' ? 'Provisional preference: ' : selectedIds.length > 1 ? 'Equal matches: ' : 'Recommended: '}{selectedIds.map(id => named(offer.cards.find(card => card.id === id))).join(' / ')}</h3><p>{status === 'provisional' ? 'Missing data or unresolved mechanics could change the weighted result.' : 'Best combined result for your priorities and recorded build filters.'}{selectedIds.length > 1 ? ' There is no single winner.' : ''}</p>{featured && <button className="primary-choice" disabled={collected.length >= MAX_COLLECTED_FATES} onClick={() => props.onCollect(featured)}>Add {named(featured)} to collected</button>}</>
          : <><h3>{status === 'provisional' ? 'Provisional portfolio plan' : 'Suggested portfolio plan'}</h3><p>Maximizes your configured points, then combo progress, then saves input slots.</p></>}
      </div>
      {portfolio && !alreadyCollected && <p className="advisor-baseline">Collection baseline: <strong>{number(portfolio.baseline?.score ?? 0)} priority points</strong> · {number(portfolio.baseline?.progress ?? 0)} combo progress. No unknown future offers are assumed.</p>}
      {!!result.excluded.length && <details className="advisor-caveats"><summary>Excluded by your settings ({result.excluded.length})</summary><ul>{result.excluded.map(row => <li key={row.cardId}><strong>{named(cards.find(card => card.id === row.cardId))}</strong>: {row.reasons.join(' · ')}</li>)}</ul></details>}
      {!!result.warnings.length && <details className="advisor-caveats"><summary>What limits this recommendation</summary><ul className="advisor-warnings">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    </>}
    {mode === 'offer' || !mapReady ? <OfferPreview offer={offer} saved={props.saved} automatic={props.automatic} embedded highlightedCardIds={selectedIds} provisional={status === 'provisional'} renderAdvice={offerReady ? card => {
      const candidate = portfolio?.candidates.find(row => row.cardId === card.id)
      return <div className="advisor-candidates">
        <label className="checkbox-row exclusion-control"><input type="checkbox" checked={excludedCardIds.includes(card.id)} onChange={() => props.onExclude(card.id)} />Exclude {named(card)} from plans</label>
        {excluded.has(card.id) && <p className="exclusion-reason">Excluded: {excluded.get(card.id)!.join(' · ')}</p>}
        {candidate && !alreadyCollected && <p className="candidate-gain">{candidate.gain === null ? 'No supported plan' : `${signed(candidate.gain)} priority points · ${signed(candidate.progressGain ?? 0)} combo progress vs collection`}{status === 'provisional' ? ' · provisional' : ''}</p>}
        {featured?.id !== card.id && <button disabled={alreadyCollected || excluded.has(card.id) || collected.length >= MAX_COLLECTED_FATES} onClick={() => props.onCollect(card)}>Add {named(card)} to collected</button>}
        {candidate?.plan && <details className="candidate-plan"><summary>All rewards & invocation order</summary><PortfolioPlan plan={candidate.plan} cards={cards} collected={collected} /></details>}
      </div>
    } : undefined} /> : invocation && <div className="advisor-plans">
      {invocation.tiedBestPlanCount > 1 && <p className="hint">{invocation.tiedBestPlanCount} equally ranked plans. Showing up to three alternatives.</p>}
      {invocation.plans.map((plan, index) => {
        const content = <article data-best={index === 0 || undefined} data-state={status}><h3>{index === 0 ? 'Best supported portfolio' : `Alternative ${index + 1}`}</h3><PortfolioPlan plan={plan} cards={collected} collected={collected} /><button className={index === 0 ? 'primary-choice' : undefined} onClick={() => props.onInvoke(plan)}>Mark this invocation completed</button><p className="hint">After invoking in game, remove these cards from your collection. You can undo this change.</p></article>
        return index === 0 ? <div key={plan.cardIds.join(':')}>{content}</div> : <details className="alternative-plan" key={plan.cardIds.join(':')}><summary>Alternative {index + 1} · {number(plan.score)} points · {plan.cardIds.length} inputs</summary>{content}</details>
      })}
    </div>}
  </>
}
