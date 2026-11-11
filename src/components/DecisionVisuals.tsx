import type { FateCard, Reward } from '../../shared/schema'
import type { InvocationPlan } from '../../shared/advisor'
import { REWARD_CATALOG } from '../../shared/reward-catalog'
import rewardIcons from '../../shared/reward-icons.json'
import { AppIcon } from './AppIcon'

const named = (card: FateCard | undefined) => card?.name.trim() || 'Unnamed Fate'

/** Interface symbols are a reading aid; only sourced catalog images represent game icons. */
export function RewardSymbol({ label, identified = true }: { label: string; identified?: boolean }) {
  const normalized = label.trim().toLowerCase()
  const catalog = identified && REWARD_CATALOG.find(entry => entry.label.toLowerCase() === normalized)
  const reference = catalog && rewardIcons.icons.find(icon => icon.id === catalog.id)
  const symbol = !identified ? 'question' : ['currency', 'additional currency items'].includes(normalized) ? 'coins'
    : ['gems', 'gem'].includes(normalized) ? 'gem' : ['armour', 'armor'].includes(normalized) ? 'shield'
      : ['flask', 'flasks'].includes(normalized) ? 'flask' : ['map', 'maps'].includes(normalized) ? 'map' : 'reward'
  return <span className="reward-symbol" aria-hidden="true">{reference
    ? <img src={`data:image/png;base64,${reference.pngBase64}`} alt="" width={36} height={36} />
    : <AppIcon name={symbol} />}</span>
}

export function TierMark({ tier, suggested = false }: { tier: number | null; suggested?: boolean }) {
  return <span className={`tier-mark${suggested ? ' is-suggested' : ''}`}>
    <svg viewBox="0 0 34 14" aria-hidden="true">{[1, 2, 3].map(level => <path key={level} d={`m${level * 11 - 8} 7 4-5 4 5-4 5Z`} fill={tier !== null && level <= tier ? 'currentColor' : 'none'} stroke="currentColor" opacity={tier !== null && level <= tier ? 1 : 0.3} />)}</svg>
    <span>{tier === null ? 'Tier ?' : `Tier ${tier}`}{suggested ? ' · suggested' : ''}</span>
  </span>
}

export function RewardStrip({ rewards, suggested = false, compact = false }: { rewards: Reward[]; suggested?: boolean; compact?: boolean }) {
  return <div className={`reward-strip${compact ? ' is-compact' : ''}`}>
    {rewards.length ? rewards.map(reward => <div className="reward-unit" key={reward.id} data-unknown={!reward.identified || reward.kind === 'unknown' || undefined}>
      <RewardSymbol label={reward.label} identified={reward.identified && reward.kind !== 'unknown'} />
      <div><strong>{reward.count}×</strong><span>{reward.label || 'Unknown reward'}</span>
        {!reward.identified || reward.kind === 'unknown' ? <small>{reward.kind === 'unknown' ? 'Kind unknown' : 'Unidentified'} · review</small>
          : reward.kind === 'combo' ? <small>Combo · needs {reward.threshold ?? '?'}</small> : null}</div>
    </div>) : <div className="reward-unit" data-unknown><RewardSymbol label="" identified={false} /><span>No rewards read</span></div>}
    {suggested && <small className="reward-review-note"><AppIcon name="warning" />Suggested · check reward row</small>}
  </div>
}

export function InvocationSequence({ plan, cards, collected }: {
  plan: Pick<InvocationPlan, 'cardIds' | 'merges'>; cards: FateCard[]; collected: FateCard[]
}) {
  const source = (id: string) => {
    const collectedIndex = collected.findIndex(card => card.id === id)
    const offeredIndex = cards.filter(card => !collected.some(item => item.id === card.id)).findIndex(card => card.id === id)
    return collectedIndex >= 0 ? `collected #${collectedIndex + 1}` : `offer #${offeredIndex + 1}`
  }
  return <div className="invocation-diagram">
    <div className="sequence-heading"><span>Invoke in this order</span><span>{plan.cardIds.length} / 3 slots</span></div>
    <ol className="invocation-order">{plan.cardIds.map((id, index) => {
      const card = cards.find(item => item.id === id)
      const merged = plan.merges.some(merge => merge.firstId === id || merge.consumedId === id)
      return <li key={id} data-merge={merged || undefined} aria-label={`${index + 1}. ${named(card)} (${source(id)})`}>
        <span className="invoke-step" aria-hidden="true">{index + 1}</span>
        <div className="invoke-card"><TierMark tier={card?.tier ?? null} suggested={!!card?.visualReview && !card.visualReview.tierReviewed} />
          <strong className="invoke-name">{named(card)}</strong><span className="invoke-source">{source(id)}</span>
          {card && <RewardStrip rewards={card.rewards} compact suggested={!!card.visualReview && !card.visualReview.rewardsReviewed} />}
        </div>
        {index < plan.cardIds.length - 1 && <span className="sequence-arrow"><AppIcon name="arrow" /></span>}
      </li>
    })}</ol>
    {plan.merges.map(merge => <div className="merge-diagram" key={merge.firstId}>
      <div className="merge-equation" aria-label="Tier 2 plus Tier 2 becomes Tier 3"><TierMark tier={2} /><AppIcon name="plus" /><TierMark tier={2} /><AppIcon name="arrow" /><TierMark tier={3} /></div>
      <div><strong>{named(cards.find(card => card.id === merge.firstId))} merge</strong><span>First regular rewards ×3 · second rewards discarded</span></div>
      <p className="sr-only">{named(cards.find(card => card.id === merge.firstId))} ({source(merge.firstId)}): T2 + T2 → T3. {named(cards.find(card => card.id === merge.consumedId))} ({source(merge.consumedId)}) is consumed. Both input slots are used.</p>
    </div>)}
  </div>
}

export function GainMark({ gain, label, provisional = false }: { gain: number | null; label: string; provisional?: boolean }) {
  const value = gain === null ? '?' : `${gain > 0 ? '+' : ''}${new Intl.NumberFormat('en', { maximumSignificantDigits: 5 }).format(gain)}`
  return <div className="candidate-gain" data-gain={gain === null ? 'unknown' : gain > 0 ? 'positive' : gain < 0 ? 'negative' : 'neutral'}>
    <strong>{value}</strong><span>{gain === null ? 'Unknown gain' : gain === 0 ? 'No gain' : gain < 0 ? `${label} if used` : `${label} vs collection`}{provisional && <small>Provisional</small>}</span>
  </div>
}
