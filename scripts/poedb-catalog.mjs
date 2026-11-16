import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'

const catalogFile = new URL('../shared/poedb-catalog.json', import.meta.url)
const creditsFile = new URL('../public/game-art/poedb/credits.json', import.meta.url)
const checkedAt = '2026-11-16'
const sources = [
  { id: 'poedb-fates', url: 'https://poedb.tw/us/Fates', label: 'PoEDB Fates and Rewards', checkedAt },
  { id: 'ggg-hotfix-2', url: 'https://www.pathofexile.com/forum/view-thread/4015564', label: 'GGG 3.30.0b Hotfix 2', checkedAt },
]
const portraitNames = new Set(['Black Frost', 'Blood Moon', 'Golemancer', 'Murderous', 'Rotted', 'Pestilent', 'Sadist', 'Savage'])
const cdnPath = 'https://cdn.poedb.tw/image/Art/2DArt/UIImages/InGame/Augury/'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const slug = name => name.toLowerCase().replace(/ /g, '-')
const json = value => `${JSON.stringify(value, null, 2)}\n`

function boundedFile(path, limit) {
  assert(statSync(path).size <= limit, `File exceeds ${limit} bytes: ${path}`)
  return readFileSync(path)
}

function capture(html, pattern) {
  const match = html.match(pattern)
  assert(match, `Missing source field matching ${pattern}`)
  return match[1]
}

function sourceText(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&(?:amp|apos|quot|lt|gt|nbsp);|&#(?:\d+|x[\da-f]+);/gi, entity => {
      const named = { '&amp;': '&', '&apos;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }
      entity = entity.toLowerCase()
      if (entity.startsWith('&#x')) return String.fromCodePoint(parseInt(entity.slice(3, -1), 16))
      if (entity.startsWith('&#')) return String.fromCodePoint(Number(entity.slice(2, -1)))
      return named[entity]
    }).replace(/\s+/g, ' ').trim()
}

const sourceLines = html => html.split(/<br\s*\/?\s*>/i).map(sourceText).filter(Boolean)

function imageUrl(row, cssClass, directory = '') {
  const url = capture(row, new RegExp(`<img\\b[^>]* src="([^"]+)"[^>]* class="${cssClass}"`))
  const prefix = cdnPath + directory
  assert(url.startsWith(prefix) && /^\w+\.webp$/.test(url.slice(prefix.length)), `Unexpected image source: ${url}`)
  return url
}

function portraitFile(name, sourceUrl) {
  const path = `/game-art/poedb/${slug(name)}.webp`
  const data = boundedFile(new URL(`../public${path}`, import.meta.url), 64 * 1024)
  const valid = data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF'
    && data.readUInt32LE(4) === data.length - 8 && data.toString('ascii', 8, 16) === 'WEBPVP8X'
  assert(valid, `Unexpected PoEDB WebP: ${path}`)
  return { name, path, sourceUrl, sha256: sha256(data), width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 }
}

function portraitCredits(portraits) {
  return {
    copyright: 'Path of Exile artwork © Grinding Gear Games.',
    purpose: 'Original WebP files mirrored by PoEDB, used as Fate name references.',
    checkedAt,
    source: sources[0].url,
    assets: portraits,
  }
}

