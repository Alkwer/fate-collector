import { useEffect, useRef, useState } from 'react'
import { activeProfile, MAX_LIBRARY_BYTES, MAX_PROFILE_NAME, MAX_SAVED_PROFILES, newSolverLibrary, parseSolverLibrary, serializeSolverLibrary, type ProfileAction } from '../lib/solver-library'
import type { SolverSettingsControl } from './SolverControls'

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SolverProfiles({ control, beforeSwitch }: { control: SolverSettingsControl; beforeSwitch: () => boolean }) {
  const { library } = control
  const active = activeProfile(library)
  const [name, setName] = useState(active.name)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const current = useRef(library); current.current = library
  useEffect(() => { setName(active.name) }, [active.id, active.name])
  function allowSwitch() {
    return (name.trim() === active.name || window.confirm('Discard the unsaved profile name?')) && beforeSwitch()
  }
  const latestSwitch = useRef(allowSwitch); latestSwitch.current = allowSwitch
  function manage(action: ProfileAction) {
    try {
      if (action.type !== 'rename' && !allowSwitch()) return
      if (action.type === 'delete' && !window.confirm(`Delete profile “${active.name}”? Your map and collected Fates will stay unchanged.`)) return
      if (!control.manage(action)) throw new Error('Profile not changed. Resolve the storage message and try again.')
      setMessage(null)
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Could not change this profile.', error: true }) }
  }
  async function importLibrary(file: File) {
    const previous = current.current
    try {
      if (file.size > MAX_LIBRARY_BYTES) throw new Error('Profile library is too large (1.5 MB maximum).')
      const imported = parseSolverLibrary(await file.text())
      if (current.current !== previous) throw new Error('Your profiles changed while reading the file. Import it again.')
      if (!latestSwitch.current() || !window.confirm(`Replace your entire profile library with ${imported.profiles.length} imported profiles? Export your current library first if you want to keep it.`)) return
      if (!control.restore(imported, previous)) throw new Error('Library not restored. Your profiles may have changed; check storage and import again.')
      setName(activeProfile(imported).name)
      setMessage({ text: 'Profile library restored. Your map and collected Fates are unchanged.', error: false })
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Could not restore this library.', error: true }) }
  }
  return <section className="profile-library" aria-label="Build profiles">
    <h3>Build profiles <span className="summary-detail">{library.profiles.length}/{MAX_SAVED_PROFILES}</span></h3>
    <p className="hint">Keep separate priorities, build filters, planning objectives and personal templates. Switching profiles keeps your current map and collected Fates.</p>
    <div className="profile-library-fields">
      <label>Active profile<select value={active.id} disabled={control.unreadable} onChange={event => manage({ type: 'select', id: event.target.value })}>{library.profiles.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <div className="profile-name"><label>Profile name<input value={name} maxLength={MAX_PROFILE_NAME} disabled={control.unreadable} onChange={event => setName(event.target.value)} /></label><button className="outline-button" disabled={control.unreadable || name.trim() === active.name} onClick={() => manage({ type: 'rename', name })}>Save name</button></div>
    </div>
    <div className="profile-library-actions">
      <button className="outline-button" disabled={control.unreadable || library.profiles.length >= MAX_SAVED_PROFILES} onClick={() => manage({ type: 'new' })}>New profile</button>
      <button className="outline-button" disabled={control.unreadable || library.profiles.length >= MAX_SAVED_PROFILES} onClick={() => manage({ type: 'duplicate' })}>Duplicate profile</button>
      <button className="text-button" disabled={control.unreadable || library.profiles.length === 1} onClick={() => manage({ type: 'delete' })}>Delete profile</button>
    </div>
    <p className="hint">{control.error ? 'Changes may only be available in this tab. Export the library before leaving.' : 'Settings save automatically on this device. Use Save name to rename a profile.'}</p>
    <div className="profile-library-actions">
      <button className="text-button" disabled={control.unreadable} onClick={() => download(serializeSolverLibrary(library), 'fate-solver-library.json')}>Export library</button>
      <button className="text-button" onClick={() => fileInput.current?.click()}>Import library</button>
      <input hidden ref={fileInput} type="file" accept="application/json,.json" aria-label="Import solver library" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importLibrary(file) }} />
    </div>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'field-error' : 'hint'}>{message.text}</p>}
    {control.error && <div className="storage-warning" role="alert"><p>{control.error}</p>
      <button onClick={() => {
        if (!allowSwitch()) return
        if (control.unsaved && !window.confirm('Discard all unsaved profile changes and reload the stored library? Export the library first to keep your changes.')) return
        control.reload(); setMessage(null)
      }}>Reload saved profile</button>
      {control.recovery !== null && <button onClick={() => download(control.recovery!, 'fate-solver-recovery.json')}>Export stored copy</button>}
      {control.unreadable && <button onClick={() => { if (window.confirm('Replace the unreadable library with one default profile? Export the stored copy first if you need to recover it.')) control.restore(newSolverLibrary()) }}>Reset profile library</button>}
    </div>}
  </section>
}
