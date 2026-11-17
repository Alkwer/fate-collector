import { useRef, useState } from 'react'
import type { AdvisorGoal } from '../../shared/advisor'
import { serializeSolverSettings, type SolverSettings } from './solver-settings'
import { activeProfile, changeActiveSettings, newSolverLibrary, readSolverLibrary, serializeSolverLibrary, updateSolverLibrary, writeSolverLibrary, type LibraryState, type ProfileAction, type SolverLibrary } from './solver-library'

export function useSolverSettings(legacyGoal: AdvisorGoal | null) {
  function read(): LibraryState {
    try { return readSolverLibrary(window.localStorage, legacyGoal) }
    catch { return { library: newSolverLibrary(), raw: null, legacyRaw: null, unreadable: false, recovery: null, unsaved: false, error: 'Browser profile storage is unavailable. Export your profiles before leaving.' } }
  }
  const [state, setState] = useState(read)
  const current = useRef(state)
  function commit(library: SolverLibrary, replaceUnreadable = false) {
    try { serializeSolverLibrary(library) } catch { return false }
    const previous = current.current
    if (previous.unreadable && !replaceUnreadable) return false
    let result: ReturnType<typeof writeSolverLibrary>
    try { result = writeSolverLibrary(window.localStorage, library, previous) }
    catch { result = { raw: previous.raw, conflict: false, error: 'Browser profile storage is unavailable. Export your profiles before leaving.' } }
    // A failed write retains the complete in-memory library for export. A conflict never replaces newer data.
    current.current = result.conflict ? { ...previous, error: result.error } : {
      ...previous, library, raw: result.raw, unreadable: false, error: result.error,
      recovery: result.error ? previous.recovery : null, unsaved: result.error !== null,
    }
    setState(current.current)
    return !result.conflict
  }
  function change(settings: SolverSettings, expectedLibrary?: SolverLibrary) {
    if (expectedLibrary && current.current.library !== expectedLibrary) return false
    try { serializeSolverSettings(settings) } catch { return false }
    return commit(changeActiveSettings(current.current.library, settings))
  }
  function manage(action: ProfileAction) { return commit(updateSolverLibrary(current.current.library, action)) }
  function reload() { current.current = read(); setState(current.current) }
  return { settings: activeProfile(state.library).settings, library: state.library, error: state.error,
    unreadable: state.unreadable, recovery: state.recovery, unsaved: state.unsaved,
    change, manage, restore: (library: SolverLibrary, expectedLibrary?: SolverLibrary) =>
      (!expectedLibrary || current.current.library === expectedLibrary) && commit(library, true), reload }
}
