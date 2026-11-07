import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID
if (!databaseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId) || /^0{8}-/.test(databaseId)) {
  console.error('Set CLOUDFLARE_D1_DATABASE_ID to the real production D1 database UUID. No deployment was attempted. See docs/deployment.md.')
  process.exit(1)
}
const config = JSON.parse((await readFile('wrangler.jsonc', 'utf8')).replace(/^\s*\/\/.*$/gm, ''))
config.main = resolve(config.main)
config.assets.directory = resolve(config.assets.directory)
config.d1_databases[0].database_id = databaseId
config.d1_databases[0].migrations_dir = resolve(config.d1_databases[0].migrations_dir)
await mkdir('.wrangler', { recursive: true })
const configPath = resolve('.wrangler/deploy.json')
await writeFile(configPath, JSON.stringify(config, null, 2))
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
for (const args of [
  ['d1', 'migrations', 'apply', 'fate-collector', '--remote', '--config', configPath],
  ['deploy', '--config', configPath],
]) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { stdio: 'inherit', env: process.env })
  if (result.error || result.status !== 0) process.exit(result.status || 1)
}
