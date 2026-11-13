import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { createBackupParts, type BackupPart } from '../lib/imports'
import { readOfferArchive, readOfferRecovery } from '../lib/storage'
import { downloadJson } from '../lib/download'

function RecoveryScreen() {
  const [parts, setParts] = useState<(BackupPart & { url: string })[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  async function backup() {
    setBusy(true)
    try {
      const builder = createBackupParts(true)
      const summary = await readOfferArchive(true, builder.add)
      const downloads = builder.finish().map(part => ({ ...part, url: URL.createObjectURL(part.blob) }))
      parts.forEach(part => URL.revokeObjectURL(part.url)); setParts(downloads)
      downloadJson(await readOfferRecovery(), 'fate-collector-recovery.json')
      setMessage(`${summary.offers} readable offers prepared. Raw draft and damaged-record recovery downloaded separately. Symbol reports and withdrawal credentials remain in site storage; these files do not include them.`)
    } catch { setMessage('The backup could not be completed. Keep this browser profile and site data. Reload to retry.') }
    finally { setBusy(false) }
  }
  return <main className="panel app-recovery"><h1>Fate Collector could not display this screen.</h1><p>Your saved browser data has not been cleared. Reload to try again, or download your offers and recovery data first.</p><div className="diagnostic-actions"><button onClick={() => location.reload()}>Reload Fate Collector</button><button disabled={busy} onClick={() => void backup()}>{busy ? 'Preparing backup…' : 'Prepare recovery backup'}</button></div><p role="status">{message}</p><ul>{parts.map(part => <li key={part.filename}><a download={part.filename} href={part.url}>{part.filename}</a></li>)}</ul><p>Do not clear site data. A pending upload or withdrawal may still need its local receipt.</p></main>
}
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Recovery is local; never transmit arbitrary exception text or component state. */ }
  render() { return this.state.failed ? <RecoveryScreen /> : this.props.children }
}
