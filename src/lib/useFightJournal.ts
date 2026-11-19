import { useState } from 'react'
import { loadFightJournal, removeFightEntry, updateFightJournal, type FightJournal, type FightOutcome, type InvocationSnapshot } from './fight-journal'

export type EntryDraft = Omit<FightOutcome, 'loot'> & { lootStatus: FightOutcome['loot']['status']; lootItems: string }
type DraftRecord = { invocation: InvocationSnapshot; fields: EntryDraft }

export function useFightJournal() {
  const [drafts, setDrafts] = useState<Record<string, DraftRecord>>({})
  function editDraft(invocation: InvocationSnapshot, fields: EntryDraft) {
    setDrafts(previous => ({ ...previous, [invocation.id]: { invocation, fields } }))
  }
  function discardDraft(id: string) {
    setDrafts(previous => {
      const next = { ...previous }
      delete next[id]
      return next
    })
  }
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
      discardDraft(id)
      setState({ journal, error: null })
      return true
    } catch {
      if (hasEntry) setState(previous => ({ ...previous, error: 'Could not undo the saved fight outcome. Try Undo again when local storage is available.' }))
      if (!hasEntry) discardDraft(id)
      return !hasEntry
    }
  }
  return { ...state, drafts, editDraft, discardDraft, update, undoInvocation }
}

export type FightJournalControl = ReturnType<typeof useFightJournal>
