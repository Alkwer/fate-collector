import { useRef, useState, type FormEvent } from 'react'
import { DetailPanel, type DetailPanelHandle } from './DetailPanel'
import {
  createFightJournalBackup, fightOutcomeSchema, loadFightJournal, planFightJournalImport, putFightEntry, readFightJournalBackup,
  type FightEntry, type FightJournal as Journal, type FightOutcome, type InvocationSnapshot,
} from '../lib/fight-journal'
import { downloadJson } from '../lib/download'
import type { FightJournalControl } from '../lib/useFightJournal'
import './fight-journal.css'

type EntryDraft = Omit<FightOutcome, 'loot'> & { lootStatus: FightOutcome['loot']['status']; lootItems: string }

function OutcomeForm({ control, invocation, entry, onEdit, onSave }: {
  control: FightJournalControl
  invocation: InvocationSnapshot
  entry?: FightEntry
  onEdit: () => void
  onSave: () => void
}) {
  const [draft, setDraft] = useState<EntryDraft>(() => ({
    boss: entry?.outcome.boss ?? '',
    bossStatus: entry?.outcome.bossStatus ?? 'unknown',
    mapName: entry?.outcome.mapName ?? invocation.mapName,
    gameVersion: entry?.outcome.gameVersion ?? invocation.gameVersion,
    gamePreview: entry?.outcome.gamePreview ?? '',
    lootStatus: entry?.outcome.loot.status ?? 'unchecked',
    lootItems: entry?.outcome.loot.status === 'items' ? entry.outcome.loot.items : '',
  }))
  function setField<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    onEdit()
    setDraft(previous => ({ ...previous, [key]: value }))
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const { lootStatus, lootItems, ...fields } = draft
    const outcome = fightOutcomeSchema.safeParse({
      ...fields,
      loot: lootStatus === 'items' ? { status: lootStatus, items: lootItems } : { status: lootStatus },
    })
    if (outcome.success && control.update(journal => putFightEntry(journal, { invocation, outcome: outcome.data }))) onSave()
  }

  return <form className="fight-journal-form" onSubmit={save}>
    <div className="fight-inputs">
      <h3>Fates used</h3>
      <ol>{invocation.inputs.map((input, index) => <li key={index}>{input.name || 'Unnamed Fate'} · {input.tier ? `Tier ${input.tier}` : 'Tier unconfirmed'}</li>)}</ol>
      {invocation.modeledPreview && <p className="hint">{invocation.modeledPreview}</p>}
    </div>
    <div className="fight-form-pair">
      <label>Map or area<input value={draft.mapName} maxLength={160} onChange={event => setField('mapName', event.target.value)} /></label>
      <label>Game version<input value={draft.gameVersion} maxLength={64} onChange={event => setField('gameVersion', event.target.value)} /></label>
      <label>Boss name<input value={draft.boss} maxLength={160} onChange={event => setField('boss', event.target.value)} /></label>
      <label>Boss killed<select value={draft.bossStatus} onChange={event => setField('bossStatus', event.target.value as EntryDraft['bossStatus'])}>
        <option value="unknown">Unconfirmed</option><option value="killed">Killed</option><option value="not-killed">Not killed</option>
      </select></label>
    </div>
    <label>Invocation preview in game<textarea value={draft.gamePreview} maxLength={1800} rows={2} onChange={event => setField('gamePreview', event.target.value)} /></label>
    <label>Loot observed<select value={draft.lootStatus} onChange={event => setField('lootStatus', event.target.value as EntryDraft['lootStatus'])}>
      <option value="unchecked">Not checked</option><option value="none">Checked · none observed</option><option value="items">Checked · loot observed</option>
    </select></label>
    {draft.lootStatus === 'items' && <label>Items and quantities<textarea value={draft.lootItems} maxLength={1800} rows={3} required onChange={event => setField('lootItems', event.target.value)} /></label>}
    <button type="submit" className="primary-button" disabled={draft.lootStatus === 'items' && !draft.lootItems.trim()}>Save fight outcome</button>
  </form>
}

