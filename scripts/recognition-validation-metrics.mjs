export const PROFILES = {
  '1080p-sdr-default': { clientSize: [1920, 1080], hdrActive: false, uiScale: 'default' },
  '1440p-sdr-alternate': { clientSize: [2560, 1440], hdrActive: false, uiScale: 'alternate' },
  '4k-hdr-default': { clientSize: [3840, 2160], hdrActive: true, uiScale: 'default' },
  'ultrawide-sdr-default': { clientSize: [3440, 1440], hdrActive: false, uiScale: 'default' },
}
export const SCENES = ['offer', 'invoke', 'negative']
export const MINIMUM_RECALL = { names: 0.95, tiers: 0.9, motifs: 0.9 }
// A minimum smoke corpus, not a statistical confidence claim.
export const COVERAGE_POLICY_VERSION = 'native-holdout-v2'
export const MINIMUM_SCENES = { offer: 10, invoke: 3, negative: 5 }
export const MINIMUM_LABELS = { names: 30, tiers: 20, motifs: 20 }
export const MOTIFS = ['blue-diamond', 'gold-stack', 'gold-grid', 'gold-ring', 'silver-cluster', 'orange-feathers', 'three-gems', 'gold-axe']
export function labelCoverage(cards) {
  const offered = cards.filter(namesExpected)
  return { names: [...new Set(offered.map(card => card.name))].sort(),
    tiers: [...new Set(offered.flatMap(card => card.tier === null ? [] : [card.tier]))].sort(),
    motifs: [...new Set(offered.flatMap(card => card.visualIds ?? []))].sort() }
}

const counter = () => ({ expected: 0, correct: 0, omitted: 0, unexpected: 0, abstained: 0 })
const tally = () => ({ names: counter(), tiers: counter(), motifs: counter(), wrongRows: 0, visibleUnknownNames: 0, unknownNameAbstentions: 0 })
const namesExpected = card => card.group === 'offered' && card.name !== null
const atHeader = ([x, y, width, height], header) => {
  if (!header) return false
  const middleX = header.x + header.width / 2
  const middleY = header.y + header.height / 2
  return middleX >= x && middleX < x + width && middleY >= y && middleY < y + height
}

export function measure(labels, suggestions) {
  const metrics = tally()
  const issues = []
  const matched = new Set()
  for (const suggestion of suggestions) {
    const index = labels.findIndex(label => atHeader(label.headerBox, suggestion.header))
    const label = labels[index]
    const detail = { header: suggestion.header, suggestedName: suggestion.name, group: label?.group ?? null, labelIndex: index }
    const reason = !label ? 'unlabeled-header' : label.group !== 'offered' ? 'wrong-row'
      : matched.has(index) ? 'duplicate-suggestion' : label.name === null ? 'unsafe-name'
      : label.name !== suggestion.name ? 'wrong-name' : null
    if (reason) {
      metrics.names.unexpected++
      metrics.wrongRows += Number(reason === 'wrong-row')
      metrics.tiers.unexpected += Number(suggestion.tier !== null)
      metrics.motifs.unexpected += suggestion.visualIds.length
      issues.push({ ...detail, reason, suggestedTier: suggestion.tier, suggestedMotifs: suggestion.visualIds })
      continue
    }
    matched.add(index)
    metrics.names.correct++
    if (suggestion.tier === null) metrics.tiers.abstained++
    else if (suggestion.tier === label.tier) metrics.tiers.correct++
    else {
      metrics.tiers.unexpected++
      issues.push({ ...detail, reason: 'unexpected-tier', expected: label.tier, actual: suggestion.tier })
    }
    const remaining = [...(label.visualIds ?? [])]
    if (suggestion.visualIds.length === 0) metrics.motifs.abstained++
    for (const visualId of suggestion.visualIds) {
      const found = remaining.indexOf(visualId)
      if (found === -1) {
        metrics.motifs.unexpected++
        issues.push({ ...detail, reason: 'unexpected-motif', actual: visualId, attributable: label.visualIds !== null })
      } else {
        remaining.splice(found, 1)
        metrics.motifs.correct++
      }
    }
    if (label.tier !== null && label.tier !== suggestion.tier) issues.push({ ...detail, reason: 'omitted-tier', expected: label.tier })
    if (remaining.length) issues.push({ ...detail, reason: 'omitted-motifs', expected: remaining })
  }
  for (const [index, label] of labels.entries()) {
    const suggestedHere = suggestions.some(suggestion => atHeader(label.headerBox, suggestion.header))
    if (label.group === 'offered' && label.name === null && label.observedName) {
      metrics.visibleUnknownNames++
      if (!suggestedHere) metrics.unknownNameAbstentions++
    }
    if (!namesExpected(label)) continue
    metrics.names.expected++
    metrics.tiers.expected += Number(label.tier !== null)
    metrics.motifs.expected += label.visualIds?.length ?? 0
    if (!matched.has(index)) {
      metrics.names.abstained += Number(!suggestedHere)
      issues.push({ labelIndex: index, header: label.headerBox, reason: 'omitted-name', expected: label.name })
    }
  }
  for (const field of ['names', 'tiers', 'motifs']) metrics[field].omitted = metrics[field].expected - metrics[field].correct
  return { metrics, issues }
}

