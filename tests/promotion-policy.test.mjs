import { afterEach, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { assertHotfixUpdateRelease, assertPromotionPolicy, HOTFIX_UPDATE_RELEASE, PRELAUNCH_DEADLINE, promotionRevision } from '../scripts/promotion-policy.mjs'
import { assertDeploymentContext } from '../scripts/release-lib.mjs'

afterEach(() => vi.useRealTimers())
const before = new Date('2026-11-13T18:59:59.999Z')
const prelaunch = { RELEASE_VALIDATION_MODE: 'prelaunch', PRELAUNCH_ACKNOWLEDGED: 'true', MANUAL_TESTS_PASSED: 'false' }
const hotfix = { RELEASE_VALIDATION_MODE: 'hotfix-20261116', HOTFIX_UPDATE_ACKNOWLEDGED: 'true', MANUAL_TESTS_PASSED: 'false' }

test('hotfix deferral requires explicit acceptance and never attests unperformed native checks', () => {
  expect(assertPromotionPolicy(hotfix)).toBe('hotfix-20261116')
  expect(promotionRevision({ ...hotfix, GITHUB_SHA: 'a'.repeat(40) })).toBe(HOTFIX_UPDATE_RELEASE.revision)
  expect(promotionRevision({ GITHUB_SHA: 'a'.repeat(40) })).toBe('a'.repeat(40))
  for (const patch of [{ HOTFIX_UPDATE_ACKNOWLEDGED: 'false' }, { MANUAL_TESTS_PASSED: 'true' }, { RECOGNITION_RUN_ID: '123' }]) {
    expect(() => assertPromotionPolicy({ ...hotfix, ...patch })).toThrow()
  }
})

test('superseded catalog, Guide, overlay, standalone advisor and dependency exceptions cannot promote prior packages', () => {
  expect(() => assertHotfixUpdateRelease(hotfix, { revision: '85b4b0e784c2e765398f68ca209298018a1352e7', releaseId: '447f7e3cf9dfc6886f2e436392d75b6fcd538652eecb67496ba412ce924c2392' })).toThrow('approved Fate hotfix package')
  for (const mode of ['catalog-20261114', 'catalog-20261115']) {
    expect(() => assertPromotionPolicy({ ...hotfix, RELEASE_VALIDATION_MODE: mode })).toThrow('Unknown')
  }
  expect(() => assertHotfixUpdateRelease(hotfix, { revision: '33ab6cf796958c7b08c26933e69a2471f802c278', releaseId: 'd400c5a9481d5a07a9cb6ac71e15b9a331822e3fbed2a540233c7bad4f95f92e' })).toThrow('approved Fate hotfix package')
  expect(() => assertHotfixUpdateRelease(hotfix, { revision: '28d992caeb526a531db9fd487ad917109dd94a08', releaseId: '4819e0064e2f5c07f392bd6c488065f2a59328e58c3771250fcbc86b77dedaef' })).toThrow('approved Fate hotfix package')
  expect(() => assertHotfixUpdateRelease(hotfix, { revision: '4074fd151722cd065cdb636e985e58705f3c48af', releaseId: '4bd7396e1a074dbae19aa3969fdd2f6bf7b630905482827b84ac2dd3bd42c6a5' })).toThrow('approved Fate hotfix package')
  expect(() => assertHotfixUpdateRelease(hotfix, { revision: 'e4dc1756f745807d70dff4f836a05707d03822db', releaseId: 'b7b83dbc557839a07067adba8fb6bcf42f26e0979a2a61f3765b1c87972a3a80' })).toThrow('approved Fate hotfix package')
  expect(() => assertHotfixUpdateRelease(hotfix, { revision: 'd8a791e40d917865d53e8a074cce59b61e158d87', releaseId: 'b100b4c8dda595540ddfcde17b08d6b7f50e7b37291304175f9ac0934439832f' })).toThrow('approved Fate hotfix package')
  expect(() => assertHotfixUpdateRelease(hotfix, { revision: 'f6001e50cbf579577f69df735fb1e210f713601c', releaseId: '9757a0c80a2bd0c963258acca508df5f370f0504fb4b587087ab586b7bb09835' })).toThrow('approved Fate hotfix package')
})

test('hotfix exception pins both package and source while keeping production workflow guards', () => {
  const manifest = { ...HOTFIX_UPDATE_RELEASE }
  const env = { ...hotfix, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Alkwer/fate-collector', GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/promote.yml@refs/heads/main', STAGING_VERIFIED_RELEASE: manifest.releaseId }
  expect(() => assertDeploymentContext('production', env, manifest)).not.toThrow()
  for (const patch of [{ revision: 'a'.repeat(40) }, { releaseId: 'b'.repeat(64) }]) {
    expect(() => assertHotfixUpdateRelease(env, { ...manifest, ...patch })).toThrow('approved Fate hotfix package')
    expect(() => assertDeploymentContext('production', { ...env, STAGING_VERIFIED_RELEASE: patch.releaseId || manifest.releaseId }, { ...manifest, ...patch })).toThrow()
  }
  for (const patch of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'other/repository' }, { GITHUB_REF: 'refs/heads/feature' }, { STAGING_VERIFIED_RELEASE: 'wrong' }, { GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/deploy.yml@refs/heads/main' }]) {
    expect(() => assertDeploymentContext('production', { ...env, ...patch }, manifest)).toThrow()
  }
  expect(() => assertDeploymentContext('staging', { ...env, GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/deploy.yml@refs/heads/main' }, manifest)).toThrow('validated GitHub Actions')
})

test('default native mode requires both manual confirmation and a report run even before launch', () => {
  expect(() => assertPromotionPolicy({}, before)).toThrow('manual staging tests')
  expect(() => assertPromotionPolicy({ MANUAL_TESTS_PASSED: 'true' }, before)).toThrow('report run')
  expect(assertPromotionPolicy({ MANUAL_TESTS_PASSED: 'true', RECOGNITION_RUN_ID: '123' }, before)).toBe('native-holdout')
})

test('prelaunch permits explicit deferral without pretending manual tests or recognition passed', () => {
  expect(assertPromotionPolicy(prelaunch, before)).toBe('prelaunch')
  expect(() => assertPromotionPolicy({ ...prelaunch, PRELAUNCH_ACKNOWLEDGED: 'false' }, before)).toThrow('explicit acceptance')
  expect(() => assertPromotionPolicy({ ...prelaunch, RECOGNITION_RUN_ID: '123' }, before)).toThrow('does not attest')
  expect(() => assertPromotionPolicy({ ...prelaunch, RELEASE_VALIDATION_MODE: 'skip' }, before)).toThrow('Unknown')
})

test('prelaunch expires at the boundary and invalid clocks fail closed', () => {
  expect(PRELAUNCH_DEADLINE).toBe('2026-11-13T19:00:00Z')
  expect(assertPromotionPolicy(prelaunch, new Date('2026-11-13T19:59:59+01:00'))).toBe('prelaunch')
  expect(() => assertPromotionPolicy(prelaunch, new Date('2026-11-13T20:00:00+01:00'))).toThrow('expired')
  for (const now of [new Date(PRELAUNCH_DEADLINE), new Date('2026-11-14T00:00:00Z'), new Date('invalid')]) {
    expect(() => assertPromotionPolicy(prelaunch, now)).toThrow('expired')
  }
  expect(assertPromotionPolicy({ MANUAL_TESTS_PASSED: 'true', RECOGNITION_RUN_ID: '123' }, new Date(PRELAUNCH_DEADLINE))).toBe('native-holdout')
})

test('production rechecks expiry after a job delay and keeps main, workflow and package guards', () => {
  vi.useFakeTimers()
  vi.setSystemTime(before)
  const manifest = { revision: 'a'.repeat(40), releaseId: 'b'.repeat(64) }
  const env = { ...prelaunch, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Alkwer/fate-collector', GITHUB_SHA: manifest.revision, GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/promote.yml@refs/heads/main', STAGING_VERIFIED_RELEASE: manifest.releaseId }
  expect(() => assertDeploymentContext('production', env, manifest)).not.toThrow()
  expect(() => assertDeploymentContext('production', { ...env, GITHUB_REF: 'refs/heads/feature', GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/promote.yml@refs/heads/feature' }, manifest)).toThrow('main')
  expect(() => assertDeploymentContext('production', { ...env, STAGING_VERIFIED_RELEASE: 'wrong' }, manifest)).toThrow('verified staging')
  expect(() => assertDeploymentContext('production', { ...env, GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/deploy.yml@refs/heads/main' }, manifest)).toThrow('designated')
  vi.setSystemTime(new Date(PRELAUNCH_DEADLINE))
  expect(() => assertDeploymentContext('production', env, manifest)).toThrow('expired')
  expect(() => assertDeploymentContext('staging', { ...env, GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/deploy.yml@refs/heads/main' }, manifest)).not.toThrow()
})

test('the actual workflow checks staging in prelaunch and keeps exact native report identity in standard mode', async () => {
  const workflow = await readFile(new URL('../.github/workflows/promote.yml', import.meta.url), 'utf8')
  const script = workflow.match(/          script: \|\r?\n([\s\S]*?)(?=^      -)/m)?.[1]
  expect(script).toBeTruthy()
  // A real Node process supports the dynamic import used by github-script;
  // Vitest's VM does not provide an import callback to AsyncFunction.
  const harness = `
    import assert from 'node:assert/strict';
    const NativeDate = Date;
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-11-12T23:59:59.999Z'])); } };
    const execute = new (Object.getPrototypeOf(async function () {}).constructor)('context', 'github', 'core', 'process', ${JSON.stringify(script)});
    const context = { ref: 'refs/heads/main', sha: 'a'.repeat(40), repo: { owner: 'Alkwer', repo: 'fate-collector' } };
    const staging = { path: '.github/workflows/deploy.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_sha: context.sha, head_branch: 'main', repository: { full_name: 'Alkwer/fate-collector' } };
    const recognition = { ...staging, path: '.github/workflows/recognition-validation.yml' };
    const calls = [], summaries = [];
    const github = { rest: { actions: { getWorkflowRun: async args => { calls.push(args); return { data: args.run_id === 11 ? staging : recognition }; } } } };
    const summary = { addHeading() { return this; }, addRaw(text) { summaries.push(text); return this; }, async write() {} };
    const env = ${JSON.stringify({ ...prelaunch, STAGING_RUN_ID: '11', GITHUB_WORKSPACE: new URL('..', import.meta.url).href.replace(/\/$/, '') })};
    await execute(context, github, { summary }, { env });
    assert.equal(calls.length, 1);
    assert.match(summaries[0], /deferred, not passed/);
    staging.head_sha = 'c'.repeat(40);
    await assert.rejects(execute(context, github, { summary }, { env }), /exact main commit/);
    staging.head_sha = context.sha;
    const nativeEnv = { ...env, RELEASE_VALIDATION_MODE: 'native-holdout', MANUAL_TESTS_PASSED: 'true', RECOGNITION_RUN_ID: '22' };
    await execute(context, github, { summary }, { env: nativeEnv });
    assert.deepEqual(calls.at(-1), { ...context.repo, run_id: 22 });
    recognition.head_sha = 'c'.repeat(40);
    await assert.rejects(execute(context, github, { summary }, { env: nativeEnv }), /designated successful recognition workflow/);
    recognition.head_sha = context.sha;
    recognition.path = '.github/workflows/deploy.yml';
    await assert.rejects(execute(context, github, { summary }, { env: nativeEnv }), /designated successful recognition workflow/);
    const hotfixRelease = ${JSON.stringify(HOTFIX_UPDATE_RELEASE)};
    const hotfixEnv = { ...env, ...${JSON.stringify(hotfix)}, STAGING_RUN_ID: hotfixRelease.stagingRunId };
    const hotfixGithub = { rest: { actions: { getWorkflowRun: async args => { assert.equal(args.run_id, Number(hotfixRelease.stagingRunId)); return { data: staging }; } } } };
    staging.head_sha = hotfixRelease.revision;
    await execute(context, hotfixGithub, { summary }, { env: hotfixEnv });
    assert.match(summaries.at(-1), /in-game validation is deferred, not passed/);
    await assert.rejects(execute(context, hotfixGithub, { summary }, { env: { ...hotfixEnv, STAGING_RUN_ID: '12' } }), /pinned Fate hotfix staging run/);
    for (const [key, value] of [['head_sha', context.sha], ['conclusion', 'failure'], ['head_branch', 'feature'], ['path', '.github/workflows/ci.yml']]) {
      const previous = staging[key]; staging[key] = value;
      await assert.rejects(execute(context, hotfixGithub, { summary }, { env: hotfixEnv }), /exact main commit/);
      staging[key] = previous;
    }
  `
  execFileSync(process.execPath, ['--input-type=module', '-e', harness], { stdio: 'pipe', windowsHide: true })
})