function parseSnapshot(fatesHtml, hotfixHtml) {
  const hotfixNotes = [...hotfixHtml.matchAll(/<li>([^\n]*?)<\/li>/g)].map(match => sourceText(match[1]))
  assert(hotfixNotes.some(line => /Tier 3 Crowkeeper Fate no longer grants .* Culling Strike/i.test(line)))
  assert(hotfixNotes.some(line => /Reduced the damage on the explosions caused by the Crowkeeper Fate/i.test(line)))
  assert(hotfixNotes.some(line => /Reduced the damage on the Blackfire Walls caused by the Wildfire Fate/i.test(line)))
  const rows = fatesHtml.split('<div class="d-flex border-top rounded">').slice(1)
  const fates = []
  const rewards = []
  const portraits = []
  const occurrences = new Map()

  for (const row of rows) {
    if (row.includes('class="AuguryCards"')) {
      const name = sourceText(capture(row, /<span class="augurypopuptitle">([^<]+)<\/span>/))
      const description = sourceLines(capture(row, /<span class="augurypopuptext">([\s\S]*?)<\/span><\/div>/))
      const short = sourceText(capture(row, /<div class="AuguryDetail">([\s\S]*?)<\/div>/))
      const rawEffects = capture(row, /<div class="explicitMod">([\s\S]*?)<\/div>/)
      const tier = Number(capture(rawEffects, /augury (?:card|daemon) tier find stat [^[]+\[(\d+)\]/))
      const effects = [short, ...sourceLines(rawEffects.replace(/<span class="secondary">[\s\S]*?<\/span>/g, ''))]
      const entry = { id: `poedb-${slug(name)}-t${tier}`, name, tier, description: description.join('\n'), effects, sourceId: 'poedb-fates', status: 'reference' }
      if (name === 'Crowkeeper') {
        const cull = line => /Culling Strike|kills Enemies below 10%/i.test(line)
        const superseded = [...description, ...effects].filter(cull)
        assert.equal(superseded.length, 2, 'Recheck the Crowkeeper source and correction')
        entry.description = description.filter(line => !cull(line)).join('\n')
        entry.effects = effects.filter(line => !cull(line))
        entry.status = 'corrected'
        entry.corrections = [{ description: 'Tier 3 no longer grants Culling Strike. Crowkeeper explosions deal less damage.', sourceId: 'ggg-hotfix-2', superseded }]
      }
      if (name === 'Wildfire') {
        entry.status = 'corrected'
        entry.corrections = [{ description: 'Blackfire Walls deal less damage.', sourceId: 'ggg-hotfix-2' }]
      }
      fates.push(entry)
      if (portraitNames.has(name)) portraits.push(portraitFile(name, imageUrl(row, 'AuguryCards', 'CardArt/')))
    } else if (row.includes('class="AuguryRewardOutcomes"')) {
      const description = sourceText(capture(row, /<div class="flex-grow-1 ms-2"><div>([\s\S]*?)<\/div>/))
      const iconUrl = imageUrl(row, 'AuguryRewardOutcomes')
      const level = row.match(/<div>Min Level: (\d+)<\/div>/)
      const minLevel = level ? Number(level[1]) : null
      const key = sha256(json([description, iconUrl, minLevel])).slice(0, 16)
      const occurrence = (occurrences.get(key) ?? 0) + 1
      occurrences.set(key, occurrence)
      rewards.push({ id: `poedb-reward-${key}-${occurrence}`, description, iconUrl, minLevel, sourceId: 'poedb-fates' })
    }
  }

  assert.equal(fates.length, 25, 'Snapshot Fate count changed')
  assert.equal(new Set(fates.map(entry => entry.id)).size, fates.length, 'Duplicate Fate IDs')
  assert(fates.every(entry => entry.tier === 3), 'Fate source tier changed')
  assert.equal(rewards.length, 146, 'Snapshot reward count changed')
  assert.deepEqual(new Set(portraits.map(entry => entry.name)), portraitNames)
  return { schemaVersion: 1, version: `poedb-fates-${checkedAt}`, checkedAt, gameVersion: '3.30 Covens League', sources, fates, rewards, portraits }
}

const [action = '--check', fatesPath, hotfixPath, ...extra] = process.argv.slice(2)
if (action === '--check' && !fatesPath) {
  const { POEDB_CATALOG } = await import('../shared/poedb-catalog.ts')
  const portraits = POEDB_CATALOG.portraits.map(entry => portraitFile(entry.name, entry.sourceUrl))
  assert.deepEqual(portraits, POEDB_CATALOG.portraits)
  assert.deepEqual(JSON.parse(readFileSync(creditsFile, 'utf8')), portraitCredits(portraits))
  console.log(`Verified ${POEDB_CATALOG.fates.length} Fates, ${POEDB_CATALOG.rewards.length} reward definitions and ${portraits.length} local portraits.`)
} else if ((action === '--import' || action === '--check-source') && fatesPath && hotfixPath && !extra.length) {
  const snapshot = parseSnapshot(boundedFile(fatesPath, 512 * 1024).toString('utf8'), boundedFile(hotfixPath, 512 * 1024).toString('utf8'))
  const credits = portraitCredits(snapshot.portraits)
  if (action === '--import') {
    writeFileSync(catalogFile, json(snapshot))
    writeFileSync(creditsFile, json(credits))
  } else {
    assert.deepEqual(JSON.parse(readFileSync(catalogFile, 'utf8')), snapshot)
    assert.deepEqual(JSON.parse(readFileSync(creditsFile, 'utf8')), credits)
  }
  console.log(`Parsed ${snapshot.fates.length} Fates and ${snapshot.rewards.length} reward definitions for ${checkedAt}.`)
} else {
  console.error('Usage: node scripts/poedb-catalog.mjs [--check | (--import | --check-source) <fates.html> <hotfix.html>]')
  process.exitCode = 1
}
