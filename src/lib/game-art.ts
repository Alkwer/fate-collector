import type { Reward } from '../../shared/schema'
import poedb from '../../public/game-art/poedb/credits.json'
import { confirmedRewardIcon } from './reward-icon-lookup'

// Display references only. Portraits never supply a card's tier or reward data.
// Sources and digests live in /game-art/credits.json and /game-art/poedb/credits.json.
const portraits = new Set(['alchemist', 'sanguine', 'butcher', 'gravewalker',
  'torchbearer', 'tempest', 'stormcaller', 'houndmaster', 'bloodthirsty',
  'deathbringer', 'dryad', 'conjurer', 'avalanche', 'wildfire', 'doomsayer',
  'incandescent', 'crowkeeper'])

const normalize = (label: string) => label.normalize().trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')

export function fateArt(name: string): string | null {
  const key = normalize(name)
  return portraits.has(key) ? `/game-art/${key}.webp` : poedb.assets.find(entry => normalize(entry.name) === key)?.path ?? null
}

const namedRewards: Record<string, string> = {
  'item rarity': 'item-rarity',
  'exceptional gem': 'exceptional-gem',
  "dreadmaidens' sacrament": 'dreadmaidens-sacrament',
  // The press-kit tooltip names this motif. These display aliases do not infer
  // regular/combo kind, threshold, item quantities, or recognition confidence.
  'additional currency items': 'gold-grid',
  'currency items': 'gold-grid',
  'currency': 'gold-grid',
}

export function rewardArt(label: string, identified = true, visualId?: Reward['visualId']): string | null {
  const key = normalize(label)
  const id = visualId || (identified && Object.hasOwn(namedRewards, key) ? namedRewards[key] : null)
  if (id) return `/game-art/reward-${id}.png`
  return identified ? confirmedRewardIcon(label) : null
}
