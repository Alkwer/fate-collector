import { SharingConsent } from './SharingConsent'
import type { useSharingConsent } from '../lib/useSharingConsent'
import { useState } from 'react'
import type { SavedOffer } from '../lib/storage'
import type { Offer } from '../../shared/schema'
import { submissionProblem } from '../../shared/offers'

interface Props { consentState: ReturnType<typeof useSharingConsent>; records: SavedOffer[]; busy: boolean; pendingOfferId: string | null; onOpen: (id: string) => void; onDelete: (id: string) => void; onExport: () => void; onShare: (offer: Offer) => void; accessKey: string; setAccessKey: (key: string) => void; connected: boolean; onCheckConnection: () => void }
export function SavedOffers({ consentState, records, busy, pendingOfferId, onOpen, onDelete, onExport, onShare, accessKey, setAccessKey, connected, onCheckConnection }: Props) {
  const [filter, setFilter] = useState('all')
  const visible = records.filter(r => filter === 'all' || r.offer.origin === filter)
  return <>
    <div className="page-heading"><div><h1>Your observation journal.</h1><p>Local evidence first. Share only what you have reviewed.</p></div><button className="outline-button" disabled={!records.length || busy} onClick={onExport}>Export all data</button></div>
    <section className="panel history-panel"><div className="section-heading"><h2>Saved offers <span className="muted">{records.length}</span></h2><label className="filter-label">Show<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All offers</option><option value="live">Live game</option><option value="test">Test / showcase</option></select></label></div>
      {!visible.length ? <div className="history-empty"><h3>No offers here yet.</h3><p>Import a helper capture or load an example in the collector, then save it.</p></div> : <div className="table-scroll"><table className="history-table"><thead><tr><th>Captured</th><th>Offer</th><th>Coverage</th><th>Sharing</th><th>Actions</th></tr></thead><tbody>{visible.map(({ offer, uploadedRevision, uploadedConsentId }) => {
        const pending = pendingOfferId === offer.id
        const problem = pending ? 'Save your changes before sharing this offer.' : submissionProblem(offer)
        const withdrawn = consentState.records.some(record => record.id === uploadedConsentId && record.withdrawnAt)
        const uploaded = uploadedRevision === offer.revision && !withdrawn
        return <tr key={offer.id}><td><time dateTime={offer.capturedAt}>{new Date(offer.capturedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><span className="cell-sub">Revision {offer.revision}</span></td>
          <td><strong>{offer.cards.map(c => c.name || 'Unknown').join(', ') || 'Unread evidence'}</strong><span className="cell-sub">{offer.origin === 'test' ? 'Test / showcase' : 'Live game'} · {offer.area || 'Area unknown'}</span></td>
          <td>{offer.completeness}<span className="cell-sub">{offer.reviewed ? 'Reviewed' : 'Needs review'}</span></td><td>{pending ? 'Unsaved changes' : withdrawn ? 'Consent withdrawn' : uploaded ? 'Shared' : uploadedRevision ? 'Updated locally' : 'Not shared'}</td>
          <td><div className="row-actions"><button onClick={() => onOpen(offer.id)} disabled={busy}>Open</button><button onClick={() => onShare(offer)} disabled={busy || !!problem || uploaded || !connected || !accessKey.trim() || !consentState.active} title={problem || (!connected ? 'Collection is not configured.' : !accessKey.trim() ? 'Enter a collection access key below.' : !consentState.active ? 'Accept data sharing below first.' : '')}>Share</button><button className="text-button danger" onClick={() => onDelete(offer.id)} disabled={busy}>Delete</button></div></td>
        </tr>
      })}</tbody></table></div>}
      <p className="hint">Sharing status applies to reviewed offers. Check raw OCR uploads in the helper's settings. Exports from this list contain offer data only; open an offer to export its local screenshot and OCR.</p>
    </section>
    <details className="panel sharing-panel" open><summary>Shared research collection <span className="muted">{connected ? consentState.active ? 'Consent active · manage below' : 'Consent required' : 'Not connected'}</span></summary>
      <p>Share sends this reviewed offer to the collection. Screenshots are not uploaded. The Windows helper can upload raw OCR separately when enabled; this list shows reviewed sharing only. Local edits are not uploaded automatically.</p>
      <div className="access-controls"><label>Collection access key<input type="password" autoComplete="off" value={accessKey} maxLength={1024} placeholder="Provided by the collection owner" onChange={e => setAccessKey(e.target.value)} /></label><button onClick={onCheckConnection}>Check connection</button>{accessKey && <button className="text-button" onClick={() => setAccessKey('')}>Forget key</button>}</div>
      <SharingConsent accessKey={accessKey} {...consentState} />
      <p className="hint">The key stays in memory and is cleared on reload. This first version uses a private collection key; it is not a public anonymous ingestion service.</p>
    </details>
  </>
}
