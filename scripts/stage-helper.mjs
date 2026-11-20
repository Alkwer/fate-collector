import { randomUUID } from 'node:crypto'
import { readFile, readdir, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { loadWebView2, webView2Version } from './webview2-package.mjs'

const local = process.argv[2] === '--local'
if (process.argv.length !== (local ? 3 : 2)) throw new Error('Usage: node scripts/stage-helper.mjs [--local]')
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const helper = fileURLToPath(new URL('../helpers/', import.meta.url))
const fileName = 'fate-collector-helper.zip'

async function readDesktopBuild(relative = '') {
  const entries = await readdir(join(dist, relative), { withFileTypes: true })
  const assets = {}
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    if (name === 'downloads' || entry.name === '_headers' || entry.name.endsWith('.map')) continue
    if (entry.isDirectory()) Object.assign(assets, await readDesktopBuild(name))
    else if (entry.isFile()) assets[name] = await readFile(join(dist, name))
    else throw new Error(`Unexpected desktop build entry ${name}.`)
  }
  return assets
}

function verifyArchive(bytes, desktop, sdk) {
  const limit = 25 * 1024 * 1024
  if (bytes.length > limit) throw new Error(`Windows helper ZIP exceeds the 25 MiB asset limit (${bytes.length} bytes).`)
  const packed = unzipSync(bytes)
  const index = packed['FateCollector/desktop/index.html']
  if (!index?.length) throw new Error('The Windows helper is missing the desktop index.')
  const references = [...Buffer.from(index).toString('utf8').matchAll(/<(link|script)\b[^>]*\b(?:href|src)=(?:"([^"]+)"|'([^']+)')/g)]
  if (!references.some(([_, tag]) => tag === 'script')) throw new Error('The desktop index is missing its entry script.')
  for (const [, , doubleQuoted, singleQuoted] of references) {
    const source = doubleQuoted ?? singleQuoted
    const url = new URL(source, 'https://fate.local')
    if (url.origin !== 'https://fate.local' || !packed[`FateCollector/desktop${decodeURIComponent(url.pathname)}`]?.length) {
      throw new Error(`The Windows helper desktop index references a missing local asset: ${source}.`)
    }
  }
  for (const [folder, assets] of Object.entries({ desktop, webview2: sdk })) {
    const prefix = `FateCollector/${folder}/`
    const packedNames = Object.keys(packed).filter(name => name.startsWith(prefix))
    if (packedNames.length !== Object.keys(assets).length) throw new Error(`Unexpected files in the Windows helper ${folder} package.`)
    for (const [name, expected] of Object.entries(assets)) {
      const data = packed[prefix + name]
      if (!data || !Buffer.from(data).equals(Buffer.from(expected))) throw new Error(`Packaging changed or omitted ${folder}/${name}.`)
    }
  }
  for (const folder of ['assets', 'fonts', 'game-art']) {
    if (!Object.keys(desktop).some(name => name.startsWith(`${folder}/`))) throw new Error(`The desktop build is missing ${folder}/.`)
  }
}

async function writeAtomically(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}-${randomUUID()}.part`
  try {
    await writeFile(temporary, data)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

const files = ['FateCollector.ahk', 'Calibration.ahk', 'CaptureProcess.ahk', 'Export-FateCapture.ps1', 'CaptureImage.cs', 'WindowCapture.Common.ps1', 'OcrImage.cs', 'Ocr.Common.ps1', 'CaptureContext.Common.ps1', 'AreaContext.Common.ps1', 'Consent.Common.ps1', 'Diagnostics.Common.ps1', 'Report-Problem.ps1', 'Report-Symbol.ps1', 'SymbolReport.Common.ps1', 'SymbolReport.cs', 'CloudUpload.Common.ps1', 'Configure-CloudUpload.ps1', 'Upload-FateCaptures.ps1', 'README.md', 'LICENSE.third-party.txt']
const release = JSON.parse(await readFile(new URL('../shared/helper-release.json', import.meta.url), 'utf8'))
files.push('Overlay.ahk', 'Show-FateOverlay.ps1', 'FateOverlay.cs', 'overlay-icons.json', 'OcrCardText.Common.ps1')
files.push('AutoCapture.ahk', 'AutoCapture.Common.ps1', 'Watch-FatePanel.ps1')
files.push('Desktop.ahk', 'Start-FateDesktop.ps1', 'FateDesktop.cs')
const producerVersions = {
  'AutoCapture.ahk': /-HelperVersion ([0-9.]+)/,
  'FateDesktop.cs': /helperVersion\s*=\s*"([^"]+)"/i,
  'Export-FateCapture.ps1': /helperVersion = '([^']+)'/,
  'SymbolReport.Common.ps1': /helperVersion = '([^']+)'/,
}
const archive = {}
for (const name of files) {
  const data = await readFile(new URL(`../helpers/${name}`, import.meta.url))
  const versionPattern = producerVersions[name]
  if (versionPattern && data.toString('utf8').match(versionPattern)?.[1] !== release.version) {
    throw new Error(`Helper release version does not match ${name}.`)
  }
  archive[`FateCollector/${name}`] = name === 'README.md'
    ? new TextEncoder().encode(data.toString('utf8')
      .replace('../docs/windows-helper.md', 'WINDOWS-GUIDE.md')
      .replace('../THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'))
    : new Uint8Array(data)
}
archive['FateCollector/WINDOWS-GUIDE.md'] = new TextEncoder().encode((await readFile(new URL('../docs/windows-helper.md', import.meta.url), 'utf8')).replace('(diagnostics.md)', '(DIAGNOSTICS-GUIDE.md)').replace('(area-context.md)', '(AREA-CONTEXT.md)').replace('(overlay.md)', '(OVERLAY-GUIDE.md)'))
archive['FateCollector/AREA-CONTEXT.md'] = new Uint8Array(await readFile(new URL('../docs/area-context.md', import.meta.url)))
archive['FateCollector/DIAGNOSTICS-GUIDE.md'] = new Uint8Array(await readFile(new URL('../docs/diagnostics.md', import.meta.url)))
archive['FateCollector/OVERLAY-GUIDE.md'] = new Uint8Array(await readFile(new URL('../docs/overlay.md', import.meta.url)))
archive['FateCollector/consent-policy.json'] = new Uint8Array(await readFile(new URL('../shared/consent-policy.json', import.meta.url)))
archive['FateCollector/diagnostics-policy.json'] = new Uint8Array(await readFile(new URL('../shared/diagnostics-policy.json', import.meta.url)))
archive['FateCollector/fate-names.json'] = new Uint8Array(await readFile(new URL('../shared/fate-names.json', import.meta.url)))
archive['FateCollector/screenshot-catalog.json'] = new Uint8Array(await readFile(new URL('../shared/screenshot-catalog.json', import.meta.url)))
archive['FateCollector/LICENSE'] = new Uint8Array(await readFile(new URL('../LICENSE', import.meta.url)))
archive['FateCollector/CHANGELOG.md'] = new Uint8Array(await readFile(new URL('../CHANGELOG.md', import.meta.url)))
archive['FateCollector/THIRD_PARTY_NOTICES.md'] = new TextEncoder().encode((await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'))
  .replaceAll('(helpers/LICENSE.third-party.txt)', '(LICENSE.third-party.txt)')
  .replaceAll('(prototypes/vision/fixtures/dataset.json)', '(https://github.com/Alkwer/fate-collector/blob/main/prototypes/vision/fixtures/dataset.json)')
  .replaceAll('(prototypes/vision/README.md)', '(https://github.com/Alkwer/fate-collector/blob/main/prototypes/vision/README.md)')
  .replaceAll('(tests/fixtures/README.md)', '(https://github.com/Alkwer/fate-collector/blob/main/tests/fixtures/README.md)'))

const [desktop, sdk] = await Promise.all([readDesktopBuild(), loadWebView2()])
for (const [folder, assets] of Object.entries({ desktop, webview2: sdk })) {
  for (const [name, data] of Object.entries(assets)) archive[`FateCollector/${folder}/${name}`] = data
}
const bytes = zipSync(archive, { level: 6 })
verifyArchive(bytes, desktop, sdk)
await writeAtomically(join(dist, 'downloads', fileName), bytes)
await writeAtomically(fileURLToPath(new URL(`../public/downloads/${fileName}`, import.meta.url)), bytes)
if (local) {
  for (const [folder, assets] of Object.entries({ desktop, webview2: sdk })) {
    for (const [name, data] of Object.entries(assets)) await writeAtomically(join(helper, folder, name), data)
  }
}
console.log(`Windows helper ${release.version} staged (${bytes.length} bytes, WebView2 SDK ${webView2Version}).`)
