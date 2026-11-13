import type { FateCard, Reward } from '../../shared/schema'
import type { InvocationPlan } from '../../shared/advisor'
import { useState } from 'react'
import { fateArt, rewardArt } from '../lib/game-art'
import { AppIcon } from './AppIcon'

const named = (card: FateCard | undefined) => card?.name.trim() || 'Unnamed Fate'

export function FateArtwork({ name }: { name: string }) {
  const src = fateArt(name)
  const [failed, setFailed] = useState<string | null>(null)
  return <div className={`fate-art${!src || failed === src ? ' is-unavailable' : ''}`}>
    {src && failed !== src ? <img src={src} alt={`${name} Fate artwork`} width={160} height={160} onError={() => setFailed(src)} />
      : <><AppIcon name="cards" /><span>Artwork unavailable</span></>}
  </div>
}

/** A recorded motif can be shown without claiming that its meaning is known. */
export function RewardSymbol({ label, identified = true, visualId }: { label: string; identified?: boolean; visualId?: Reward['visualId'] }) {
  const src = rewardArt(label, identified, visualId)
  const [failed, setFailed] = useState<string | null>(null)
  return <span className="reward-symbol" aria-hidden="true" data-game-icon={!!src || undefined}>{src && failed !== src
    ? <img src={src} alt="" width={36} height={36} onError={() => setFailed(src)} />
    : <AppIcon name={identified ? 'reward' : 'question'} />}</span>
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
      <RewardSymbol label={reward.label} identified={reward.identified && reward.kind !== 'unknown'} visualId={reward.visualId} />
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
    <div className="sequence-heading"><strong>Select in this order</strong><span>{plan.cardIds.length} / 3 inputs</span></div>
    <ol className="invocation-order" data-input-count={plan.cardIds.length}>{plan.cardIds.map((id, index) => {
      const card = cards.find(item => item.id === id)
      const merged = plan.merges.some(merge => merge.firstId === id || merge.consumedId === id)
      return <li key={id} data-merge={merged || undefined} aria-label={`${index + 1}. ${named(card)} (${source(id)})`}>
        <div className="invoke-step-label"><span className="invoke-step" aria-hidden="true">{index + 1}</span><span>Select {index + 1 === 1 ? 'first' : index + 1 === 2 ? 'second' : 'third'}</span></div>
        <div className="invoke-card"><FateArtwork name={named(card)} />
          <div className="invoke-identity"><strong className="invoke-name">{named(card)}</strong><span className="invoke-source">{source(id)}</span>
          <TierMark tier={card?.tier ?? null} suggested={!!card?.visualReview && !card.visualReview.tierReviewed} /></div>
          {card && <RewardStrip rewards={card.rewards} compact suggested={!!card.visualReview && !card.visualReview.rewardsReviewed} />}
        </div>
        {index < plan.cardIds.length - 1 && <span className="sequence-arrow"><AppIcon name="arrow" /></span>}
      </li>
    })}</ol>
    {plan.merges.map(merge => {
      const first = cards.find(card => card.id === merge.firstId), second = cards.find(card => card.id === merge.consumedId)
      return <div className="merge-diagram" key={merge.firstId}>
        <div className="merge-equation" aria-label={`${named(first)}: Tier 2 plus Tier 2 becomes Tier 3`}>
          <figure><FateArtwork name={named(first)} /><figcaption><TierMark tier={2} /><span>Step {plan.cardIds.indexOf(merge.firstId) + 1}</span></figcaption></figure>
          <AppIcon name="plus" />
          <figure><FateArtwork name={named(second)} /><figcaption><TierMark tier={2} /><span>Step {plan.cardIds.indexOf(merge.consumedId) + 1}</span></figcaption></figure>
          <AppIcon name="arrow" />
          <figure className="merge-output"><FateArtwork name={named(first)} /><figcaption><TierMark tier={3} /></figcaption></figure>
        </div>
        <div className="merge-explanation"><strong>First regular rewards ×3</strong><span>Second rewards discarded</span></div>
        <p className="sr-only">{named(first)} ({source(merge.firstId)}): T2 + T2 → T3. {named(second)} ({source(merge.consumedId)}) is consumed. Both input slots are used.</p>
      </div>
    })}
    <div className="invoke-final-step"><AppIcon name="check" /><strong>Then Confirm in game</strong></div>
  </div>
}

export function GainMark({ gain, label, provisional = false }: { gain: number | null; label: string; provisional?: boolean }) {
  const value = gain === null ? '?' : `${gain > 0 ? '+' : ''}${new Intl.NumberFormat('en', { maximumSignificantDigits: 5 }).format(gain)}`
  return <div className="candidate-gain" data-gain={gain === null ? 'unknown' : gain > 0 ? 'positive' : gain < 0 ? 'negative' : 'neutral'}>
    <strong>{value}</strong><span>{gain === null ? 'Unknown gain' : provisional ? `Known gain · ${label}` : gain === 0 ? 'No gain' : gain < 0 ? `${label} if used` : `${label} vs collection`}{provisional && <small>Total unresolved</small>}</span>
  </div>
}
