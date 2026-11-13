import { DetailPanel, type DetailPanelHandle } from './components/DetailPanel'
import { useSharingConsent } from './lib/useSharingConsent'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { offerSchema, formatValidationError, type Offer } from '../shared/schema'
import { newOffer, exampleOffer, guidedExampleOffer, submissionProblem } from '../shared/offers'
import { SourcePanel, CaptureDetails } from './components/SourcePanel'
import { OfferEditor } from './components/OfferEditor'
import { OfferPreview } from './components/OfferPreview'
import { SavedOffers } from './components/SavedOffers'
import { importFiles, recoverBackup, importJson, downloadArchive, type Imported } from './lib/imports'
import * as storage from './lib/storage'
import { collectionInfo, collectionStatus, submitOffer } from './lib/api'
import { useCaptureSync } from './lib/useCaptureSync'
import { CaptureConnection } from './components/CaptureConnection'
import { useDiagnosticWithdrawals } from './lib/useDiagnosticWithdrawals'
import { installDiagnosticLog, logDiagnostic } from './lib/diagnostic-log'

import { errorText, useOfferDraft } from './lib/useOfferDraft'
import { BackupDownload } from './components/BackupDownload'
import { FateAdvisor } from './components/FateAdvisor'
import { useAdvisorWorkspace } from './lib/useAdvisorWorkspace'
import { useSolverSettings } from './lib/useSolverSettings'
import { DraftRecovery } from './components/LocalRecovery'
import { useArchiveBackup } from './lib/useArchiveBackup'
import { useReleaseUpdate } from './lib/useReleaseUpdate'
import { OfferSaveBar } from './components/OfferSaveBar'
import { AppIcon } from './components/AppIcon'
import { useTheme } from './lib/theme'
import { WorkspaceNotice } from './components/WorkspaceNotice'
const UsageGuide = lazy(() => import('./components/UsageGuide').then(module => ({ default: module.UsageGuide })))
const Diagnostics = lazy(() => import('./components/Diagnostics').then(module => ({ default: module.Diagnostics })))
import type { SymbolReportsHandle } from './components/SymbolReports'
import { LazySymbolReports } from './components/LazySymbolReports'
import { ImportConflicts, offerDifferences, type ImportConflict } from './components/ImportConflicts'

