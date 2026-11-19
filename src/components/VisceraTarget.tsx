import { useState } from 'react'
import type { PlanningFilters } from '../../shared/planning-filters'
import type { FateCard, Offer } from '../../shared/schema'
import { VISCERA_SOURCE_URL, VISCERA_TARGETS, getVisceraTarget, isVisceraSourceHere, resolveVisceraArea, visceraCompanion } from '../../shared/viscera-target'
import { VISCERA_COMPANION_PATCH_URL } from '../../shared/viscera'
import { PATCH_3300D_SOURCE } from '../../shared/patch-3300d-rewards'
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
  const companions = [
    ...(offerReady && offer ? offer.cards.flatMap(card => {
      const candidate = visceraCompanion(card, filters)
      return candidate ? [{ ...candidate, id: card.id, location: 'This offer' }] : []
    }) : []),
    ...collected.flatMap(card => {
      const candidate = visceraCompanion(card, filters)
      return candidate ? [{ ...candidate, id: card.id, location: 'Collected' }] : []
    }),
  ]

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
    {area?.id === 'MapWorldsAbomination' && <p className="hint">Only Nightmare of the Depraved Trinity receives Fate empowerment in Abomination. It can drop the full range of Fate rewards. <a href={PATCH_3300D_SOURCE} target="_blank" rel="noreferrer">GGG 3.30.0d</a></p>}
    {target && <>
      <p className="viscera-area" role="status">{!area ? 'Current area match unknown.' :
        sourcesHere?.length ? `Listed source in ${area.name}.` : `No listed source in ${area.name}.`}</p>
      <ul className="viscera-sources" aria-label="Listed Viscera sources">{target.sources.map((source, index) =>
        <li key={index}><strong>{source.boss}</strong> · {source.act && `Act ${source.act}, `}{source.area ?? 'Area unknown'}</li>
      )}</ul>
      <p className="hint"><a href={VISCERA_SOURCE_URL} target="_blank" rel="noreferrer">Viscera sources on PoEDB</a>{!storageError && ' · Target saved on this device.'}</p>
    </>}
    {companions.length > 0 && <div className="viscera-companions">
      <h4>Fates that spawn a companion boss</h4>
      <p className="hint">The companion is a random campaign boss without an Atlas equivalent. It always drops its own Viscera when killed. {target ? 'Your chance at this target depends on which boss spawns.' : 'Which Viscera drops depends on which boss spawns.'}</p>
      <ul>{companions.map(({ id, name, tier, location, excluded, reasons, warnings }) =>
        <li key={`${location}:${id}`}><strong>{name} · Tier {tier}</strong> · {location}{excluded && ' · Excluded by your settings'}
          {[...reasons, ...warnings].map(message => <p className="hint" key={message}>{message}</p>)}
        </li>
      )}</ul>
      <p className="hint"><a href={VISCERA_COMPANION_PATCH_URL} target="_blank" rel="noreferrer">GGG 3.30.0c</a></p>
    </div>}
  </section>
}
