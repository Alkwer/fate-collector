import type { Offer } from '../../shared/schema'

export function OfferPreview({ offer, saved = false, automatic = false }: { offer: Offer; saved?: boolean; automatic?: boolean }) {
  return <section className="panel offer-preview" aria-labelledby="preview-heading">
    <div className="section-heading"><h2 id="preview-heading">Offered Fates</h2>{offer.cards.length > 0 && <span className="muted">{offer.cards.length} {offer.cards.length === 1 ? 'card' : 'cards'}</span>}</div>
    {offer.cards.length ? <>
      <ul className="fate-list">{offer.cards.map((card, index) => <li key={card.id}>
        <div className="fate-title"><h3>{card.name || `Unread card ${index + 1}`}</h3>{card.tier !== null && <span className="muted">Tier {card.tier}</span>}</div>
        {card.modifiers.length > 0 && <p>{card.modifiers.join(' ')}</p>}
        {card.rewards.some(reward => reward.identified) && <p className="detected-rewards">{card.rewards.filter(reward => reward.identified).map(reward => `${reward.count > 1 ? `${reward.count}× ` : ''}${reward.label}`).join(', ')}</p>}
      </li>)}</ul>
      <p className="preview-hint">{saved ? 'Spotted a misread? Open Edit details to correct it.' : 'Compare these cards with the image. Use Edit details only if something needs correcting.'}</p>
    </> : <div className="empty-offer"><h3>{offer.captureId ? saved ? 'Your capture is saved.' : 'Your capture is safe to save.' : 'Your Fates will appear here.'}</h3><p>{offer.captureId ? saved ? 'No cards were recognized. The image is preserved; you can add cards in Edit details later.' : 'No cards were recognized. Save the image for later, or open Edit details to add them.' : automatic ? 'Press F9 in game. Each capture appears here and saves automatically.' : 'Connect a captures folder, or import a capture. Known names and descriptions are filled in for you.'}</p></div>}
  </section>
}
