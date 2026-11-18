import { SCREENSHOT_CATALOG_SOURCE } from '../../shared/reward-catalog'
import { DetailPanel } from './DetailPanel'
import { getPoedbFate, getScreenshotFate, POEDB_CATALOG } from '../../shared/poedb-catalog'
import { VISCERA_COMPANION_PATCH_URL, visceraCompanionName } from '../../shared/viscera'

export function FateReference({ name, tier }: { name: string; tier: number | null }) {
  const fate = getScreenshotFate(name)
  const external = getPoedbFate(name, tier === null ? 3 : tier)
  if (!fate && !external) return null
  const variants = !fate ? [] : tier === null ? fate.variants : fate.variants.filter(variant => variant.tier === tier)
  const currentCompanionEffect = external && visceraCompanionName(external.name, external.tier)
  const companionPatchApplies = currentCompanionEffect || variants.some(variant => visceraCompanionName(name, variant.tier))
  return <DetailPanel className="fate-reference" title={`${fate?.name ?? external?.name} effects`} triggerLabel="Known Fate effects">
    <p className="hint">Rewards vary between offers. References never fill or confirm your card. Check the tier and current tooltip in game.</p>
    {companionPatchApplies && <p className="hint">{variants.length > 0 && 'A spawned companion boss always drops its own Viscera when killed. '}<a href={VISCERA_COMPANION_PATCH_URL} target="_blank" rel="noreferrer">GGG 3.30.0c</a></p>}
    {!variants.length && !external && <p>No effect tooltip recorded for Tier {tier}. Check the tooltip in game.</p>}
    {variants.map(variant => <section key={variant.tier}>
      <h3>Tier {variant.tier}{variant.completeness === 'short-only' ? ' · short description only' : ''}</h3>
      <p className="hint">Observed tooltip · 13–15 Nov 2026</p>
      <p>{variant.shortDescription}</p>
      {!!variant.lines.length && <ul>{variant.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      {variant.completeness === 'short-only' && <p className="hint">The full effect tooltip is missing. Values and additional effects are unknown.</p>}
    </section>)}
    {external && <section>
      <h3>Tier 3 · source reference</h3>
      <p className="hint">PoEDB · checked {POEDB_CATALOG.checkedAt}{external.status === 'corrected' || currentCompanionEffect ? ' · official patch correction applied' : ''}</p>
      <p>{currentCompanionEffect ? external.description.replace('can drop Viscera associated with it', 'will always drop its own Viscera when killed') : external.description}</p>
      {!!external.effects.length && <ul>{external.effects.map((effect, index) => <li key={index}>{effect}</li>)}</ul>}
      {external.corrections?.map((correction, index) => <p className="hint" key={index}>{correction.description} <a href={POEDB_CATALOG.sources.find(source => source.id === correction.sourceId)?.url} target="_blank" rel="noreferrer">Official patch notes</a></p>)}
      <p><a href="https://poedb.tw/us/Fates" target="_blank" rel="noreferrer">PoEDB Fate effects</a></p>
    </section>}
    {fate && <p><a href={`${SCREENSHOT_CATALOG_SOURCE}#fate-${fate.name.toLowerCase().replaceAll(' ', '-')}`} target="_blank" rel="noreferrer">Screenshot sources and scope</a></p>}
  </DetailPanel>
}
