import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { assertDeploymentContext, selectTarget, verifyLiveRelease, verifyRelease } from './release-lib.mjs'

const environment = process.argv[2]
const dryRun = process.argv[3] === '--dry-run'
if (process.argv.length > (dryRun ? 4 : 3)) throw new Error('Usage: npm run deploy -- staging|production [--dry-run]')
const settings = JSON.parse(await readFile('deployment/environments.json', 'utf8'))
const target = selectTarget(settings, environment)
const manifest = await verifyRelease(resolve('.release'), process.env.GITHUB_SHA)
if (!dryRun) {
  assertDeploymentContext(environment, process.env, manifest)
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== settings.accountId) throw new Error('Cloudflare account does not match the release target.')
  if (environment === 'production') await verifyLiveRelease(settings.staging, 'staging', manifest)
}
const config = {
  ...JSON.parse(await readFile('.release/runtime.json', 'utf8')),
  name: target.worker, account_id: settings.accountId,
  main: resolve('.release/worker/index.js'), no_bundle: true,
  vars: { APP_ENV: environment, RELEASE_REVISION: manifest.revision, RELEASE_ID: manifest.releaseId },
  d1_databases: [{ binding: 'DB', database_name: target.databaseName, database_id: target.databaseId, migrations_dir: resolve('.release/migrations') }],
}
config.assets.directory = resolve('.release/assets')
if (environment === 'staging') config.assets.run_worker_first = true
await mkdir('.wrangler', { recursive: true })
const configPath = resolve(`.wrangler/deploy-${environment}.json`)
await writeFile(configPath, JSON.stringify(config, null, 2))
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
function run(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args, '--config', configPath], { stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`Wrangler ${args[0]} failed.`)
}
console.log(`Target: ${environment}, Worker ${target.worker}, database ${target.databaseName} (${target.databaseId}).`)
if (dryRun) run(['deploy', '--dry-run'])
else {
  let secretPath
  try {
    if (environment === 'staging') {
      const capture = process.env.COLLECTOR_CAPTURE_KEY
      const ingest = process.env.COLLECTOR_INGEST_KEY
      if (!capture || !ingest || capture === ingest || Math.min(capture.length, ingest.length) < 32) throw new Error('Two distinct staging upload secrets (at least 32 characters) are required.')
      secretPath = resolve('.wrangler/staging-secrets.json')
      await writeFile(secretPath, JSON.stringify({ COLLECTOR_CAPTURE_KEY: capture, COLLECTOR_INGEST_KEY: ingest }), { mode: 0o600 })
    }
    run(['d1', 'migrations', 'apply', target.databaseName, '--remote'])
    run(['deploy', '--tag', manifest.revision.slice(0, 12), ...(secretPath ? ['--secrets-file', secretPath] : [])])
    let failure
    for (let attempt = 0; attempt < 6; attempt++) {
      try { await verifyLiveRelease(target, environment, manifest); failure = undefined; break } catch (error) { failure = error }
      await new Promise(done => setTimeout(done, 3000))
    }
    if (failure) throw failure
    console.log(`Verified ${target.url} at release ${manifest.releaseId}.`)
  } finally {
    if (secretPath) await rm(secretPath, { force: true })
  }
}
