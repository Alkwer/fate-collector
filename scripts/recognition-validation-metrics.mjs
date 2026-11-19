export const PROFILES = {
  '1080p-sdr-default': { clientSize: [1920, 1080], hdrActive: false, uiScale: 'default' },
  '1440p-sdr-alternate': { clientSize: [2560, 1440], hdrActive: false, uiScale: 'alternate' },
  '4k-hdr-default': { clientSize: [3840, 2160], hdrActive: true, uiScale: 'default' },
  'ultrawide-sdr-default': { clientSize: [3440, 1440], hdrActive: false, uiScale: 'default' },
}
export const SCENES = ['offer', 'invoke', 'negative']
export const MINIMUM_RECALL = { names: 0.95, tiers: 0.9, motifs: 0.9, rewards: 0.9 }
// A minimum smoke corpus, not a statistical confidence claim.
export const COVERAGE_POLICY_VERSION = 'native-holdout-v3'
export const REPORT_SCHEMA_VERSION = 3
export const MINIMUM_SCENES = { offer: 10, invoke: 3, negative: 5 }
export const MINIMUM_LABELS = { names: 30, tiers: 20, motifs: 20, rewards: 8 }
export const MOTIFS = ['blue-diamond', 'gold-stack', 'gold-grid', 'gold-ring', 'silver-cluster', 'orange-feathers', 'three-gems', 'gold-axe']
export const REWARD_VARIANT_PATTERN = new RegExp(`^(?:${MOTIFS.join('|')})/(?:regular|combo-(?:[1-9][0-9]?|100))$`)
const rewardVariant = ({ visualId, kind, threshold }) => `${visualId}/${kind === 'combo' ? `combo-${threshold}` : 'regular'}`

export function labelCoverage(cards) {
  const offered = cards.filter(namesExpected)
  return { names: [...new Set(offered.map(card => card.name))].sort(),
    tiers: [...new Set(offered.flatMap(card => card.tier === null ? [] : [card.tier]))].sort(),
    motifs: [...new Set(offered.flatMap(card => card.visualIds ?? []))].sort(),
    rewards: [...new Set(offered.flatMap(card => (card.rewards ?? []).filter(reward => reward.kind !== 'unknown').map(rewardVariant)))].sort() }
}

const counter = () => ({ expected: 0, correct: 0, omitted: 0, unexpected: 0, abstained: 0 })
const tally = () => ({
  names: counter(), tiers: counter(), motifs: counter(),
  rewards: { ...counter(), annotatedCards: 0, unannotatedCards: 0, abstentionExpected: 0, abstentionCorrect: 0 },
  wrongRows: 0, visibleUnknownNames: 0, unknownNameAbstentions: 0,
})
const namesExpected = card => card.group === 'offered' && card.name !== null
const makesClaim = reward => reward.identified || reward.kind !== 'unknown' || reward.threshold !== null
const sameReward = (expected, actual) => actual.identified && expected.visualId === actual.visualId
  && expected.label === actual.label && expected.kind === actual.kind && expected.threshold === actual.threshold
const atHeader = ([x, y, width, height], header) => {
  if (!header) return false
  const middleX = header.x + header.width / 2
  const middleY = header.y + header.height / 2
  return middleX >= x && middleX < x + width && middleY >= y && middleY < y + height
}

function measureRewards(expected, predicted, metrics, issues, detail) {
  if (expected === undefined) {
    metrics.unannotatedCards++
    return
  }
  metrics.annotatedCards++
  const remaining = (expected ?? []).filter(reward => reward.kind !== 'unknown')
  const abstentions = (expected ?? []).filter(reward => reward.kind === 'unknown')
  metrics.expected += remaining.length
  metrics.abstentionExpected += expected === null ? 1 : abstentions.length
  const unexpected = []
  for (const actual of predicted) {
    if (!makesClaim(actual)) {
      metrics.abstained++
      continue
    }
    const index = remaining.findIndex(reward => sameReward(reward, actual))
    if (index === -1) {
      unexpected.push(actual)
      issues.push({ ...detail, reason: 'unexpected-reward', actual, attributable: expected !== null })
    } else {
      remaining.splice(index, 1)
      metrics.correct++
    }
  }
  metrics.unexpected += unexpected.length
  if (expected === null) metrics.abstentionCorrect += Number(unexpected.length === 0)
  else {
    const unsafeMotifs = unexpected.map(reward => reward.visualId)
    for (const { visualId } of abstentions) {
      const index = unsafeMotifs.indexOf(visualId)
      if (index === -1) metrics.abstentionCorrect++
      else unsafeMotifs.splice(index, 1)
    }
  }
  if (remaining.length) issues.push({ ...detail, reason: 'omitted-rewards', expected: remaining })
}

