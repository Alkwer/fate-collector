import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { zipSync } from 'fflate'
const files = ['FateCollector.ahk', 'Calibration.ahk', 'CaptureProcess.ahk', 'Export-FateCapture.ps1', 'CaptureImage.cs', 'WindowCapture.Common.ps1', 'OcrImage.cs', 'Ocr.Common.ps1', 'CaptureContext.Common.ps1', 'AreaContext.Common.ps1', 'Consent.Common.ps1', 'Diagnostics.Common.ps1', 'Report-Problem.ps1', 'Report-Symbol.ps1', 'SymbolReport.Common.ps1', 'SymbolReport.cs', 'CloudUpload.Common.ps1', 'Configure-CloudUpload.ps1', 'Upload-FateCaptures.ps1', 'README.md', 'LICENSE.third-party.txt']
const release = JSON.parse(await readFile(new URL('../shared/helper-release.json', import.meta.url), 'utf8'))
for (const name of ['Export-FateCapture.ps1', 'SymbolReport.Common.ps1']) {
  const producer = await readFile(new URL(`../helpers/${name}`, import.meta.url), 'utf8')
  if (producer.match(/helperVersion = '([^']+)'/)?.[1] !== release.version) {
    throw new Error(`Helper release version does not match ${name}.`)
  }
}
const archive = {}
for (const name of files) {
  const data = await readFile(new URL(`../helpers/${name}`, import.meta.url))
  archive[`FateCollector/${name}`] = name === 'README.md'
    ? new TextEncoder().encode(data.toString('utf8')
      .replace('../docs/windows-helper.md', 'WINDOWS-GUIDE.md')
      .replace('../THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'))
    : new Uint8Array(data)
}
archive['FateCollector/WINDOWS-GUIDE.md'] = new TextEncoder().encode((await readFile(new URL('../docs/windows-helper.md', import.meta.url), 'utf8')).replace('(diagnostics.md)', '(DIAGNOSTICS-GUIDE.md)').replace('(area-context.md)', '(AREA-CONTEXT.md)'))
archive['FateCollector/AREA-CONTEXT.md'] = new Uint8Array(await readFile(new URL('../docs/area-context.md', import.meta.url)))
archive['FateCollector/DIAGNOSTICS-GUIDE.md'] = new Uint8Array(await readFile(new URL('../docs/diagnostics.md', import.meta.url)))
archive['FateCollector/consent-policy.json'] = new Uint8Array(await readFile(new URL('../shared/consent-policy.json', import.meta.url)))
archive['FateCollector/diagnostics-policy.json'] = new Uint8Array(await readFile(new URL('../shared/diagnostics-policy.json', import.meta.url)))
archive['FateCollector/fate-names.json'] = new Uint8Array(await readFile(new URL('../shared/fate-names.json', import.meta.url)))
archive['FateCollector/LICENSE'] = new Uint8Array(await readFile(new URL('../LICENSE', import.meta.url)))
archive['FateCollector/THIRD_PARTY_NOTICES.md'] = new TextEncoder().encode((await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'))
  .replaceAll('(helpers/LICENSE.third-party.txt)', '(LICENSE.third-party.txt)')
  .replaceAll('(prototypes/vision/fixtures/dataset.json)', '(https://github.com/Alkwer/fate-collector/blob/main/prototypes/vision/fixtures/dataset.json)')
  .replaceAll('(prototypes/vision/README.md)', '(https://github.com/Alkwer/fate-collector/blob/main/prototypes/vision/README.md)')
  .replaceAll('(tests/fixtures/README.md)', '(https://github.com/Alkwer/fate-collector/blob/main/tests/fixtures/README.md)'))
const directory = new URL('../public/downloads/', import.meta.url)
await mkdir(directory, { recursive: true })
await writeFile(new URL('fate-collector-helper.zip', directory), zipSync(archive, { level: 6 }))
console.log('Windows helper package staged.')
