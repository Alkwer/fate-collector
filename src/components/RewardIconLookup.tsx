import { useState } from 'react'
import type { Reward } from '../../shared/schema'
import { catalogFields, type CatalogReward } from '../../shared/reward-catalog'
import { iconGroupName, iconGroups, iconPath, matchingIconVariants, suggestedIconGroup, tooltipPhrases } from '../lib/reward-icon-lookup'

const differences = /(has a chance to drop|will drop|no \w+ modifiers?|\w+ modifier|(?:highly|greatly|massively|extremely) increased|valuable currency|maximum quality)/gi

export function RewardIconLookup({ reward, ocr, onApply }: {
  reward: Reward; ocr: string; onApply: (fields: Partial<Reward>) => void
}) {
  const [group, setGroup] = useState(() => suggestedIconGroup(reward.visualId))
  const [words, setWords] = useState('')
  const rows = matchingIconVariants(group, words)
  const phrases = group ? tooltipPhrases(ocr).filter(phrase => matchingIconVariants(group, phrase).length > 0) : []
  function apply(entry: CatalogReward) {
    onApply({ ...catalogFields(entry), tooltipConfirmed: true })
  }
  return <div className="reward-label icon-lookup">
    {!group ? <><p>Choose the icon shown on the card.</p><div className="icon-picker">{iconGroups.map(key =>
      <button type="button" key={key} onClick={() => { setGroup(key); setWords('') }}>
        <img src={iconPath(key)} alt="" width="28" height="28" />{iconGroupName(key)}
      </button>)}</div></> : <>
      <div className="icon-lookup-heading"><img src={iconPath(group)} width="32" height="32" alt="" /><strong>{iconGroupName(group)}</strong>
        <button type="button" className="text-button" onClick={() => { setGroup(''); setWords('') }}>Change icon</button></div>
      <label>Words in the tooltip<input type="search" value={words} maxLength={120} placeholder="For example, Speed" onChange={event => setWords(event.target.value)} /></label>
      {!!phrases.length && <label>Use words from this capture<select value="" onChange={event => setWords(event.target.value)}>
        <option value="">Choose matching OCR text</option>{phrases.map(phrase => <option key={phrase}>{phrase}</option>)}</select></label>}
      <p className="hint" role="status">{rows.length ? `${rows.length} matching PoEDB ${rows.length === 1 ? 'definition' : 'definitions'}. Check the full tooltip and any combo requirement.` : 'No matching definition. Clear the words or choose another icon.'}</p>
      <ul className="icon-variants">{rows.map(row => <li key={row.id}>
        <span>{row.description.split(differences).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part)}</span>
        {row.minLevel !== null && <small>Listed minimum level {row.minLevel}</small>}
        {row.matches.map(entry => <button type="button" className="text-button" key={entry.id} onClick={() => apply(entry)}>
          Apply checked tooltip · {entry.label} · {entry.kind === 'combo' ? `combo of ${entry.threshold}` : 'regular'}
        </button>)}
      </li>)}</ul>
    </>}
  </div>
}
