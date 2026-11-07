import { resolve } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
const common = ['--persist-to', '.wrangler/e2e-state']
const migration = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'fate-collector', '--local', ...common], { stdio: 'inherit' })
if (migration.status !== 0) process.exit(migration.status || 1)
const child = spawn(process.execPath, [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', '8790', '--var', 'COLLECTOR_INGEST_KEY:e2e-local-only', ...common], { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => process.exit(code || 0))
