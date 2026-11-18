// Temporary exception approved before live Fate encounters are available.
export const PRELAUNCH_DEADLINE = '2026-11-13T19:00:00Z'

// The owner approved deferred manual checks for this tested 0.10.2 package.
export const HOTFIX_UPDATE_RELEASE = Object.freeze({
  revision: '42058309d2e2eb9cf5d491f1d8c00a33b1011055',
  releaseId: '86d8c7186d48b0df69f41d4fac5a99ec6db3dc64f7406255ffd7d0c76b89e94d',
  stagingRunId: '44346808731',
})

export function assertPromotionPolicy(env, now = new Date()) {
  const mode = env.RELEASE_VALIDATION_MODE || 'native-holdout'
  if (mode === 'hotfix-20261116') {
    if (env.HOTFIX_UPDATE_ACKNOWLEDGED !== 'true') throw new Error('Hotfix promotion requires explicit acceptance of deferred in-game validation.')
    if (env.RECOGNITION_RUN_ID || env.MANUAL_TESTS_PASSED === 'true') throw new Error('Hotfix promotion does not attest native or full manual tests.')
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
  if (env.RELEASE_VALIDATION_MODE !== 'hotfix-20261116') return env.GITHUB_SHA
  assertPromotionPolicy(env)
  return HOTFIX_UPDATE_RELEASE.revision
}

export function assertHotfixUpdateRelease(env, manifest) {
  if (env.RELEASE_VALIDATION_MODE !== 'hotfix-20261116') return
  assertPromotionPolicy(env)
  if (manifest.revision !== HOTFIX_UPDATE_RELEASE.revision || manifest.releaseId !== HOTFIX_UPDATE_RELEASE.releaseId) {
    throw new Error('Hotfix exception is limited to the approved Fate hotfix package.')
  }
}
