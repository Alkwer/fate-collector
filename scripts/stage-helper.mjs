import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { zipSync } from 'fflate'
const files = ['FateCollector.ahk', 'Export-FateCapture.ps1', 'CaptureContext.Common.ps1', 'Consent.Common.ps1', 'CloudUpload.Common.ps1', 'Configure-CloudUpload.ps1', 'Upload-FateCaptures.ps1', 'README.md', 'LICENSE.one-more-map.txt']
const archive = {}
for (const name of files) {
  const data = await readFile(new URL(`../helpers/${name}`, import.meta.url))
  archive[`FateCollector/${name}`] = name === 'README.md'
    ? new TextEncoder().encode(data.toString('utf8').replace('../docs/windows-helper.md', 'WINDOWS-GUIDE.md'))
    : new Uint8Array(data)
}
archive['FateCollector/WINDOWS-GUIDE.md'] = new Uint8Array(await readFile(new URL('../docs/windows-helper.md', import.meta.url)))
archive['FateCollector/consent-policy.json'] = new Uint8Array(await readFile(new URL('../shared/consent-policy.json', import.meta.url)))
const directory = new URL('../public/downloads/', import.meta.url)
await mkdir(directory, { recursive: true })
await writeFile(new URL('fate-collector-helper.zip', directory), zipSync(archive, { level: 6 }))
console.log('Windows helper package staged.')
