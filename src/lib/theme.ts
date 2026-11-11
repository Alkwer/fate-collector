import { useEffect, useState } from 'react'

export type Theme = 'mineral' | 'trail'
const themeKey = 'fate-collector.theme'

function readTheme(): Theme {
  try { return localStorage.getItem(themeKey) === 'trail' ? 'trail' : 'mineral' }
  catch { return 'mineral' }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'trail' ? '#edf1eb' : '#0e1b22')
}

// Apply before React paints, including when the saved preference is light.
export function initializeTheme() { applyTheme(readTheme()) }

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [error, setError] = useState('')
  useEffect(() => {
    applyTheme(theme)
    const sync = (event: StorageEvent) => {
      if (event.key === themeKey || event.key === null) setTheme(readTheme())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [theme])
  function changeTheme(next: Theme) {
    setTheme(next)
    try { localStorage.setItem(themeKey, next); setError('') }
    catch { setError('Theme changed for this visit. Your browser could not save the preference.') }
  }
  return { theme, changeTheme, error }
}