function aggregate(rows) {
  const totals = tally()
  for (const { metrics } of rows) {
    for (const field of ['names', 'tiers', 'motifs']) {
      for (const key of Object.keys(totals[field])) totals[field][key] += metrics[field][key]
    }
    totals.wrongRows += metrics.wrongRows
    totals.visibleUnknownNames += metrics.visibleUnknownNames
    totals.unknownNameAbstentions += metrics.unknownNameAbstentions
  }
  const recall = Object.fromEntries(Object.entries(MINIMUM_RECALL).map(([field]) => [field,
    totals[field].expected ? totals[field].correct / totals[field].expected : null]))
  return { ...totals, recall }
}

export function summarize(mode, rows, releaseProblems = []) {
  const measured = rows.filter(row => row.outcome === 'measured')
  const summary = aggregate(measured)
  const byProfile = {}
  const missingCoverage = []
  const failures = [...releaseProblems, ...rows.filter(row => row.outcome !== 'measured' || row.problems.length)
    .map(row => `incomplete or failed scene: ${row.sceneId}`)]
  if (!measured.length) failures.push('no measured scenes')
  for (const field of Object.keys(MINIMUM_RECALL)) {
    if (summary[field].unexpected) failures.push(`unexpected ${field}: ${summary[field].unexpected}`)
  }
  if (mode === 'holdout') {
    for (const profile of Object.keys(PROFILES)) {
      const subset = measured.filter(row => row.profile === profile)
      byProfile[profile] = { measured: subset.length,
        byScene: Object.fromEntries(SCENES.map(scene => [scene, subset.filter(row => row.scene === scene).length])), ...aggregate(subset) }
      for (const scene of SCENES) {
        if (subset.filter(row => row.scene === scene).length < MINIMUM_SCENES[scene]) missingCoverage.push(`${profile}/${scene}`)
      }
      const coverage = Object.fromEntries(['names', 'tiers', 'motifs'].map(field => [field,
        [...new Set(subset.flatMap(row => row.labelCoverage?.[field] ?? []))].sort()]))
      byProfile[profile].labelCoverage = coverage
      if (coverage.names.length < 5) missingCoverage.push(`${profile}/five-distinct-names`)
      for (const tier of [2, 3]) if (!coverage.tiers.includes(tier)) missingCoverage.push(`${profile}/tier-${tier}`)
      for (const [field, minimum] of Object.entries(MINIMUM_RECALL)) {
        if (byProfile[profile][field].expected < MINIMUM_LABELS[field]) missingCoverage.push(`${profile}/${field}-minimum-${MINIMUM_LABELS[field]}`)
        const recall = byProfile[profile].recall[field]
        if (recall === null) missingCoverage.push(`${profile}/${field}-denominator`)
        else if (recall < minimum) failures.push(`${profile}/${field} recall below ${minimum}`)
      }
    }
    const offers = measured.filter(row => row.scene === 'offer')
    for (const motif of MOTIFS) if (!offers.some(row => row.labelCoverage?.motifs.includes(motif))) missingCoverage.push(`offer/motif-${motif}`)
    if (!offers.some(row => row.coverage.unknownName)) missingCoverage.push('offer/visible-unknown-name')
    if (!offers.some(row => row.coverage.collectedRow)) missingCoverage.push('offer/visible-known-collected-name')
    if (!offers.some(row => row.coverage.tooltip)) missingCoverage.push('offer/tooltip-obscured-reward-area')
  } else if (Object.values(summary.recall).some(recall => recall !== null && recall !== 1)) {
    failures.push('regression replay must match every labeled supported suggestion')
  }
  return { status: missingCoverage.length || failures.length ? 'FAIL' : 'PASS', measuredScenes: measured.length,
    summary, byProfile, missingCoverage, failures }
}
