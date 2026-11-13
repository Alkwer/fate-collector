import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { Evidence, Offer } from '../../shared/schema'
import { newCard, newOffer } from '../../shared/offers'
import { SYMBOL_REPORT_LIMIT, SYMBOL_REPORT_VERSION, symbolConsentText, symbolReportSchema, type SymbolReport } from '../../shared/symbol-reports'
import { prepareSymbolImage, saveSymbolSubmission, sendSymbolReport, symbolImageUrl, withdrawSymbolReport, type SymbolVerification } from '../lib/symbol-reports'
import { discardSymbolDraft, readSymbolDrafts, writeSymbolDraft, type LocalSymbolDraft } from '../lib/symbol-report-storage'
import { DetailPanel, type DetailPanelHandle } from './DetailPanel'
import { SymbolReportHistory } from './SymbolReportHistory'
import { SymbolReportVerification, type SymbolReportVerificationHandle } from './SymbolReportVerification'
import { parseSymbolDraft } from '../../shared/symbol-drafts'
import { symbolDraftContext } from '../lib/symbol-drafts'
import { getOffer } from '../lib/storage'
import '../symbol-reports.css'

function CaptureCrop({ source, onCrop }: { source: string; onCrop: (image: SymbolReport['icon']) => void }) {
  const panel = useRef<DetailPanelHandle>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [box, setBox] = useState({ x: 0, y: 0, width: 48, height: 48 })
  const start = useRef<{ x: number; y: number } | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <DetailPanel ref={panel} title="Crop symbol from capture">
    <p>Drag around one symbol, or enter its rectangle in original image pixels. Include its border.</p>
    <div className="symbol-crop" onPointerDown={event => {
      if (!size.width) return
      const bounds = event.currentTarget.getBoundingClientRect()
      start.current = { x: Math.floor((event.clientX - bounds.left) / bounds.width * size.width), y: Math.floor((event.clientY - bounds.top) / bounds.height * size.height) }
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={event => {
      if (!start.current) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const x = Math.max(0, Math.min(size.width, Math.round((event.clientX - bounds.left) / bounds.width * size.width)))
      const y = Math.max(0, Math.min(size.height, Math.round((event.clientY - bounds.top) / bounds.height * size.height)))
      setBox({ x: Math.min(x, start.current.x), y: Math.min(y, start.current.y), width: Math.abs(x - start.current.x), height: Math.abs(y - start.current.y) })
    }} onPointerUp={() => { start.current = null }} onPointerCancel={() => { start.current = null }}>
      <img src={source} alt="Capture to crop" draggable={false} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      {!!size.width && <span className="symbol-crop-selection" style={{ left: `${box.x / size.width * 100}%`, top: `${box.y / size.height * 100}%`, width: `${box.width / size.width * 100}%`, height: `${box.height / size.height * 100}%` }} />}
    </div>
    <div className="symbol-crop-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key}<input type="number" min={key === 'x' || key === 'y' ? 0 : 8} value={box[key]} onChange={event => setBox({ ...box, [key]: Number(event.target.value) })} /></label>)}</div>
    <button disabled={busy || !size.width} onClick={() => {
      setBusy(true); setError('')
      void prepareSymbolImage(source, 'icon', box).then(image => { onCrop(image); panel.current?.close() }).catch(error => setError(error instanceof Error ? error.message : 'Could not crop image.')).finally(() => setBusy(false))
    }}>{busy ? 'Preparing…' : 'Use this crop'}</button>
    {error && <p role="alert">{error}</p>}
  </DetailPanel>
}

export interface SymbolReportsHandle { showNew: () => void; showHistory: () => void }
export function SymbolReports({ offer, evidence, ref }: { offer: Offer; evidence: Evidence | null; ref: Ref<SymbolReportsHandle> }) {
  const panel = useRef<DetailPanelHandle>(null)
  const verification = useRef<SymbolReportVerificationHandle>(null)
  const helperFilePanel = useRef<DetailPanelHandle>(null)
  const draftPanel = useRef<DetailPanelHandle>(null)
  const generation = useRef(0)
  const renderGeneration = generation.current
  const [context, setContext] = useState<Offer | null>(null), [source, setSource] = useState<string | null>(null)
  const [cardId, setCardId] = useState(''), [rewardId, setRewardId] = useState('')
  const [label, setLabel] = useState(''), [kind, setKind] = useState<SymbolReport['rewardKind']>('unknown'), [threshold, setThreshold] = useState('')
  const [description, setDescription] = useState(''), [gameVersion, setGameVersion] = useState('')
  const [icon, setIcon] = useState<SymbolReport['icon'] | null>(null), [tooltip, setTooltip] = useState<SymbolReport['tooltip'] | null>(null)
  const [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [storageError, setStorageError] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [helperDraft, setHelperDraft] = useState(false), [linkedOffer, setLinkedOffer] = useState(false)
  const [helperEntry, setHelperEntry] = useState(false)
  const [open, setOpen] = useState(false)
  const [draftId, setDraftId] = useState('')
  const [edited, setEdited] = useState(false)
  const [drafts, setDrafts] = useState<LocalSymbolDraft[]>([])
  const [draftStatus, setDraftStatus] = useState('')
  const [draftError, setDraftError] = useState('')
  const [draftPanelError, setDraftPanelError] = useState('')
  const draftWrites = useRef<Promise<void>>(Promise.resolve())
  const draftRevision = useRef<{ id: string; revision: string | null }>({ id: '', revision: null })
  const draftReadGeneration = useRef(0)
  const draftWriteGeneration = useRef(0)
  const card = context?.cards.find(card => card.id === cardId)
  const refreshDrafts = useCallback(() => {
    const request = ++draftReadGeneration.current
    void draftWrites.current.then(readSymbolDrafts).then(rows => {
      if (request === draftReadGeneration.current) setDrafts(rows)
    }).catch(error => {
      if (request === draftReadGeneration.current) setDraftPanelError(error instanceof Error ? error.message : 'Symbol drafts are unavailable.')
    })
  }, [])
  useEffect(() => {
    if (!context || !draftId || !edited || savedId) return
    setDraftStatus('')
    const request = ++draftWriteGeneration.current
    const active = draftRevision.current
    const snapshot: LocalSymbolDraft = { id: draftId, origin: location.origin, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(),
      context, cardId, rewardId, label, rewardKind: kind, threshold, description, gameVersion, icon, tooltip, fromHelper: helperDraft, linkedOffer }
    draftWrites.current = draftWrites.current.then(async () => {
      if (!await writeSymbolDraft(snapshot, active.revision)) throw new Error('This draft changed in another tab. Reopen the saved draft before editing it here.')
      active.revision = snapshot.revision
      if (active === draftRevision.current && request === draftWriteGeneration.current) { setDraftError(''); setDraftStatus('Draft saved in this browser.') }
    }).catch(error => {
      if (active === draftRevision.current && request === draftWriteGeneration.current) {
        setDraftError(error instanceof Error ? error.message : 'The draft could not be saved.')
        setDraftStatus('')
      }
    })
  }, [context, draftId, edited, savedId, cardId, rewardId, label, kind, threshold, description, gameVersion, icon, tooltip, helperDraft, linkedOffer])
  function startDraft(id: string, revision: string | null = null) {
    draftRevision.current = { id, revision }
    setDraftId(id); setDraftStatus(''); setDraftError(''); setEdited(false)
  }
  function newReport(linkCurrentOffer = true) {
    generation.current++; setBusy(false)
    verification.current?.cancel()
    const linked = linkCurrentOffer && !!offer.cards.length
    const next = linked ? structuredClone(offer) : { ...newOffer(), origin: 'live' as const, gameVersion: 'unknown', cards: [newCard()] }
    startDraft(crypto.randomUUID())
    setContext(next); setSource(linked ? evidence?.imageDataUrl || null : null); setCardId(next.cards[0].id); setRewardId('')
    setLabel(''); setKind('unknown'); setThreshold(''); setDescription(''); setGameVersion(linked ? next.gameVersion : '')
    setIcon(null); setTooltip(null); setAgreed(false); setSavedId(null); setMessage(''); setError('')
    setHelperDraft(false); setLinkedOffer(linked); setHelperEntry(false)
  }
  useImperativeHandle(ref, () => ({
    showNew() { newReport(); panel.current?.show() },
    showHistory() {
      generation.current++
      verification.current?.cancel()
      setContext(null); setSource(null); setIcon(null); setTooltip(null)
      startDraft('')
      setBusy(false); setAgreed(false); setSavedId(null); setHelperDraft(false); setLinkedOffer(false); setHelperEntry(false)
      setError(''); setMessage('')
      panel.current?.show()
    },
  }))
  function restoreDraft(draft: LocalSymbolDraft) {
    generation.current++
    verification.current?.cancel()
    startDraft(draft.id, draft.revision)
    setContext(draft.context); setCardId(draft.cardId); setRewardId(draft.rewardId)
    setLabel(draft.label); setKind(draft.rewardKind); setThreshold(draft.threshold); setDescription(draft.description); setGameVersion(draft.gameVersion)
    setIcon(draft.icon); setTooltip(draft.tooltip); setHelperDraft(draft.fromHelper); setLinkedOffer(draft.linkedOffer)
    setSavedId(null); setAgreed(false); setHelperEntry(false); setSource(null); setError('')
    setMessage('Draft restored. Check the previews and consent before sending.')
    draftPanel.current?.close()
  }
  useEffect(() => {
    const openHelper = () => {
      if (location.hash !== '#report-symbol') return
      setHelperEntry(true); panel.current?.show()
      history.replaceState(history.state, '', location.pathname + location.search)
    }
    openHelper(); window.addEventListener('hashchange', openHelper)
    return () => window.removeEventListener('hashchange', openHelper)
  }, [])
  async function importHelper(read: () => Promise<string>) {
    if (busy) return
    if (!savedId && (icon || tooltip) && !window.confirm('Replace the current symbol report draft with the helper images?')) return
    const current = ++generation.current
    verification.current?.cancel(); setBusy(true); setAgreed(false); setError(''); setMessage('')
    try {
      const draft = await parseSymbolDraft(await read())
      const candidate = draft.captureId ? offer.captureId === draft.captureId ? offer : (await getOffer(draft.captureId))?.offer : null
      const prepared = symbolDraftContext(draft, candidate)
      if (generation.current !== current) return
      if (!draftId || savedId) startDraft(crypto.randomUUID())
      setContext(prepared.offer); setSource(null); setCardId(prepared.offer.cards[0].id); setRewardId('')
      setLabel(''); setKind('unknown'); setThreshold(''); setDescription(''); setGameVersion(prepared.offer.gameVersion)
      setIcon(draft.icon); setTooltip(draft.tooltip); setAgreed(false); setSavedId(null)
      setHelperDraft(true); setLinkedOffer(prepared.linked); setHelperEntry(false); setEdited(true)
      helperFilePanel.current?.close()
      setMessage('Both helper images are ready. Check the previews before sending. Nothing has been uploaded.')
    } catch (error) { if (generation.current === current) setError(error instanceof Error ? error.message : 'Could not import the helper draft.') }
    finally { if (generation.current === current) setBusy(false) }
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (!panel.current?.isOpen() || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const text = event.clipboardData?.getData('text/plain') || ''
      if (!helperEntry && !text.includes('fate-collector.symbol-draft')) return
      event.preventDefault(); event.stopImmediatePropagation()
      void importHelper(async () => text)
    }
    window.addEventListener('paste', paste, true)
    return () => window.removeEventListener('paste', paste, true)
  })
  async function act(action: (isCurrent: () => boolean, verify: SymbolVerification) => Promise<void>) {
    const current = generation.current, isCurrent = () => generation.current === current
    const verify: SymbolVerification = async (action, id) => {
      if (!isCurrent() || !panel.current?.isOpen() || !verification.current) {
        throw new Error('Verification cancelled. Your report is saved on this device.')
      }
      const token = await verification.current.verify(action, id)
      if (!isCurrent()) throw new Error('Verification cancelled. Your report is saved on this device.')
      setMessage(action === 'symbol-withdraw' ? 'Confirming withdrawal…' : 'Sending report…')
      return token
    }
    setBusy(true); setError(''); setMessage('')
    try { await action(isCurrent, verify) } catch (error) { if (isCurrent()) { setMessage(''); setError(error instanceof Error ? error.message : 'Request failed. Keep the images and retry.') } }
    finally { if (isCurrent()) setBusy(false) }
  }
  async function imageFile(file: File | undefined, target: 'icon' | 'tooltip') {
    if (!file) return
    await act(async isCurrent => { const image = await prepareSymbolImage(file, target); if (!isCurrent()) return; if (target === 'icon') setIcon(image); else setTooltip(image); setAgreed(false); setEdited(true) })
  }
  return <DetailPanel ref={panel} trigger={false} title="Report a reward symbol" className="symbol-reports" onOpenChange={open => {
    setOpen(open)
    if (!open) { verification.current?.cancel(); generation.current++; setBusy(false); setAgreed(false) }
  }}>
    <p>{helperDraft ? 'Check the symbol and tooltip captured by your helper. Reports are reviewed before the catalog changes.' : 'Send a symbol image and its tooltip for review. Reports go to the shared collection; recognition changes only after verification and a catalog update.'}</p>
    <p className="hint">No collection key is needed. Complete a security check when sending. Limit: 5 new reports per network per day, resetting at midnight UTC.</p>
    <SymbolReportVerification ref={verification} />
    {storageError && <p role="alert" className="storage-warning">{storageError}</p>}
    <DetailPanel ref={draftPanel} title="Saved symbol drafts" onOpenChange={open => { if (open) { setDraftPanelError(''); refreshDrafts() } }}>
      <p>Restore a draft to review it. Sending requires fresh consent and a security check.</p>
      {draftPanelError && <p role="alert">{draftPanelError}</p>}
      {drafts.length === 0 && <p>No saved drafts.</p>}
      {drafts.map(draft => <article key={draft.id} className="symbol-draft-row">
        <strong>{draft.label || draft.context.cards.find(card => card.id === draft.cardId)?.name || 'Unidentified symbol'}</strong>
        <p>{new Date(draft.updatedAt).toLocaleString()} · {draft.icon && draft.tooltip ? 'Both images ready' : 'Draft incomplete'}</p>
        <div className="row-actions">
          <button disabled={busy} onClick={() => restoreDraft(draft)}>Restore draft</button>
          <button disabled={busy} className="text-button" onClick={() => {
            if (!window.confirm('Discard this saved symbol draft and its images?')) return
            void act(async isCurrent => {
              try {
                if (!await discardSymbolDraft(draft)) throw new Error('This draft changed. Review the latest version.')
                if (isCurrent() && draftId === draft.id) newReport()
                if (isCurrent()) setDraftPanelError('')
              } catch (error) {
                if (isCurrent()) setDraftPanelError(error instanceof Error ? error.message : 'The draft could not be discarded.')
              } finally { refreshDrafts() }
            })
          }}>Discard draft</button>
        </div>
      </article>)}
    </DetailPanel>
    {(!helperDraft || helperEntry) && <section className="symbol-helper-import" aria-label="Import from Windows helper">
      <h3>{helperDraft ? 'Images from Windows helper' : 'Captured with the helper?'}</h3>
      <p>{helperDraft ? 'You can replace the images by pasting a new helper draft.' : 'After Ctrl+Shift+F9 in the game, paste both selected images here. Nothing is sent until you approve the previews.'}</p>
      <button disabled={busy} onClick={() => void importHelper(async () => {
        try { return await navigator.clipboard.readText() } catch { throw new Error('Clipboard access is unavailable. Press Ctrl+V in this panel, or import the saved helper draft.') }
      })}>{busy ? 'Preparing…' : 'Paste from helper'}</button>
      <DetailPanel ref={helperFilePanel} title="Import saved helper draft">
        <p>If the clipboard changed, choose the JSON draft in the helper’s symbol-reports folder.</p>
        <label>Helper draft file<input type="file" accept="application/json,.json" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (file) void importHelper(async () => {
            if (file.size > SYMBOL_REPORT_LIMIT) throw new Error('This helper draft is too large. Capture tighter symbol and tooltip crops.')
            return file.text()
          })
        }} /></label>
      </DetailPanel>
    </section>}
    {savedId ? <p role="status">Report saved on this device. Its upload status is shown in history below.</p> : context?.cards.length ? <fieldset disabled={busy} className="symbol-report-form" onChange={() => setAgreed(false)}>
      <legend>{helperDraft ? 'Check your images' : 'New report'}</legend>
      {context.cards.length > 1 ? <div className="context-fields">
        <label>Fate<select value={cardId} onChange={event => { setCardId(event.target.value); setRewardId(''); setLabel(''); setKind('unknown'); setThreshold(''); setEdited(true) }}>{context.cards.map(card => <option key={card.id} value={card.id}>{card.name || 'Unnamed Fate'}</option>)}</select></label>
      </div> : <p>Fate <strong>{card?.name || (linkedOffer ? 'Unnamed Fate' : 'Not identified')}</strong></p>}
      {helperDraft && linkedOffer && <p className="hint">Context comes from the last F9 offer. Check that the selected Fate matches these images.</p>}
      <div className="symbol-report-images">
        <section><h3>Symbol image</h3>{!helperDraft && <p className="hint">Crop tightly around one icon, including its border.</p>}
          {source && <CaptureCrop key={renderGeneration} source={source} onCrop={image => { if (renderGeneration !== generation.current) return; setIcon(image); setAgreed(false); setEdited(true); setMessage('Crop selected. Check its preview below.') }} />}
          {!helperDraft && <label>Choose symbol image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void imageFile(event.target.files?.[0], 'icon'); event.target.value = '' }} /></label>}
          {icon && <img className="symbol-image-preview" src={symbolImageUrl(icon)} alt="Symbol image to send" />}
        </section>
        <section><h3>Tooltip image</h3>{!helperDraft && <p className="hint">Include the effect and combo threshold, if shown.</p>}
          {!helperDraft && <label>Choose tooltip image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void imageFile(event.target.files?.[0], 'tooltip'); event.target.value = '' }} /></label>}
          {tooltip && <><img className="symbol-tooltip-preview" src={symbolImageUrl(tooltip)} alt="Tooltip image to send" /><DetailPanel title="Enlarge tooltip"><img className="symbol-tooltip-full" src={symbolImageUrl(tooltip)} alt="Full size tooltip to send" /></DetailPanel></>}
        </section>
      </div>
      <div className="symbol-report-details">
        {helperDraft && <button type="button" className="text-button" onClick={() => setHelperEntry(value => !value)}>{helperEntry ? 'Keep these images' : 'Replace helper images'}</button>}
        <DetailPanel title="Optional details">
          <div className="context-fields" onChange={() => setEdited(true)}>
            {!linkedOffer && <label>Fate name<input value={card?.name || ''} maxLength={160} onChange={event => setContext({ ...context, cards: context.cards.map(row => row.id === cardId ? { ...row, name: event.target.value } : row) })} /></label>}
            {linkedOffer && <label>Reward<select value={rewardId} onChange={event => {
              setRewardId(event.target.value); const reward = card?.rewards.find(reward => reward.id === event.target.value)
              setLabel(reward?.label || ''); setKind(reward?.kind || 'unknown'); setThreshold(reward?.threshold?.toString() || '')
            }}><option value="">New / unrecorded symbol</option>{card?.rewards.map((reward, index) => <option key={reward.id} value={reward.id}>{index + 1}. {reward.label || 'Unidentified'}</option>)}</select></label>}
            <label>Reward name<input value={label} maxLength={160} onChange={event => setLabel(event.target.value)} /></label>
            <label>Reward kind<select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setThreshold('') }}><option value="unknown">Unknown</option><option value="regular">Regular</option><option value="combo">Combo</option></select></label>
            {kind === 'combo' && <label>Combo threshold<input type="number" min={1} max={100} value={threshold} onChange={event => setThreshold(event.target.value)} /></label>}
            <label>Game version<input value={gameVersion} placeholder={context.gameVersion.trim() || 'Unknown'} maxLength={64} onChange={event => setGameVersion(event.target.value)} /></label>
            <label className="symbol-report-description">Description / tooltip text<textarea rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          </div>
        </DetailPanel>
        <DetailPanel title="References included in this report" triggerLabel="Source references">
          <dl className="symbol-references">
            <dt>Evidence</dt><dd>{context.origin === 'test' ? 'Test / showcase evidence' : 'Live game evidence'}</dd>
            <dt>{linkedOffer ? 'Offer ID' : 'Local reference ID'}</dt><dd>{context.id}</dd>
            {linkedOffer && <><dt>Offer revision</dt><dd>{context.revision}</dd></>}
            <dt>Capture ID</dt><dd>{context.captureId || 'None'}</dd>
            <dt>Card ID</dt><dd>{cardId}</dd>
            <dt>Reward ID</dt><dd>{rewardId || 'None'}</dd>
            <dt>Area level</dt><dd>{context.areaLevel ?? 'Unknown'}</dd>
          </dl>
          <p>{linkedOffer ? 'These references can link the report to an offer or OCR capture already in the collection.' : 'This report has no linked offer.'}</p>
        </DetailPanel>
      </div>
    </fieldset> : null}
    {!savedId && card && <>
      <p className="symbol-consent">{symbolConsentText(location.origin)}</p>
      <label className="checkbox-row"><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} />I checked both previews and agree to send this report.</label>
      <button className="primary-button symbol-report-send" disabled={busy || !!storageError || !agreed || !icon || !tooltip} onClick={() => void act(async (isCurrent, verify) => {
        if (!context || !card || !icon || !tooltip || !agreed) return
        await draftWrites.current
        if (!isCurrent()) return
        const report = symbolReportSchema.parse({ kind: 'fate-collector.symbol-report', schemaVersion: 1, id: draftId, createdAt: new Date().toISOString(),
          offer: { id: context.id, revision: context.revision, captureId: context.captureId, cardId, cardName: card.name, rewardId: rewardId || null, gameVersion: gameVersion.trim() || context.gameVersion.trim() || 'unknown', origin: context.origin, areaLevel: context.areaLevel },
          label, rewardKind: kind, threshold: kind === 'combo' && threshold ? Number(threshold) : null, description, icon, tooltip })
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
        await saveSymbolSubmission({ report, token, consent: { version: SYMBOL_REPORT_VERSION, text: symbolConsentText(location.origin), acceptedAt: new Date().toISOString() } }, draftRevision.current.revision)
        if (draftRevision.current.id === report.id) {
          setSavedId(report.id)
          setAgreed(false)
          setIcon(null)
          setTooltip(null)
        }
        await sendSymbolReport(report.id, verify); if (isCurrent()) setMessage('Received by the collection.')
      })}>{busy ? 'Sending…' : 'Send symbol report'}</button>
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {!savedId && draftStatus && <p className="hint" role="status">{draftStatus}</p>}
    {draftError && <p role="alert">{draftError}</p>}
    {(!context || savedId) && <button className="text-button" disabled={busy} onClick={() => newReport()}>{offer.cards.length ? 'Start another report from current offer' : 'Start a manual report'}</button>}
    {!savedId && linkedOffer && <button className="text-button" disabled={busy} onClick={() => newReport(false)}>Start a report without an offer</button>}
    <SymbolReportHistory open={open} busy={busy} onStorageError={setStorageError} onRestore={refreshDrafts}
      onRetry={id => void act(async (isCurrent, verify) => { await sendSymbolReport(id, verify); if (isCurrent()) setMessage('Received by the collection.') })}
      onWithdraw={id => void act(async (isCurrent, verify) => { await withdrawSymbolReport(id, verify); if (isCurrent()) setMessage('Withdrawal confirmed. Images and description removed from the collection.') })} />
  </DetailPanel>
}