export function measure(labels, rows) {
  const suggestions = rows.filter(row => row.name || row.tier !== null || row.rewards.length > 0)
  const metrics = tally()
  const issues = []
  const matched = new Map()
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
      metrics.motifs.unexpected += suggestion.rewards.length
      metrics.rewards.unexpected += suggestion.rewards.filter(makesClaim).length
      issues.push({ ...detail, reason, suggestedTier: suggestion.tier, suggestedMotifs: suggestion.rewards.map(reward => reward.visualId) })
      continue
    }
    matched.set(index, suggestion)
    metrics.names.correct++
    if (suggestion.tier === null) metrics.tiers.abstained++
    else if (suggestion.tier === label.tier) metrics.tiers.correct++
    else {
      metrics.tiers.unexpected++
      issues.push({ ...detail, reason: 'unexpected-tier', expected: label.tier, actual: suggestion.tier })
    }
    const remaining = [...(label.visualIds ?? [])]
    if (suggestion.rewards.length === 0) metrics.motifs.abstained++
    for (const { visualId } of suggestion.rewards) {
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
    measureRewards(label.rewards, matched.get(index)?.rewards ?? [], metrics.rewards, issues,
      { labelIndex: index, header: label.headerBox })
    if (!matched.has(index)) {
      metrics.names.abstained += Number(!suggestedHere)
      issues.push({ labelIndex: index, header: label.headerBox, reason: 'omitted-name', expected: label.name })
    }
  }
  for (const field of Object.keys(MINIMUM_RECALL)) metrics[field].omitted = metrics[field].expected - metrics[field].correct
  return { metrics, issues }
}

function aggregate(rows) {
  const totals = tally()
  for (const { metrics } of rows) {
    for (const field of Object.keys(MINIMUM_RECALL)) {
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
  const { rewards } = summary
  const rewardEvaluation = rewards.annotatedCards === 0 ? 'NOT_EVALUATED'
    : rewards.unannotatedCards ? 'PARTIAL' : 'MEASURED'
  const byProfile = {}
  const missingCoverage = []
  const failures = [...releaseProblems, ...rows.filter(row => row.outcome !== 'measured' || row.problems.length)
    .map(row => `incomplete or failed scene: ${row.sceneId}`)]
  if (!measured.length) failures.push('no measured scenes')
  for (const field of Object.keys(MINIMUM_RECALL)) {
    if (summary[field].unexpected) failures.push(`unexpected ${field}: ${summary[field].unexpected}`)
  }
  if (rewards.abstentionCorrect !== rewards.abstentionExpected) failures.push('unsafe semantic reward acceptance')
  if (mode === 'holdout') {
    if (rewards.unannotatedCards) missingCoverage.push('offer/complete-semantic-reward-annotations')
    for (const profile of Object.keys(PROFILES)) {
      const subset = measured.filter(row => row.profile === profile)
      byProfile[profile] = { measured: subset.length,
        byScene: Object.fromEntries(SCENES.map(scene => [scene, subset.filter(row => row.scene === scene).length])), ...aggregate(subset) }
      for (const scene of SCENES) {
        if (subset.filter(row => row.scene === scene).length < MINIMUM_SCENES[scene]) missingCoverage.push(`${profile}/${scene}`)
      }
      const coverage = Object.fromEntries(Object.keys(MINIMUM_RECALL).map(field => [field,
        [...new Set(subset.flatMap(row => row.labelCoverage?.[field] ?? []))].sort()]))
      byProfile[profile].labelCoverage = coverage
      if (coverage.names.length < 5) missingCoverage.push(`${profile}/five-distinct-names`)
      for (const tier of [2, 3]) if (!coverage.tiers.includes(tier)) missingCoverage.push(`${profile}/tier-${tier}`)
      for (const variant of ['regular', 'combo-2', 'combo-3']) {
        if (!coverage.rewards.some(reward => reward.endsWith(`/${variant}`))) missingCoverage.push(`${profile}/reward-${variant}`)
      }
      for (const [field, minimum] of Object.entries(MINIMUM_RECALL)) {
        if (byProfile[profile][field].expected < MINIMUM_LABELS[field]) missingCoverage.push(`${profile}/${field}-minimum-${MINIMUM_LABELS[field]}`)
        const recall = byProfile[profile].recall[field]
        if (recall === null) missingCoverage.push(`${profile}/${field}-denominator`)
        else if (recall < minimum) failures.push(`${profile}/${field} recall below ${minimum}`)
      }
    }
    const offers = measured.filter(row => row.scene === 'offer')
    const rewardVariants = new Set(offers.flatMap(row => row.labelCoverage?.rewards ?? []))
    if (!MOTIFS.some(motif => [...rewardVariants].filter(variant => variant.startsWith(`${motif}/`)).length > 1)) {
      missingCoverage.push('offer/same-motif-different-reward-frames')
    }
    if (rewards.abstentionExpected === 0) missingCoverage.push('offer/reward-abstention')
    for (const motif of MOTIFS) if (!offers.some(row => row.labelCoverage?.motifs.includes(motif))) missingCoverage.push(`offer/motif-${motif}`)
    if (!offers.some(row => row.coverage.unknownName)) missingCoverage.push('offer/visible-unknown-name')
    if (!offers.some(row => row.coverage.collectedRow)) missingCoverage.push('offer/visible-known-collected-name')
    if (!offers.some(row => row.coverage.tooltip)) missingCoverage.push('offer/tooltip-obscured-reward-area')
  } else if (Object.values(summary.recall).some(recall => recall !== null && recall !== 1)) {
    failures.push('regression replay must match every labeled supported suggestion')
  }
  return { status: missingCoverage.length || failures.length ? 'FAIL' : 'PASS', measuredScenes: measured.length, rewardEvaluation,
    summary, byProfile, missingCoverage, failures }
}
