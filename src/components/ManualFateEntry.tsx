import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { cardSchema, type FateCard } from '../../shared/schema'
import { newCard } from '../../shared/offers'
import { KNOWN_FATE_NAMES } from '../../shared/recognition'
import type { RewardDefinition } from '../lib/solver-settings'
import { DetailPanel, type DetailPanelHandle } from './DetailPanel'
import { FateArtwork } from './DecisionVisuals'
import { ManualRewards } from './ManualRewards'
import '../manual-entry.css'

interface Props {
  panelRef: Ref<DetailPanelHandle>
  offerId: string
  cardCount: number
  nextOffer: boolean
  busy: boolean
  definitions: RewardDefinition[]
  onAdd: (card: FateCard) => boolean
  onDone: () => void
}

export function ManualFateEntry({ panelRef, offerId, cardCount, nextOffer, busy, definitions, onAdd, onDone }: Props) {
  const formId = useId()
  const [card, setCard] = useState(newCard)
  const [query, setQuery] = useState('')
  const [choosing, setChoosing] = useState(true)
  const [message, setMessage] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const limitReached = !nextOffer && cardCount >= 30
  const matches = KNOWN_FATE_NAMES.filter(name => name.toLowerCase().includes(query.trim().toLowerCase()))
  const valid = !!card.name.trim() && cardSchema.safeParse(card).success

  useEffect(() => {
    setCard(newCard()); setQuery(''); setChoosing(true); setMessage('')
  }, [offerId])

  function choose(name: string) {
    setCard(current => ({ ...current, name }))
    setChoosing(false)
    requestAnimationFrame(() => nameInput.current?.focus())
  }
  function submit(another: boolean) {
    if (busy || limitReached || !valid || !onAdd({ ...card, name: card.name.trim() })) return
    setMessage(`${card.name.trim()} added to the offer.`)
    setCard(newCard()); setQuery(''); setChoosing(true)
    if (another) requestAnimationFrame(() => search.current?.focus())
    else onDone()
  }

  return <DetailPanel ref={panelRef} trigger={false} className="manual-fate-entry" title="Add Fate manually"
    footer={<>
      {!choosing && <button type="submit" form={formId} name="another" disabled={busy || limitReached || !valid}>Add & enter another</button>}
      {choosing ? <button type="button" onClick={onDone}>Back to offer</button>
        : <button className="primary-button" type="submit" form={formId} disabled={busy || limitReached || !valid}>Add to offer</button>}
    </>}>
    <p className="manual-entry-context">{nextOffer ? 'Your previous choice is recorded. Start the next offer.'
      : cardCount ? `${cardCount} ${cardCount === 1 ? 'Fate' : 'Fates'} in this offer. Add the other choices shown in game.`
      : 'Enter the choices shown in game. No helper or screenshot needed.'}</p>
    {message && <p className="manual-entry-status" role="status">{message}</p>}
    {limitReached && <p className="field-error" role="alert">This offer has 30 cards. Remove a card in Edit offer, or start a new offer from More actions.</p>}
    {choosing ? <div className="manual-fate-picker">
      <label>Find a Fate<input ref={search} type="search" maxLength={160} value={query} placeholder="Search by name" onChange={event => setQuery(event.target.value)} /></label>
      <div className="manual-fate-options" aria-label="Fate names">
        {matches.map(name => <button key={name} type="button" aria-label={`Choose ${name}`} disabled={busy || limitReached} onClick={() => choose(name)}>
          <FateArtwork name={name} /><span>{name}</span>
        </button>)}
      </div>
      {!matches.length && <p className="hint">No matching Fate. You can enter the name as shown in game.</p>}
      <button className="text-button manual-custom-name" type="button" disabled={busy || limitReached} onClick={() => choose(query.trim())}>{query.trim() ? `Use a different name: ${query.trim()}` : 'Enter a different name'}</button>
    </div> : <form id={formId} className="manual-fate-form" onSubmit={event => {
      event.preventDefault()
      submit((event.nativeEvent as SubmitEvent).submitter?.getAttribute('name') === 'another')
    }}>
      <div className="manual-fate-identity">
        <FateArtwork name={card.name} />
        <div><label>Fate name<input ref={nameInput} required maxLength={160} value={card.name} onChange={event => setCard({ ...card, name: event.target.value })} /></label>
          <button className="text-button" type="button" onClick={() => { setChoosing(true); requestAnimationFrame(() => search.current?.focus()) }}>Change Fate</button>
        </div>
      </div>
      <div className="manual-tier">
        <label>Tier<input type="number" min={1} max={100} step={1} placeholder="Unknown" value={card.tier ?? ''} onChange={event => setCard({ ...card, tier: event.target.value ? Number(event.target.value) : null })} /></label>
        <div role="group" aria-label="Quick tier selection">{[1, 2, 3].map(tier => <button type="button" key={tier} aria-pressed={card.tier === tier} onClick={() => setCard({ ...card, tier })}>Tier {tier}</button>)}</div>
      </div>
      <ManualRewards rewards={card.rewards} definitions={definitions} onChange={rewards => setCard({ ...card, rewards })} />
      <p className="hint">You can add modifiers and correct details later in Edit offer.</p>
      {!valid && card.name.trim() && <p className="field-error" role="alert">Use whole numbers from 1 to 100. Tier and combo threshold can be left blank if unknown.</p>}
    </form>}
  </DetailPanel>
}
