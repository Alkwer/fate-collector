import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { releaseFiles, releaseId, verifyRelease } from './release-lib.mjs'

const directory = resolve('.release')
if (process.argv[2] === 'verify') {
  const manifest = await verifyRelease(directory, process.env.GITHUB_SHA)
  console.log(`Verified release ${manifest.releaseId} for ${manifest.revision}.`)
} else if (process.argv[2] === 'pack') {
  // Refuse an existing package instead of mixing builds or deleting it.
  await mkdir(directory)
  const revision = process.env.GITHUB_SHA || spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A full source commit SHA is required.')
  const config = JSON.parse((await readFile('wrangler.jsonc', 'utf8')).replace(/^\s*\/\/.*$/gm, ''))
  const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--outdir', '.release/worker'], { stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error('Worker packaging failed.')
  await cp('dist', resolve(directory, 'assets'), { recursive: true })
  await cp('migrations', resolve(directory, 'migrations'), { recursive: true })
  const runtime = { compatibility_date: config.compatibility_date, assets: { ...config.assets, directory: './assets' }, observability: config.observability }
  if (config.compatibility_flags) runtime.compatibility_flags = config.compatibility_flags
  if (config.triggers) runtime.triggers = config.triggers
  if (config.ratelimits) runtime.ratelimits = config.ratelimits
  await writeFile(resolve(directory, 'runtime.json'), JSON.stringify(runtime, null, 2) + '\n')
  const files = await releaseFiles(directory)
  await writeFile(resolve(directory, 'release.json'), JSON.stringify({ schemaVersion: 1, revision, releaseId: releaseId(revision, files), files }, null, 2) + '\n')
  const manifest = await verifyRelease(directory, revision)
  console.log(`Packaged release ${manifest.releaseId} for ${revision}.`)
} else throw new Error('Usage: node scripts/release.mjs pack|verify')
