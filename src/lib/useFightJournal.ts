import { useState } from 'react'
import { loadFightJournal, removeFightEntry, updateFightJournal, type FightJournal } from './fight-journal'

export function useFightJournal() {
  const [state, setState] = useState(() => {
    try { return { journal: loadFightJournal(window.localStorage), error: null as string | null } }
    catch { return { journal: null, error: 'The saved fight journal could not be opened.' } }
  })
  function update(change: (journal: FightJournal) => FightJournal): boolean {
    try {
      setState({ journal: updateFightJournal(window.localStorage, change), error: null })
      return true
    } catch {
      setState(previous => ({ ...previous, error: 'The fight journal could not be saved. Your previous entries are preserved.' }))
      return false
    }
  }
  function undoInvocation(id: string) {
    let hasEntry = state.journal?.entries.some(entry => entry.invocation.id === id) ?? false
    try {
      const journal = updateFightJournal(window.localStorage, latest => {
        hasEntry = latest.entries.some(entry => entry.invocation.id === id)
        return removeFightEntry(latest, id)
      })
      setState({ journal, error: null })
      return true
    } catch {
      if (hasEntry) setState(previous => ({ ...previous, error: 'Could not undo the saved fight outcome. Try Undo again when local storage is available.' }))
      return !hasEntry
    }
  }
  return { ...state, update, undoInvocation }
}

export type FightJournalControl = ReturnType<typeof useFightJournal>
