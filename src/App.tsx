import { DetailPanel, type DetailPanelHandle } from './components/DetailPanel'
import { useSharingConsent } from './lib/useSharingConsent'
import { useCallback, useEffect, useRef, useState } from 'react'
import { offerSchema, formatValidationError, type Offer } from '../shared/schema'
import { newOffer, exampleOffer, submissionProblem } from '../shared/offers'
import { SourcePanel, CaptureDetails } from './components/SourcePanel'
import { OfferEditor } from './components/OfferEditor'
import { OfferPreview } from './components/OfferPreview'
import { SavedOffers } from './components/SavedOffers'
import { importFiles, recoverBackup, importJson, downloadArchive, createBackupParts, type BackupPart, type Imported } from './lib/imports'
import * as storage from './lib/storage'
import { collectionInfo, collectionStatus, submitOffer } from './lib/api'
import { useCaptureSync } from './lib/useCaptureSync'
import { CaptureConnection } from './components/CaptureConnection'
import { Diagnostics, useDiagnosticWithdrawals } from './components/Diagnostics'
import { installDiagnosticLog, logDiagnostic } from './lib/diagnostic-log'

import { errorText, useOfferDraft } from './lib/useOfferDraft'
import { BackupDownload } from './components/BackupDownload'
import { FateAdvisor } from './components/FateAdvisor'
import { useAdvisorWorkspace } from './lib/useAdvisorWorkspace'
import { useSolverSettings } from './lib/useSolverSettings'
import { DraftRecovery } from './components/LocalRecovery'
import { AppIcon } from './components/AppIcon'
import { useTheme } from './lib/theme'
import { WorkspaceNotice } from './components/WorkspaceNotice'

