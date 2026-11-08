import { useEffect, useState } from 'react'
import { diagnosticText, type DiagnosticReport } from '../../shared/diagnostics'
import { diagnosticHistory, downloadDiagnostic, generateDiagnostic, onDiagnosticChange, retryDiagnosticWithdrawals, sendDiagnostic, withdrawDiagnostic, type DiagnosticRecord } from '../lib/diagnostics'
import { clearDiagnosticLog } from '../lib/diagnostic-log'

interface Props { environment: string; folderConnection: DiagnosticReport['state']['folderConnection']; sharing: DiagnosticReport['state']['sharing'] }
export function Diagnostics({ environment, folderConnection, sharing }: Props) {
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [records, setRecords] = useState<DiagnosticRecord[]>([])
  const [agreed, setAgreed] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [storageError, setStorageError] = useState('')
  useEffect(() => {
    const refresh = () => { try { setRecords(diagnosticHistory()); setStorageError('') } catch { setStorageError('Diagnostic receipts cannot be read. Sending is disabled; you can still download a report.') } }
    refresh(); return onDiagnosticChange(refresh)
  }, [])
  async function act(action: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : 'The diagnostic action could not complete. Keep the local receipt and retry.') }
    finally { setBusy(false) }
  }
  const selected = records.find(item => item.report.id === report?.id)
  return <>
    <div className="page-heading"><div><h1>Report a problem.</h1><p>Review a small diagnostic report before deciding to send it.</p></div></div>
    <section className="panel diagnostics-panel">
      <h2>1. Generate and inspect</h2>
      <p>Includes software versions, technical states and up to 100 recent event codes. Excludes keys, screenshots, OCR, offers, notes, file paths, account names and raw error messages.</p>
      <div className="diagnostic-actions"><button disabled={busy} onClick={() => { try { setReport(generateDiagnostic(environment, folderConnection, sharing)); setAgreed(false); setMessage('') } catch { setMessage('Could not generate a diagnostic report.') } }}>Generate diagnostic report</button><button className="text-button" disabled={busy} onClick={() => { try { clearDiagnosticLog(); setMessage('Local diagnostic events cleared. Saved submission receipts are kept.') } catch { setMessage('Could not clear local diagnostic events.') } }}>Clear local diagnostic events</button></div>
      {report && <>
        <label>Diagnostic report preview<textarea className="diagnostic-preview" readOnly rows={16} value={JSON.stringify(report, null, 2)} /></label>
        <button onClick={() => downloadDiagnostic(report)}>Download diagnostic ZIP</button><p className="hint">The ZIP contains only diagnostics.json. Downloading sends nothing to the collection.</p>
        <h2>2. Choose whether to send</h2>
        <p>Destination: <strong className="consent-destination">{location.origin}</strong></p>
        <label>Diagnostic consent information<textarea className="consent-copy" readOnly rows={8} value={diagnosticText(location.origin)} /></label>
        <label>Collection access key<input type="password" autoComplete="off" maxLength={512} value={key} onChange={event => setKey(event.target.value)} placeholder="Capture or reviewed-offer key" /></label>
        <label className="consent-check"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />I agree to send this diagnostic report to Fate Collector — Alkwer.</label>
        <button disabled={!agreed || !key.trim() || busy || !!storageError || !!selected?.receipt || !!selected?.withdrawnAt} onClick={() => void act(async () => { await sendDiagnostic(report, key, agreed); setAgreed(false); setKey(''); setMessage('Diagnostic report received. Keep its report number for your problem report.') })}>{selected && !selected.receipt ? 'Retry sending this report' : 'Send diagnostic report'}</button>
      </>}
      {(message || storageError) && <p role="status" className="diagnostic-message">{storageError || message}</p>}
    </section>
    <section className="panel diagnostics-panel"><h2>Report history</h2><p>A report expires after 30 days. Use its number when contacting the operator through the <a href="https://github.com/Alkwer/fate-collector" target="_blank" rel="noreferrer">project repository</a>. Keep site data until deletion is confirmed.</p>
      {!records.length && <p>No diagnostic submissions on this device.</p>}
      {records.map(record => <article className="diagnostic-receipt" key={record.report.id}>
        <h3>{record.withdrawalConfirmedAt ? 'Deleted from collection' : record.withdrawnAt ? 'Deletion pending' : record.receipt ? Date.parse(record.receipt.expiresAt) <= Date.now() ? 'Expired' : 'Received by collection' : 'Receipt not confirmed'}</h3>
        <p className="mono">Report number: {record.report.id}</p>
        <button onClick={() => void act(async () => { await navigator.clipboard.writeText(record.report.id); setMessage('Report number copied. No diagnostic data or credentials were copied.') })}>Copy report number</button>
        <p>Consent accepted: {new Date(record.consent.acceptedAt).toLocaleString()}{record.receipt && <> · Received: {new Date(record.receipt.receivedAt).toLocaleString()} · Expires: {new Date(record.receipt.expiresAt).toLocaleString()}</>}{record.withdrawalConfirmedAt && <> · Deleted: {new Date(record.withdrawalConfirmedAt).toLocaleString()}</>}</p>
        {!record.receipt && !record.withdrawnAt && record.retryAt && <p>Sending limit: retry after {new Date(record.retryAt).toLocaleString()}.</p>}
        {record.withdrawnAt && !record.withdrawalConfirmedAt && record.deletionRetryAt && <p>Deletion limit: next retry after {new Date(record.deletionRetryAt).toLocaleString()}.</p>}
        <details><summary>Accepted diagnostic consent</summary><p className="consent-snapshot">{record.consent.text}</p></details>
        {!record.receipt && !record.withdrawnAt && <button disabled={busy} onClick={() => { setReport(record.report); setAgreed(false); setMessage('Review this report and tick the checkbox to retry. No automatic diagnostic upload occurs.') }}>Review and retry</button>}
        {!record.withdrawnAt && <button className="text-button danger" onClick={() => void act(() => withdrawDiagnostic(record.report.id))}>Withdraw consent and delete report</button>}
        {record.withdrawnAt && !record.withdrawalConfirmedAt && <><p>Sending is stopped. Deletion retries when connected or after reopening this site.</p><button onClick={() => void act(retryDiagnosticWithdrawals)}>Retry report deletion</button></>}
      </article>)}
    </section>
  </>
}

// Deletion retries run while the site is open, regardless of the selected tab.
export function useDiagnosticWithdrawals() {
  useEffect(() => {
    const retry = () => { void retryDiagnosticWithdrawals().catch(() => { /* The durable pending receipt stays visible. */ }) }
    retry(); window.addEventListener('online', retry)
    const timer = setInterval(retry, 30000)
    return () => { window.removeEventListener('online', retry); clearInterval(timer) }
  }, [])
}
