import type { useCaptureSync } from '../lib/useCaptureSync'
import { CaptureVersion } from './CaptureVersion'

export function CaptureConnection({ sync }: { sync: ReturnType<typeof useCaptureSync> }) {
  const active = sync.status === 'active'
  return <section className={`capture-connection ${active ? 'connected' : ''}`} aria-label="Local capture review">
    <div><strong>{active ? 'Local review connected' : sync.status === 'permission' ? 'Allow folder access to resume local review' : sync.status === 'error' ? 'Local auto-save is paused' : 'Local capture review'}</strong>
      <p>{active ? `${sync.folderName} · ${sync.received} saved this session. Press F9 in game; keep this page open for local review.`
        : sync.supported ? "Optional: connect the helper's captures folder to save and review offers here automatically." : 'Folder connection needs desktop Chrome or Edge. You can still import or paste captures here.'}</p>
      <p>Cloud upload is configured in the helper and can run with this page closed.</p>
    </div>
    <div className="connection-actions">{!active && sync.supported && <button disabled={sync.status === 'connecting'} onClick={() => void (sync.folderName ? sync.resume() : sync.connect())}>{sync.status === 'connecting' ? 'Connecting…' : sync.folderName ? 'Resume local review' : 'Connect folder'}</button>}
      {sync.folderName && <button className="text-button" disabled={sync.status === 'connecting'} onClick={() => void sync.disconnect()}>Disconnect</button>}</div>
    {sync.problem && <p className="connection-problem" role="alert">{sync.problem}</p>}
    <CaptureVersion />
  </section>
}