export default function App() {
  const appearance = useTheme()
  const consentState = useSharingConsent()
  useDiagnosticWithdrawals()
  useEffect(installDiagnosticLog, [])
  const [tab, setTab] = useState<'collector' | 'review' | 'saved' | 'diagnostics'>('collector')
  const advisor = useAdvisorWorkspace()
  const solver = useSolverSettings()
  const [records, setRecords] = useState<storage.SavedOffer[]>([])
  const [unreadableOffers, setUnreadableOffers] = useState<storage.UnreadableOffer[]>([])
  const [damagedEvidenceCount, setDamagedEvidenceCount] = useState(0)
  const [isolatedCount, setIsolatedCount] = useState(0)
  const [missingEvidenceIds, setMissingEvidenceIds] = useState<string[]>([])
  const detailsPanel = useRef<DetailPanelHandle>(null)
  const [editing, setEditing] = useState(false)
  const [reviewRequest, setReviewRequest] = useState<{ cardId: string; sequence: number } | null>(null)
  const [backup, setBackup] = useState<{ parts: BackupPart[]; includeEvidence: boolean; summary: Awaited<ReturnType<typeof storage.readOfferArchive>> } | null>(null)
  const backupReturnFocus = useRef<HTMLElement | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [accessKey, setAccessKey] = useState('')
  const [connected, setConnected] = useState(false)
  const [environment, setEnvironment] = useState('unknown')
  const fileInput = useRef<HTMLInputElement>(null)
  const recoveryInput = useRef<HTMLInputElement>(null)
  const moreActions = useRef<DetailPanelHandle>(null)
  const connectionPanel = useRef<DetailPanelHandle>(null)
  const helpPanel = useRef<DetailPanelHandle>(null)
  function editCurrentOffer(cardId?: string) {
    if (!detailsPanel.current) return
    detailsPanel.current.show()
    if (cardId) setReviewRequest(previous => ({ cardId, sequence: (previous?.sequence ?? 0) + 1 }))
    else detailsPanel.current.element?.querySelector<HTMLElement>('h2')?.focus()
  }
  function returnToAdvice() {
    if (detailsPanel.current) detailsPanel.current.close()
    document.getElementById('advisor-heading')?.focus()
  }
  function closeActions() { if (moreActions.current) moreActions.current.close() }
  const announce = useCallback((text: string, error = false) => setNotice({ text, error }), [])
  const refresh = useCallback(async () => {
    const history = await storage.readOfferHistory()
    setRecords(history.records); setUnreadableOffers(history.unreadable)
    setMissingEvidenceIds(history.missingEvidenceIds); setIsolatedCount(history.isolatedCount)
  }, [])
  const sync = useCaptureSync(async entry => {
    // Apply delivery to this editor session before an asynchronous history read
    // allows the user to switch drafts underneath this callback.
    mapEditor.receive(entry, tab === 'collector' && !!detailsPanel.current?.isOpen())
    if (entry.restored) archiveEditor.receive(entry, true)
    await refresh()
  })
  const mapEditor = useOfferDraft({ records, connected: sync.status === 'active', refresh, announce })
  useEffect(() => {
    if ((sync.status === 'permission' || sync.status === 'error') && connectionPanel.current) connectionPanel.current.show()
  }, [sync.status, tab])
  const archiveEditor = useOfferDraft({ records, connected: sync.status === 'active', refresh, announce })
  const editor = tab === 'review' ? archiveEditor : mapEditor
  const busy = mapEditor.busy || archiveEditor.busy
  const { draft, evidence, dirty, autoSaving, setBusy, loadDraft, change, canReplace, save,
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
  useEffect(() => storage.onHistoryChange(() => { void refresh().catch(error => announce(errorText(error), true)) }), [refresh, announce])
  async function acceptImport(result: Imported) {
    if (result.mode === 'restore') {
      if (result.entries.length === 1 && !archiveEditor.canReplace()) return
      const imported = await storage.importOffers(result.entries)
      await refresh()
      if (result.entries.length === 1) {
        const saved = await storage.getOffer(result.entries[0].offer.id)
        if (!saved) throw new Error('This offer no longer exists on this device.')
        archiveEditor.loadDraft(saved.offer, await storage.getEvidence(saved.offer.captureId))
        setTab('review')
        const source = await storage.readEvidence(saved.offer.captureId, true)
        archiveEditor.loadDraft(saved.offer, source.evidence)
        announce(`${imported ? 'Offer restored on this device with its original revision. Nothing was uploaded.' : 'This offer is already saved. Available missing evidence was restored; your existing corrections were preserved.'} ${result.message}${source.warning ? ` ${source.warning}` : ''}`, !!source.warning)
      } else {
        setTab('saved'); announce(`Imported ${imported} new offers and restored available missing evidence. Existing corrections were preserved. ${result.message}`)
      }
      return
    }
    if (result.entries.length === 1) {
      if (!mapEditor.canReplace()) return
      const entry = result.entries[0]
      const existing = await storage.getOffer(entry.offer.id)
      if (existing) {
        const old = await storage.readEvidence(existing.offer.captureId, true)
        let restored = false
        if (entry.evidence && old.status === 'damaged' && window.confirm('Restore screenshot and OCR from this capture? The damaged original will be kept in recovery data. Your offer corrections stay unchanged.')) {
          await storage.repairEvidence(existing.offer.id, entry.evidence); restored = true
        } else if (entry.evidence) restored = await storage.restoreEvidence(existing.offer.id, entry.evidence)
        const source = await storage.readEvidence(existing.offer.captureId, true)
        mapEditor.loadDraft(existing.offer, source.evidence)
        await refresh()
        announce(source.warning || (restored ? 'Original screenshot and OCR restored. Your existing corrections were preserved.' : 'This capture is already saved. Your existing corrections were preserved.'), !!source.warning)
      } else { mapEditor.loadDraft(entry.offer, entry.evidence, true); announce(result.message) }
      setTab('collector')
      return
    }
  }
  async function loadFile(file: File | File[], recovery = false) {
    if (busy) return
    setBusy(true)
    try { await acceptImport(recovery ? await recoverBackup(Array.isArray(file) ? file[0] : file) : await importFiles(Array.isArray(file) ? file : [file])); logDiagnostic('import', 'ok') } catch (error) { logDiagnostic('import', 'error'); announce(errorText(error), true) } finally { setBusy(false) }
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (busy || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const file = event.clipboardData?.files[0]
      const text = event.clipboardData?.getData('text/plain') || ''
      if (file) { event.preventDefault(); void loadFile(file); return }
      if (!text.includes('fate-collector.')) return
      event.preventDefault()
      setBusy(true)
      void importJson(text).then(acceptImport).catch(e => announce(errorText(e), true)).finally(() => setBusy(false))
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })
  async function open(id: string) {
    if (!archiveEditor.canReplace()) return
    setBusy(true)
    try {
      const saved = await storage.getOffer(id)
      if (!saved) throw new Error('This offer no longer exists on this device.')
      const source = await storage.readEvidence(saved.offer.captureId, true)
      archiveEditor.loadDraft(saved.offer, source.evidence); setTab('review'); setNotice(source.warning ? { text: source.warning, error: true } : null)
      if (source.status === 'damaged') setDamagedEvidenceCount(count => Math.max(count, 1))
    } catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this local offer and its evidence? This does not delete a previously shared observation.')) return
    setBusy(true)
    try { await storage.deleteOffer(id); await refresh(); if (id === draft.id) loadDraft(newOffer(), null); announce('Local offer deleted.') }
    catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  async function share(offer: Offer) {
    if ([mapEditor, archiveEditor].some(item => item.dirtyRef.current && item.draft.id === offer.id)) { announce('Save your changes before sharing this offer.', true); return }
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
  async function exportAll(includeEvidence: boolean) {
    if (busy) return
    backupReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setBusy(true)
    try {
      const builder = createBackupParts(includeEvidence)
      const summary = await storage.readOfferArchive(includeEvidence, entry => builder.add(entry))
      if (includeEvidence) setDamagedEvidenceCount(summary.damagedEvidence)
      if (!summary.offers) throw new Error('No readable offers to export. Use Export recovery data for unreadable records.')
      setBackup({ parts: builder.finish(), includeEvidence, summary })
    } catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  async function exportRecovery() {
    if (busy) return
    setBusy(true)
    try {
      const recovery = await storage.readOfferRecovery()
      const url = URL.createObjectURL(new Blob([JSON.stringify(recovery)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'fate-collector-recovery.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      announce('Recovery data exported. The original records are unchanged. This file needs repair before it can be imported.')
    } catch (error) { announce(errorText(error), true) } finally { setBusy(false) }
  }
  function startMap() {
    if (!mapEditor.canReplace()) return
    advisor.startMap()
    mapEditor.loadDraft(newOffer(), null)
    setTab('collector'); setNotice(null)
  }
  function useCurrentOffer() {
    if (advisor.needsMapConfirmation) return
    if (advisor.workspace.map) advisor.bindOffer(mapEditor.draft.id)
    else advisor.startMap(mapEditor.draft.id)
  }
  function useArchivedOffer() {
    if (archiveEditor.dirty || advisor.needsMapConfirmation || !mapEditor.canReplace()) return
    mapEditor.loadDraft(archiveEditor.draft, archiveEditor.evidence)
    if (advisor.workspace.map) advisor.bindOffer(archiveEditor.draft.id)
    else advisor.startMap(archiveEditor.draft.id)
    setTab('collector'); setNotice(null)
  }
  useEffect(() => { setEditing(false) }, [tab, draft.id])
  const saveBar = (evidence || draft.cards.length > 0 || dirty || savedLocally) && <div className="action-band"><p>{saveMessage}<span className="save-state">{automatic ? `${reviewMessage} Corrections save on this device.` : savedCurrent ? `${reviewMessage} Saved on this device.` : 'Saving here does not upload changes.'}{draft.origin === 'test' ? ' Test capture.' : ''}</span></p>{automatic ? <div className="auto-save-actions">
          <span className="auto-save-state" role="status">{autoSaving ? 'Saving changes…' : autoSaveFailure ? autoSaveFailure.conflict ? 'Save conflict' : 'Save failed' : dirty ? 'Changes pending…' : 'Saved locally'}</span>
          {autoSaveFailure && !autoSaveFailure.conflict && <button className="outline-button" disabled={busy || autoSaving} onClick={() => { setNotice(null); retryAutoSave() }}>Retry save</button>}
        </div> : <div className="primary-actions"><button className="primary-button" onClick={() => void save(canConfirm ? 'confirm' : 'current')} disabled={!canSave}>{busy ? 'Working…' : savedCurrent && !needsConfirmation ? 'Saved' : canConfirm ? 'Confirm and save' : 'Save offer'}</button></div>}</div>
  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    {environment === 'staging' && <div className="environment-banner" role="status"><strong>STAGING</strong> Test collection. Uploads go to the test database.</div>}
    <div className="app-shell">
    <header className="app-header"><div className="header-inner">
      <span className="wordmark"><AppIcon name="mark" /><span>Fate Collector</span></span>
      <nav aria-label="Main">
        <button className={tab === 'collector' ? 'active' : ''} aria-current={tab === 'collector' ? 'page' : undefined} onClick={() => setTab('collector')}><AppIcon name="map" />Current map</button>
        <button className={tab === 'saved' || tab === 'review' ? 'active' : ''} aria-current={tab === 'saved' || tab === 'review' ? 'page' : undefined} onClick={() => setTab('saved')}><AppIcon name="archive" />Saved offers{records.length > 0 && <span className="nav-count">{records.length}</span>}</button>
        <button className={`diagnostics-nav ${tab === 'diagnostics' ? 'active' : ''}`} aria-current={tab === 'diagnostics' ? 'page' : undefined} onClick={() => setTab('diagnostics')}><AppIcon name="tools" />Diagnostics</button>
      </nav>
      <p className="shell-note">Your evidence.<br />Your next decision.</p>
    </div></header>
    <div className="main-area">
    <main id="main" className="workspace" tabIndex={-1}>
      <div className="page-heading"><div><h1>{tab === 'review' ? 'Archived offer' : tab === 'saved' ? 'Your observation journal.' : tab === 'diagnostics' ? 'Report a problem.' : 'Your current map'}</h1>{(tab !== 'collector' || (!draft.cards.length && !advisor.workspace.collection.cards.length)) && <p>{tab === 'review' ? 'Review this observation separately from your current map.' : tab === 'saved' ? 'Your captures, ready to revisit.' : tab === 'diagnostics' ? 'Inspect a report before deciding to send it.' : 'Your next Fate, with the evidence to choose.'}</p>}</div>
        <div className="page-heading-actions">
        <a className="helper-download" href="/downloads/fate-collector-helper.zip" download><AppIcon name="download" /><span>Download Windows helper</span></a>
        <DetailPanel ref={moreActions} className="more-actions" title="More actions"><div className="action-menu">
          {(tab === 'collector' || tab === 'review') && <>
            <button onClick={() => { closeActions(); editCurrentOffer() }}>Edit details</button>
            {canConfirm && <button disabled={busy || autoSaving || (savedLocally && !dirty)} onClick={() => { closeActions(); void save('later') }}>Save for later</button>}
            <button disabled={busy} onClick={() => { closeActions(); exportCurrent() }}>Export JSON</button>
            {tab === 'collector' && <><button disabled={busy || autoSaving} onClick={() => { closeActions(); startMap() }}>{advisor.workspace.map ? 'New map' : 'Start new map'}</button>
              <button disabled={busy} onClick={() => { closeActions(); if (canReplace()) { loadDraft(newOffer(), null); setNotice(null) } }}>New offer</button>
              <button disabled={busy} onClick={() => { closeActions(); if (canReplace()) { loadDraft(exampleOffer(), null, true); announce('Illustrative example loaded. It cannot be shared as a game observation.') } }}>Load example</button></>}
          </>}
          {tab === 'collector' && <button onClick={() => { closeActions(); connectionPanel.current?.show() }}>{sync.status === 'active' ? 'Local review connected' : sync.status === 'permission' ? 'Folder access needed' : sync.status === 'error' ? 'Local review needs attention' : 'Connect captures folder'}</button>}
          <button onClick={() => { closeActions(); helpPanel.current?.show() }}>How to capture from Path of Exile</button>
          <label className="theme-picker">Appearance<select value={appearance.theme} onChange={event => appearance.changeTheme(event.target.value === 'trail' ? 'trail' : 'mineral')}><option value="mineral">Mineral Depth · dark</option><option value="trail">Light Trail · light</option></select></label>
          {appearance.error && <p className="hint" role="status">{appearance.error}</p>}
        </div></DetailPanel>
        </div>
      </div>
      {notice && <WorkspaceNotice notice={notice} onDismiss={() => setNotice(null)} />}
      <DraftRecovery busy={busy} onRecover={record => { if (!mapEditor.recover(record)) return false; setTab('collector'); announce('Draft recovered. Check it before saving; your saved offer has not been replaced.'); return true }} />
      {editor.recoveryError && <p className="notice error" role="alert">{editor.recoveryError}</p>}
      {tab === 'saved' && (archiveEditor.savedLocally || archiveEditor.dirty) && <button onClick={() => setTab('review')}>Resume archived review</button>}
      {tab === 'collector' || tab === 'review' ? <>
        {tab === 'collector' ? <>
        {advisor.workspace.map && <section className="map-session" data-state={advisor.needsMapConfirmation ? 'confirmation' : advisor.workspace.map ? 'active' : 'empty'} aria-label="Map session">
          <div><strong>{advisor.needsMapConfirmation ? 'Confirm your current map.' : advisor.workspace.map ? 'Map session active' : 'No active map'}</strong><p>{advisor.workspace.map?.startedAt ? `Started ${new Date(advisor.workspace.map.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}{advisor.needsMapConfirmation && ' · Fates belong to this instance.'}</p></div>
          <div className="map-session-actions">{advisor.canUndo && <button className="text-button" aria-label="Undo collection change" disabled={busy} onClick={advisor.undo}>Undo</button>}{advisor.needsMapConfirmation && <button disabled={busy} onClick={advisor.confirmMap}>Continue this map</button>}</div>
        </section>}
        {!advisor.workspace.map && !!draft.cards.length && advisor.canUndo && <button disabled={busy} onClick={advisor.undo}>Undo collection change</button>}
        {advisor.storageError && <p className="notice error" role="alert">{advisor.storageError}</p>}
        <FateAdvisor solverControl={solver} savedOffers={records.map(record => record.offer)} offer={draft} workspace={advisor.workspace} onChange={advisor.changeWorkspace} needsMapConfirmation={advisor.needsMapConfirmation} onUseOffer={useCurrentOffer} busy={busy} saved={savedLocally && !dirty} automatic={sync.status === 'active'} onEditOffer={editCurrentOffer} source={<SourcePanel compact={!!draft.cards.length || !!advisor.workspace.collection.cards.length} evidence={evidence} automatic={sync.status === 'active'} onPick={() => fileInput.current?.click()} onFile={file => void loadFile(file)} />} />
        {sync.status !== 'off' && <button className="connection-status text-button" onClick={() => connectionPanel.current?.show()}>{sync.status === 'active' ? 'Local review connected' : sync.status === 'permission' ? 'Folder access needed' : sync.status === 'error' ? 'Local review needs attention' : 'Local review settings'}</button>}
        {sync.problem && <p className="connection-warning field-error" role="alert">{sync.problem}</p>}
        <DetailPanel trigger={false} className="map-capture-connection" ref={connectionPanel} title="Local review"><CaptureConnection sync={sync} /></DetailPanel>
        </> : <>
        <div className="archive-boundary"><p>This archived offer is not used in current-map advice. Only transfer it if it belongs to the instance you are playing now.{archiveEditor.dirty ? ' Save corrections before transferring.' : ''}{advisor.needsMapConfirmation ? ' Confirm your map on the Current map screen first.' : ''}</p><div><button onClick={() => setTab('collector')}>Return to current map</button><button disabled={busy || autoSaving || archiveEditor.dirty || advisor.needsMapConfirmation} onClick={useArchivedOffer}>{advisor.workspace.map ? 'Use this offer in current map' : 'Start map with this offer'}</button></div></div>
        <div className={`collector-grid ${draft.cards.length ? 'has-fates' : ''} ${busy ? 'is-busy' : ''}`} aria-busy={busy} inert={busy}>
          <SourcePanel evidence={evidence} automatic={sync.status === 'active'} onPick={() => fileInput.current?.click()} onFile={file => void loadFile(file)} />
          <OfferPreview offer={draft} saved={savedLocally && !dirty} automatic={sync.status === 'active'} />
        </div></>}
        <DetailPanel trigger={false} ref={detailsPanel} onOpenChange={setEditing} className="advanced-panel" key={`${tab}:${draft.id}`} title="Edit details" footer={<>{editing && saveBar}<button onClick={returnToAdvice}>{tab === 'collector' ? 'Back to advice' : 'Done'}</button></>}><div className={`advanced-grid ${evidence ? 'has-review-evidence' : ''}`} inert={busy}>
          <OfferEditor solverControl={solver} offer={draft} onChange={change} evidence={evidence} showRecordedChoice={tab === 'review'} reviewRequest={tab === 'collector' ? reviewRequest : null} />
          <CaptureDetails offer={draft} evidence={evidence} onChange={change} />
        </div></DetailPanel>
        {!editing && saveBar}
      </> : tab === 'diagnostics' ? <Diagnostics environment={environment} folderConnection={sync.status} sharing={consentState.error ? 'error' : consentState.active ? 'active' : consentState.records.some(item => item.withdrawnAt && !item.withdrawalConfirmedAt) ? 'withdrawal-pending' : consentState.current ? 'pending' : 'off'} /> : <SavedOffers consentState={consentState} records={records} unreadableOffers={unreadableOffers} damagedEvidenceCount={damagedEvidenceCount} isolatedCount={isolatedCount} missingEvidenceIds={missingEvidenceIds} onImport={() => fileInput.current?.click()} onRecoverBackup={() => recoveryInput.current?.click()} onIsolate={key => { if (window.confirm('Isolate this unreadable record? Its original data is preserved in recovery storage and can be exported.')) void storage.isolateUnreadableOffer(key).then(refresh).catch(error => announce(errorText(error), true)) }} onRecovery={() => void exportRecovery()} busy={busy || autoSaving} pendingOfferIds={[mapEditor, archiveEditor].filter(item => item.dirty).map(item => item.draft.id)} onOpen={id => void open(id)} onDelete={id => void remove(id)} onExport={includeEvidence => void exportAll(includeEvidence)} onShare={offer => void share(offer)} accessKey={accessKey} setAccessKey={setAccessKey} connected={connected} onCheckConnection={() => { void collectionStatus().then(value => { setConnected(value); announce(value ? 'Collection API is configured. Enter your access key to share reviewed offers.' : 'Collection API is not configured. Local collection works normally.') }).catch(() => { setConnected(false); announce('Collection API is unreachable. Local collection works normally.', true) }) }} />}
      {backup && <BackupDownload {...backup} onRecovery={() => void exportRecovery()} onClose={() => { setBackup(null); requestAnimationFrame(() => backupReturnFocus.current?.focus()) }} />}
      <input ref={fileInput} className="file-input" type="file" multiple accept=".json,image/png,image/jpeg" aria-label="Import capture file" onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) void loadFile(files); event.target.value = '' }} />
      <input ref={recoveryInput} className="file-input" type="file" accept=".json" aria-label="Recover damaged backup" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file, true); event.target.value = '' }} />
      <DetailPanel trigger={false} ref={helpPanel} className="setup-help" title="How to capture from Path of Exile"><p>Run the Windows helper. Select the panel with F6 and F7 once; the helper remembers it. F8 previews the saved frame. Press F9 for each new offer. To send new captures to the shared database with this page closed, open Cloud upload settings in the helper's tray menu. Enter the collection owner's site URL and capture upload key, then enable upload.</p><p>For local review, use Connect folder to select its captures folder in desktop Chrome or Edge. Captures and corrections save locally without pasting or clicking Save. Keep this page open for local intake; it catches up from disk when reopened. Browser folder permission may need renewing. Manual import and paste remain available.</p><p>Windows 10/11, AutoHotkey v2 and an installed Windows OCR language are required. The helper uses GDI for SDR and Windows Graphics Capture for HDR. Live game and HDR monitor compatibility still need validation.</p><a href="/downloads/fate-collector-helper.zip" download>Download Windows helper</a><p className="hint">Cloud upload sends OCR text and capture metadata; screenshots stay on disk. Automatic records remain unverified. Website corrections are shared separately from Saved offers.</p></DetailPanel>
    </main>
    <footer className="app-footer">Advisor uses identified rewards and preview rules. Unknown icons need manual review.<span>Independent community tool · Not affiliated with Grinding Gear Games</span></footer>
    </div></div>
  </>
}
