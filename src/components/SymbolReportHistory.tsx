import { useEffect, useRef, useState } from 'react'
import { cleanSymbolImages, canCleanSymbolImages, exportDamagedSymbol, exportSymbolRecovery, importSymbolRecovery, onSymbolHistoryChange, readSymbolHistoryPage, readSymbolReportDetails, removeDamagedSymbol, SYMBOL_RECOVERY_LIMIT_BYTES, type SymbolHistoryCursor, type SymbolHistoryRow } from '../lib/symbol-report-storage'
import { readSymbolReviewStatus, symbolImageUrl } from '../lib/symbol-reports'
import { downloadJson } from '../lib/download'
import { DetailPanel } from './DetailPanel'

function ReportDetails({ id, hasImages }: { id: string; hasImages: boolean }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof readSymbolReportDetails>> | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [working, setWorking] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    if (!hasImages) setDetail(current => current && { ...current, images: null })
  }, [hasImages])
  return <DetailPanel title="Submitted details" onOpenChange={open => {
    const request = ++generation.current
    if (!open) { setDetail(null); setError(''); setMessage(''); return }
    void readSymbolReportDetails(id).then(result => {
      if (request === generation.current) setDetail(result)
    }).catch(error => {
      if (request === generation.current) setError(error.message)
    })
  }}>
    {detail ? <>
      <p>{detail.report.description || 'No description supplied.'}</p>
      <p>{detail.report.rewardKind} · threshold {detail.report.threshold ?? 'unknown'}</p>
      {hasImages && detail.images ? <>
        <img className="symbol-image-preview" src={symbolImageUrl(detail.images.icon)} alt="Submitted symbol" />
        <img className="symbol-tooltip-preview" src={symbolImageUrl(detail.images.tooltip)} alt="Submitted tooltip" />
      </> : <p>{detail.damagedImages && hasImages ? 'The saved images are unreadable. Withdrawal is still available.' : 'No local images are available. The report record and any consent receipt are still saved.'}</p>}
      {detail.damagedImages && hasImages && <div className="row-actions">
        <button disabled={working} onClick={async () => {
          setWorking(true); setError('')
          try {
            downloadJson(await exportDamagedSymbol({ store: 'images', key: id }), 'fate-collector-damaged-symbol-images-private.json')
            setMessage('Private copy downloaded.')
          } catch (error) { setError(error instanceof Error ? error.message : 'Could not download the entry.') }
          finally { setWorking(false) }
        }}>Download damaged images privately</button>
        <button disabled={working} onClick={async () => {
          if (!window.confirm('Remove these unreadable images from this browser? The report and its withdrawal credential will be kept.')) return
          setWorking(true); setError('')
          try { await removeDamagedSymbol({ store: 'images', key: id }); setMessage('Unreadable images removed.') }
          catch (error) { setError(error instanceof Error ? error.message : 'Could not remove the images.') }
          finally { setWorking(false) }
        }}>Remove unreadable images</button>
      </div>}
      <p className="symbol-consent">{detail.consent.text}</p>
    </> : !error && <p role="status">Loading saved details…</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </DetailPanel>
}

function reportStatus(row: SymbolHistoryRow) {
  if (row.withdrawnAt) return 'Withdrawn — removed from collection'
  if (row.withdrawRequestedAt) return 'Withdrawal pending — retry below'
  if (row.expired) return 'Expired or removed from collection'
  if (row.receipt) return Date.parse(row.receipt.expiresAt) <= Date.now() ? 'Expired in collection' : 'Received — review status unavailable'
  if (!row.hasImages) return 'Saved locally — images unavailable'
  return 'Saved locally — upload not confirmed'
}
const reviewLabels = {
  pending: 'Awaiting review',
  'in-review': 'In review',
  accepted: 'Accepted for research',
  rejected: 'Rejected',
  conflict: 'Conflicting evidence',
}
type ReviewStatus = Awaited<ReturnType<typeof readSymbolReviewStatus>>

