import { useRef, useState, type FormEvent } from 'react'
import { DetailPanel, type DetailPanelHandle } from './DetailPanel'
import { fightOutcomeSchema, putFightEntry, type FightEntry, type FightOutcome, type InvocationSnapshot } from '../lib/fight-journal'
import type { FightJournalControl } from '../lib/useFightJournal'
import './fight-journal.css'

type EntryDraft = Omit<FightOutcome, 'loot'> & { lootStatus: FightOutcome['loot']['status']; lootItems: string }

function OutcomeForm({ control, invocation, entry, onSave }: {
  control: FightJournalControl
  invocation: InvocationSnapshot
  entry?: FightEntry
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

export function FightJournal({ control, latest }: { control: FightJournalControl; latest: InvocationSnapshot | null }) {
  const panel = useRef<DetailPanelHandle>(null)
  const [selected, setSelected] = useState('')
  const [open, setOpen] = useState(false)
  const [savedId, setSavedId] = useState('')
  const entries = control.journal?.entries ?? []
  const unsaved = latest && !entries.some(entry => entry.invocation.id === latest.id) ? latest : null
  const entry = entries.find(row => row.invocation.id === selected)
  const invocation = entry?.invocation ?? unsaved ?? entries[0]?.invocation
  const savedEntry = entries.find(row => row.invocation.id === invocation?.id)
  return <div className="fight-journal-action">
    <DetailPanel ref={panel} className="fight-journal" title="Fight journal" triggerLabel={unsaved ? 'Log fight outcome' : 'Fight journal'} onOpenChange={next => {
      setOpen(next)
      if (next) setSelected('')
    }}>
      {control.journal && <p className="hint">{invocation ? 'Save what you observed. All encounter details are optional.' : 'After recording an invocation, you can log the boss and loot here.'}</p>}
      {open && control.journal && invocation && <>
        {entries.length > (unsaved ? 0 : 1) && <label>Fight<select value={invocation.id} onChange={event => setSelected(event.target.value)}>
          {unsaved && <option value={unsaved.id}>Latest invocation · outcome unsaved</option>}
          {entries.map(row => <option key={row.invocation.id} value={row.invocation.id}>{new Date(row.invocation.invokedAt).toLocaleString()} · {row.outcome.mapName || row.outcome.boss || row.invocation.inputs[0].name || 'Unnamed fight'}</option>)}
        </select></label>}
        <OutcomeForm key={invocation.id} control={control} invocation={invocation} entry={savedEntry} onSave={() => {
          setSavedId(invocation.id)
          panel.current?.close()
        }} />
      </>}
      {open && control.error && <p role="alert" className="field-error">{control.error}</p>}
    </DetailPanel>
    {!open && control.error && <p role="alert" className="field-error">{control.error}</p>}
    {!unsaved && entries.some(entry => entry.invocation.id === savedId) && <p role="status" className="hint">Fight outcome saved locally.</p>}
  </div>
}
