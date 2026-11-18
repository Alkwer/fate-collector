import { normalizeFateName } from './fate-names'
import { getPoedbFate, getScreenshotFate } from './poedb-catalog'

export const VISCERA_COMPANION_PATCH_URL = 'https://www.pathofexile.com/forum/view-thread/4017172'
export const COMPANION_VISCERA = 'Guaranteed companion Viscera on kill'

const companionNames = new Set(['savage', 'pestilent', 'sadist'])

export function isCompanionFate(name: string) {
  return companionNames.has(normalizeFateName(name))
}

// The patch guarantees the spawned boss's Viscera. The tier references tell
// us when the boss spawns, including Sadist's Tier 2 short description.
export function visceraCompanionName(name: string, tier: number | null) {
  if (!isCompanionFate(name)) return undefined
  if (tier === 3) return getPoedbFate(name, tier)?.name
  const fate = getScreenshotFate(name)
  if (fate?.variants.some(variant => variant.tier === tier && /spawns an additional boss\b/i.test(variant.shortDescription))) return fate.name
}
