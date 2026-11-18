import { describe, expect, it } from 'vitest'
import { overlayAdvice, type OverlayInputs } from '../src/lib/overlay-advice'
import { newCard, newOffer, newReward } from '../shared/offers'
import { bindOfferToMap, newAdvisorWorkspace, startMapWorkspace } from '../src/lib/advisor-workspace'
import { newSolverSettings } from '../src/lib/solver-settings'
import { overlayStateSchema, type OverlayCommand, type OverlayState } from '../shared/overlay'
import { OverlayChannel } from '../src/lib/overlay-channel'
import { activeProfitGoal, profitObjectives } from '../src/lib/league-challenges'

function inputs(): OverlayInputs {
  const offer = newOffer()
  offer.captureId = offer.id
  offer.cards = [1, 2].map((count, index) => ({ id: crypto.randomUUID(), name: ['Alchemist', 'Crowkeeper'][index], tier: 2, modifiers: [], rewards: [{ id: crypto.randomUUID(), label: 'Currency', kind: 'regular', count, threshold: null, identified: true }] }))
  const settings = newSolverSettings()
  settings.profile = { goals: [{ kind: 'regular', label: 'Currency', weight: 1 }], avoidModifiers: [] }
  return { offer, workspace: bindOfferToMap(startMapWorkspace(newAdvisorWorkspace()), offer.id), settings, capture: { protocol: 1, captureId: offer.id, phase: 'saved', updatedAt: Date.now() }, needsMapConfirmation: false, blocked: false, canUndo: false, confirmNewArea: false }
}

