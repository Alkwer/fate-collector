import { useEffect, useId, useRef, useState } from 'react'
import { normalizeRewardLabel, type AdvisorGoal } from '../../shared/advisor'
import { applyTradeStarter, MAX_PROFILE_BYTES, newSolverSettings, parseSolverSettings, serializeSolverSettings, replaceStarterPriorities, STARTER_PROFILES, type StarterProfileId, type SolverSettings } from '../lib/solver-settings'
import { rewardFamily } from '../../shared/reward-families'
import { RISK_CATEGORIES, type FateRiskSettings } from '../../shared/fate-risk'

export interface SolverSettingsControl {
  settings: SolverSettings
  error: string | null
  change: (settings: SolverSettings, replaceUnreadable?: boolean) => boolean
  reload: () => void
}
const key = (goal: AdvisorGoal) => `${goal.kind}:${normalizeRewardLabel(goal.label)}`

export function SolverControls({ control, availableGoals }: { control: SolverSettingsControl; availableGoals: AdvisorGoal[] }) {
  const { settings, change } = control
  const [selected, setSelected] = useState('')
  const [starterId, setStarterId] = useState<StarterProfileId>('trade')
  const [customLabel, setCustomLabel] = useState('')
  const [customKind, setCustomKind] = useState<'regular' | 'combo'>('regular')
  const [filterText, setFilterText] = useState(settings.profile.avoidModifiers.join('\n'))
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const starterDescription = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const current = useRef(settings); current.current = settings
  useEffect(() => { setFilterText(settings.profile.avoidModifiers.join('\n')) }, [settings.profile.avoidModifiers])
  const choices = availableGoals.filter(goal => !settings.profile.goals.some(row => key(row) === key(goal)))
  const starter = STARTER_PROFILES[starterId]
  const families = [...new Set(settings.profile.goals.map(goal => rewardFamily(goal.label)))]
  function update(next: SolverSettings) {
    try {
      serializeSolverSettings(next)
      if (!change(next)) { setMessage({ text: 'Profile not changed. Resolve the storage message below and try again.', error: true }); return false }
      setMessage(null); return true
    } catch {
      setMessage({ text: 'Use up to 30 unique priorities and 30 modifier filters; weights must be 0–1,000,000.', error: true }); return false
    }
  }
  function addGoal() {
    const goal = selected === 'custom' ? { kind: customKind, label: customLabel.trim() } : choices.find(row => key(row) === selected)
    if (!goal?.label) { setMessage({ text: 'Choose or enter a reward first.', error: true }); return }
    if (update({ ...settings, profile: { ...settings.profile, goals: [...settings.profile.goals, { ...goal, weight: 1 }] } })) {
      setSelected(''); setCustomLabel('')
    }
  }
  function useTradeStarter() {
    const next = applyTradeStarter(settings)
    if (!next) {
      setMessage({ text: 'The trade starter would exceed 30 priorities. Remove some priorities and try again.', error: true })
      return
    }
    if (update(next)) {
      if (next.profile.goals.some(goal => key(goal) === selected)) setSelected('')
      setMessage({ text: 'Trade starter applied.', error: false })
    }
  }
  function exportProfile() {
    const url = URL.createObjectURL(new Blob([serializeSolverSettings(settings)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'fate-solver-profile.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function importProfile(file: File) {
    const previous = current.current
    try {
      if (file.size > MAX_PROFILE_BYTES) throw new Error('Profile is too large (64 KB maximum).')
      const imported = parseSolverSettings(await file.text())
      if (current.current !== previous) throw new Error('Your settings changed while reading the file. Import it again to replace them.')
      if (!change(imported, true)) throw new Error('Profile was not imported. Resolve the storage message and retry.')
      setMessage({ text: 'Profile imported. Your map and collected cards are unchanged.', error: false })
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Could not import this profile.', error: true }) }
  }
  return <section className="solver-settings" aria-label="Solver settings">
    <label>Planning objective<select value={settings.profile.objective ?? 'rewards'} onChange={event => update({ ...settings, profile: { ...settings.profile, objective: event.target.value as 'rewards' | 'viscera' } })}><option value="rewards">Reward priorities</option><option value="viscera">Farm boss Viscera</option></select></label>
    {settings.profile.objective === 'viscera' && <p className="hint">Compare Fate count and duplicates while respecting your build filters. Exact drop chances are unknown; a duplicate pair and three different Fates are shown as alternatives. Confirm that the boss can drop the Viscera you want. <a href="https://www.pathofexile.com/forum/view-thread/4013527/page/1" target="_blank" rel="noreferrer">GGG FAQ</a></p>}
    <label className="checkbox-row"><input type="checkbox" checked={settings.mode === 'portfolio' || settings.profile.objective === 'viscera'} disabled={settings.profile.objective === 'viscera'} onChange={event => { update({ ...settings, mode: event.target.checked ? 'portfolio' : 'single' }) }} />Compare multiple rewards</label>
    {settings.mode === 'portfolio' && settings.profile.objective !== 'viscera' && <p className="hint">Maximize your combined priorities with up to three input Fates.</p>}
    <section className="solver-profile">
      <h3>Priorities, build filters & profile <span className="muted">{settings.profile.goals.length} priorities · {settings.profile.avoidModifiers.length} filters</span></h3>
      <p>Weights are provisional priority points. A regular reward earns points per icon. A combo earns its points once when completed. Set weights based on what matters to you, independently of market prices or expected profit.</p>
      <p className="hint">Incomplete combo progress helps choose the next Fate. It is not an active reward when invoking. Unlisted rewards remain visible but add no points. A weight of 0 disables that priority.</p>
      <div className="starter-profile">
        <label>Starter priorities<select value={starterId} onChange={event => setStarterId(event.target.value as StarterProfileId)}>{Object.entries(STARTER_PROFILES).map(([id, entry]) => <option key={id} value={id}>{entry.label}</option>)}</select></label>
        <p className="hint">{starter.description} These are editable preferences, not measured reward values.</p>
        <p id={starterDescription} className="hint">Replace your {settings.profile.goals.length} priorities with {starter.priorities.length} starter priorities. Build filters and personal templates stay unchanged.</p>
        <button className="outline-button" aria-describedby={starterDescription} onClick={() => { if (update(replaceStarterPriorities(settings, starterId))) { setSelected(''); setMessage({ text: `${starter.label} priorities applied.`, error: false }) } }}>Replace priorities</button>
        {starterId === 'trade' && <><p className="hint">To keep other priorities, update only the trade starter’s rewards.</p><button className="text-button" onClick={useTradeStarter}>Use trade starter</button></>}
      </div>
      {families.map(family => <section className="priority-group" key={family}><h4>{family}</h4><ul className="priority-list">{settings.profile.goals.map((goal, index) => rewardFamily(goal.label) === family ? <li key={key(goal)}>
        <div><strong>{goal.label}</strong><span className="cell-sub">{goal.kind === 'combo' ? 'Per completed combo' : 'Per regular icon'}</span></div>
        <label>Weight<input aria-label={`${goal.label} ${goal.kind} weight`} type="number" min={0} max={1_000_000} step="any" value={goal.weight} onChange={event => update({ ...settings, profile: { ...settings.profile, goals: settings.profile.goals.map((row, i) => i === index ? { ...row, weight: Number(event.target.value) } : row) } })} /></label>
        <button className="text-button" aria-label={`Remove priority ${goal.label} ${goal.kind}`} onClick={() => update({ ...settings, profile: { ...settings.profile, goals: settings.profile.goals.filter((_, i) => i !== index) } })}>Remove</button>
      </li> : null)}</ul></section>)}
      <div className="priority-add"><label>Add reward<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a reward</option>{choices.map(goal => <option key={key(goal)} value={key(goal)}>{goal.label} · {goal.kind}</option>)}<option value="custom">Enter another reward…</option></select></label><button onClick={addGoal} disabled={settings.profile.goals.length >= 30}>Add priority</button></div>
      {selected === 'custom' && <div className="priority-add"><label>Reward name<input maxLength={160} value={customLabel} onChange={event => setCustomLabel(event.target.value)} /></label><label>Reward kind<select value={customKind} onChange={event => setCustomKind(event.target.value as 'regular' | 'combo')}><option value="regular">Regular</option><option value="combo">Combo</option></select></label></div>}
      <section className="risk-settings"><h3>Build dangers</h3><p className="hint">Applies to every planning mode. Matches recorded effects and checked Tier 3 source references, including supported merges. Allow means no filter, not a safe encounter. Missing effects remain unverified.</p>
        <ul className="priority-list">{RISK_CATEGORIES.map(risk => <li key={risk.id}><div><strong>{risk.label}</strong><span className="cell-sub">{risk.description}</span></div><label>Action<select aria-label={`${risk.label} action`} value={settings.profile.risks?.[risk.id] ?? 'allow'} onChange={event => update({ ...settings, profile: { ...settings.profile, risks: { ...settings.profile.risks, [risk.id]: event.target.value as FateRiskSettings[typeof risk.id] } } })}><option value="allow">Allow</option><option value="warn">Warn</option><option value="exclude">Exclude</option></select></label></li>)}</ul>
      </section>
      <label className="modifier-filter">Avoid modifiers containing<textarea rows={3} maxLength={30_030} value={filterText} onChange={event => setFilterText(event.target.value)} placeholder="One phrase per line, for example a modifier your build cannot handle" /></label>
      <p className="hint">Applies to every planning mode. Matches literal phrases in recorded modifiers, ignoring case. Unread effects remain unassessed. Individual Fate exclusions also apply in every mode.</p>
      <button className="outline-button" onClick={() => update({ ...settings, profile: { ...settings.profile, avoidModifiers: filterText.split('\n').map(line => line.trim()).filter(Boolean) } })}>Apply modifier filters</button>
      <div className="profile-transfer"><button onClick={exportProfile}>Export profile</button><button onClick={() => fileInput.current?.click()}>Import profile</button><input hidden ref={fileInput} type="file" accept="application/json,.json" aria-label="Import solver profile" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importProfile(file) }} /></div>
      <p className="hint">Stored on this device across maps and browser restarts. Profile exports include priorities, filters and personal reward templates, but no captured offers or images. Import replaces the profile.</p>
      {!!settings.definitions.length && <section className="personal-definitions"><h3>Personal reward templates ({settings.definitions.length})</h3><ul>{settings.definitions.map(row => <li key={row.id}><span>{row.label} · {row.kind}{row.threshold !== null ? ` (${row.threshold})` : ''}{row.note ? ` · ${row.note}` : ''}</span><button className="text-button" aria-label={`Delete template ${row.label} ${row.kind}`} onClick={() => update({ ...settings, definitions: settings.definitions.filter(item => item.id !== row.id) })}>Delete</button></li>)}</ul></section>}
    </section>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'field-error' : 'hint'}>{message.text}</p>}
    {control.error && <div className="storage-warning" role="alert"><p>{control.error}</p><button onClick={control.reload}>Reload saved profile</button>{control.error.startsWith('Your saved profile') && <button onClick={() => { if (window.confirm('Replace the unreadable profile with the default trade starter?')) change(newSolverSettings(), true) }}>Replace unreadable profile</button>}</div>}
  </section>
}
