import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const hash = value => createHash('sha256').update(value).digest('hex')
export async function releaseFiles(directory, prefix = '') {
  const files = {}
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (!prefix && name === 'release.json') continue
    if (entry.isSymbolicLink()) throw new Error('Release packages cannot contain symbolic links.')
    if (entry.isDirectory()) Object.assign(files, await releaseFiles(directory, name))
    else if (entry.isFile()) files[name] = hash(await readFile(join(directory, name)))
    else throw new Error(`Unsupported release entry: ${name}`)
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}
export function releaseId(revision, files) {
  return hash(JSON.stringify({ revision, files }))
}
export async function verifyRelease(directory, expectedRevision) {
  const manifest = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.revision) || !/^[a-f0-9]{64}$/.test(manifest.releaseId)) throw new Error('Invalid release manifest.')
  if (expectedRevision && manifest.revision !== expectedRevision) throw new Error('Release does not match the selected commit.')
  const files = await releaseFiles(directory)
  if (JSON.stringify(files) !== JSON.stringify(manifest.files) || releaseId(manifest.revision, files) !== manifest.releaseId) throw new Error('Release package changed after validation.')
  for (const name of ['worker/index.js', 'assets/index.html', 'assets/downloads/fate-collector-helper.zip', 'runtime.json']) {
    if (!files[name]) throw new Error(`Release is missing ${name}.`)
  }
  if (!Object.keys(files).some(name => /^migrations\/[^/]+\.sql$/.test(name))) throw new Error('Release has no database migrations.')
  return manifest
}
export function selectTarget(settings, environment) {
  if (!['staging', 'production'].includes(environment)) throw new Error('Choose staging or production explicitly.')
  const { staging, production } = settings
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  if (!/^[a-f0-9]{32}$/.test(settings.accountId)) throw new Error('Invalid Cloudflare account.')
  for (const target of [staging, production]) {
    if (!target || !uuid.test(target.databaseId) || /^00000000-/.test(target.databaseId)) throw new Error('A real database ID is required.')
    const url = new URL(target.url)
    if (url.origin !== target.url || url.protocol !== 'https:' || !url.hostname.startsWith(`${target.worker}.`)) throw new Error('Invalid deployment origin.')
  }
  if (staging.worker !== 'app-staging' || production.worker !== 'app' || staging.databaseId === production.databaseId || staging.databaseName === production.databaseName || staging.url === production.url) throw new Error('Staging must be isolated from production.')
  return settings[environment]
}
export function assertDeploymentContext(environment, env, manifest) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'Alkwer/fate-collector' || manifest.revision !== env.GITHUB_SHA) throw new Error('Remote deployment requires the validated GitHub Actions release workflow for this commit.')
  const workflow = environment === 'staging' ? 'deploy.yml' : 'promote.yml'
  const expected = `${env.GITHUB_REPOSITORY}/.github/workflows/${workflow}@${env.GITHUB_REF}`
  if (env.GITHUB_WORKFLOW_REF !== expected) throw new Error('Use the designated deployment workflow.')
  if (environment === 'production' && (env.GITHUB_REF !== 'refs/heads/main' || env.STAGING_VERIFIED_RELEASE !== manifest.releaseId)) throw new Error('Production requires a verified staging release on main.')
}
export async function verifyLiveRelease(target, environment, manifest) {
  const response = await fetch(`${target.url}/api/status`, { redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store' })
  if (!response.ok) throw new Error(`Release status returned HTTP ${response.status}.`)
  const status = await response.json()
  if (status.environment !== environment || status.revision !== manifest.revision || status.releaseId !== manifest.releaseId || status.ingestionEnabled !== true || status.captureIngestionEnabled !== true) throw new Error(`The live ${environment} does not match the tested release or its upload keys are missing.`)
}
