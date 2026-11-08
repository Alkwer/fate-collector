import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

if (process.platform !== 'win32') throw new Error('Helper tests require Windows PowerShell 5.1.')
const suites = { capture: 'Test-FateCapture.ps1', upload: 'Test-CloudUpload.ps1', diagnostics: 'Test-Diagnostics.ps1' }
const suite = suites[process.argv[2]]
if (!suite) throw new Error('Choose capture, upload or diagnostics.')
const executable = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const env = { ...process.env }
// npm launched from PowerShell 7 inherits incompatible standard-module paths.
for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key]
env.PSModulePath = join(dirname(executable), 'Modules')
const result = spawnSync(executable, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('helpers/tests', suite), ...process.argv.slice(3)], { env, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exit(result.status ?? 1)
