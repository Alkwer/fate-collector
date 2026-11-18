import { useRef, useState } from 'react'
import type { InvocationLimit } from '../../shared/advisor'
import type { FateCard } from '../../shared/schema'
import { DetailPanel, type DetailPanelHandle } from './DetailPanel'

export function RecordInvocation({ cards, limit, onRecord }: { limit: InvocationLimit; cards: FateCard[]; onRecord: (plan: { cardIds: string[] }) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const panel = useRef<DetailPanelHandle>(null)
  const ids = selected.filter(id => cards.some(card => card.id === id))
  if (!cards.length) return null
  return <DetailPanel ref={panel} className="record-invocation" title="Record an invocation already done" triggerLabel="Record a different invocation" onOpenChange={() => setSelected([])}>
    <p>Select the original Fates you used, including both inputs of a merge. This records your action; it does not recommend a plan or control the game.</p>
    {cards.map((card, index) => <label className="checkbox-row" key={card.id}><input type="checkbox" checked={ids.includes(card.id)} disabled={!ids.includes(card.id) && ids.length >= limit} onChange={event => setSelected(event.target.checked ? [...ids, card.id] : ids.filter(id => id !== card.id))} />{index + 1}. {card.name || 'Unnamed Fate'} · Tier {card.tier ?? '?'}</label>)}
    <button disabled={!ids.length || ids.length > limit} onClick={() => { onRecord({ cardIds: ids }); panel.current?.close() }}>Record used Fates</button>
    <p className="hint">Removes these cards from your local collection. Undo is available.</p>
  </DetailPanel>
}
