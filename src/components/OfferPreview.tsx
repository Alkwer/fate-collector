import type { ReactNode } from 'react'
import type { FateCard, Offer } from '../../shared/schema'
import { VISUAL_LABELS } from '../../shared/visual-suggestions'
import { RewardStrip, TierMark } from './DecisionVisuals'
import { DetailPanel } from './DetailPanel'
import { AppIcon } from './AppIcon'

export function OfferPreview({ offer, saved = false, automatic = false, embedded = false, highlightedCardIds, provisional = false, renderAdvice }: { offer: Offer; saved?: boolean; automatic?: boolean; embedded?: boolean; highlightedCardIds?: string[]; provisional?: boolean; renderAdvice?: (card: FateCard) => ReactNode }) {
  const sequence = offer.captureContext?.session?.sequence
  const possibleRepeat = Boolean(offer.captureContext?.possibleDuplicate)
  return <section className={`${embedded ? 'visual-offer ' : 'panel '}offer-preview`} aria-labelledby="preview-heading">
    <div className="section-heading"><h2 id="preview-heading">Offered Fates</h2>{offer.cards.length > 0 && <span className="muted">{offer.cards.length} {offer.cards.length === 1 ? 'card' : 'cards'}</span>}</div>
    {(sequence !== undefined || possibleRepeat) && <p className="hint">
      {sequence !== undefined ? `Session capture #${sequence}` : ''}{sequence !== undefined && possibleRepeat ? ' · ' : ''}{possibleRepeat ? 'Possible repeat (matching OCR)' : ''}
    </p>}
    {offer.cards.length ? <>
      <ul className="fate-list">{offer.cards.map((card, index) => <li key={card.id} className={highlightedCardIds?.includes(card.id) ? `recommended-fate${provisional ? ' provisional-fate' : ''}` : undefined}>
        {highlightedCardIds?.includes(card.id) && <p className="recommendation-label"><AppIcon name={provisional ? 'warning' : 'check'} />{provisional ? 'Provisional match' : highlightedCardIds.length > 1 ? 'Equal best match' : 'Best match'}</p>}
        <div className="fate-title"><h3>{card.name || `Unread card ${index + 1}`}</h3>{embedded ? <TierMark tier={card.tier} suggested={!!card.visualReview && !card.visualReview.tierReviewed} /> : card.tier !== null && <span className="muted">Tier {card.tier}{card.visualReview && !card.visualReview.tierReviewed ? ' · suggested' : ''}</span>}</div>
        {embedded ? <>
          <RewardStrip rewards={card.rewards} suggested={!!card.visualReview && !card.visualReview.rewardsReviewed} />
          {!!card.modifiers.length && <DetailPanel className="fate-modifiers" title={`${card.name || 'Unread card'} · modifiers`} triggerLabel={<><AppIcon name="shield" />Modifiers ({card.modifiers.length})</>}><ul>{card.modifiers.map((modifier, index) => <li key={index}>{modifier}</li>)}</ul></DetailPanel>}
        </> : <>
          {card.modifiers.length > 0 && <p>{card.modifiers.join(' ')}</p>}
          {card.rewards.some(reward => reward.identified) && <p className="detected-rewards">{card.rewards.filter(reward => reward.identified).map(reward => `${reward.count > 1 ? `${reward.count}× ` : ''}${reward.label}`).join(', ')}{card.visualReview && !card.visualReview.rewardsReviewed ? ' · suggested; check the full reward row' : ''}</p>}
          {card.rewards.some(reward => reward.visualId && !reward.identified) && <p>Suggested icons: {card.rewards.filter(reward => reward.visualId && !reward.identified).map(reward => reward.label === VISUAL_LABELS[reward.visualId!] ? reward.label : `${reward.label} (${VISUAL_LABELS[reward.visualId!]}; ${reward.kind === 'unknown' ? 'kind unknown' : 'unidentified'})`).join(', ')}. Meanings need review.</p>}
        </>}
        {renderAdvice?.(card)}
      </li>)}</ul>
      {!embedded && <p className="preview-hint">{saved ? 'Spotted a misread? Open Edit details to correct it.' : 'Compare these cards with the image. Use Edit details only if something needs correcting.'}</p>}
    </> : <div className="empty-offer"><h3>{offer.captureId ? saved ? 'Your capture is saved.' : 'Your capture is safe to save.' : 'Your Fates will appear here.'}</h3><p>{offer.captureId ? saved ? 'No cards were recognized. The image is preserved; you can add cards in Edit details later.' : 'No cards were recognized. Save the image for later, or open Edit details to add them.' : automatic ? 'Press F9 in game. Each capture appears here and saves automatically.' : 'Connect a captures folder, or import a capture. Known names and descriptions are filled in for you.'}</p></div>}
  </section>
}
