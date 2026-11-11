import { useEffect, useState } from 'react'
import { listDraftRecovery, removeDraftRecovery, onHistoryChange, storageHealth, type RecoveryDraft } from '../lib/storage'

export function DraftRecovery({ busy, onRecover }: { busy: boolean; onRecover: (draft: RecoveryDraft) => boolean }) {
  const [drafts, setDrafts] = useState<RecoveryDraft[]>([]), [problem, setProblem] = useState('')
  useEffect(() => { void listDraftRecovery().then(setDrafts).catch(() => setProblem('Draft recovery could not be read. Existing recovery data is preserved.')) }, [])
  if (!drafts.length && !problem) return null
  return <section className="notice draft-recovery" aria-label="Draft recovery"><div><strong>Unsaved drafts from an earlier visit</strong>
    {problem && <p role="alert">{problem}</p>}
    <ul>{drafts.map(draft => <li key={draft.id}><span>{draft.offer.cards.map(card => card.name).filter(Boolean).join(', ') || 'Unread capture'} · {new Date(draft.savedAt).toLocaleString()}</span>
      <button disabled={busy} onClick={() => { if (onRecover(draft)) setDrafts(current => current.filter(item => item.id !== draft.id)) }}>Recover draft</button>
      <button disabled={busy} onClick={() => { void removeDraftRecovery(draft.id).then(() => setDrafts(current => current.filter(item => item.id !== draft.id))).catch(() => setProblem('The recovery copy could not be removed.')) }}>Discard recovery copy</button>
    </li>)}</ul><p className="hint">Recovery does not overwrite saved offers or add cards to your map.</p></div></section>
}

export function StorageHealth() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof storageHealth>> | null>(null), [message, setMessage] = useState('')
  useEffect(() => {
    let stopped = false
    const refresh = () => { void storageHealth().then(value => { if (!stopped) setHealth(value) }).catch(() => { if (!stopped) setMessage('Storage usage is unavailable. Keep regular backups.') }) }
    refresh(); const unsubscribe = onHistoryChange(refresh)
    return () => { stopped = true; unsubscribe() }
  }, [])
  const pressured = health && (health.offers >= 225 || (health.usage !== null && health.quota !== null && health.usage > health.quota * .8))
  return <aside className={`storage-health ${pressured ? 'storage-warning' : ''}`} aria-label="Local storage">
    <p>{health ? `${health.offers}/${health.limit} local offers` : 'Checking local storage…'}{health?.usage !== null && health?.usage !== undefined ? ` · ${(health.usage / 1048576).toFixed(1)} MiB used` : ''}
      {health?.quota ? ` of approximately ${(health.quota / 1048576).toFixed(0)} MiB available to this site` : ''}</p>
    {pressured && <p role="status">Storage is nearly full. Export a backup and remove old offers before automatic capture pauses.</p>}
    {health && <p className="hint">{health.persistent ? 'Persistent storage is enabled. Clearing site data still removes local records.' : 'Browser storage may be evicted. Keep backups outside this browser.'}</p>}
    {health?.canPersist && !health.persistent && <button onClick={() => {
      void navigator.storage.persist().then(async granted => { setHealth(await storageHealth()); setMessage(granted ? 'Persistent storage enabled.' : 'The browser did not grant persistence. Your data is unchanged; keep regular backups.') }).catch(() => setMessage('Persistence is unavailable. Keep regular backups.'))
    }}>Protect local storage</button>}
    {message && <p role="status">{message}</p>}
  </aside>
}
