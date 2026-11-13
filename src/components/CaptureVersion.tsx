import { useState } from 'react'
import { readCaptureVersion, saveCaptureVersion, type CaptureVersion as Setting } from '../lib/capture-version'

export function CaptureVersion() {
  const [setting, setSetting] = useState<Setting | null>(() => { try { return readCaptureVersion() } catch { return null } })
  const [version, setVersion] = useState(setting?.version ?? ''), [message, setMessage] = useState('')
  return <section className="capture-version"><h3>Game version for new local captures</h3><p>Enter the patch shown by your game. Applies to live helper captures made from now for up to 24 hours. Older files and existing offers stay unchanged. Raw cloud OCR keeps its original version information.</p><label>Session game version<input value={version} maxLength={64} placeholder="Unknown" onChange={event => setVersion(event.target.value)} /></label><button onClick={() => {
    try { const next = saveCaptureVersion(version); setSetting(next); setMessage(next ? 'Version saved for new local captures. Its user-entered source is recorded in offer notes.' : 'New captures will keep their original version, including unknown.') }
    catch { setMessage('Version could not be saved. The existing setting is unchanged.') }
  }}>Apply from now</button>{setting && <p>Active until {new Date(setting.expiresAt).toLocaleString()}: {setting.version}</p>}{message && <p role="status">{message}</p>}</section>
}
