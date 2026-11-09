import { useSharingConsent } from './lib/useSharingConsent'
import { useCallback, useEffect, useRef, useState } from 'react'
import { offerSchema, formatValidationError, type Offer } from '../shared/schema'
import { newOffer, exampleOffer, submissionProblem } from '../shared/offers'
import { SourcePanel, CaptureDetails } from './components/SourcePanel'
import { OfferEditor } from './components/OfferEditor'
import { OfferPreview } from './components/OfferPreview'
import { SavedOffers } from './components/SavedOffers'
import { importFile, importJson, downloadArchive, archiveParts, type Imported } from './lib/imports'
import * as storage from './lib/storage'
import { collectionInfo, collectionStatus, submitOffer } from './lib/api'
import { useCaptureSync } from './lib/useCaptureSync'
import { CaptureConnection } from './components/CaptureConnection'
import { Diagnostics, useDiagnosticWithdrawals } from './components/Diagnostics'
import { installDiagnosticLog, logDiagnostic } from './lib/diagnostic-log'

import { errorText, useOfferDraft } from './lib/useOfferDraft'
import { BackupDownload } from './components/BackupDownload'

export default function App() {
  const consentState = useSharingConsent()
  useDiagnosticWithdrawals()
  useEffect(installDiagnosticLog, [])
  const [tab, setTab] = useState<'collector' | 'saved' | 'diagnostics'>('collector')
  const [records, setRecords] = useState<storage.SavedOffer[]>([])
  const detailsPanel = useRef<HTMLDetailsElement>(null)
  const [backup, setBackup] = useState<ReturnType<typeof archiveParts> | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [accessKey, setAccessKey] = useState('')
  const [connected, setConnected] = useState(false)
  const [environment, setEnvironment] = useState('unknown')
  const fileInput = useRef<HTMLInputElement>(null)
  const moreActions = useRef<HTMLDetailsElement>(null)
  function closeActions() { if (moreActions.current) moreActions.current.open = false }
  const announce = useCallback((text: string, error = false) => setNotice({ text, error }), [])
  const refresh = useCallback(async () => setRecords(await storage.listOffers()), [])
  const sync = useCaptureSync(async entry => {
    // Apply delivery to this editor session before an asynchronous history read
    // allows the user to switch drafts underneath this callback.
    editor.receive(entry, !!detailsPanel.current?.open)
    await refresh()
  })
  const editor = useOfferDraft({ records, connected: sync.status === 'active', refresh, announce })
  const { draft, evidence, dirty, busy, autoSaving, dirtyRef, setBusy, loadDraft, change, canReplace, save,
    savedLocally, automatic, canConfirm, needsConfirmation, canSave, autoSaveFailure, retryAutoSave } = editor
  const savedCurrent = savedLocally && !dirty
  const reviewMessage = draft.reviewed
    ? draft.completeness === 'partial' ? 'Reviewed · some cards are missing.' : 'Reviewed · all offered cards are included.'
    : 'Not reviewed yet.'
  const saveMessage = automatic && (autoSaving || dirty)
    ? autoSaving ? 'Saving your corrections…' : 'Your corrections have not been saved yet.'
    : savedCurrent && draft.reviewed ? 'Review saved. You can still correct a misread in Edit details.'
    : automatic ? 'Capture saved. Open Edit details only if something needs correcting.'
    : canConfirm ? draft.completeness === 'partial'
      ? 'Confirm the listed cards. This offer will stay marked as incomplete.'
      : 'Confirm all offered cards are listed correctly. Unknown rewards are OK.'
    : savedCurrent ? 'Capture saved. You can check the details later.'
    : evidence || draft.cards.length ? 'Save on this device. You can check the details later.'
    : 'Capture an offer to start reviewing.'
  useEffect(() => { void refresh().catch(e => announce(errorText(e), true)); void collectionInfo().then(info => { setConnected(info.ingestionEnabled); setEnvironment(info.environment) }).catch(() => setConnected(false)) }, [refresh])
  async function acceptImport(result: Imported) {
    if (result.mode === 'restore') {
      const imported = await storage.importOffers(result.entries)
      await refresh()
      if (result.entries.length === 1) {
        const saved = await storage.getOffer(result.entries[0].offer.id)
        if (!saved) throw new Error('This offer no longer exists on this device.')
        loadDraft(saved.offer, await storage.getEvidence(saved.offer.captureId))
        setTab('collector')
        announce(imported ? 'Offer restored on this device with its original revision. Nothing was uploaded.' : 'This offer is already saved. Available missing evidence was restored; your existing corrections were preserved.')
      } else {
        setTab('saved'); announce(`Imported ${imported} new offers and restored available missing evidence. Existing corrections were preserved.`)
      }
      return
    }
    if (result.entries.length === 1) {
      const entry = result.entries[0]
      const existing = await storage.getOffer(entry.offer.id)
      if (existing) {
        const restored = entry.evidence ? await storage.restoreEvidence(existing.offer.id, entry.evidence) : false
        loadDraft(existing.offer, await storage.getEvidence(existing.offer.captureId))
        announce(restored ? 'Original screenshot and OCR restored. Your existing corrections were preserved.' : 'This capture is already saved. Your existing corrections were preserved.')
      } else { loadDraft(entry.offer, entry.evidence, true); announce(result.message) }
      setTab('collector')
      return
    }
  }
  async function loadFile(file: File) {
    if (busy || !canReplace()) return
    setBusy(true)
    try { await acceptImport(await importFile(file)); logDiagnostic('import', 'ok') } catch (error) { logDiagnostic('import', 'error'); announce(errorText(error), true) } finally { setBusy(false) }
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (busy || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const file = event.clipboardData?.files[0]
      const text = event.clipboardData?.getData('text/plain') || ''
      if (file) { event.preventDefault(); void loadFile(file); return }
      if (!text.includes('fate-collector.')) return
      event.preventDefault()
      if (!canReplace()) return
      setBusy(true)
      void importJson(text).then(acceptImport).catch(e => announce(errorText(e), true)).finally(() => setBusy(false))
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })
  async function open(id: string) {
    if (!canReplace()) return
    setBusy(true)
    try {
      const saved = await storage.getOffer(id)
      if (!saved) throw new Error('This offer no longer exists on this device.')
      loadDraft(saved.offer, await storage.getEvidence(saved.offer.captureId)); setTab('collector'); setNotice(null)
    } catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this local offer and its evidence? This does not delete a previously shared observation.')) return
    setBusy(true)
    try { await storage.deleteOffer(id); await refresh(); if (id === draft.id) loadDraft(newOffer(), null); announce('Local offer deleted.') }
    catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  async function share(offer: Offer) {
    if (dirtyRef.current && draft.id === offer.id) { announce('Save your changes before sharing this offer.', true); return }
    const problem = submissionProblem(offer)
    if (problem) { announce(problem, true); return }
    setBusy(true)
    try { const consentId = await submitOffer(offer, accessKey.trim()); await storage.markUploaded(offer.id, offer.revision, consentId); await refresh(); announce('Reviewed offer shared. The screenshot was not uploaded.') }
    catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  function exportCurrent() {
    const parsed = offerSchema.safeParse(draft)
    if (!parsed.success) { announce(formatValidationError(parsed.error), true); return }
    try { downloadArchive([{ offer: parsed.data, evidence }]) } catch (error) { announce(errorText(error), true) }
  }
  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    {environment === 'staging' && <div className="environment-banner" role="status"><strong>STAGING</strong> Test collection. Uploads go to the test database.</div>}
    <header className="app-header"><div className="header-inner"><span className="wordmark">Fate Collector</span><nav aria-label="Main"><button className={tab === 'collector' ? 'active' : ''} aria-current={tab === 'collector' ? 'page' : undefined} onClick={() => setTab('collector')}>Collector</button><button className={tab === 'saved' ? 'active' : ''} aria-current={tab === 'saved' ? 'page' : undefined} onClick={() => setTab('saved')}>Saved offers{records.length > 0 && <span className="nav-count">{records.length}</span>}</button><button className={tab === 'diagnostics' ? 'active' : ''} aria-current={tab === 'diagnostics' ? 'page' : undefined} onClick={() => setTab('diagnostics')}>Diagnostics</button></nav></div></header>
    <main id="main" className="workspace" tabIndex={-1}>
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}
      {tab === 'collector' ? <>
        <div className="page-heading"><div><h1>Review your captures.</h1><p>Check detected Fates and correct any misreads.</p></div>
          <details ref={moreActions} className="more-actions"><summary>More actions</summary><div className="action-menu">
            {canConfirm && <button disabled={busy || autoSaving || (savedLocally && !dirty)} onClick={() => { closeActions(); void save('later') }}>Save for later</button>}
            <button disabled={busy} onClick={() => { closeActions(); exportCurrent() }}>Export JSON</button>
            <button disabled={busy} onClick={() => { closeActions(); if (canReplace()) { loadDraft(newOffer(), null); setNotice(null) } }}>New offer</button>
            <button disabled={busy} onClick={() => { closeActions(); if (canReplace()) { loadDraft(exampleOffer(), null, true); announce('Illustrative example loaded. It cannot be shared as a game observation.') } }}>Load example</button>
          </div></details>
        </div>
        <CaptureConnection sync={sync} />
        <div className={`collector-grid ${draft.cards.length ? 'has-fates' : ''} ${busy ? 'is-busy' : ''}`} aria-busy={busy} inert={busy}>
          <SourcePanel evidence={evidence} automatic={sync.status === 'active'} onPick={() => fileInput.current?.click()} onFile={file => void loadFile(file)} />
          <OfferPreview offer={draft} saved={savedLocally && !dirty} automatic={sync.status === 'active'} />
        </div>
        <details ref={detailsPanel} className="advanced-panel" key={draft.id}><summary>Edit details</summary><div className="advanced-grid" inert={busy}>
          <OfferEditor offer={draft} onChange={change} />
          <CaptureDetails offer={draft} evidence={evidence} onChange={change} />
        </div></details>
        <div className="action-band"><p>{saveMessage}<span className="save-state">{automatic ? `${reviewMessage} Corrections save on this device.` : savedCurrent ? `${reviewMessage} Saved on this device.` : 'Saving here does not upload changes.'}{draft.origin === 'test' ? ' Test capture.' : ''}</span></p>{automatic ? <div className="auto-save-actions">
          <span className="auto-save-state" role="status">{autoSaving ? 'Saving changes…' : autoSaveFailure ? autoSaveFailure.conflict ? 'Save conflict' : 'Save failed' : dirty ? 'Changes pending…' : 'Saved locally'}</span>
          {autoSaveFailure && !autoSaveFailure.conflict && <button className="outline-button" disabled={busy || autoSaving} onClick={() => { setNotice(null); retryAutoSave() }}>Retry save</button>}
        </div> : <div className="primary-actions"><button className="primary-button" onClick={() => void save(canConfirm ? 'confirm' : 'current')} disabled={!canSave}>{busy ? 'Working…' : savedCurrent && !needsConfirmation ? 'Saved' : canConfirm ? 'Confirm and save' : 'Save offer'}</button></div>}</div>
      </> : tab === 'diagnostics' ? <Diagnostics environment={environment} folderConnection={sync.status} sharing={consentState.error ? 'error' : consentState.active ? 'active' : consentState.records.some(item => item.withdrawnAt && !item.withdrawalConfirmedAt) ? 'withdrawal-pending' : consentState.current ? 'pending' : 'off'} /> : <SavedOffers consentState={consentState} records={records} busy={busy || autoSaving} pendingOfferId={dirty ? draft.id : null} onOpen={id => void open(id)} onDelete={id => void remove(id)} onExport={() => {
        try { setBackup(archiveParts(records.map(r => ({ offer: r.offer, evidence: null })))) } catch (error) { announce(errorText(error), true) }
      }} onShare={offer => void share(offer)} accessKey={accessKey} setAccessKey={setAccessKey} connected={connected} onCheckConnection={() => { void collectionStatus().then(value => { setConnected(value); announce(value ? 'Collection API is configured. Enter your access key to share reviewed offers.' : 'Collection API is not configured. Local collection works normally.') }).catch(() => { setConnected(false); announce('Collection API is unreachable. Local collection works normally.', true) }) }} />}
      {backup && <BackupDownload parts={backup} onClose={() => setBackup(null)} />}
      <input ref={fileInput} className="file-input" type="file" accept=".json,image/png,image/jpeg" aria-label="Import capture file" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = '' }} />
      <details className="setup-help"><summary>How to capture from Path of Exile</summary><p>Run the Windows helper. Select the panel with F6 and F7 once; the helper remembers it. F8 previews the saved frame. Press F9 for each new offer. To send new captures to the shared database with this page closed, open Cloud upload settings in the helper's tray menu. Enter the collection owner's site URL and capture upload key, then enable upload.</p><p>For local review, use Connect folder to select its captures folder in desktop Chrome or Edge. Captures and corrections save locally without pasting or clicking Save. Keep this page open for local intake; it catches up from disk when reopened. Browser folder permission may need renewing. Manual import and paste remain available.</p><p>Windows 10/11, AutoHotkey v2 and an installed Windows OCR language are required. The helper uses GDI for SDR and Windows Graphics Capture for HDR. Live game and HDR monitor compatibility still need validation.</p><a href="/downloads/fate-collector-helper.zip" download>Download Windows helper</a><p className="hint">Cloud upload sends OCR text and capture metadata; screenshots stay on disk. Automatic records remain unverified. Website corrections are shared separately from Saved offers.</p></details>
    </main>
    <footer className="app-footer">Icon recognition needs verification. The collector does not recommend choices yet.<span>Independent community tool · Not affiliated with Grinding Gear Games</span></footer>
  </>
}
