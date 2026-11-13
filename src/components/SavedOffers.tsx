import { DetailPanel } from './DetailPanel'
import { SharingConsent } from './SharingConsent'
import type { useSharingConsent } from '../lib/useSharingConsent'
import { useState } from 'react'
import type { SavedOffer, UnreadableOffer } from '../lib/storage'
import type { Offer } from '../../shared/schema'
import { submissionProblem } from '../../shared/offers'
import { AREA_CATEGORY_LABELS } from '../../shared/area-context'
import { StorageHealth } from './LocalRecovery'

interface Props { consentState: ReturnType<typeof useSharingConsent>; records: SavedOffer[]; unreadableOffers: UnreadableOffer[]; damagedEvidenceCount: number; isolatedCount: number; missingEvidenceIds: string[]; onRecovery: () => void; onIsolate: (key: IDBValidKey) => void; onImport: () => void; onRecoverBackup: () => void; busy: boolean; pendingOfferIds: string[]; onOpen: (id: string) => void; onDelete: (id: string) => void; onExport: (includeEvidence: boolean) => void; onShare: (offer: Offer) => void; accessKey: string; setAccessKey: (key: string) => void; connected: boolean; onCheckConnection: () => void }
export function SavedOffers({ consentState, records, unreadableOffers, damagedEvidenceCount, isolatedCount, missingEvidenceIds, onRecovery, onIsolate, onImport, onRecoverBackup, busy, pendingOfferIds, onOpen, onDelete, onExport, onShare, accessKey, setAccessKey, connected, onCheckConnection }: Props) {
  const [filter, setFilter] = useState('all')
  const [category, setCategory] = useState('all')
  const [includeEvidence, setIncludeEvidence] = useState(true)
  const [search, setSearch] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [review, setReview] = useState('all'), [sharing, setSharing] = useState('all'), [evidence, setEvidence] = useState('all')
  const visible = records.filter(r => {
    const day = new Date(r.offer.capturedAt).toISOString().slice(0, 10), missing = missingEvidenceIds.includes(r.offer.id) || !r.offer.captureId
    const shared = r.uploadedRevision === r.offer.revision && !consentState.records.some(item => item.id === r.uploadedConsentId && item.withdrawnAt)
    return (filter === 'all' || r.offer.origin === filter) && (!from || day >= from) && (!to || day <= to)
      && (category === 'all' || (r.offer.areaCategory ?? 'unknown') === category)
      && (review === 'all' || r.offer.reviewed === (review === 'reviewed')) && (sharing === 'all' || shared === (sharing === 'shared'))
      && (evidence === 'all' || missing === (evidence === 'missing'))
      && `${r.offer.area} ${r.offer.cards.map(card => card.name).join(' ')} ${r.offer.id}`.toLowerCase().includes(search.trim().toLowerCase())
  })
  return <>
    <StorageHealth />
    <DetailPanel className="archive-tools" title={<>Import, export & recovery</>}><div className="archive-tools-body">
      <div className="backup-controls"><label>Backup contents<select value={includeEvidence ? 'full' : 'data'} onChange={event => setIncludeEvidence(event.target.value === 'full')}><option value="full">Data, screenshots & OCR</option><option value="data">Offer data only</option></select></label><button className="outline-button" disabled={!records.length || busy} onClick={() => onExport(includeEvidence)}>{busy ? 'Working…' : 'Export all data'}</button></div>
      <div className="journal-import"><button disabled={busy} onClick={onImport}>Import backup parts</button><button disabled={busy} onClick={onRecoverBackup}>Recover readable backup entries</button><p className="hint">Select every part of a backup together. Recovery salvages readable offers from a damaged backup and preserves the original file.</p></div>
    </div></DetailPanel>
    {!!(unreadableOffers.length || damagedEvidenceCount || isolatedCount) && <section className="notice error recovery-notice" aria-label="Storage recovery"><div><strong>Some local records need recovery.</strong><p>{unreadableOffers.length} unreadable offer(s){damagedEvidenceCount ? ` and ${damagedEvidenceCount} damaged evidence record(s)` : ''}; {isolatedCount} isolated original(s). Readable offers remain available. The original records have been preserved.</p><p className="hint">Recovery exports contain raw local data and may include screenshots and OCR. Repair them before importing; they are separate from your normal backup. To repair damaged evidence, import its original helper capture.</p>{!!unreadableOffers.length && <DetailPanel title={<>Unreadable records</>}><ul>{unreadableOffers.map((entry, index) => <li key={index}><span className="mono">{String(entry.key)}</span>: {entry.problems.join(' ')} <button disabled={busy} onClick={() => onIsolate(entry.key)}>Isolate original</button></li>)}</ul></DetailPanel>}</div><button disabled={busy} onClick={onRecovery}>Export recovery data</button></section>}
    <section className="panel history-panel"><div className="section-heading"><h2>Saved offers <span className="muted">{records.length}</span></h2><label className="filter-label">Show<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All offers</option><option value="live">Live game</option><option value="test">Test / showcase</option></select></label></div>
      <div className="journal-search"><label>Search offers<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Fate, area or ID" /></label><DetailPanel className="filter-options" title={<>More filters{(category !== 'all' || from || to || review !== 'all' || sharing !== 'all' || evidence !== 'all') && <span className="summary-detail">Filters active</span>}</>}>      <div className="journal-filters"><label>Area category<select value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option>{Object.entries(AREA_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>From date (UTC)<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To date (UTC)<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label><label>Review<select value={review} onChange={e => setReview(e.target.value)}><option value="all">Any review state</option><option value="reviewed">Reviewed</option><option value="pending">Needs review</option></select></label><label>Sharing<select value={sharing} onChange={e => setSharing(e.target.value)}><option value="all">Any sharing state</option><option value="shared">Shared current revision</option><option value="pending">Not shared / changed</option></select></label><label>Evidence<select value={evidence} onChange={e => setEvidence(e.target.value)}><option value="all">Any evidence state</option><option value="available">Evidence stored</option><option value="missing">No stored evidence</option></select></label></div>
</DetailPanel></div>
      <p className="hint">Showing {visible.length} of {records.length} offers. Stored evidence may still need a recovery check when opened or exported.</p>
      {!visible.length ? <div className="history-empty"><h3>{records.length ? 'No matching offers.' : 'No offers here yet.'}</h3><p>{records.length ? 'Adjust the filters to see more offers.' : 'Import a helper capture or load an example in the collector, then save it.'}</p></div> : <div className="table-scroll"><table className="history-table"><thead><tr><th>Captured</th><th>Offer</th><th>Coverage</th><th>Sharing</th><th>Actions</th></tr></thead><tbody>{visible.map(({ offer, uploadedRevision, uploadedConsentId }) => {
        const pending = pendingOfferIds.includes(offer.id)
        const problem = pending ? 'Save your changes before sharing this offer.' : submissionProblem(offer)
        const withdrawn = consentState.records.some(record => record.id === uploadedConsentId && record.withdrawnAt)
        const uploaded = uploadedRevision === offer.revision && !withdrawn
        return <tr key={offer.id}><td><time dateTime={offer.capturedAt}>{new Date(offer.capturedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><span className="cell-sub">Revision {offer.revision}</span></td>
          <td><strong>{offer.cards.map(c => c.name || 'Unknown').join(', ') || 'Unread evidence'}</strong><span className="cell-sub area-context">{offer.origin === 'test' ? 'Test / showcase' : 'Live game'} · {AREA_CATEGORY_LABELS[offer.areaCategory ?? 'unknown']} · {offer.area || 'Area unknown'}</span></td>
          <td>{offer.completeness}<span className="cell-sub">{offer.reviewed ? 'Reviewed' : 'Needs review'}</span></td><td>{pending ? 'Unsaved changes' : withdrawn ? 'Consent withdrawn' : uploaded ? 'Shared' : uploadedRevision ? 'Updated locally' : 'Not shared'}</td>
          <td><div className="row-actions"><button onClick={() => onOpen(offer.id)} disabled={busy}>Open</button><button onClick={() => onShare(offer)} disabled={busy || !!problem || uploaded || !connected || !accessKey.trim() || !consentState.active} title={problem || (!connected ? 'Collection is not configured.' : !accessKey.trim() ? 'Enter a collection access key below.' : !consentState.active ? 'Accept data sharing below first.' : '')}>Share</button><button className="text-button danger" onClick={() => onDelete(offer.id)} disabled={busy}>Delete</button></div></td>
        </tr>
      })}</tbody></table></div>}
      <p className="hint">Sharing status applies to reviewed offers. Check raw OCR uploads in the helper's settings. Full backups include available local screenshots and OCR; download every part. Offer-data backups omit that evidence.</p>
    </section>
    <DetailPanel className="panel sharing-panel" title={<>Shared research collection <span className="muted">{connected ? consentState.active ? 'Consent active · manage below' : 'Consent required' : 'Not connected'}</span></>}>
      <p>Share sends this reviewed offer to the collection. Screenshots are not uploaded. The Windows helper can upload raw OCR separately when enabled; this list shows reviewed sharing only. Local edits are not uploaded automatically.</p>
      <div className="access-controls"><label>Collection access key<input type="password" autoComplete="off" value={accessKey} maxLength={1024} placeholder="Provided by the collection owner" onChange={e => setAccessKey(e.target.value)} /></label><button onClick={onCheckConnection}>Check connection</button>{accessKey && <button className="text-button" onClick={() => setAccessKey('')}>Forget key</button>}</div>
      <SharingConsent accessKey={accessKey} {...consentState} />
      <p className="hint">The key stays in memory and is cleared on reload. This first version uses a private collection key; it is not a public anonymous ingestion service.</p>
    </DetailPanel>
  </>
}
