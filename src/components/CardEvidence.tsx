import { useId, useRef, useState } from 'react'
import type { Evidence } from '../../shared/schema'

export function CardEvidence({ evidence, cardId }: { evidence: Evidence; cardId: string }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null)
  const region = evidence.cardRegions?.find(item => item.cardId === cardId)
  const [size, setSize] = useState({ width: 0, height: 0 }), [full, setFull] = useState(false)
  return <aside className="card-evidence">
    <h3>Compare with your capture</h3>
    <button className="evidence-button" aria-label="Enlarge review screenshot" onClick={() => { setFull(false); dialog.current?.showModal() }}><img src={evidence.imageDataUrl} alt="Reference capture for the selected Fate" onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />{region && <span className="evidence-region" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}</button>
    <p className="hint">Check the selected card's tier and entire reward row. Select the image to enlarge it; use the in-game tooltip to identify unknown meanings.</p>
    <dialog ref={dialog} className="evidence-dialog" aria-labelledby={id}><div className="dialog-heading"><h2 id={id}>Review screenshot</h2>{region && <button onClick={() => setFull(value => !value)}>{full ? 'Show selected card' : 'Show full capture'}</button>}<button onClick={() => dialog.current?.close()}>Close</button></div>{region && size.width && !full ? <svg role="img" aria-label="Selected card region" viewBox={`${region.x * size.width} ${region.y * size.height} ${region.width * size.width} ${region.height * size.height}`}><image href={evidence.imageDataUrl} width={size.width} height={size.height} /></svg> : <img src={evidence.imageDataUrl} alt="Enlarged reference capture" />}</dialog>
  </aside>
}
