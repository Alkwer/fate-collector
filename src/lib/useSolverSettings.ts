import { useRef, useState } from 'react'
import { newSolverSettings, readSolverSettings, serializeSolverSettings, writeSolverSettings, type SolverSettings } from './solver-settings'

export function useSolverSettings() {
  function read() {
    try { return readSolverSettings(window.localStorage) }
    catch { return { settings: newSolverSettings(), raw: null, error: 'Browser profile storage is unavailable. Export your settings before leaving.' } }
  }
  const [state, setState] = useState(read)
  const current = useRef(state)
  function change(settings: SolverSettings, replaceUnreadable = false) {
    try { serializeSolverSettings(settings) } catch { return false }
    const previous = current.current
    if (previous.error?.startsWith('Your saved profile') && !replaceUnreadable) return false
    let result: { raw: string | null; error: string | null }
    try { result = writeSolverSettings(window.localStorage, settings, previous.raw) }
    catch { result = { raw: previous.raw, error: 'Browser profile storage is unavailable. Export your settings before leaving.' } }
    if (result.error?.startsWith('The profile changed')) {
      current.current = { ...previous, error: result.error }; setState(current.current); return false
    }
    current.current = { settings, ...result }; setState(current.current); return true
  }
  function reload() { current.current = read(); setState(current.current) }
  return { settings: state.settings, error: state.error, change, reload }
}
