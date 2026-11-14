import screenshots from '../../shared/screenshot-catalog.json' with { type: 'json' }
import { SCREENSHOT_CATALOG_SOURCE } from '../../shared/reward-catalog'
import { DetailPanel } from './DetailPanel'

export function FateReference({ name, tier }: { name: string; tier: number | null }) {
  const fate = screenshots.fates.find(entry => entry.name.toLowerCase() === name.trim().toLowerCase())
  if (!fate) return null
  const variants = tier === null ? fate.variants : fate.variants.filter(variant => variant.tier === tier)
  return <DetailPanel className="fate-reference" title={`${fate.name} effects`} triggerLabel="Known Fate effects">
    <p className="hint">Observed tooltips, 13–14 Nov 2026. Rewards vary between offers. This reference does not fill or confirm your card.</p>
    {!variants.length && <p>No effect tooltip recorded for Tier {tier}. Check the tooltip in game.</p>}
    {variants.map(variant => <section key={variant.tier}>
      <h3>Tier {variant.tier}{variant.completeness === 'short-only' ? ' · short description only' : ''}</h3>
      <p>{variant.shortDescription}</p>
      {!!variant.lines.length && <ul>{variant.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      {variant.completeness === 'short-only' && <p className="hint">The full effect tooltip is missing. Values and additional effects are unknown.</p>}
    </section>)}
    <p><a href={`${SCREENSHOT_CATALOG_SOURCE}#fate-${fate.name.toLowerCase().replaceAll(' ', '-')}`} target="_blank" rel="noreferrer">Screenshot sources and scope</a></p>
  </DetailPanel>
}
