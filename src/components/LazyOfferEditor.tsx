import { lazy, Suspense, type ComponentProps } from 'react'

const Editor = lazy(() => import('./OfferEditor').then(module => ({ default: module.OfferEditor })))

export function LazyOfferEditor(props: ComponentProps<typeof Editor>) {
  return <Suspense fallback={<p role="status">Loading editor…</p>}><Editor {...props} /></Suspense>
}
