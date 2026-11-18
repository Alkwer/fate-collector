// Temporary exception approved before live Fate encounters are available.
export const PRELAUNCH_DEADLINE = '2026-11-13T19:00:00Z'

// The owner approved deferred manual checks for this tested 0.10.1 package.
export const HOTFIX_UPDATE_RELEASE = Object.freeze({
  revision: '151b9081b12e507cb47a570d9047ae8419bd5514',
  releaseId: '6839e181340632950bc1b549678d1f1eb5abe56fa28caad3e96ec760e9e7edb5',
  stagingRunId: '44318878022',
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
