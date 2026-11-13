import { useEffect, useRef, useState } from 'react'
import type { Offer } from '../../shared/schema'
import { downloadArchive } from '../lib/imports'
import { replaceImportedOffer } from '../lib/storage'

export type ImportConflict = { local: Offer; incoming: Offer }
export function offerDifferences(local: Offer, incoming: Offer) {
  return (Object.keys(incoming) as (keyof Offer)[]).filter(key => !['revision', 'updatedAt'].includes(key) && JSON.stringify(local[key]) !== JSON.stringify(incoming[key]))
}
export function ImportConflicts({ conflicts, onUpdated, onClose }: { conflicts: ImportConflict[]; onUpdated: () => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [remaining, setRemaining] = useState(conflicts), [busy, setBusy] = useState(false), [problem, setProblem] = useState('')
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); return () => { if (previous instanceof HTMLElement) previous.focus() } }, [])
  const current = remaining[0]
  async function replace() {
    if (!current) return
    setBusy(true); setProblem('')
    try { await replaceImportedOffer(current.incoming, current.local); await onUpdated(); next() }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Replacement failed. Both copies are preserved.') }
    finally { setBusy(false) }
  }
  function next() { if (remaining.length === 1) onClose(); else setRemaining(rows => rows.slice(1)) }
  return <dialog ref={dialog} className="backup-dialog import-comparison" aria-labelledby="import-comparison-heading" onCancel={event => { if (busy) event.preventDefault() }} onClose={onClose}>
    <div className="dialog-heading"><h2 id="import-comparison-heading">Compare imported corrections</h2><button disabled={busy} onClick={onClose}>Keep all remaining local copies</button></div>
    {current && <><p>{remaining.length} offer(s) have different contents. Local revision {current.local.revision}; imported revision {current.incoming.revision}. A higher revision from another device does not automatically replace your edits.</p>
      <p>{current.local.cards.map(card => card.name || 'Unknown Fate').join(', ') || 'Unread capture'} · {new Date(current.local.capturedAt).toLocaleString()}</p>
      <div className="table-scroll"><table><thead><tr><th>Field</th><th>Local</th><th>Imported</th></tr></thead><tbody>{offerDifferences(current.local, current.incoming).map(key => <tr key={key}><th>{key}</th><td><pre>{JSON.stringify(current.local[key], null, 2)}</pre></td><td><pre>{JSON.stringify(current.incoming[key], null, 2)}</pre></td></tr>)}</tbody></table></div>
      <p>The local copy stays saved unless you choose the imported correction. Replacing creates a new revision and preserves the original in recovery data. Nothing is uploaded.</p>
      <div className="diagnostic-actions"><button disabled={busy} onClick={next}>Keep local copy</button><button disabled={busy} onClick={() => void replace()}>Use imported correction</button><button disabled={busy} onClick={() => downloadArchive([{ offer: current.incoming, evidence: null }], 'fate-imported-correction.json')}>Export imported offer data</button></div></>}
    {problem && <p role="alert">{problem}</p>}
  </dialog>
}
