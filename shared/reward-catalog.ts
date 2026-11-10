import type { Reward } from './schema'

export const REWARD_CATALOG_VERSION = 'rewards-v1'

// Tooltip meanings are independent of the visual matcher. In particular, the
// matcher crops do not reliably distinguish regular/combo borders for every motif.
export const REWARD_CATALOG = [
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

export type CatalogReward = typeof REWARD_CATALOG[number]
export const KNOWN_COMBOS = REWARD_CATALOG.filter(entry => entry.kind === 'combo')

export function catalogFields(entry: CatalogReward): Pick<Reward, 'label' | 'kind' | 'threshold' | 'identified'> {
  return { label: entry.label, kind: entry.kind, threshold: entry.threshold, identified: entry.kind !== 'unknown' }
}

export function selectedCatalogReward(reward: Reward): CatalogReward | undefined {
  return REWARD_CATALOG.find(entry => reward.label === entry.label && reward.kind === entry.kind
    && reward.threshold === entry.threshold && reward.identified === (entry.kind !== 'unknown'))
}

export function visualRewardFields(visualId: NonNullable<Reward['visualId']>): Partial<Reward> {
  if (visualId === 'orange-feathers') return catalogFields(REWARD_CATALOG[2])
  if (visualId === 'gold-grid') return catalogFields(REWARD_CATALOG[3])
  // Item Rarity's combo variant is verified, but a bare ring must not become
  // combo(3) automatically. Only an explicit tooltip-based selection does that.
  if (visualId === 'gold-ring') return { label: 'Item Rarity', kind: 'unknown', threshold: null, identified: false }
  return {}
}
