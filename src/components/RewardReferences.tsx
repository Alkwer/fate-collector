import { useState } from 'react'
import { getPoedbRewardReferences, POEDB_CATALOG } from '../../shared/poedb-catalog'
import { DetailPanel } from './DetailPanel'

export function RewardReferences() {
  const [query, setQuery] = useState('')
  const matches = query.trim() ? getPoedbRewardReferences(query) : []
  return <DetailPanel className="reward-references" title="Reward references" triggerLabel="Search reward references">
    <p>Search possible reward effects from PoEDB. These definitions do not establish the reward kind or combo threshold. Check the complete tooltip in game before entering a reward.</p>
    <p className="hint">{POEDB_CATALOG.gameVersion} · checked {POEDB_CATALOG.checkedAt}. Your recorded rewards stay unchanged.</p>
    <label>Search reward effects<input type="search" value={query} maxLength={120} placeholder="For example: currency, boots, gem" onChange={event => setQuery(event.target.value)} /></label>
    <p className="hint" role="status">{!query.trim() ? 'Enter an item or effect to search.' : !matches.length ? 'No matching definition. Keep the reward unknown if its tooltip is missing.' : `${matches.length} matching ${matches.length === 1 ? 'definition' : 'definitions'}${matches.length === 30 ? ' shown; narrow your search for more specific results' : ''}.`}</p>
    <ul className="reference-results">{matches.map(entry => <li key={entry.id}>
      <p>{entry.description}</p>
      {entry.minLevel !== null && <p className="hint">Listed minimum area level: {entry.minLevel}. Confirm availability in game.</p>}
    </li>)}</ul>
    <p><a href="https://poedb.tw/us/Fates#Rewards" target="_blank" rel="noreferrer">PoEDB reward definitions</a></p>
  </DetailPanel>
}
