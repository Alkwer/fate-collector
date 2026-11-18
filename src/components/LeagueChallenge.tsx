import { useMemo, useState, type FormEvent } from 'react'
import type { InvocationLimit } from '../../shared/advisor'
import type { FateCard } from '../../shared/schema'
import type { SolverProfile } from '../../shared/solver'
import { challengeAdvice } from '../lib/challenge-advice'
import type { OmenMap } from '../lib/fight-journal'
import {
  activeProfitGoal, leagueGoalSchema, omenMaps, OVERPOWERING_OMENS_SOURCE, profitObjectives, PROMISED_PROFITS_SOURCE, type LeagueGoal,
} from '../lib/league-challenges'
import type { FightJournalControl } from '../lib/useFightJournal'
import { DetailPanel } from './DetailPanel'
import './fight-journal.css'

function ChallengeProgress({ goal, control }: { goal: NonNullable<LeagueGoal>; control: FightJournalControl }) {
  const progress = control.journal?.progress ?? {}
  const objective = goal.kind === 'profit' ? profitObjectives.find(row => row.id === goal.objective) : undefined
  const key = goal.kind === 'profit' ? `profit:${goal.objective}` : `omen:${goal.map}`
  const target = objective?.target ?? 1
  const saved = progress[key] ?? 0
  const [count, setCount] = useState(String(saved))
  const [updated, setUpdated] = useState(false)

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = Number(count)
    if (!count.trim() || !Number.isInteger(next) || next < 0 || next > target) return
    setUpdated(control.update(journal => ({ ...journal, progress: { ...journal.progress, [key]: next } })))
  }

  return <form className="league-goal-form" onSubmit={save}>
    {target > 1
      ? <label>Progress shown in game (out of {target})<input type="number" min={0} max={target} required value={count} onChange={event => { setCount(event.target.value); setUpdated(false) }} /></label>
      : <label className="checkbox-row"><input type="checkbox" checked={count === '1'} onChange={event => { setCount(event.target.checked ? '1' : '0'); setUpdated(false) }} />Marked complete in game</label>}
    <button type="submit" className="outline-button">Save confirmed progress</button>
    {updated && <p className="hint" role="status">Challenge progress saved locally.</p>}
  </form>
}

interface Props {
  control: FightJournalControl
  mode: 'offer' | 'invoke'
  limit: InvocationLimit
  mapReady: boolean
  offered: FateCard[]
  collected: FateCard[]
  profile: SolverProfile
  excludedCardIds: string[]
  confirmedOmenMap: OmenMap | null
  onConfirmOmenMap: (map: OmenMap | null) => void
}

export function LeagueChallenge({ control, mode, mapReady, limit, offered, collected, profile, excludedCardIds, confirmedOmenMap, onConfirmOmenMap }: Props) {
  const goal = control.journal?.goal ?? null
  const progress = control.journal?.progress ?? {}
  const profitDone = profitObjectives.filter(row => (progress[`profit:${row.id}`] ?? 0) >= row.target).length
  const omenDone = omenMaps.filter(map => progress[`omen:${map}`] === 1).length
  const objective = goal?.kind === 'profit' ? profitObjectives.find(row => row.id === goal.objective) : undefined
  const option = goal ? goal.kind === 'profit' ? `profit:${goal.objective}` : `omen:${goal.map}` : ''
  const completed = goal?.kind === 'omen' ? omenDone >= 12 || progress[option] === 1
    : goal?.kind === 'profit' && !activeProfitGoal(control.journal)
  const suggestion = useMemo(() => mapReady && goal && !completed
    ? challengeAdvice({ goal, offered, collected, mode, confirmedOmenMap, profile, excludedCardIds, limit }) : '',
    [completed, goal, offered, collected, mode, confirmedOmenMap, profile, excludedCardIds, mapReady, limit])

  function setGoal(value: string) {
    const [kind, target] = value.split(':')
    const parsed = leagueGoalSchema.safeParse(!value ? null : kind === 'profit' ? { kind, objective: target } : { kind, map: target })
    if (parsed.success) control.update(journal => ({ ...journal, goal: parsed.data }))
  }

  return <div className="league-challenge-action">
    <DetailPanel className="league-challenge" title="League challenge goals">
      {control.error && <p role="alert" className="field-error">{control.error}</p>}
      {control.journal && <div className="league-goal-form">
        <p className="hint">Covens of Umbra · 3.30. Match a challenge objective to your current choices. Copy progress from the in-game challenge panel.</p>
        <label>Challenge objective<select value={option} onChange={event => setGoal(event.target.value)}>
          <option value="">No challenge goal</option>
          <optgroup label="Promised Profits">{profitObjectives.map(row => <option key={row.id} value={`profit:${row.id}`}>{row.label} · {progress[`profit:${row.id}`] ?? 0}/{row.target}</option>)}</optgroup>
          <optgroup label="Overpowering Omens">{omenMaps.map(map => <option key={map} value={`omen:${map}`}>{map}{progress[`omen:${map}`] === 1 ? ' · Complete' : ''}</option>)}</optgroup>
        </select></label>
        {goal?.kind === 'profit' && <p className="hint">Receive 10 of the 15 listed reward types from Fate-empowered bosses at their required counts. {profitDone}/10 objectives confirmed.</p>}
        {goal?.kind === 'omen' && <>
          <p className="hint">Defeat the final boss of 12 listed Rare Tier 16 maps with at least 100% Atlas Drops and an invoked Tier 3 Fate. {omenDone}/12 maps confirmed.</p>
          {mapReady && <label className="checkbox-row"><input type="checkbox" checked={confirmedOmenMap === goal.map} onChange={event => onConfirmOmenMap(event.target.checked ? goal.map : null)} />I checked that this area is the selected Rare Tier 16 map with at least 100% Atlas Drops.</label>}
        </>}
        {goal && <ChallengeProgress key={option} goal={goal} control={control} />}
        <p className="hint"><a href={PROMISED_PROFITS_SOURCE} target="_blank" rel="noreferrer">Promised Profits reference</a> · <a href={OVERPOWERING_OMENS_SOURCE} target="_blank" rel="noreferrer">Overpowering Omens reference</a></p>
      </div>}
    </DetailPanel>
    {option && <p className="hint">{goal?.kind === 'profit' ? objective?.label : goal?.map}{completed ? ' · Goal complete' : ''}{suggestion && <> · {suggestion}</>}</p>}
  </div>
}
