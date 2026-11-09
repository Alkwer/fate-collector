import { useRef } from 'react'
import type { Evidence, Offer } from '../../shared/schema'
import { hasNewerHelper, HELPER_VERSION } from '../lib/helper-version'

interface Props { evidence: Evidence | null; automatic?: boolean; onPick: () => void; onFile: (file: File) => void }
export function SourcePanel({ evidence, automatic = false, onPick, onFile }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  return <section className="panel source-panel" aria-labelledby="source-heading">
    <h2 id="source-heading">Your capture</h2>
    {hasNewerHelper(evidence?.helperVersion) && <aside className="helper-update" aria-label="Windows helper update">
      <strong>Newer Windows helper available</strong>
      <p>This capture used version {evidence?.helperVersion}.</p>
      <a href="/downloads/fate-collector-helper.zip" download>Download helper {HELPER_VERSION}</a>
      <details><summary>What's new and how to update</summary>
        <p>Safer capture around overlapping windows, recovery of damaged upload state and faster checks of large capture folders.</p>
        <p>Exit the running helper, replace its program files and start it again. Keep your captures and fate-collector.ini.</p>
      </details>
    </aside>}
    <div className={`dropzone ${evidence ? 'has-image' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) onFile(file)
    }}>
      {evidence ? <>
        <button className="evidence-button" onClick={() => dialog.current?.showModal()} aria-label="Enlarge source screenshot"><img src={evidence.imageDataUrl} alt="Captured Fate offer" /></button>
        <div className="evidence-caption"><span>Select image to enlarge</span><button className="text-button" onClick={onPick}>Replace</button></div>
      </> : <>
        <svg className="upload-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M16 22V4m-7 7 7-7 7 7M5 20v7h22v-7" /></svg>
        <strong>{automatic ? 'Waiting for your next F9 capture' : 'Paste your capture with Ctrl+V'}</strong><p>{automatic ? 'Keep the whole Fate offer visible in game.' : 'Or drop a helper file or screenshot here'}</p>{!automatic && <button className="outline-button" onClick={onPick}>Import capture</button>}
      </>}
    </div>
    <dialog ref={dialog} className="evidence-dialog" aria-labelledby="evidence-heading"><div className="dialog-heading"><h2 id="evidence-heading">Source evidence</h2><button onClick={() => dialog.current?.close()}>Close</button></div>{evidence && <img src={evidence.imageDataUrl} alt="Full size source evidence" />}</dialog>
  </section>
}

interface DetailsProps { evidence: Evidence | null; offer: Offer; onChange: (patch: Partial<Offer>) => void }
export function CaptureDetails({ evidence, offer, onChange }: DetailsProps) {
  return <section className="panel" aria-labelledby="details-heading">
    <h2 id="details-heading">Capture details</h2>
    <div className="review-controls"><label>Review status<select value={offer.reviewed ? offer.completeness : 'unverified'} onChange={event => {
      const completeness = event.target.value as Offer['completeness']
      onChange({ completeness, reviewed: completeness !== 'unverified' })
    }}><option value="unverified">Not checked yet</option><option value="partial">Checked — some offered cards are missing</option><option value="complete">Checked — all offered cards are included</option></select></label></div>
    <details className="disclosure"><summary>Original OCR text</summary>
      <p className="hint">This is the original local OCR evidence. Card edits do not alter it.</p>
      <pre className="ocr-text">{evidence?.ocrText || 'No OCR text available. The Windows helper reads text locally; a plain screenshot is preserved without automatic recognition.'}</pre>
    </details>
      <div className="context-fields">
        <label>Game version<input value={offer.gameVersion} maxLength={64} onChange={e => onChange({ gameVersion: e.target.value })} /></label>
        <label>Area<input value={offer.area} maxLength={160} placeholder="Unknown" onChange={e => onChange({ area: e.target.value })} /></label>
        <label>Area level<input type="number" min={1} max={100} value={offer.areaLevel ?? ''} placeholder="Unknown" onChange={e => onChange({ areaLevel: e.target.value ? Number(e.target.value) : null })} /></label>
        <label>Origin<select value={offer.origin} disabled={offer.source === 'example'} onChange={e => onChange({ origin: e.target.value as Offer['origin'] })}><option value="test">Test / showcase</option><option value="live">Live game</option></select></label>
        <label>Encounter number<input type="number" min={1} max={10000} value={offer.encounterNumber} onChange={e => onChange({ encounterNumber: Number(e.target.value) })} /></label>
      </div>
      <label className="notes-field">Notes<textarea rows={2} maxLength={4000} value={offer.notes} placeholder="Anything unusual about this capture" onChange={e => onChange({ notes: e.target.value })} /></label>
      <p className="hint">Offer ID: <span className="mono">{offer.id}</span></p>
  </section>
}
