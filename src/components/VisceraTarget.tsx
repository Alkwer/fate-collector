import { useState } from 'react'
import type { PlanningFilters } from '../../shared/planning-filters'
import type { FateCard, Offer } from '../../shared/schema'
import { VISCERA_SOURCE_URL, VISCERA_TARGETS, getVisceraTarget, isVisceraSourceHere, resolveVisceraArea, visceraCompanion } from '../../shared/viscera-target'
import './VisceraTarget.css'

const storageKey = 'fate-collector.viscera-target'

function readTarget() {
  try { return getVisceraTarget(window.localStorage.getItem(storageKey))?.id ?? '' }
  catch { return '' }
}

export function VisceraTarget({ offer, collected, filters = {}, offerReady = false }: {
  offer: Offer | null
  collected: FateCard[]
  filters?: PlanningFilters
  offerReady?: boolean
}) {
  const [targetId, setTargetId] = useState(readTarget)
  const [storageError, setStorageError] = useState(false)
  const target = getVisceraTarget(targetId)
  const area = resolveVisceraArea(offer)
  const sourcesHere = target?.sources.filter(source => isVisceraSourceHere(source, area))
  const companions = target ? [
    ...(offerReady && offer ? offer.cards.flatMap(card => {
      const candidate = visceraCompanion(card, filters, offer.reviewed)
      return candidate ? [{ ...candidate, id: card.id, location: 'This offer' }] : []
    }) : []),
    ...collected.flatMap(card => {
      const candidate = visceraCompanion(card, filters, !!offer?.reviewed && offer.cards.some(entry => entry.id === card.id && entry.name === card.name && entry.tier === card.tier))
      return candidate ? [{ ...candidate, id: card.id, location: 'Collected' }] : []
    }),
  ] : []

  function changeTarget(id: string) {
    setTargetId(id)
    try {
      if (id) window.localStorage.setItem(storageKey, id)
      else window.localStorage.removeItem(storageKey)
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }

  return <section className="viscera-target" aria-label="Viscera farming target">
    <label>Viscera target
      <select value={targetId} onChange={event => changeTarget(event.target.value)}>
        <option value="">No target selected</option>
        {VISCERA_TARGETS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    {storageError && <p className="hint" role="status">Target storage is unavailable. Your choice may reset when you reload.</p>}
    {target && <>
      <p className="viscera-area" role="status">{!area ? 'Current area match unknown.' :
        sourcesHere?.length ? `Listed source in ${area.name}.` : `No listed source in ${area.name}.`}</p>
      <ul className="viscera-sources" aria-label="Listed Viscera sources">{target.sources.map((source, index) =>
        <li key={index}><strong>{source.boss}</strong> · {source.act && `Act ${source.act}, `}{source.area ?? 'Area unknown'}</li>
      )}</ul>
      <p className="hint"><a href={VISCERA_SOURCE_URL} target="_blank" rel="noreferrer">Viscera sources on PoEDB</a>{!storageError && ' · Target saved on this device.'}</p>
      {companions.length > 0 && <div className="viscera-companions">
        <h4>Companion boss</h4>
        <p className="hint">Adds a random campaign boss from a pool without Atlas equivalents. It inherits the other invoked Fates and may drop its own Viscera. Target availability and drop odds are unknown.</p>
        <ul>{companions.map(({ id, name, location, excluded, reasons, warnings }) =>
          <li key={`${location}:${id}`}><strong>{name} · Tier 3</strong> · {location}{excluded && ' · Excluded by your settings'}
            {[...reasons, ...warnings].map(message => <p className="hint" key={message}>{message}</p>)}
          </li>
        )}</ul>
        <p className="hint"><a href="https://poedb.tw/us/Fates" target="_blank" rel="noreferrer">Companion Fate effects on PoEDB</a></p>
      </div>}
    </>}
  </section>
}
