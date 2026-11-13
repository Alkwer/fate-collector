import { useState } from 'react'
import { newReward } from '../../shared/offers'
import { catalogFields, REWARD_CATALOG } from '../../shared/reward-catalog'
import type { Reward } from '../../shared/schema'
import type { RewardDefinition } from '../lib/solver-settings'
import { AppIcon } from './AppIcon'
import { DetailPanel } from './DetailPanel'
import { RewardSymbol } from './DecisionVisuals'

type Preset = Pick<Reward, 'label' | 'kind' | 'threshold' | 'identified'>
const kindLabel = (reward: Pick<Reward, 'kind' | 'threshold'>) => reward.kind === 'combo'
  ? `Combo · ${reward.threshold === null ? 'threshold unknown' : `needs ${reward.threshold}`}`
  : reward.kind === 'regular' ? 'Regular' : 'Kind unknown'

export function ManualRewards({ rewards, definitions, onChange }: {
  rewards: Reward[]; definitions: RewardDefinition[]; onChange: (rewards: Reward[]) => void
}) {
  const [customId, setCustomId] = useState<string | null>(null)
  const presets = REWARD_CATALOG.map(entry => ({ id: entry.id, ...catalogFields(entry) }))
  const matching = (preset: Preset) => rewards.find(reward => reward.label === preset.label && reward.kind === preset.kind && reward.threshold === preset.threshold && reward.identified === preset.identified)
  function update(id: string, patch: Partial<Reward>) {
    onChange(rewards.map(reward => {
      if (reward.id !== id) return reward
      const updated = { ...reward, ...patch }
      if (patch.label !== undefined || patch.kind !== undefined) updated.identified = !!updated.label.trim() && updated.kind !== 'unknown'
      return updated
    }))
  }
  function add(preset?: Preset, custom = false) {
    const existing = preset && matching(preset)
    if (existing) {
      if (existing.count < 100) update(existing.id, { count: existing.count + 1 })
      return
    }
    if (rewards.length >= 30) return
    const reward = { ...newReward(), ...(preset && { label: preset.label, kind: preset.kind, threshold: preset.threshold, identified: preset.identified }) }
    onChange([...rewards, reward])
    if (custom) setCustomId(reward.id)
  }
  return <section className="manual-rewards" aria-label="Fate rewards">
    <div className="section-heading"><h3>Rewards</h3><span className="hint">Optional</span></div>
    <p className="hint">Click the matching reward. Click again to add another icon.</p>
    <div className="manual-reward-presets" aria-label="Reward shortcuts">
      {presets.map(preset => {
        const existing = matching(preset)
        return <button type="button" key={preset.id} disabled={existing ? existing.count >= 100 : rewards.length >= 30} onClick={() => add(preset)}>
          <RewardSymbol label={preset.label} /><span><span className="sr-only">Add </span>{preset.label}<small> {kindLabel(preset)}</small></span><AppIcon name="plus" />
        </button>
      })}
    </div>
    {!!definitions.length && <label className="manual-personal-reward">Personal template<select value="" onChange={event => {
      const entry = definitions.find(item => item.id === event.target.value)
      if (entry) add({ label: entry.label, kind: entry.kind, threshold: entry.threshold, identified: true })
    }}><option value="">Choose a saved reward</option>{definitions.map(entry => <option key={entry.id} value={entry.id}>{entry.label} · {kindLabel(entry)}</option>)}</select></label>}
    {!!rewards.length && <ul className="manual-reward-list" aria-label="Selected rewards">
      {rewards.map((reward, index) => <li key={reward.id}>
        <div className="manual-reward-summary"><RewardSymbol label={reward.label} identified={reward.identified} />
          <div><strong>{reward.label || 'Unknown reward'}</strong>
            <DetailPanel className="manual-reward-details" title={`Reward ${index + 1} details`} triggerLabel={reward.kind === 'unknown' ? 'Set reward kind' : `${kindLabel(reward)} · Edit`} autoOpen={customId === reward.id}>
              <p className="hint">Copy the tooltip only if you know it. Unknown details can stay blank.</p>
              <div className="manual-reward-fields">
                <label>Reward name<input maxLength={160} value={reward.label} placeholder="Unknown reward" onChange={event => update(reward.id, { label: event.target.value })} /></label>
                <label>Kind<select value={reward.kind} onChange={event => update(reward.id, { kind: event.target.value as Reward['kind'], threshold: null })}><option value="unknown">Unknown</option><option value="regular">Regular</option><option value="combo">Combo</option></select></label>
                {reward.kind === 'combo' && <label>Combo threshold<input type="number" min={1} max={100} step={1} placeholder="Unknown" value={reward.threshold ?? ''} onChange={event => update(reward.id, { threshold: event.target.value ? Number(event.target.value) : null })} /></label>}
              </div>
            </DetailPanel>
          </div>
        </div>
        <div className="manual-reward-count" role="group" aria-label={`Reward ${index + 1} count`}>
          <button type="button" aria-label={`Decrease reward ${index + 1} count`} disabled={reward.count <= 1} onClick={() => update(reward.id, { count: reward.count - 1 })}><AppIcon name="minus" /></button>
          <span aria-live="polite" aria-atomic="true">{reward.count}×</span>
          <button type="button" aria-label={`Increase reward ${index + 1} count`} disabled={reward.count >= 100} onClick={() => update(reward.id, { count: reward.count + 1 })}><AppIcon name="plus" /></button>
        </div>
        <button type="button" className="text-button manual-remove-reward" aria-label={`Remove reward ${index + 1}`} onClick={() => onChange(rewards.filter(item => item.id !== reward.id))}><AppIcon name="close" /></button>
      </li>)}
    </ul>}
    <div className="manual-reward-other"><button type="button" className="text-button" disabled={rewards.length >= 30} onClick={() => add(undefined, true)}>Other reward</button><button type="button" className="text-button" disabled={rewards.length >= 30} onClick={() => add()}>Unknown reward</button></div>
  </section>
}
