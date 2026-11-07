import { useEffect, useRef, useState } from 'react'
import { CaptureReader, directoryPicker, type CaptureDirectory, type CapturedEntry } from './capture-sync'
import { getCaptureFolder, setCaptureFolder } from './storage'

export function useCaptureSync(onSaved: (entry: CapturedEntry) => Promise<void>) {
  const supported = typeof directoryPicker() === 'function' && window.isSecureContext
  const [folder, setFolder] = useState<CaptureDirectory | null>(null)
  const [status, setStatus] = useState<'off' | 'connecting' | 'active' | 'permission' | 'error'>('off')
  const [problem, setProblem] = useState<string | null>(null)
  const [received, setReceived] = useState(0)
  const callback = useRef(onSaved)
  const actionVersion = useRef(0)
  useEffect(() => { callback.current = onSaved }, [onSaved])
  useEffect(() => {
    let cancelled = false
    const version = actionVersion.current
    if (supported) void getCaptureFolder().then(async handle => {
      if (!handle) return
      const directory = handle as CaptureDirectory
      const permission = await directory.queryPermission({ mode: 'read' })
      if (!cancelled && version === actionVersion.current) { setFolder(directory); setStatus(permission === 'granted' ? 'active' : 'permission') }
    }).catch(error => { if (!cancelled && version === actionVersion.current) { setProblem(String(error)); setStatus('error') } })
    return () => { cancelled = true }
  }, [supported])

  useEffect(() => {
    if (!folder || status !== 'active') return
    let stopped = false
    let working = false
    let timer: number | undefined
    const reader = new CaptureReader()
    const scan = async () => {
      if (stopped || working) return
      working = true
      window.clearTimeout(timer)
      try {
        const result = await reader.scan(folder, async entry => {
          if (stopped) return
          setReceived(count => count + 1)
          await callback.current(entry)
        }, () => stopped)
        if (!stopped) setProblem(result.invalidCount ? `${result.invalidCount} capture(s) could not be read. ${result.problem}` : null)
      } catch (error) {
        if (!stopped) {
          setProblem(error instanceof Error ? error.message : 'Capture folder is unavailable.')
          setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'permission' : 'error')
        }
      } finally {
        working = false
        if (!stopped) timer = window.setTimeout(() => void scan(), 2000)
      }
    }
    const wake = () => { if (!document.hidden) void scan() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    void scan()
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake) }
  }, [folder, status])

  async function connect() {
    const picker = directoryPicker()
    if (!picker) return
    const previous = status
    const version = ++actionVersion.current
    setStatus('connecting')
    try {
      const directory = await picker.call(window, { id: 'fate-collector-captures', mode: 'read' })
      if (version !== actionVersion.current) return
      await setCaptureFolder(directory)
      if (version !== actionVersion.current) return
      setFolder(directory); setProblem(null); setReceived(0); setStatus('active')
    } catch (error) {
      if (version !== actionVersion.current) return
      if (error instanceof DOMException && error.name === 'AbortError') setStatus(previous)
      else { setProblem(error instanceof Error ? error.message : 'Could not connect the folder.'); setStatus('error') }
    }
  }
  async function resume() {
    if (!folder) { await connect(); return }
    const version = ++actionVersion.current
    setStatus('connecting')
    try {
      const permission = await folder.requestPermission({ mode: 'read' })
      if (version !== actionVersion.current) return
      setProblem(permission === 'granted' ? null : 'Allow read access to resume automatic capture.')
      setStatus(permission === 'granted' ? 'active' : 'permission')
    } catch (error) { if (version === actionVersion.current) { setProblem(error instanceof Error ? error.message : 'Could not resume.'); setStatus('error') } }
  }
  async function disconnect() {
    const version = ++actionVersion.current
    setStatus('off'); setFolder(null); setProblem(null)
    try { await setCaptureFolder(null) } catch { if (version === actionVersion.current) { setProblem('Could not forget the folder. Revoke access in browser settings before reloading.'); setStatus('error') } }
  }
  return { supported, folderName: folder?.name, status, problem, received, connect, resume, disconnect }
}
