import { afterEach, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { assertPromotionPolicy, PRELAUNCH_DEADLINE } from '../scripts/promotion-policy.mjs'
import { assertDeploymentContext } from '../scripts/release-lib.mjs'

afterEach(() => vi.useRealTimers())
const before = new Date('2026-11-12T23:59:59.999Z')
const prelaunch = { RELEASE_VALIDATION_MODE: 'prelaunch', PRELAUNCH_ACKNOWLEDGED: 'true', MANUAL_TESTS_PASSED: 'false' }

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
  `
  execFileSync(process.execPath, ['--input-type=module', '-e', harness], { stdio: 'pipe', windowsHide: true })
})
