import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import settings from '../deployment/environments.json'
// @ts-expect-error Standalone Node deployment scripts are plain JavaScript.
import { assertDeploymentContext, releaseFiles, releaseId, selectTarget, verifyRelease } from '../scripts/release-lib.mjs'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (dirname(directory) !== tmpdir() || !basename(directory).startsWith('fate-release-test-')) throw new Error('Unsafe cleanup path.')
    await rm(directory, { recursive: true, force: true })
  }
})
const revision = 'a'.repeat(40)
async function release() {
  const directory = await mkdtemp(join(tmpdir(), 'fate-release-test-')); directories.push(directory)
  for (const name of ['worker/index.js', 'assets/index.html', 'assets/downloads/fate-collector-helper.zip', 'runtime.json', 'migrations/0001.sql']) {
    await mkdir(dirname(join(directory, name)), { recursive: true })
    await writeFile(join(directory, name), name)
  }
  const files = await releaseFiles(directory)
  const manifest = { schemaVersion: 1, revision, releaseId: releaseId(revision, files), files }
  await writeFile(join(directory, 'release.json'), JSON.stringify(manifest))
  return { directory, manifest }
}
test('release identity covers the Worker, assets, helper and migrations', async () => {
  const { directory, manifest } = await release()
  expect(await verifyRelease(directory, revision)).toEqual(manifest)
  await writeFile(join(directory, 'migrations/0001.sql'), 'changed migration')
  await expect(verifyRelease(directory, revision)).rejects.toThrow('changed after validation')
})
test('an artifact from another commit or containing an extra file is rejected', async () => {
  const { directory } = await release()
  await expect(verifyRelease(directory, 'b'.repeat(40))).rejects.toThrow('selected commit')
  await writeFile(join(directory, 'assets/extra.js'), 'extra asset')
  await expect(verifyRelease(directory, revision)).rejects.toThrow('changed after validation')
})
test('an internally consistent package still needs its helper and migrations', async () => {
  const { directory, manifest } = await release()
  await rm(join(directory, 'assets/downloads/fate-collector-helper.zip'))
  const files = await releaseFiles(directory)
  await writeFile(join(directory, 'release.json'), JSON.stringify({ ...manifest, files, releaseId: releaseId(revision, files) }))
  await expect(verifyRelease(directory, revision)).rejects.toThrow('missing assets/downloads')
})
test('deployment requires an explicit environment with a different database', () => {
  expect(selectTarget(settings, 'staging').worker).toBe('app-staging')
  expect(selectTarget(settings, 'production').worker).toBe('app')
  expect(() => selectTarget(settings, undefined)).toThrow('explicitly')
  expect(() => selectTarget({ ...settings, staging: { ...settings.staging, databaseId: settings.production.databaseId } }, 'staging')).toThrow('isolated')
  expect(() => selectTarget({ ...settings, staging: { ...settings.staging, databaseId: '00000000-0000-0000-0000-000000000000' } }, 'staging')).toThrow('real database')
  expect(() => selectTarget({ ...settings, production: { ...settings.production, turnstileHostnames: ['localhost'] } }, 'production')).toThrow('deployment hostnames')
  expect(() => selectTarget({ ...settings, production: { ...settings.production, turnstileSitekey: '1x00000000000000000000AA' } }, 'production')).toThrow('real Turnstile')
})
test('production cannot be deployed locally, from a branch or with a different staging package', () => {
  const manifest = { revision, releaseId: 'b'.repeat(64) }
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Alkwer/fate-collector', GITHUB_SHA: revision, GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/promote.yml@refs/heads/main', STAGING_VERIFIED_RELEASE: manifest.releaseId, MANUAL_TESTS_PASSED: 'true', RECOGNITION_RUN_ID: '123' }
  expect(() => assertDeploymentContext('production', env, manifest)).not.toThrow()
  expect(() => assertDeploymentContext('production', {}, manifest)).toThrow('GitHub Actions')
  expect(() => assertDeploymentContext('production', { ...env, STAGING_VERIFIED_RELEASE: 'wrong' }, manifest)).toThrow('verified staging')
  expect(() => assertDeploymentContext('production', { ...env, GITHUB_SHA: 'c'.repeat(40) }, manifest)).toThrow('this commit')
  expect(() => assertDeploymentContext('production', { ...env, GITHUB_REF: 'refs/heads/feature', GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/promote.yml@refs/heads/feature' }, manifest)).toThrow('main')
  expect(() => assertDeploymentContext('production', { ...env, GITHUB_WORKFLOW_REF: 'Alkwer/fate-collector/.github/workflows/deploy.yml@refs/heads/main' }, manifest)).toThrow('designated')
})
