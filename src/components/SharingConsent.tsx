import { DetailPanel } from './DetailPanel'
import { useState } from 'react'
import { consentText } from '../../shared/consent'
import { acceptConsent, exportConsentRecords, isCurrentConsent, registerConsent, retryWithdrawals, withdrawConsent, type LocalConsent } from '../lib/consent'

interface Props { accessKey: string; current: LocalConsent | null; active: LocalConsent | null; records: LocalConsent[]; error: string; warning: string }
export function SharingConsent({ accessKey, current, active, records, error, warning }: Props) {
  const [agreed, setAgreed] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  async function act(action: () => Promise<void>) {
    setPending(true); setMessage('')
    try { await action(); setAgreed(false) } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Consent could not be updated. Check the connection and retry.') }
    finally { setPending(false) }
  }
  return <div className="sharing-consent">
    <h3>Consent to share reviewed offers</h3>
    <p>Destination: <strong className="consent-destination">{location.origin}</strong></p>
    {active ? <p className="consent-status">Sharing consent active. Accepted <time dateTime={active.acceptedAt}>{new Date(active.acceptedAt).toLocaleString()}</time>.</p> : <p className="consent-status">Sharing is off until you accept and the server confirms your consent.</p>}
    <label>Consent information<textarea className="consent-copy" readOnly rows={9} value={consentText('observations', location.origin)} /></label>
    {!active && !isCurrentConsent(current) && <><label className="consent-check"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />I have read this information and agree to share reviewed offers.</label><button disabled={!agreed || !accessKey.trim() || pending || !!error} onClick={() => void act(() => acceptConsent(accessKey, agreed))}>Accept data sharing</button></>}
    {!active && isCurrentConsent(current) && <><p>Consent saved on this device. Server confirmation is pending.</p><button disabled={!accessKey.trim() || pending} onClick={() => void act(() => registerConsent(accessKey))}>Retry consent confirmation</button></>}
    {current && !current.withdrawnAt && <button className="text-button danger" onClick={() => void act(() => withdrawConsent(current.id))}>Withdraw consent</button>}
    {(message || error) && <p role="alert">{error || message}</p>}
    {warning && <p role="alert">{warning}</p>}
    {records.some(record => record.withdrawnAt && !record.withdrawalConfirmedAt) && <p role="status">Sharing stopped locally. Server withdrawal is pending and will retry when connected. <button className="text-button" onClick={() => void act(retryWithdrawals)}>Retry withdrawal</button></p>}
    <p className="hint">This controls website sharing only. Manage automatic OCR uploads separately in the Windows helper. Withdrawing does not remove your local offers or screenshots.</p>
    {!!records.length && <DetailPanel className="consent-history" title={<>Consent history ({records.length})</>}><button onClick={exportConsentRecords}>Export consent history</button>{records.map(record => <article key={record.id}><p><strong>{record.withdrawalConfirmedAt ? 'Withdrawn on server' : record.withdrawnAt ? 'Withdrawal pending' : record.recordedAt ? 'Recorded consent' : 'Confirmation pending'}</strong> · Version {record.policyVersion}</p><p>Accepted: <time dateTime={record.acceptedAt}>{new Date(record.acceptedAt).toLocaleString()}</time>{record.recordedAt && <> · Server recorded: {new Date(record.recordedAt).toLocaleString()}</>}{record.withdrawnAt && <> · Withdrawal requested: {new Date(record.withdrawnAt).toLocaleString()}</>}{record.withdrawalConfirmedAt && <> · Server confirmed: {new Date(record.withdrawalConfirmedAt).toLocaleString()}</>}</p><section><h3>Accepted text</h3><p className="consent-snapshot">{record.text}</p></section>{!record.withdrawnAt && record.id !== current?.id && <button className="text-button danger" onClick={() => void act(() => withdrawConsent(record.id))}>Withdraw this consent</button>}</article>)}</DetailPanel>}
  </div>
}
