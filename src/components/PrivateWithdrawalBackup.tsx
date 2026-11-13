import { useRef, useState } from 'react'
import { downloadJson } from '../lib/download'

export function PrivateWithdrawalBackup() {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  async function act(action: () => Promise<string>) {
    setBusy(true)
    try { setMessage(await action()) } catch (error) { setMessage(error instanceof Error ? error.message : 'Private backup failed. Keep site data; existing records are preserved.') }
    finally { setBusy(false) }
  }
  return <section className="private-backup"><h3>Private withdrawal credentials</h3><p>Contains secret tokens for reviewed-offer consent and diagnostics. Anyone with this file can withdraw them. Keep it private. It excludes symbols, which have their own private backup in Symbol report history.</p><div className="diagnostic-actions"><button disabled={busy} onClick={() => void act(async () => {
    const api = await import('../lib/private-withdrawal-backup'); downloadJson(await api.exportPrivateWithdrawals(), 'fate-withdrawal-credentials-private.json'); return 'Private credentials downloaded. Sharing stays unchanged.'
  })}>Export private withdrawal backup</button><button disabled={busy} onClick={() => input.current?.click()}>Restore private withdrawal backup</button></div><input ref={input} className="file-input" type="file" accept=".json" aria-label="Private withdrawal backup file" onChange={event => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (file) void act(async () => { const api = await import('../lib/private-withdrawal-backup'); if (file.size > api.PRIVATE_WITHDRAWAL_LIMIT) throw new Error('Private backup exceeds 16 MiB.'); const result = await api.importPrivateWithdrawals(await file.text()); return `Restored ${result.restored} record(s); ${result.conflicts} conflicts preserved. Import does not activate sharing. Pending withdrawals will retry.` })
  }} /><p className="hint">Restore only at the original collector address. Existing withdrawals cannot be undone. This file is separate from offer exports and public diagnostic ZIPs.</p>{message && <p role="status">{message}</p>}</section>
}
