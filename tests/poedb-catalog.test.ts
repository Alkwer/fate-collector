import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import credits from '../public/game-art/poedb/credits.json'
import { REWARD_CATALOG } from '../shared/reward-catalog'
import { extractCards, knownFateName } from '../shared/recognition'
import { getPoedbFate, getPoedbRewardReferences, POEDB_CATALOG } from '../shared/poedb-catalog'

test('the versioned reference records have unique IDs and source provenance', () => {
  const { version, checkedAt, sources, fates, rewards } = POEDB_CATALOG
  expect(version).toBe(`poedb-fates-${checkedAt}`)
  expect(checkedAt).toBe('2026-11-16')
  expect(fates).toHaveLength(25)
  expect(rewards).toHaveLength(146)
  const records = [...sources, ...fates, ...rewards]
  expect(new Set(records.map(row => row.id)).size).toBe(records.length)
  expect(sources.map(source => source.url)).toEqual([
    'https://poedb.tw/us/Fates',
    'https://www.pathofexile.com/forum/view-thread/4015564',
  ])
  const sourceById = new Map(sources.map(source => [source.id, source]))
  for (const record of [...fates, ...rewards, ...fates.flatMap(row => row.corrections ?? [])]) {
    expect(sourceById.get(record.sourceId)?.checkedAt).toBe(checkedAt)
  }
})

test('Crowkeeper reference applies Hotfix 2 and retains the superseded source wording in its notes', () => {
  const crowkeeper = getPoedbFate(' Crowkeeper ', 3)
  expect(crowkeeper).toMatchObject({ status: 'corrected', corrections: [{ sourceId: 'ggg-hotfix-2',
    superseded: expect.arrayContaining(['Culling Strike']) }] })
  expect(crowkeeper?.corrections?.[0].description).toContain('no longer grants Culling Strike')
  expect(crowkeeper?.description).not.toMatch(/Culling Strike|kills Enemies below 10%/i)
  expect(crowkeeper?.effects.join(' ')).not.toMatch(/Culling Strike|kills Enemies below 10%/i)
  expect(getPoedbFate('Crowkeeper', 2)).toBeUndefined()
  expect(getPoedbFate('wildfire', 3)?.corrections?.[0]).toMatchObject({ sourceId: 'ggg-hotfix-2' })
})

test('PoEDB names match exact normalized names and preserve the separate screenshot name Rot', () => {
  expect(getPoedbFate('Rot', 3)).toBeUndefined()
  expect(getPoedbFate('rotted', 3)?.name).toBe('Rotted')
  expect(getPoedbFate('SAVAGE', 3)?.name).toBe('Savage')
  expect(getPoedbFate('  black   frost  ', 3)?.name).toBe('Black Frost')
  expect(['Rot', 'Rotted', 'Savage'].map(knownFateName)).toEqual(['Rot', 'Rotted', 'Savage'])

  const line = (text: string, x: number, y: number) => ({ text, x, y, width: 160, height: 20 })
  const recognized = extractCards({ image: { width: 1000, height: 800 }, ocr: { status: 'ok',
    text: '', language: 'en-US', lines: [line('Fates', 450, 0), line('Rot', 50, 100), line('Rotted', 350, 100),
      line('Savage', 650, 100), line('CONFIRM', 450, 450)] } })
  expect(recognized.cards.map(card => card.name)).toEqual(['Rot', 'Rotted', 'Savage'])
  for (const card of recognized.cards) expect(card).toMatchObject({ tier: null, rewards: [], modifiers: [] })
})

test('reward definitions are bounded references with source levels and no solver fields', () => {
  expect(getPoedbRewardReferences()).toHaveLength(30)
  expect(getPoedbRewardReferences('there is no such reward')).toEqual([])
  expect(getPoedbRewardReferences('  Additional  Currency Items  ')).toEqual(expect.arrayContaining([
    expect.objectContaining({ minLevel: 81, sourceId: 'poedb-fates' }),
  ]))
  for (const reference of POEDB_CATALOG.rewards) {
    expect(Object.keys(reference).sort()).toEqual(['description', 'iconUrl', 'id', 'minLevel', 'sourceId'])
    expect(reference.iconUrl).toMatch(/^https:\/\/cdn\.poedb\.tw\//)
  }
  expect(REWARD_CATALOG.every(reward => !reward.id.startsWith('poedb-reward-'))).toBe(true)
})

test('credited portraits are original local WebP files with matching digests', () => {
  expect(POEDB_CATALOG.portraits.map(entry => entry.name).sort()).toEqual([
    'Black Frost', 'Blood Moon', 'Golemancer', 'Murderous', 'Pestilent', 'Rotted', 'Sadist', 'Savage',
  ])
  expect(credits.assets).toEqual(POEDB_CATALOG.portraits)
  for (const portrait of POEDB_CATALOG.portraits) {
    const data = readFileSync(new URL(`../public${portrait.path}`, import.meta.url))
    expect(createHash('sha256').update(data).digest('hex')).toBe(portrait.sha256)
    expect(data.toString('ascii', 8, 16)).toBe('WEBPVP8X')
    expect([data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1]).toEqual([portrait.width, portrait.height])
  }
})
