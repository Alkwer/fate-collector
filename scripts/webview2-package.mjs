import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

export const webView2Version = '1.0.3537.50'
const hash = '5ea526bbd728adda0da4d31219267e96460494a427e4894c4e09d9f320f4b9aa'
const packageUrl = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${webView2Version}/microsoft.web.webview2.${webView2Version}.nupkg`
const cacheDirectory = new URL('../.qa/webview2/', import.meta.url)
const cachePath = new URL('sdk.zip', cacheDirectory)
const files = {
  'lib/net462/Microsoft.Web.WebView2.Core.dll': 'Microsoft.Web.WebView2.Core.dll',
  'lib/net462/Microsoft.Web.WebView2.WinForms.dll': 'Microsoft.Web.WebView2.WinForms.dll',
  'build/native/x64/WebView2Loader.dll': 'x64/WebView2Loader.dll',
  'build/native/x86/WebView2Loader.dll': 'x86/WebView2Loader.dll',
  'LICENSE.txt': 'LICENSE.txt',
  'NOTICE.txt': 'NOTICE.txt',
}

export async function loadWebView2() {
  let bytes
  let downloaded = false
  try {
    bytes = await readFile(cachePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    let response
    try {
      response = await fetch(packageUrl, { signal: AbortSignal.timeout(30_000) })
    } catch (cause) {
      throw new Error(`Could not download WebView2 SDK ${webView2Version} from NuGet. Build with network access or put the pinned package in .qa/webview2/sdk.zip.`, { cause })
    }
    if (!response.ok) throw new Error(`WebView2 SDK download returned HTTP ${response.status}.`)
    bytes = new Uint8Array(await response.arrayBuffer())
    downloaded = true
  }
  if (createHash('sha256').update(bytes).digest('hex') !== hash) {
    throw new Error(`WebView2 SDK ${webView2Version} failed SHA-256 verification. Remove the invalid .qa/webview2/sdk.zip cache and rebuild.`)
  }
  const extracted = unzipSync(bytes, { filter: ({ name }) => Object.hasOwn(files, name) })
  const sdk = {}
  for (const [source, destination] of Object.entries(files)) {
    if (!extracted[source]?.length) throw new Error(`WebView2 SDK is missing ${source}.`)
    sdk[destination] = extracted[source]
  }
  if (downloaded) {
    await mkdir(cacheDirectory, { recursive: true })
    const temporary = new URL(`sdk-${randomUUID()}.part`, cacheDirectory)
    try {
      await writeFile(temporary, bytes)
      await rename(temporary, cachePath)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  return sdk
}
