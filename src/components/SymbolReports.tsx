import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { Evidence, Offer } from '../../shared/schema'
import { SYMBOL_REPORT_VERSION, symbolConsentText, symbolReportSchema, type SymbolReport } from '../../shared/symbol-reports'
import { prepareSymbolImage, saveSymbolSubmission, sendSymbolReport, symbolImageUrl, symbolReportHistory, withdrawSymbolReport, type LocalSymbolReport, type SymbolVerification } from '../lib/symbol-reports'
import { DetailPanel, type DetailPanelHandle } from './DetailPanel'
import { SymbolReportVerification, type SymbolReportVerificationHandle } from './SymbolReportVerification'
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
  const generation = useRef(0)
  const renderGeneration = generation.current
  const [context, setContext] = useState<Offer | null>(null), [source, setSource] = useState<string | null>(null)
  const [cardId, setCardId] = useState(''), [rewardId, setRewardId] = useState('')
  const [label, setLabel] = useState(''), [kind, setKind] = useState<SymbolReport['rewardKind']>('unknown'), [threshold, setThreshold] = useState('')
  const [description, setDescription] = useState(''), [gameVersion, setGameVersion] = useState('')
  const [icon, setIcon] = useState<SymbolReport['icon'] | null>(null), [tooltip, setTooltip] = useState<SymbolReport['tooltip'] | null>(null)
  const [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<LocalSymbolReport[]>([]), [message, setMessage] = useState(''), [error, setError] = useState(''), [storageError, setStorageError] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const card = context?.cards.find(card => card.id === cardId)
  async function refresh() {
    try { setRows(await symbolReportHistory()); setStorageError('') } catch (error) { setStorageError(error instanceof Error ? error.message : 'Report history is unavailable.') }
  }
  function newReport() {
    generation.current++; setBusy(false)
    verification.current?.cancel()
    setContext(structuredClone(offer)); setSource(evidence?.imageDataUrl || null); setCardId(offer.cards[0]?.id || ''); setRewardId('')
    setLabel(''); setKind('unknown'); setThreshold(''); setDescription(''); setGameVersion(offer.gameVersion || '')
    setIcon(null); setTooltip(null); setAgreed(false); setSavedId(null); setMessage(''); setError('')
  }
  useImperativeHandle(ref, () => ({ showNew() { newReport(); panel.current?.show() }, showHistory() { panel.current?.show() } }))
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
    finally { await refresh(); if (isCurrent()) setBusy(false) }
  }
  async function imageFile(file: File | undefined, target: 'icon' | 'tooltip') {
    if (!file) return
    await act(async isCurrent => { const image = await prepareSymbolImage(file, target); if (!isCurrent()) return; if (target === 'icon') setIcon(image); else setTooltip(image); setAgreed(false) })
  }
  return <DetailPanel ref={panel} trigger={false} title="Report a reward symbol" className="symbol-reports" onOpenChange={open => {
    if (open) void refresh()
    else verification.current?.cancel()
  }}>
    <p>Send a symbol image and its tooltip for review. Reports go to the shared collection; recognition changes only after verification and a catalog update.</p>
    <p className="hint">No collection key is needed. Complete a security check when sending. Limit: 5 new reports per network per day, resetting at midnight UTC.</p>
    <SymbolReportVerification ref={verification} />
    {storageError && <p role="alert" className="storage-warning">{storageError}</p>}
    {savedId ? <p role="status">Report saved on this device. Its upload status is shown in history below.</p> : context?.cards.length ? <fieldset disabled={busy} className="symbol-report-form" onChange={() => setAgreed(false)}>
      <legend>New report</legend>
      <div className="context-fields">
        <label>Fate<select value={cardId} onChange={event => { setCardId(event.target.value); setRewardId(''); setLabel(''); setKind('unknown'); setThreshold('') }}>{context.cards.map(card => <option key={card.id} value={card.id}>{card.name || 'Unnamed Fate'}</option>)}</select></label>
        <label>Reward<select value={rewardId} onChange={event => {
          setRewardId(event.target.value); const reward = card?.rewards.find(reward => reward.id === event.target.value)
          setLabel(reward?.label || ''); setKind(reward?.kind || 'unknown'); setThreshold(reward?.threshold?.toString() || '')
        }}><option value="">New / unrecorded symbol</option>{card?.rewards.map((reward, index) => <option key={reward.id} value={reward.id}>{index + 1}. {reward.label || 'Unidentified'}</option>)}</select></label>
        <label>Game version<input value={gameVersion} maxLength={64} onChange={event => setGameVersion(event.target.value)} /></label>
      </div>
      <p className="hint">{context.origin === 'test' ? 'Test / showcase evidence' : 'Live game evidence'} · Offer {context.id} · revision {context.revision}. This report keeps these references; it does not share or change the full offer.</p>
      <DetailPanel title="References included in this report"><dl className="symbol-references"><dt>Capture ID</dt><dd>{context.captureId || 'None'}</dd><dt>Card ID</dt><dd>{cardId}</dd><dt>Reward ID</dt><dd>{rewardId || 'None'}</dd><dt>Area level</dt><dd>{context.areaLevel ?? 'Unknown'}</dd></dl><p>These identifiers can link the report to an offer or OCR capture already in the collection.</p></DetailPanel>
      <div className="symbol-report-images">
        <section><h3>Symbol image</h3><p className="hint">Crop tightly around one icon, including its border.</p>
          {source && <CaptureCrop key={renderGeneration} source={source} onCrop={image => { if (renderGeneration !== generation.current) return; setIcon(image); setAgreed(false); setMessage('Crop selected. Check its preview below.') }} />}
          <label>Choose symbol image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void imageFile(event.target.files?.[0], 'icon'); event.target.value = '' }} /></label>
          {icon && <img className="symbol-image-preview" src={symbolImageUrl(icon)} alt="Symbol image to send" />}
        </section>
        <section><h3>Tooltip image</h3><p className="hint">Include the effect and combo threshold, if shown.</p>
          <label>Choose tooltip image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void imageFile(event.target.files?.[0], 'tooltip'); event.target.value = '' }} /></label>
          {tooltip && <><img className="symbol-tooltip-preview" src={symbolImageUrl(tooltip)} alt="Tooltip image to send" /><DetailPanel title="Enlarge tooltip"><img className="symbol-tooltip-full" src={symbolImageUrl(tooltip)} alt="Full size tooltip to send" /></DetailPanel></>}
        </section>
      </div>
      <div className="context-fields">
        <label>Reward name (optional)<input value={label} maxLength={160} onChange={event => setLabel(event.target.value)} /></label>
        <label>Reward kind<select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setThreshold('') }}><option value="unknown">Unknown</option><option value="regular">Regular</option><option value="combo">Combo</option></select></label>
        {kind === 'combo' && <label>Combo threshold (if known)<input type="number" min={1} max={100} value={threshold} onChange={event => setThreshold(event.target.value)} /></label>}
      </div>
      <label>Description / tooltip text (optional)<textarea rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    </fieldset> : <p>Open or import an offer with at least one Fate to report a symbol. Existing reports remain available below.</p>}
    {!savedId && card && <>
      <p className="symbol-consent">{symbolConsentText(location.origin)}</p>
      <label className="checkbox-row"><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} />I checked both previews and agree to send this report.</label>
      <button disabled={busy || !!storageError || !agreed || !icon || !tooltip || !gameVersion.trim()} onClick={() => void act(async (isCurrent, verify) => {
        if (!context || !card || !icon || !tooltip || !agreed) return
        const report = symbolReportSchema.parse({ kind: 'fate-collector.symbol-report', schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
          offer: { id: context.id, revision: context.revision, captureId: context.captureId, cardId, cardName: card.name, rewardId: rewardId || null, gameVersion, origin: context.origin, areaLevel: context.areaLevel },
          label, rewardKind: kind, threshold: kind === 'combo' && threshold ? Number(threshold) : null, description, icon, tooltip })
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
        await saveSymbolSubmission({ report, token, consent: { version: SYMBOL_REPORT_VERSION, text: symbolConsentText(location.origin), acceptedAt: new Date().toISOString() } })
        if (isCurrent()) { setSavedId(report.id); setAgreed(false) }
        await sendSymbolReport(report.id, verify); if (isCurrent()) setMessage('Received by the collection.')
      })}>{busy ? 'Sending…' : 'Send symbol report'}</button>
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <button className="text-button" disabled={busy || !offer.cards.length} onClick={newReport}>Start another report from current offer</button>
    <section className="symbol-report-history"><h3>Symbol report history</h3><p className="hint">Reports stay on this device for retries and withdrawal. Keep this browser's site data until withdrawal is confirmed.</p>
      {!rows.length && <p>No saved reports.</p>}
      {rows.map(row => <article key={row.id}>
        <img src={symbolImageUrl(row.submission.report.icon)} width={48} height={48} alt="Submitted symbol" />
        <div><strong>{row.submission.report.label || 'Unidentified symbol'}</strong><p>{row.withdrawnAt ? 'Withdrawn — removed from collection' : row.withdrawRequestedAt ? 'Withdrawal pending — retry below' : row.expired ? 'Expired or removed from collection' : row.receipt ? Date.parse(row.receipt.expiresAt) <= Date.now() ? 'Expired in collection' : 'Received — review status unavailable' : 'Saved locally — upload not confirmed'}</p>
          <small>{new Date(row.submission.report.createdAt).toLocaleString()} · {row.id}</small>
          <DetailPanel title="Submitted details"><p>{row.submission.report.description || 'No description supplied.'}</p><p>{row.submission.report.rewardKind} · threshold {row.submission.report.threshold ?? 'unknown'}</p><img className="symbol-tooltip-preview" src={symbolImageUrl(row.submission.report.tooltip)} alt="Submitted tooltip" /><p className="symbol-consent">{row.submission.consent.text}</p></DetailPanel>
          <div className="row-actions">{!row.receipt && !row.withdrawRequestedAt && !row.expired && <button disabled={busy} onClick={() => void act(async (isCurrent, verify) => { await sendSymbolReport(row.id, verify); if (isCurrent()) setMessage('Received by the collection.') })}>Retry upload</button>}
            {!row.withdrawnAt && <button disabled={busy} className="text-button" onClick={() => void act(async (isCurrent, verify) => { await withdrawSymbolReport(row.id, verify); if (isCurrent()) setMessage('Withdrawal confirmed. Images and description removed from the collection.') })}>{row.withdrawRequestedAt ? 'Retry withdrawal' : 'Withdraw report'}</button>}</div>
        </div>
      </article>)}
    </section>
  </DetailPanel>
}
