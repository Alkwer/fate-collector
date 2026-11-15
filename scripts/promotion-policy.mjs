// Temporary exception approved before live Fate encounters are available.
export const PRELAUNCH_DEADLINE = '2026-11-13T19:00:00Z'

// Owner-approved data update; this exception cannot promote any other package.
export const CATALOG_UPDATE_RELEASE = Object.freeze({
  revision: '33ab6cf796958c7b08c26933e69a2471f802c278',
  releaseId: 'd400c5a9481d5a07a9cb6ac71e15b9a331822e3fbed2a540233c7bad4f95f92e',
  stagingRunId: '43767408132',
})

export function assertPromotionPolicy(env, now = new Date()) {
  const mode = env.RELEASE_VALIDATION_MODE || 'native-holdout'
  if (mode === 'catalog-20261115') {
    if (env.CATALOG_UPDATE_ACKNOWLEDGED !== 'true') throw new Error('Catalog promotion requires explicit acceptance of deferred in-game validation.')
    if (env.RECOGNITION_RUN_ID || env.MANUAL_TESTS_PASSED === 'true') throw new Error('Catalog promotion does not attest native or full manual tests.')
    return mode
  }
  if (mode === 'prelaunch') {
    if (!Number.isFinite(now.getTime()) || now.getTime() >= Date.parse(PRELAUNCH_DEADLINE)) {
      throw new Error(`The prelaunch exception expired at ${PRELAUNCH_DEADLINE}; use native-holdout.`)
    }
    if (env.PRELAUNCH_ACKNOWLEDGED !== 'true') {
      throw new Error('Prelaunch promotion requires explicit acceptance of deferred native Fate and manual staging validation.')
    }
    if (env.RECOGNITION_RUN_ID) throw new Error('Prelaunch does not attest a recognition report; use native-holdout to verify one.')
    return mode
  }
  if (mode !== 'native-holdout') throw new Error('Unknown release validation mode.')
  if (env.MANUAL_TESTS_PASSED !== 'true') throw new Error('Native-holdout promotion requires confirmation of manual staging tests.')
  if (!/^[1-9][0-9]*$/.test(env.RECOGNITION_RUN_ID ?? '')) throw new Error('A native recognition report run is required.')
  return mode
}

export function promotionRevision(env) {
  if (env.RELEASE_VALIDATION_MODE !== 'catalog-20261115') return env.GITHUB_SHA
  assertPromotionPolicy(env)
  return CATALOG_UPDATE_RELEASE.revision
}

export function assertCatalogUpdateRelease(env, manifest) {
  if (env.RELEASE_VALIDATION_MODE !== 'catalog-20261115') return
  assertPromotionPolicy(env)
  if (manifest.revision !== CATALOG_UPDATE_RELEASE.revision || manifest.releaseId !== CATALOG_UPDATE_RELEASE.releaseId) {
    throw new Error('Catalog exception is limited to the approved screenshot catalog package.')
  }
}
