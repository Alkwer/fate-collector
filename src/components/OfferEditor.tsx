import { useEffect, useState } from 'react'
import type { FateCard, Offer, Reward } from '../../shared/schema'
import { newCard, newReward } from '../../shared/offers'
import { KNOWN_FATE_NAMES } from '../../shared/recognition'

interface Props { offer: Offer; onChange: (patch: Partial<Offer>) => void }
export function OfferEditor({ offer, onChange }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = offer.cards.find(c => c.id === selectedId) ?? offer.cards[0]
  useEffect(() => { setSelectedId(null) }, [offer.id])
  function updateCard(patch: Partial<FateCard>) {
    if (selected) onChange({ cards: offer.cards.map(c => c.id === selected.id ? { ...c, ...patch } : c) })
  }
  function updateReward(id: string, patch: Partial<Reward>) {
    if (selected) updateCard({ rewards: selected.rewards.map(r => r.id === id ? { ...r, ...patch } : r) })
  }
  function addCard() { const card = newCard(); onChange({ cards: [...offer.cards, card] }); setSelectedId(card.id) }
  return <section className="panel editor-panel" aria-labelledby="offers-heading">
    <div className="section-heading"><h2 id="offers-heading">Correct cards</h2><button className="text-button" onClick={addCard} disabled={offer.cards.length >= 30}>Add card</button></div>
    {!offer.cards.length ? <div className="empty-offer"><span className="empty-number">01</span><h3>Start with a capture.</h3><p>A helper capture fills known card names and descriptions. You can save unreadable evidence now and review it later.</p><button className="text-button" onClick={addCard}>Or add a card manually</button></div> : <>
      <div className="table-scroll"><table className="cards-table"><thead><tr><th>Name</th><th>Tier</th><th>Rewards</th><th>Choice</th></tr></thead><tbody>{offer.cards.map((card, index) => <tr key={card.id} className={card.id === selected?.id ? 'selected' : ''}>
        <td><button className="card-name" onClick={() => setSelectedId(card.id)} aria-pressed={card.id === selected?.id}>{card.name || `Unnamed card ${index + 1}`}</button></td>
        <td>{card.tier ?? <span className="muted">—</span>}</td>
        <td className="reward-summary">{card.rewards.length ? card.rewards.map(r => r.identified ? `${r.count > 1 ? `${r.count}× ` : ''}${r.label}` : 'Unidentified').join(', ') : <span className="muted">Not read</span>}</td>
        <td><input type="radio" name="chosen-card" aria-label={`Chosen ${card.name || `card ${index + 1}`}`} checked={offer.selectedCardId === card.id} onChange={() => onChange({ selectedCardId: card.id })} /></td>
      </tr>)}</tbody></table></div>
      <div className="table-footnote"><span>Click a card to correct it. Choice is optional.</span>{offer.selectedCardId && <button className="text-button" onClick={() => onChange({ selectedCardId: null })}>Clear choice</button>}</div>
      {selected && <div className="card-editor" key={selected.id}>
        <div className="card-fields"><label>Fate name<input value={selected.name} list="fate-names" maxLength={160} placeholder="Unreadable / unknown" onChange={e => updateCard({ name: e.target.value })} /></label>
          <label>Tier<input type="number" min={1} max={100} value={selected.tier ?? ''} placeholder="Unknown" onChange={e => updateCard({ tier: e.target.value ? Number(e.target.value) : null })} /></label></div>
        <datalist id="fate-names">{KNOWN_FATE_NAMES.map(name => <option key={name} value={name} />)}</datalist>
        <details className="card-details"><summary>Modifiers & rewards <span className="muted">Optional corrections</span></summary>
          <label>Modifiers<textarea rows={3} maxLength={12000} value={selected.modifiers.join('\n')} placeholder="One visible modifier per line" onChange={e => updateCard({ modifiers: e.target.value.split('\n') })} /></label>
          <div className="section-heading reward-heading"><h3>Rewards</h3><button className="text-button" disabled={selected.rewards.length >= 30} onClick={() => updateCard({ rewards: [...selected.rewards, newReward()] })}>Add reward</button></div>
          <p className="hint">Keep unknown icons unidentified. An empty list means rewards were not read, not that the card has no rewards.</p>
          {selected.rewards.map((reward, index) => <fieldset className="reward-editor" key={reward.id}><legend>Reward {index + 1}</legend>
            <label className="reward-label">Label<input value={reward.label} maxLength={160} placeholder="Unidentified icon" onChange={e => updateReward(reward.id, { label: e.target.value, identified: e.target.value.trim() ? reward.identified : false })} /></label>
            <label>Kind<select value={reward.kind} onChange={e => updateReward(reward.id, { kind: e.target.value as Reward['kind'] })}><option value="unknown">Unknown</option><option value="regular">Regular</option><option value="combo">Combo</option></select></label>
            <label>Count<input type="number" min={1} max={100} value={reward.count} onChange={e => updateReward(reward.id, { count: Number(e.target.value) })} /></label>
            <label>Combo threshold<input type="number" min={1} max={100} value={reward.threshold ?? ''} placeholder="Unknown" onChange={e => updateReward(reward.id, { threshold: e.target.value ? Number(e.target.value) : null })} /></label>
            <label className="checkbox-row"><input type="checkbox" checked={reward.identified} disabled={!reward.label.trim()} onChange={e => updateReward(reward.id, { identified: e.target.checked })} />Identified</label>
            <button className="text-button danger" onClick={() => updateCard({ rewards: selected.rewards.filter(r => r.id !== reward.id) })}>Remove reward</button>
          </fieldset>)}
        </details>
        <button className="text-button danger remove-card" onClick={() => {
          onChange({ cards: offer.cards.filter(c => c.id !== selected.id), selectedCardId: offer.selectedCardId === selected.id ? null : offer.selectedCardId, completeness: 'unverified' })
        }}>Remove card</button>
      </div>}
    </>}
  </section>
}
