import { useState } from 'react'
import { getCurrentRewardReferences } from '../../shared/poedb-catalog'
import { PATCH_3300C_SOURCE } from '../../shared/patch-3300c-rewards'
import { DetailPanel } from './DetailPanel'

export function RewardReferences() {
  const [query, setQuery] = useState('')
  const matches = query.trim() ? getCurrentRewardReferences(query) : []
  return <DetailPanel className="reward-references" title="Reward references" triggerLabel="Search reward references">
    <p>Find reward effects for 3.30.0c. Check the in-game tooltip for the reward kind and any required copies.</p>
    <label>Search reward effects<input type="search" value={query} maxLength={120} placeholder="For example: currency, boots, gem" onChange={event => setQuery(event.target.value)} /></label>
    <p className="hint" role="status">{!query.trim() ? 'Enter an item or effect to search.' : !matches.length ? 'No matching definition. Keep the reward unknown if its tooltip is missing.' : `${matches.length} matching ${matches.length === 1 ? 'definition' : 'definitions'}${matches.length === 30 ? ' shown; narrow your search for more specific results' : ''}.`}</p>
    <ul className="reference-results">{matches.map(entry => <li key={entry.id}>
      <p>{entry.description}</p>
      {entry.sourceId === 'ggg-3-30-0c' && <a href={PATCH_3300C_SOURCE} target="_blank" rel="noreferrer">GGG 3.30.0c patch notes</a>}
      {entry.minLevel !== null && <p className="hint">Listed minimum area level: {entry.minLevel}. Confirm availability in game.</p>}
    </li>)}</ul>
    <p><a href="https://poedb.tw/us/Fates#Rewards" target="_blank" rel="noreferrer">PoEDB reward definitions</a></p>
  </DetailPanel>
}
