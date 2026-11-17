import { describe, expect, it } from 'vitest'
import { overlayAdvice, type OverlayInputs } from '../src/lib/overlay-advice'
import { newOffer } from '../shared/offers'
import { bindOfferToMap, newAdvisorWorkspace, startMapWorkspace } from '../src/lib/advisor-workspace'
import { newSolverSettings } from '../src/lib/solver-settings'
import { overlayStateSchema, type OverlayCommand, type OverlayState } from '../shared/overlay'
import { OverlayChannel } from '../src/lib/overlay-channel'

function inputs(): OverlayInputs {
  const offer = newOffer()
  offer.captureId = offer.id
  offer.cards = [1, 2].map((count, index) => ({ id: crypto.randomUUID(), name: ['Alchemist', 'Crowkeeper'][index], tier: 2, modifiers: [], rewards: [{ id: crypto.randomUUID(), label: 'Currency', kind: 'regular', count, threshold: null, identified: true }] }))
  const settings = newSolverSettings()
  settings.profile = { goals: [{ kind: 'regular', label: 'Currency', weight: 1 }], avoidModifiers: [] }
  return { offer, workspace: bindOfferToMap(startMapWorkspace(newAdvisorWorkspace()), offer.id), settings, capture: { protocol: 1, captureId: offer.id, phase: 'saved', updatedAt: Date.now() }, needsMapConfirmation: false, blocked: false, canUndo: false, confirmNewArea: false }
}

describe('overlay advice uses the existing recommendation engines', () => {
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
  it('ranks the exact offered IDs and supports both priorities and a single goal', () => {
    const input = inputs()
    const portfolio = overlayAdvice(input)
    expect(portfolio).toMatchObject({ status: 'ready', title: 'Recommended: 2. Crowkeeper' })
    expect(portfolio.rows.map(row => row.recommended)).toEqual([false, true])
    expect(portfolio.actions).toContainEqual({ id: `collect:${input.offer.cards[1].id}`, slot: 2, label: 'Record Crowkeeper' })
    input.settings.mode = 'single'; input.workspace.goal = { kind: 'regular', label: 'Currency' }
    expect(overlayAdvice(input).title).toBe(portfolio.title)
  })
  it('keeps ties, missing rewards and exclusions explicit', () => {
    const input = inputs()
    input.offer.cards[1].rewards[0].count = 1
    expect(overlayAdvice(input).title).toContain('Equal matches')
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