function BackupForm({ control, draftId }: { control: FightJournalControl; draftId?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ base: Journal; backup: Journal } | null>(null)
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const plan = pending ? planFightJournalImport(pending.base, pending.backup) : null
  const hasChanges = plan && !!(plan.fightsAdded || plan.progressAdded || plan.goalAdded)
  const hasConflicts = plan && !!(plan.fightConflicts || plan.progressConflicts || plan.goalConflict)
  const overlapsDraft = plan && draftId && !pending?.base.entries.some(row => row.invocation.id === draftId)
    && pending?.backup.entries.some(row => row.invocation.id.toLowerCase() === draftId.toLowerCase())

  function exportBackup() {
    setMessage(''); setError('')
    try {
      const backup = createFightJournalBackup(loadFightJournal(window.localStorage))
      downloadJson(backup, 'fate-collector-fight-journal.json')
    } catch {
      setError('The saved fight journal could not be exported.')
    }
  }

  async function previewBackup(file: File) {
    setReading(true); setPending(null); setMessage(''); setError('')
    try {
      const backup = await readFightJournalBackup(file)
      setPending({ base: loadFightJournal(window.localStorage), backup })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The fight journal backup could not be opened.')
    } finally {
      setReading(false)
    }
  }

  function importBackup() {
    if (!pending || !plan || !hasChanges || overlapsDraft) return
    setError('')
    let changedSincePreview = false
    const saved = control.update(latest => {
      changedSincePreview = JSON.stringify(latest) !== JSON.stringify(pending.base)
      return changedSincePreview ? latest : plan.journal
    })
    if (!saved) {
      setError('The import could not be saved. Your previous fights and challenge progress are preserved.')
    } else if (changedSincePreview) {
      setPending(null)
      setError('The local journal changed while this backup was open. Choose the file again to review the current import.')
    } else {
      setPending(null)
      setMessage(hasConflicts ? 'Backup imported. Your local values were kept for conflicts.' : 'Fight journal backup imported.')
    }
  }

  return <div className="fight-backup">
    <p className="hint">The JSON includes saved fight outcomes, your selected league goal and confirmed challenge progress. It stays on this device until you move the file.</p>
    <div className="fight-backup-actions">
      <button type="button" onClick={exportBackup} disabled={reading}>Export fight journal</button>
      <button type="button" onClick={() => input.current?.click()} disabled={reading}>Choose fight journal backup</button>
      <input ref={input} type="file" hidden aria-label="Fight journal backup file" accept=".json,application/json" onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void previewBackup(file)
      }} />
    </div>
    {reading && <p role="status">Reading backup…</p>}
    {plan && <div className="fight-backup-preview">
      <h3>Import preview</h3>
      <p>{plan.fightsAdded} new {plan.fightsAdded === 1 ? 'fight' : 'fights'} and {plan.progressAdded} new challenge progress {plan.progressAdded === 1 ? 'value' : 'values'}.{plan.goalAdded && ' The backup’s league goal will be selected.'}</p>
      {hasConflicts && <p>Local values will be kept for {[
        plan.fightConflicts > 0 && `${plan.fightConflicts} conflicting ${plan.fightConflicts === 1 ? 'fight' : 'fights'}`,
        plan.progressConflicts > 0 && `${plan.progressConflicts} conflicting challenge progress ${plan.progressConflicts === 1 ? 'value' : 'values'}`,
        plan.goalConflict && 'the selected league goal',
      ].filter(Boolean).join(', ')}. Keep the original backup to retain those versions.</p>}
      {overlapsDraft ? <p role="alert">This backup includes the fight you are editing. Close the backup panel and save your outcome before importing.</p> : hasChanges
        ? <button type="button" className="primary-button" onClick={importBackup}>{hasConflicts ? 'Import data without conflicts' : 'Import fight journal'}</button>
        : <p>There is no new data to import.</p>}
    </div>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>
}

export function FightJournal({ control, latest }: { control: FightJournalControl; latest: InvocationSnapshot | null }) {
  const panel = useRef<DetailPanelHandle>(null)
  const [selected, setSelected] = useState('')
  const [open, setOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [savedId, setSavedId] = useState('')
  const [draftId, setDraftId] = useState('')
  const entries = control.journal?.entries ?? []
  const unsaved = latest && !entries.some(entry => entry.invocation.id === latest.id) ? latest : null
  const entry = entries.find(row => row.invocation.id === selected)
  const invocation = entry?.invocation ?? unsaved ?? entries[0]?.invocation
  const savedEntry = entries.find(row => row.invocation.id === invocation?.id)
  return <div className="fight-journal-action">
    <DetailPanel ref={panel} className="fight-journal" title="Fight journal" triggerLabel={unsaved ? 'Log fight outcome' : 'Fight journal'} onOpenChange={next => {
      setOpen(next)
      if (next) setSelected('')
      else setDraftId('')
    }}>
      {control.journal && <p className="hint">{invocation ? 'Save what you observed. All encounter details are optional.' : 'After recording an invocation, you can log the boss and loot here.'}</p>}
      {open && control.journal && invocation && <>
        {entries.length > (unsaved ? 0 : 1) && <label>Fight<select value={invocation.id} onChange={event => { setSelected(event.target.value); setDraftId('') }}>
          {unsaved && <option value={unsaved.id}>Latest invocation · outcome unsaved</option>}
          {entries.map(row => <option key={row.invocation.id} value={row.invocation.id}>{new Date(row.invocation.invokedAt).toLocaleString()} · {row.outcome.mapName || row.outcome.boss || row.invocation.inputs[0].name || 'Unnamed fight'}</option>)}
        </select></label>}
        <OutcomeForm key={`${invocation.id}:${!!savedEntry}`} control={control} invocation={invocation} entry={savedEntry} onEdit={() => setDraftId(invocation.id)} onSave={() => {
          setSavedId(invocation.id)
          panel.current?.close()
        }} />
      </>}
      {open && control.journal && <DetailPanel className="fight-backup-panel" title="Fight journal backup" triggerLabel="Back up or restore" onOpenChange={setBackupOpen}>
        {backupOpen && <BackupForm control={control} draftId={draftId || undefined} />}
      </DetailPanel>}
      {open && control.error && <p role="alert" className="field-error">{control.error}</p>}
    </DetailPanel>
    {!open && control.error && <p role="alert" className="field-error">{control.error}</p>}
    {!unsaved && entries.some(entry => entry.invocation.id === savedId) && <p role="status" className="hint">Fight outcome saved locally.</p>}
  </div>
}
