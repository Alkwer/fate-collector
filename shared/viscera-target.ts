import { assessPlanningCard, type PlanningFilters } from './planning-filters'
import type { FateCard, Offer } from './schema'
import { visceraCompanionName } from './viscera'
import catalog from './viscera-catalog.json' with { type: 'json' }

export const VISCERA_SOURCE_URL = 'https://poedb.tw/us/Viscera'

export type VisceraSource = { boss: string; area?: string; act?: number }
type VisceraArea = { id: string; name: string; act?: number }
export type VisceraTarget = { id: string; name: string; sources: readonly VisceraSource[] }

export const VISCERA_TARGETS: readonly VisceraTarget[] = catalog.targets
const areas: readonly VisceraArea[] = catalog.areas

export function getVisceraTarget(id: string | null) {
  return VISCERA_TARGETS.find(target => target.id === id)
}

const normalizeArea = (name: string) => name.normalize().trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')

export function resolveVisceraArea(offer: Pick<Offer, 'area' | 'areaCategory'> | null): VisceraArea | undefined {
  const input = normalizeArea(offer?.area ?? '')
  if (!input || offer?.areaCategory === 'other') return undefined

  const byId = areas.filter(area => normalizeArea(area.id) === input)
  const matches = (byId.length ? byId : areas.filter(area => {
    const name = normalizeArea(area.name)
    return input === name || (area.act ? input === `act ${area.act}, ${name}` : input === `${name} map`)
  })).filter(area => offer?.areaCategory === 'campaign' ? area.act !== undefined : offer?.areaCategory === 'map' ? area.act === undefined : true)
  const first = matches[0]
  // Multiple IDs can point to the same area. A shared name or ID may also refer
  // to distinct encounters and cannot select one without more information.
  return first && matches.every(area => area.name === first.name && area.act === first.act) ? first : undefined
}

export function isVisceraSourceHere(source: VisceraSource, area: VisceraArea | undefined) {
  return !!area && source.area === area.name && source.act === area.act
}

export function visceraCompanion(card: FateCard, filters: PlanningFilters) {
  if (card.tier === null || card.visualReview?.tierReviewed === false) return undefined
  const name = visceraCompanionName(card.name, card.tier)
  if (!name) return undefined
  return { name, tier: card.tier, ...assessPlanningCard(card, filters) }
}
