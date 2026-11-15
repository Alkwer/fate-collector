import type { Reward } from './schema'
import screenshots from './screenshot-catalog.json' with { type: 'json' }

export const REWARD_CATALOG_VERSION = 'rewards-v3-screenshots-20261115'

export const SCREENSHOT_CATALOG_SOURCE = 'https://github.com/Alkwer/fate-collector/blob/main/research/SCREENSHOT_CATALOG_2026-11-15.md'
type CatalogDetails = { id: string; label: string; description: string; source: string; sourceLabel: string }
export type CatalogReward = CatalogDetails & (
  { kind: 'combo'; threshold: number } | { kind: 'regular' | 'unknown'; threshold: null }
)

// Tooltip meanings are independent of the visual matcher. In particular, the
// matcher crops do not reliably distinguish regular/combo borders for every motif.
const prereleaseRewards = [
  { id: 'item-rarity', label: 'Item Rarity', kind: 'combo', threshold: 3,
    description: 'Greatly increases the empowered boss’s Item Rarity. Requires three matching combo icons.',
    source: 'https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11637s' },
  { id: 'exceptional-gem', label: 'Exceptional Gem', kind: 'combo', threshold: 3,
    description: 'Adds an Exceptional Gem. Requires three matching combo icons. The three-coloured-gems motif is a different icon.',
    source: 'https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11677s' },
  { id: 'dreadmaidens-sacrament', label: "Dreadmaidens' Sacrament", kind: 'combo', threshold: 2,
    description: 'Awards the unique Basalt Flask. Requires two matching combo icons.',
    source: 'https://www.youtube.com/watch?v=8FKW2rKJyxA&t=11697s' },
  { id: 'additional-currency', label: 'Additional Currency Items', kind: 'unknown', threshold: null,
    description: 'Adds currency items. The motif alone does not establish regular/combo kind or a combo threshold; check your tooltip.',
    source: 'https://web.poecdn.com/public/news/2026-11-07/Kits_for_press_exc26/PoE1_CovensofUmbra_PressKit.zip' },
] as const

const observedRewards: CatalogReward[] = screenshots.rewards.map(entry => {
  const details = { id: `observed-${entry.id}`, label: entry.label, description: entry.tooltip.map(line => `${line}.`).join(' '),
    source: `${SCREENSHOT_CATALOG_SOURCE}#${entry.id}`, sourceLabel: 'Screenshot tooltip · 13–15 Nov 2026' }
  if (entry.kind === 'combo' && Number.isInteger(entry.threshold) && entry.threshold !== null && entry.threshold > 0) {
    return { ...details, kind: 'combo', threshold: entry.threshold }
  }
  if (entry.kind === 'regular' && entry.threshold === null) return { ...details, kind: 'regular', threshold: null }
  throw new Error(`Invalid screenshot reward: ${entry.id}`)
})

export const REWARD_CATALOG: CatalogReward[] = [
  ...prereleaseRewards.map(entry => ({ ...entry, sourceLabel: 'GGG prerelease reference' })),
  ...observedRewards,
]
export const REWARD_SHORTCUTS = REWARD_CATALOG.filter(entry => prereleaseRewards.some(original => original.id === entry.id))
export const KNOWN_COMBOS = REWARD_CATALOG.filter(entry => entry.kind === 'combo')

export function catalogFields(entry: CatalogReward): Pick<Reward, 'label' | 'kind' | 'threshold' | 'identified'> {
  return { label: entry.label, kind: entry.kind, threshold: entry.threshold, identified: entry.kind !== 'unknown' }
}

export function selectedCatalogReward(reward: Reward): CatalogReward | undefined {
  return REWARD_CATALOG.find(entry => reward.label === entry.label && reward.kind === entry.kind
    && reward.threshold === entry.threshold && reward.identified === (entry.kind !== 'unknown'))
}

export function visualRewardFields(visualId: NonNullable<Reward['visualId']>): Partial<Reward> {
  if (visualId === 'orange-feathers') return catalogFields(REWARD_CATALOG.find(entry => entry.id === 'dreadmaidens-sacrament')!)
  if (visualId === 'gold-grid') return catalogFields(REWARD_CATALOG.find(entry => entry.id === 'additional-currency')!)
  // Item Rarity's combo variant is verified, but a bare ring must not become
  // combo(3) automatically. Only an explicit tooltip-based selection does that.
  if (visualId === 'gold-ring') return { label: 'Item Rarity', kind: 'unknown', threshold: null, identified: false }
  return {}
}
