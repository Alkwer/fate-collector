const paths = {
  mark: 'm12 3 8 9-8 9-8-9 8-9Zm-8 9h16M12 3v18',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15',
  archive: 'M4 8h16v13H4V8ZM3 3h18v5H3V3Zm6 9h6',
  tools: 'M8 4H4v16h16v-4M10 14l10-10m-5 0h5v5M8 10v6h6',
} as const

export function AppIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