describe('overlay advice uses the existing recommendation engines', () => {
  it('uses the confirmed campaign capacity for offer scores', () => {
    const input = inputs()
    input.workspace.collection.cards = ['Dryad', 'Blood Moon'].map(name => ({
      ...input.offer.cards[0], id: crypto.randomUUID(), name,
    }))
    input.offer.areaCategory = 'map'
    expect(overlayAdvice(input).title).toContain('4 pts')
    input.offer.areaCategory = 'campaign'
    expect(overlayAdvice(input).title).toContain('3 pts')
  })
  it('puts the active challenge tooltip first and withdraws it when the offer or goal is no longer eligible', () => {
    const input = inputs()
    input.offer.cards[1].rewards.push({ ...newReward(), visualId: 'orange-feathers' })
    const goal = { kind: 'profit', objective: 'ordered-fate' } as const
    input.leagueGoal = activeProfitGoal({ goal, progress: {} })
    expect(overlayAdvice(input).detail.split('\n')[0]).toMatch(/^Hover #2.*Ordered Fate/)
    input.workspace.excludedCardIds = [input.offer.cards[1].id]
    expect(overlayAdvice(input).detail).not.toMatch(/^Hover/)
    input.workspace.excludedCardIds = []
    input.leagueGoal = activeProfitGoal({ goal, progress: { 'profit:ordered-fate': 1 } })
    expect(overlayAdvice(input).detail).not.toMatch(/^Hover/)
    const complete = Object.fromEntries(profitObjectives.slice(0, 10).map(row => [`profit:${row.id}`, row.target]))
    expect(activeProfitGoal({ goal, progress: complete })).toBeNull()
  })
  it('distinguishes a future Tempest duplicate from a Currency set available now', () => {
    const input = inputs()
    const goal = { kind: 'combo', label: 'Additional Valuable Currency Items', weight: 6 } as const
    input.settings.profile.goals.push(goal)
    const tempest = input.offer.cards[0]
    tempest.name = 'Tempest'
    tempest.rewards.push({ ...newReward(), kind: goal.kind, label: goal.label, threshold: 3, identified: true })
    expect(overlayAdvice(input)).toMatchObject({ title: 'Now: #2 Crowkeeper · 2 pts',
      detail: expect.stringContaining('Tempest 1→9 pts with another T2 Tempest') })
    input.workspace.collection.cards.push({ ...newCard(), name: 'Tempest', tier: 2,
      rewards: [{ ...newReward(), label: 'Gloves', kind: 'regular', identified: true }] })
    expect(overlayAdvice(input)).toMatchObject({ title: 'Now: #1 Tempest · 9 pts',
      rows: [{ recommended: true }, { recommended: false }] })
  })
  it('puts current points and the nearest winning icon before the review guidance', () => {
    const input = inputs()
    input.settings.profile.goals.push({ kind: 'combo', label: 'Decks', weight: 4 })
    input.offer.cards[0].rewards.push({ ...input.offer.cards[0].rewards[0], id: crypto.randomUUID(), kind: 'combo', label: 'Decks', threshold: 2 })
    expect(overlayAdvice(input).rows[0].detail).toContain('1 known plan pts now · 5 pts with 1 more Decks icon on a new Fate')
  })
  it('separates the immediate winner on Malformation from the nearest winning completion', () => {
    const input = inputs()
    input.settings = newSolverSettings()
    const regular = (label: string) => ({ ...newReward(), label, kind: 'regular' as const, identified: true })
    const combo = (label: string, threshold: number) => ({ ...regular(label), kind: 'combo' as const, threshold })
    input.offer.cards = [
      { ...newCard(), name: 'Rot', tier: 2, rewards: [regular('Gold'), regular('Rare Helmets with a Drop Modifier')] },
      { ...newCard(), name: 'Alchemist', tier: 2, rewards: [regular('Additional Gems with Quality')] },
      { ...newCard(), name: 'Bloodthirsty', tier: 2, rewards: [regular('Rare Bows with a Critical Modifier'), combo('Additional Valuable Currency Items', 3), combo('Many Additional Stacked Decks', 2)] },
      { ...newCard(), name: 'Gravewalker', tier: 2, rewards: [regular('Greatly Increased Item Rarity'), regular('Rare Body Armours with a Life Modifier')] },
    ]
    const view = overlayAdvice(input)
    expect(view.title).toBe('Now: #4 Gravewalker · 4 pts')
    expect(view.detail.split('\n')[0]).toBe('Bloodthirsty 1→9 pts with another T2 Bloodthirsty')
    expect(view.rows.filter(row => row.recommended).map(row => row.label)).toEqual(['4. Gravewalker'])
  })
  it('shows a tie on Belfry and chooses the more valuable of two one-icon completions', () => {
    const input = inputs()
    input.settings = newSolverSettings()
    input.offer.cards = [
      { ...newCard(), name: 'Houndmaster', tier: 2, rewards: [newReward()] },
      ...[['Avalanche', 'Many Additional Stacked Decks'], ['Dryad', 'Valuable Unique Jewellery Item']].map(([name, label]) => ({
        ...newCard(), name, tier: 2, rewards: [newReward(), { ...newReward(), label, kind: 'combo' as const, threshold: 2, identified: true }],
      })),
    ]
    const view = overlayAdvice(input)
    expect(view.title).toBe('Now: tie · 0 known pts')
    expect(view.detail.split('\n')[0]).toBe('Dryad 0→5 pts with 1× Valuable Unique Jewellery Item')
    expect(view.rows.some(row => row.recommended)).toBe(false)
    input.workspace.excludedCardIds = [input.offer.cards[2].id]
    expect(overlayAdvice(input).detail.split('\n')[0]).toBe('Avalanche 0→4 pts with 1× Many Additional Stacked Decks')
    input.offer.cards.forEach(card => { card.rewards = [newReward()] })
    expect(overlayAdvice(input).title).toBe('Check rewards before choosing')
  })
  it('uses the active profile single goal and respects an explicitly empty goal', () => {
    const input = inputs()
    input.settings.mode = 'single'
    input.workspace.goal = { kind: 'regular', label: 'Armour' }
    input.settings.singleGoal = { kind: 'regular', label: 'Currency' }
    expect(overlayAdvice(input)).toMatchObject({ title: 'Recommended: 2. Crowkeeper', detail: expect.stringContaining('Goal: Currency.') })
    input.settings.singleGoal = null
    expect(overlayAdvice(input)).toMatchObject({ status: 'check', title: 'Set reward priorities in Fate Collector' })
    expect(input.workspace.goal.label).toBe('Armour')
  })
  it('honors build rules in single-goal mode and uses the Viscera objective without reward weights', () => {
    const input = inputs()
    input.settings.mode = 'single'
    input.workspace.goal = { kind: 'regular', label: 'Currency' }
    input.settings.profile.risks = { bleeding: 'exclude' }
    input.offer.cards[1].modifiers = ['Inflicts Bleeding on Hit']
    const single = overlayAdvice(input)
    expect(single.rows[1].detail).toContain('Excluded:')
    expect(single.actions.some(action => action.id === `collect:${input.offer.cards[1].id}`)).toBe(false)
    input.settings.profile.objective = 'viscera'
    input.settings.profile.goals = []
    input.workspace.goal = null
    expect(overlayAdvice(input)).toMatchObject({ status: 'provisional', detail: expect.stringContaining('Viscera farming') })
  })
  it('shows the random companion drop in the recommendation and applies the build filter', () => {
    const input = inputs()
    input.settings.profile.objective = 'viscera'
    input.offer.cards[0].name = 'Sadist'
    const companion = overlayAdvice(input)
    expect(companion.title).toBe('Provisional: 1. Sadist')
    expect(companion.detail.split('\n')[0]).toBe('Guaranteed Viscera on kill from a random companion.')
    expect(companion.rows[0]).toMatchObject({ recommended: true, detail: expect.stringContaining('Guaranteed companion Viscera on kill') })
    expect(companion.rows[1].recommended).toBe(false)

    input.settings.profile.risks = { extraBoss: 'exclude' }
    const filtered = overlayAdvice(input)
    expect(filtered.rows[0]).toMatchObject({ recommended: false, detail: 'Excluded: Additional boss (Tier 2 screenshot description).' })
    expect(filtered.rows[1].recommended).toBe(true)
    expect(filtered.detail).not.toContain('Guaranteed Viscera on kill from a random companion.')
  })
  it('ranks the exact offered IDs and supports both priorities and a single goal', () => {
    const input = inputs()
    const portfolio = overlayAdvice(input)
    expect(portfolio).toMatchObject({ status: 'ready', title: 'Now: #2 Crowkeeper · 2 pts' })
    expect(portfolio.rows.map(row => row.recommended)).toEqual([false, true])
    expect(portfolio.actions).toContainEqual({ id: `collect:${input.offer.cards[1].id}`, slot: 2, label: 'Record Crowkeeper' })
    input.settings.mode = 'single'; input.workspace.goal = { kind: 'regular', label: 'Currency' }
    expect(overlayAdvice(input).title).toBe('Recommended: 2. Crowkeeper')
  })
  it('keeps ties, missing rewards and exclusions explicit', () => {
    const input = inputs()
    input.offer.cards[1].rewards[0].count = 1
    expect(overlayAdvice(input).title).toBe('Now: tie · 1 pt')
    input.offer.cards[1].rewards[0].identified = false
    expect(overlayAdvice(input).status).not.toBe('ready')
    input.workspace.excludedCardIds = [input.offer.cards[1].id]
    expect(overlayAdvice(input).actions.some(action => action.id === `collect:${input.offer.cards[1].id}`)).toBe(false)
  })
  it('requires explicit area membership and restored-area confirmation', () => {
    const input = inputs(); input.workspace = newAdvisorWorkspace()
    expect(overlayAdvice(input)).toMatchObject({ status: 'confirm-area', actions: expect.arrayContaining([{ id: 'use-offer', slot: 10, label: 'Start area with offer' }]) })
    input.needsMapConfirmation = true
    expect(overlayAdvice(input).actions.some(action => action.id === 'continue-area')).toBe(true)
    expect(overlayAdvice(input).actions.some(action => action.id.startsWith('collect:'))).toBe(false)
  })
  it('withholds old advice while capturing, on mismatch, errors and edits', () => {
    const input = inputs()
    for (const phase of ['capturing', 'cancelled', 'error', 'watching', 'paused'] as const) {
      input.capture!.phase = phase
      expect(overlayAdvice(input).actions).toEqual([])
      expect(overlayAdvice(input).rows).toEqual([])
    }
    input.capture!.phase = 'saved'; input.capture!.captureId = crypto.randomUUID()
    expect(overlayAdvice(input).status).toBe('busy')
    input.capture!.captureId = input.offer.id; input.blocked = true
    expect(overlayAdvice(input).actions).toEqual([])
  })
  it('prevents recording a second card and requires two steps to clear an area', () => {
    const input = inputs()
    input.workspace.collection.cards.push(input.offer.cards[0]); input.workspace.sources[input.offer.cards[0].id] = input.offer.id
    expect(overlayAdvice(input)).toMatchObject({ status: 'collected', title: 'Recorded: Alchemist' })
    expect(overlayAdvice(input).actions.some(action => action.id.startsWith('collect:'))).toBe(false)
    input.confirmNewArea = true
    expect(overlayAdvice(input).actions.map(action => action.id)).toEqual(['confirm-new-area', 'cancel-new-area'])
  })
})

function memoryDirectory() {
  const files = new Map<string, string>()
  let onRead: ((name: string) => void) | undefined
  const directory = {
    async getFileHandle(name: string, options?: { create: boolean }) {
      if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError')
      return {
        async getFile() { onRead?.(name); return { size: new TextEncoder().encode(files.get(name) ?? '').length, text: async () => files.get(name) ?? '' } },
        async createWritable() { let text = ''; return { async write(value: string) { text = value }, async close() { files.set(name, text) }, async abort() {} } },
      }
    },
  } as unknown as FileSystemDirectoryHandle
  return { directory, files, read: (fn: (name: string) => void) => { onRead = fn } }
}
function command(state: OverlayState, fields: Partial<OverlayCommand> = {}): OverlayCommand {
  return { protocol: 1, id: crypto.randomUUID(), clientId: state.clientId, revision: state.revision, captureId: state.captureId, action: state.actions.find(action => action.id.startsWith('collect:'))!.id, createdAt: Date.now(), ...fields }
}
describe('local overlay channel', () => {
  it('keeps heartbeat revisions stable, applies a choice once, and invalidates on disconnect', async () => {
    const { directory, files } = memoryDirectory(), input = inputs()
    files.set('capture.json', JSON.stringify(input.capture))
    const channel = new OverlayChannel(directory), calls: string[] = []
    const snapshot = () => ({ view: overlayAdvice(input), context: JSON.stringify(input) })
    const state = (await channel.tick(snapshot, action => calls.push(action)))!
    expect((await channel.tick(snapshot, action => calls.push(action)))!.revision).toBe(state.revision)
    files.set('command.json', JSON.stringify(command(state)))
    expect((await channel.tick(snapshot, action => calls.push(action)))?.actions).toEqual([])
    await channel.tick(snapshot, action => calls.push(action))
    expect(calls).toHaveLength(1)
    await channel.disconnect()
    expect(overlayStateSchema.parse(JSON.parse(files.get('state.json')!))).toMatchObject({ writtenAt: 0, actions: [] })
  })
  it('rejects stale, mismatched, previous-session and unadvertised commands', async () => {
    const { directory, files } = memoryDirectory(), input = inputs(), calls: string[] = []
    files.set('capture.json', JSON.stringify(input.capture))
    const channel = new OverlayChannel(directory), snapshot = () => ({ view: overlayAdvice(input), context: '' })
    const state = (await channel.tick(snapshot, action => calls.push(action)))!
    for (const fields of [{ createdAt: Date.now() - 13_000 }, { captureId: crypto.randomUUID() }, { clientId: crypto.randomUUID() }, { revision: crypto.randomUUID() }, { action: 'confirm-new-area' }]) {
      files.set('command.json', JSON.stringify(command(state, fields)))
      await channel.tick(snapshot, action => calls.push(action))
    }
    expect(calls).toEqual([])
  })
  it('rejects a command when the capture or website changes during file reads', async () => {
    const fs = memoryDirectory(), input = inputs(), calls: string[] = []
    fs.files.set('capture.json', JSON.stringify(input.capture))
    const channel = new OverlayChannel(fs.directory), snapshot = () => ({ view: overlayAdvice(input), context: JSON.stringify(input) })
    const state = (await channel.tick(snapshot, action => calls.push(action)))!
    fs.files.set('command.json', JSON.stringify(command(state)))
    fs.read(name => { if (name === 'command.json') input.blocked = true })
    await channel.tick(snapshot, action => calls.push(action))
    expect(calls).toEqual([])
    input.blocked = false; fs.read(() => undefined)
    const fresh = (await channel.tick(snapshot, action => calls.push(action)))!
    fs.files.set('command.json', JSON.stringify(command(fresh)))
    fs.read(name => { if (name === 'command.json') fs.files.set('capture.json', JSON.stringify({ ...input.capture, phase: 'capturing', captureId: crypto.randomUUID() })) })
    await channel.tick(snapshot, action => calls.push(action))
    expect(calls).toEqual([])
  })
  it('rejects a second live writer, malformed capture markers and oversized messages', async () => {
    const { directory, files } = memoryDirectory(), input = inputs()
    files.set('capture.json', JSON.stringify(input.capture))
    const snapshot = () => ({ view: overlayAdvice(input), context: '' })
    const channel = new OverlayChannel(directory)
    await channel.tick(snapshot, () => undefined)
    await expect(new OverlayChannel(directory).tick(snapshot, () => undefined)).rejects.toThrow('Another advisor')
    files.set('capture.json', '{')
    await expect(channel.tick(snapshot, () => undefined)).rejects.toThrow()
    files.set('capture.json', 'x'.repeat(32_769))
    await expect(channel.tick(snapshot, () => undefined)).rejects.toThrow('size limit')
  })
})