export function SymbolReportHistory({ open, busy, onRetry, onWithdraw, onStorageError, onRestore }: {
  open: boolean; busy: boolean; onRetry: (id: string) => void; onWithdraw: (id: string) => void
  onStorageError: (message: string) => void; onRestore: () => void
}) {
  const [page, setPage] = useState<Awaited<ReturnType<typeof readSymbolHistoryPage>> | null>(null)
  const [cursors, setCursors] = useState<(SymbolHistoryCursor | undefined)[]>([undefined])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, ReviewStatus>>({})
  const before = cursors.at(-1)
  useEffect(() => {
    if (!open) return
    let generation = 0
    function refresh() {
      const request = ++generation
      void readSymbolHistoryPage(before).then(result => {
        if (request !== generation) return
        setPage(result)
        onStorageError('')
      }).catch(error => {
        if (request !== generation) return
        onStorageError(error instanceof Error ? error.message : 'Report history is unavailable.')
      })
    }
    refresh()
    const unsubscribe = onSymbolHistoryChange(refresh)
    return () => { generation++; unsubscribe() }
  }, [before, open, onStorageError])
  async function perform(action: () => Promise<void>) {
    setWorking(true)
    setError('')
    setMessage('')
    try { await action() }
    catch (error) { setError(error instanceof Error ? error.message : 'The symbol history action failed.') }
    finally { setWorking(false) }
  }
  return <section className="symbol-report-history" aria-label="Symbol report history">
    <h3>Symbol report history</h3>
    <p className="hint">Reports stay in this browser for retries and withdrawal.</p>
    {!page ? <p>Loading saved reports…</p> : <>
      {page.rows.length === 0 && <p>No saved reports on this page.</p>}
      {page.rows.map(row => {
        const active = !!row.receipt && !row.withdrawRequestedAt && !row.expired && Date.parse(row.receipt.expiresAt) > Date.now()
        return <article key={row.id}>
        <strong>{row.label || 'Unidentified symbol'}</strong>
        <p>{active && statuses[row.id] ? `Received — ${reviewLabels[statuses[row.id]]}` : reportStatus(row)}</p>
        <small>{new Date(row.createdAt).toLocaleString()} · {row.id}</small>
        <div className="row-actions">
          <ReportDetails id={row.id} hasImages={row.hasImages} />
          {active && <button disabled={busy || working} className="text-button" onClick={() => void perform(async () => {
            const status = await readSymbolReviewStatus(row.id)
            setStatuses(current => ({ ...current, [row.id]: status }))
            setMessage(`Review status: ${reviewLabels[status]}.`)
          })}>Check review status</button>}
          {!row.receipt && !row.withdrawRequestedAt && !row.expired && row.hasImages && <button disabled={busy} onClick={() => onRetry(row.id)}>Retry upload</button>}
          {!row.withdrawnAt && <button disabled={busy} className="text-button" onClick={() => onWithdraw(row.id)}>{row.withdrawRequestedAt ? 'Retry withdrawal' : 'Withdraw report'}</button>}
          {canCleanSymbolImages(row) && <button disabled={busy || working} className="text-button" onClick={() => {
            if (!window.confirm('Remove these images from this browser? The report record and withdrawal details will be kept.')) return
            void perform(async () => { await cleanSymbolImages(row.id); setMessage('Local images removed.') })
          }}>Remove local images</button>}
        </div>
      </article>
      })}
      {(cursors.length > 1 || page.next) && <nav className="row-actions" aria-label="Symbol report history pages">
        <button disabled={cursors.length === 1} onClick={() => { setPage(null); setCursors(cursors.slice(0, -1)) }}>Newer reports</button>
        <span>Page {cursors.length}</span>
        <button disabled={!page.next} onClick={() => { setPage(null); setCursors([...cursors, page.next!]) }}>Older reports</button>
      </nav>}
      {!!page.damaged.length && <DetailPanel title="Unreadable reports" triggerLabel={`Unreadable reports (${page.damaged.length})`}>
        <p>Download the original entry before removing it. It may contain your images and the credential needed to withdraw the report. Keep the file private.</p>
        {page.damaged.map((entry, index) => <article key={`${entry.store}:${JSON.stringify(entry.key)}`}>
          <small>Saved entry {index + 1}</small>
          <div className="row-actions">
            <button disabled={working} onClick={() => void perform(async () => {
              downloadJson(await exportDamagedSymbol(entry), 'fate-collector-damaged-symbol-private.json')
              setMessage('Private copy downloaded.')
            })}>Download original entry</button>
            <button disabled={working} className="text-button" onClick={() => {
              if (!window.confirm('Remove this unreadable entry from this browser? You may lose the ability to withdraw this report.')) return
              void perform(async () => { await removeDamagedSymbol(entry); setMessage('Unreadable entry removed.') })
            }}>Remove unreadable entry</button>
          </div>
        </article>)}
        {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
      </DetailPanel>}
    </>}
    <DetailPanel title="Private symbol backup">
      <p>This file contains private images and withdrawal credentials. Anyone with a credential can withdraw its report. Keep the file private and restore it only on this collector address.</p>
      <div className="row-actions">
        <button disabled={working || busy} onClick={() => void perform(async () => {
          downloadJson(await exportSymbolRecovery(), 'fate-collector-symbol-backup-private.json')
          setMessage('Private symbol backup downloaded.')
        })}>Download private symbol backup</button>
        <label>Restore private symbol backup<input type="file" accept="application/json,.json" disabled={working || busy} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void perform(async () => {
            if (file.size > SYMBOL_RECOVERY_LIMIT_BYTES) throw new Error('This private symbol backup is too large.')
            const { restored, conflicts } = await importSymbolRecovery(JSON.parse(await file.text()))
            onRestore()
            setMessage(`Restored or matched ${restored} saved entries.${conflicts ? ` Skipped ${conflicts} conflicting or unavailable entries.` : ''}`)
          })
        }} /></label>
      </div>
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    </DetailPanel>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>
}
