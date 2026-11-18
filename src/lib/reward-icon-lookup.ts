import { POEDB_CATALOG } from '../../shared/poedb-catalog'
import { REWARD_CATALOG } from '../../shared/reward-catalog'
import type { Reward } from '../../shared/schema'

const normalize = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'").replace(/[.,:;]/g, ' ').replace(/\s+/g, ' ').trim()
const iconKey = (url: string) => url.split('/').pop()!.replace(/^AuguryRewardIcon|\.webp$/g, '')
export const iconGroups = [...new Set(POEDB_CATALOG.rewards.map(row => iconKey(row.iconUrl)))].sort()
const groupNames: Record<string, string> = {
  IncreasedRarityAffectedMonster: 'Item rarity', Divination: 'Stacked decks', UniqueAuguryItem: 'League unique',
}
export const iconGroupName = (key: string) => groupNames[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2')
export const iconPath = (group: string) => `/game-art/poedb/reward-icons/AuguryRewardIcon${group}.webp`
export function suggestedIconGroup(visual: Reward['visualId']) {
  if (visual === 'orange-feathers') return 'UniqueAuguryItem'
  if (visual === 'gold-grid') return 'Currency'
  if (visual === 'gold-ring') return 'IncreasedRarityAffectedMonster'
  return ''
}

const catalogDescriptions = REWARD_CATALOG.filter(entry => entry.kind !== 'unknown').map(entry => ({
  entry, text: normalize(entry.description.split(/To claim this reward/i)[0]),
}))
export const iconVariants = POEDB_CATALOG.rewards.map(row => {
  const text = normalize(row.description)
  const matches = catalogDescriptions.filter(({ entry, text: tooltip }) => tooltip === text
    || (entry.id === 'exceptional-gem' && text === 'empowered monster will drop an additional exceptional gem')
    || (entry.id === 'dreadmaidens-sacrament' && text === "empowered monster will drop dreadmaidens' sacrament")).map(item => item.entry)
  return { ...row, group: iconKey(row.iconUrl), text, matches }
})

// A tooltip label can supply reference artwork only when every matching
// definition points to the same image. Recorded motifs retain precedence.
const labelGroups = new Map<string, Set<string>>()
for (const row of iconVariants) for (const entry of row.matches) {
  const key = normalize(entry.label)
  const groups = labelGroups.get(key) ?? new Set<string>()
  groups.add(row.group)
  labelGroups.set(key, groups)
}
export function confirmedRewardIcon(label: string) {
  const groups = labelGroups.get(normalize(label))
  if (groups?.size === 1) return iconPath([...groups][0])
  return null
}

export function matchingIconVariants(group: string, words: string) {
  const tokens = normalize(words).split(' ').filter(Boolean)
  return iconVariants.filter(row => row.group === group && tokens.every(token => row.text.includes(token)))
}

// OCR may contain several cards or tooltips. The player chooses a phrase from
// the capture, so unrelated OCR never silently filters a selected reward.
export function tooltipPhrases(text: string) {
  const phrases = text.match(/\b(?:no [a-z]+ modifiers?|[a-z]+ modifier|valuable currency|stacked decks|maximum quality|[a-z]+ requirements|exceptional gem|(?:highly|greatly|massively|extremely) increased item rarity)\b/gi) ?? []
  return [...new Set(phrases.map(normalize))].slice(0, 24)
}