export default function App() {
  const releaseUpdate = useReleaseUpdate()
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([])
  const appearance = useTheme()
  const consentState = useSharingConsent()
  useDiagnosticWithdrawals()
  useEffect(installDiagnosticLog, [])
  const [tab, setTab] = useState<'collector' | 'review' | 'saved' | 'diagnostics' | 'guide'>('collector')
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
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [accessKey, setAccessKey] = useState('')
  const [connected, setConnected] = useState(false)
  const [environment, setEnvironment] = useState('unknown')
  const fileInput = useRef<HTMLInputElement>(null)
  const recoveryInput = useRef<HTMLInputElement>(null)
  const moreActions = useRef<DetailPanelHandle>(null)
  const connectionPanel = useRef<DetailPanelHandle>(null)
  const symbolReportsPanel = useRef<SymbolReportsHandle>(null)
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
  function leaveGuide(destination: 'collector' | 'saved' | 'diagnostics') {
    setTab(destination)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.page-heading h1')?.focus()
      window.scrollTo(0, 0)
    })
  }
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
    savedLocally, canConfirm } = editor
  const { backup, exportAll, exportRecovery, closeBackup } = useArchiveBackup({ busy, setBusy, setDamagedEvidenceCount, announce })
  useEffect(() => { void refresh().catch(e => announce(errorText(e), true)); void collectionInfo().then(info => { setConnected(info.ingestionEnabled); setEnvironment(info.environment) }).catch(() => setConnected(false)) }, [refresh, announce])
  useEffect(() => storage.onHistoryChange(() => { void refresh().catch(error => announce(errorText(error), true)) }), [refresh, announce])
  async function acceptImport(result: Imported) {
    if (result.mode === 'restore') {
      if (result.entries.length === 1 && !archiveEditor.canReplace()) return
      const conflicts: ImportConflict[] = []
      for (const { offer: incoming } of result.entries) {
        const local = (await storage.getOffer(incoming.id))?.offer
        if (local && offerDifferences(local, incoming).length) conflicts.push({ local, incoming })
      }
      const imported = await storage.importOffers(result.entries)
      setImportConflicts(conflicts)
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
  async function removeMany(offers: Offer[]): Promise<boolean> {
    if (!window.confirm(`Delete ${offers.length} selected local offers and their evidence? Verify your downloaded backup first. Shared observations stay unchanged.`)) return false
    setBusy(true)
    try {
      await storage.deleteOffers(offers.map(offer => ({ id: offer.id, revision: offer.revision })))
      await refresh()
      for (const item of [mapEditor, archiveEditor]) if (offers.some(offer => offer.id === item.draft.id) && !item.dirty) item.loadDraft(newOffer(), null)
      announce(`${offers.length} local offers deleted.`); return true
    } catch (error) { announce(errorText(error), true); return false } finally { setBusy(false) }
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
  const saveBar = <OfferSaveBar editor={editor} clearNotice={() => setNotice(null)} />
  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    {environment === 'staging' && <div className="environment-banner" role="status"><strong>STAGING</strong> Test collection. Uploads go to the test database.</div>}
    <div className="app-shell">
    <header className="app-header"><div className="header-inner">
      <span className="wordmark"><AppIcon name="mark" /><span>Fate Collector</span></span>
      <nav aria-label="Main">
        <button className={tab === 'collector' ? 'active' : ''} aria-current={tab === 'collector' ? 'page' : undefined} onClick={() => setTab('collector')}><AppIcon name="map" />Current area</button>
        <button className={tab === 'saved' || tab === 'review' ? 'active' : ''} aria-current={tab === 'saved' || tab === 'review' ? 'page' : undefined} onClick={() => setTab('saved')}><AppIcon name="archive" />Saved offers{records.length > 0 && <span className="nav-count">{records.length}</span>}</button>
        <button className={tab === 'guide' ? 'active' : ''} aria-current={tab === 'guide' ? 'page' : undefined} onClick={() => setTab('guide')}><AppIcon name="question" />Guide</button>
        <button className={`diagnostics-nav ${tab === 'diagnostics' ? 'active' : ''}`} aria-current={tab === 'diagnostics' ? 'page' : undefined} onClick={() => setTab('diagnostics')}><AppIcon name="tools" />Diagnostics</button>
      </nav>
      <p className="shell-note">Your evidence.<br />Your next decision.</p>
    </div></header>
    <div className="main-area">
    <main id="main" className="workspace" tabIndex={-1}>
      <div className="page-heading"><div><h1 tabIndex={-1}>{tab === 'guide' ? 'Helper & website guide' : tab === 'review' ? 'Archived offer' : tab === 'saved' ? 'Your observation journal.' : tab === 'diagnostics' ? 'Report a problem.' : 'Your current area'}</h1>{(tab !== 'collector' || (!draft.cards.length && !advisor.workspace.collection.cards.length)) && <p>{tab === 'guide' ? 'From your first capture to your next Fate.' : tab === 'review' ? 'Review this observation separately from your current area.' : tab === 'saved' ? 'Your captures, ready to revisit.' : tab === 'diagnostics' ? 'Inspect a report before deciding to send it.' : 'Your next Fate, with the evidence to choose.'}</p>}</div>
        <div className="page-heading-actions">
        <a className="helper-download" href="/downloads/fate-collector-helper.zip" download><AppIcon name="download" /><span>Download Windows helper</span></a>
        <DetailPanel ref={moreActions} className="more-actions" title="More actions"><div className="action-menu">
          {(tab === 'collector' || tab === 'review') && <section className="action-menu-group" aria-labelledby="offer-actions-heading">
            <h3 id="offer-actions-heading">{tab === 'review' ? 'Archived offer' : 'Current offer'}</h3>
            <div className="action-menu-items">
              <button onClick={() => { closeActions(); editCurrentOffer() }}>Edit details</button>
              {canConfirm && <button disabled={busy || autoSaving || (savedLocally && !dirty)} onClick={() => { closeActions(); void save('later') }}>Save for later</button>}
              <button disabled={busy} onClick={() => { closeActions(); exportCurrent() }}>Export JSON</button>
              <button disabled={busy} onClick={() => { closeActions(); symbolReportsPanel.current?.showNew() }}>Report symbol</button>
            </div>
          </section>}
          {tab === 'collector' && <section className="action-menu-group" aria-labelledby="new-actions-heading">
            <h3 id="new-actions-heading">Start fresh</h3>
            <div className="action-menu-items">
              <button disabled={busy || autoSaving} aria-describedby="new-map-description" onClick={() => { closeActions(); startMap() }}>{advisor.workspace.map ? 'New area' : 'Start new area'}</button>
              <p id="new-map-description" className="action-menu-description">Resets area planning. Saved offers stay in your journal.</p>
              <button disabled={busy} onClick={() => { closeActions(); if (canReplace()) { loadDraft(newOffer(), null); setNotice(null) } }}>New offer</button>
            </div>
          </section>}
          <section className="action-menu-group" aria-labelledby="setup-actions-heading">
            <h3 id="setup-actions-heading">Setup & help</h3>
            <div className="action-menu-items">
              {tab === 'collector' && <button onClick={() => { closeActions(); connectionPanel.current?.show() }}>{sync.status === 'active' ? 'Local review connected' : sync.status === 'permission' ? 'Folder access needed' : sync.status === 'error' ? 'Local review needs attention' : 'Connect captures folder'}</button>}
              <button onClick={() => { closeActions(); setTab('guide') }}>Setup & usage guide</button>
              <button onClick={() => { closeActions(); symbolReportsPanel.current?.showHistory() }}>Symbol report history</button>
              {tab === 'collector' && <button disabled={busy} onClick={() => { closeActions(); if (canReplace()) { loadDraft(guidedExampleOffer(), null, true); announce('Guided practice: start an area, collect one Fate, then plan and record its invocation. Rewards are invented training values; nothing can be shared as live evidence.') } }}>Load guided practice</button>}
              {tab === 'collector' && <button disabled={busy} onClick={() => { closeActions(); if (canReplace()) { loadDraft(exampleOffer(), null, true); announce('Illustrative example loaded. It cannot be shared as a game observation.') } }}>Load example</button>}
            </div>
          </section>
          <label className="theme-picker">Appearance<select value={appearance.theme} onChange={event => appearance.changeTheme(event.target.value === 'trail' ? 'trail' : 'mineral')}><option value="mineral">Mineral Depth · dark</option><option value="trail">Light Trail · light</option></select></label>
          {appearance.error && <p className="hint" role="status">{appearance.error}</p>}
        </div></DetailPanel>
        </div>
      </div>
      {notice && <WorkspaceNotice notice={notice} onDismiss={() => setNotice(null)} />}
      {releaseUpdate && <aside className="notice" aria-label="Website update"><p>A new website version is available. Save or export open drafts before reloading; local records are kept.</p><button onClick={() => location.reload()}>Reload when ready</button></aside>}
      <DraftRecovery busy={busy} onRecover={record => { if (!mapEditor.recover(record)) return false; setTab('collector'); announce('Draft recovered. Check it before saving; your saved offer has not been replaced.'); return true }} />
      {editor.recoveryError && <p className="notice error" role="alert">{editor.recoveryError}</p>}
      {tab === 'saved' && (archiveEditor.savedLocally || archiveEditor.dirty) && <button onClick={() => setTab('review')}>Resume archived review</button>}
      <Suspense fallback={<p role="status">Loading view…</p>}>
      {tab === 'collector' || tab === 'review' ? <>
        {tab === 'collector' ? <>
        {advisor.workspace.map && <section className="map-session" data-state={advisor.needsMapConfirmation ? 'confirmation' : advisor.workspace.map ? 'active' : 'empty'} aria-label="Area session">
          <div><strong>{advisor.needsMapConfirmation ? 'Confirm your current area.' : advisor.workspace.map ? 'Area session active' : 'No active area'}</strong><p>{advisor.workspace.map?.startedAt ? `Started ${new Date(advisor.workspace.map.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}{advisor.needsMapConfirmation && ' · Fates belong to this instance.'}</p></div>
          <div className="map-session-actions">{advisor.canUndo && <button className="text-button" aria-label="Undo collection change" disabled={busy} onClick={advisor.undo}>Undo</button>}{advisor.needsMapConfirmation && <button disabled={busy} onClick={advisor.confirmMap}>Continue this area</button>}</div>
        </section>}
        {!advisor.workspace.map && !!draft.cards.length && advisor.canUndo && <button disabled={busy} onClick={advisor.undo}>Undo collection change</button>}
        {advisor.storageError && <p className="notice error" role="alert">{advisor.storageError}</p>}
        <FateAdvisor solverControl={solver} savedOffers={records.map(record => record.offer)} offer={draft} workspace={advisor.workspace} onChange={advisor.changeWorkspace} needsMapConfirmation={advisor.needsMapConfirmation} onUseOffer={useCurrentOffer} busy={busy} saved={savedLocally && !dirty} automatic={sync.status === 'active'} onEditOffer={editCurrentOffer} source={<SourcePanel compact={!!draft.cards.length || !!advisor.workspace.collection.cards.length} evidence={evidence} automatic={sync.status === 'active'} onPick={() => fileInput.current?.click()} onFile={file => void loadFile(file)} />} />
        {sync.status !== 'off' && <button className="connection-status text-button" onClick={() => connectionPanel.current?.show()}>{sync.status === 'active' ? 'Local review connected' : sync.status === 'permission' ? 'Folder access needed' : sync.status === 'error' ? 'Local review needs attention' : 'Local review settings'}</button>}
        {sync.problem && <p className="connection-warning field-error" role="alert">{sync.problem}</p>}
        </> : <>
        <div className="archive-boundary"><p>This archived offer is not used in current-area advice. Only transfer it if it belongs to the instance you are playing now.{archiveEditor.dirty ? ' Save corrections before transferring.' : ''}{advisor.needsMapConfirmation ? ' Confirm your area on the Current area screen first.' : ''}</p><div><button onClick={() => setTab('collector')}>Return to current area</button><button disabled={busy || autoSaving || archiveEditor.dirty || advisor.needsMapConfirmation} onClick={useArchivedOffer}>{advisor.workspace.map ? 'Use this offer in current area' : 'Start area with this offer'}</button></div></div>
        <div className={`collector-grid ${draft.cards.length ? 'has-fates' : ''} ${busy ? 'is-busy' : ''}`} aria-busy={busy} inert={busy}>
          <SourcePanel evidence={evidence} automatic={sync.status === 'active'} onPick={() => fileInput.current?.click()} onFile={file => void loadFile(file)} />
          <OfferPreview offer={draft} saved={savedLocally && !dirty} automatic={sync.status === 'active'} />
        </div></>}
        <DetailPanel trigger={false} ref={detailsPanel} onOpenChange={setEditing} className="advanced-panel" key={`${tab}:${draft.id}`} title="Edit details" footer={<>{editing && saveBar}<button onClick={returnToAdvice}>{tab === 'collector' ? 'Back to advice' : 'Done'}</button></>}><div className={`advanced-grid ${evidence ? 'has-review-evidence' : ''}`} inert={busy}>
          <OfferEditor solverControl={solver} offer={draft} onChange={change} evidence={evidence} showRecordedChoice={tab === 'review'} reviewRequest={tab === 'collector' ? reviewRequest : null} />
          <CaptureDetails offer={draft} evidence={evidence} onChange={change} />
        </div></DetailPanel>
        {!editing && saveBar}
      </> : tab === 'guide' ? <UsageGuide onConnect={() => connectionPanel.current?.show()} onMap={() => leaveGuide('collector')} onSaved={() => leaveGuide('saved')} onDiagnostics={() => leaveGuide('diagnostics')} /> : tab === 'diagnostics' ? <Diagnostics environment={environment} folderConnection={sync.status} sharing={consentState.error ? 'error' : consentState.active ? 'active' : consentState.records.some(item => item.withdrawnAt && !item.withdrawalConfirmedAt) ? 'withdrawal-pending' : consentState.current ? 'pending' : 'off'} /> : <SavedOffers consentState={consentState} records={records} unreadableOffers={unreadableOffers} damagedEvidenceCount={damagedEvidenceCount} isolatedCount={isolatedCount} missingEvidenceIds={missingEvidenceIds} onImport={() => fileInput.current?.click()} onRecoverBackup={() => recoveryInput.current?.click()} onIsolate={key => { if (window.confirm('Isolate this unreadable record? Its original data is preserved in recovery storage and can be exported.')) void storage.isolateUnreadableOffer(key).then(refresh).catch(error => announce(errorText(error), true)) }} onRecovery={() => void exportRecovery()} busy={busy || autoSaving} pendingOfferIds={[mapEditor, archiveEditor].filter(item => item.dirty).map(item => item.draft.id)} onOpen={id => void open(id)} onDelete={id => void remove(id)} onDeleteMany={removeMany} onExport={(includeEvidence, ids) => void exportAll(includeEvidence, ids)} onShare={offer => void share(offer)} accessKey={accessKey} setAccessKey={setAccessKey} connected={connected} onCheckConnection={() => { void collectionStatus().then(value => { setConnected(value); announce(value ? 'Collection API is configured. Enter your access key to share reviewed offers.' : 'Collection API is not configured. Local collection works normally.') }).catch(() => { setConnected(false); announce('Collection API is unreachable. Local collection works normally.', true) }) }} />}
      </Suspense>
      {importConflicts.length > 0 && <ImportConflicts conflicts={importConflicts} onUpdated={refresh} onClose={() => setImportConflicts([])} />}
      <LazySymbolReports ref={symbolReportsPanel} offer={draft} evidence={evidence} />
      {backup && <BackupDownload {...backup} onRecovery={() => void exportRecovery()} onClose={closeBackup} />}
      <input ref={fileInput} className="file-input" type="file" multiple accept=".json,image/png,image/jpeg" aria-label="Import capture file" onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) void loadFile(files); event.target.value = '' }} />
      <input ref={recoveryInput} className="file-input" type="file" accept=".json" aria-label="Recover damaged backup" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file, true); event.target.value = '' }} />
      <DetailPanel trigger={false} className="map-capture-connection" ref={connectionPanel} title="Local review"><CaptureConnection sync={sync} /></DetailPanel>
    </main>
    <footer className="app-footer">Advisor uses identified rewards and preview rules. Unknown icons need manual review.<span>Independent community tool · Not affiliated with Grinding Gear Games</span></footer>
    </div></div>
  </>
}
