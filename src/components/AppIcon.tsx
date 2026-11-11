const paths = {
  mark: 'm12 3 8 9-8 9-8-9 8-9Zm-8 9h16M12 3v18',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15',
  archive: 'M4 8h16v13H4V8ZM3 3h18v5H3V3Zm6 9h6',
  tools: 'M8 4H4v16h16v-4M10 14l10-10m-5 0h5v5M8 10v6h6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  coins: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 4 3 3-3 3-3-3 3-3Zm8 1a7 7 0 1 1-10 11',
  gem: 'm4 8 4-4h8l4 4-8 13L4 8Zm0 0h16M8 4l-1 4 5 13 5-13-1-4',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z',
  flask: 'M9 3h6m-5 0v6L5 17c-2 4 16 4 14 0l-5-8V3M7 14h10',
  reward: 'M4 9h16v11H4V9ZM3 6h18v3H3V6Zm9 0v14M12 6C3 6 5 0 9 3l3 3Zm0 0c9 0 7-6 3-3l-3 3Z',
  question: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  warning: 'm12 3 10 18H2L12 3Zm0 6v5m0 3h.01',
  cards: 'M7 5h13v16H7V5ZM4 17H2V2h13v1',
  capture: 'M8 5V3H3v5m13-3V3h5v5M3 16v5h5m8 0h5v-5M8 12h8m-4-4v8',
} as const

export function AppIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
