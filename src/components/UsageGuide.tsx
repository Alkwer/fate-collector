import { useEffect, useRef, useState } from 'react'
import { AppIcon } from './AppIcon'
import '../usage-guide.css'

const sections = [
  ['start', 'Quick start'],
  ['use', 'Using Fate Collector'],
  ['data', 'Backup & sharing'],
  ['problems', 'Troubleshooting'],
] as const
type GuideSection = typeof sections[number][0]
const topicTitles = {
  frame: 'Frame the Fate panel',
  manual: 'Import or enter an offer',
  backup: 'Back up your local journal',
  upload: 'Upload new captures from the helper',
  symbols: 'Report a reward symbol',
  corrections: 'Share reviewed corrections',
  capture: 'F9 does nothing or the frame is wrong',
  missing: 'The capture does not appear on the website',
  recognition: 'Names or rewards are missing or incorrect',
  storage: 'Local auto-save is paused at 250 offers',
} as const
type GuideTopic = keyof typeof topicTitles

function CalibrationDiagram() {
  const [step, setStep] = useState(0)
  const instructions = [
    'Move the pointer to the upper-left corner of the whole Fate panel, then press F6.',
    'Move the pointer to the lower-right corner, then press F7. Keep the heading, every offered card and Confirm inside.',
    'Press F8 to preview the saved frame in game. If anything is outside it, repeat F6 and F7.',
  ]
  return <figure className="guide-calibration">
    <div className="guide-demo-controls" role="group" aria-label="Calibration diagram steps">
      {['F6 · First corner', 'F7 · Second corner', 'F8 · Preview'].map((label, index) => <button key={label} type="button" aria-pressed={step === index} onClick={() => setStep(index)}>{label}</button>)}
    </div>
    <div className="guide-frame-diagram" data-step={step} aria-hidden="true">
      <span className="guide-corner guide-corner-start">F6</span>
      <div className="guide-panel-outline">
        <span>Fate panel heading</span>
        <div className="guide-diagram-cards"><span>Card<br />+ text</span><span>Card<br />+ text</span><span>Card<br />+ text</span></div>
        <span>Confirm</span>
      </div>
      <span className="guide-corner guide-corner-end">F7</span>
    </div>
    <p className="guide-demo-instruction" aria-live="polite">{instructions[step]}</p>
    <figcaption>Click the steps to explore this diagram. It does not control the helper or the game.</figcaption>
  </figure>
}

export function UsageGuide({ onConnect, onMap, onSaved, onDiagnostics }: {
  onConnect: () => void; onMap: () => void; onSaved: () => void; onDiagnostics: () => void
}) {
  const [location, setLocation] = useState<{ section: GuideSection; topic: GuideTopic | null }>({ section: 'start', topic: null })
  const focusTarget = useRef<string | null>(null)
  const { section, topic } = location
  const sectionTitle = sections.find(([id]) => id === section)![1]
  useEffect(() => {
    document.querySelector<HTMLElement>('.page-heading h1')?.focus()
    window.scrollTo(0, 0)
  }, [])
  useEffect(() => {
    if (!focusTarget.current) return
    const target = document.getElementById(focusTarget.current)
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'start' })
    focusTarget.current = null
  }, [location])
  function navigate(nextSection: GuideSection, nextTopic: GuideTopic | null = null, returnTo?: GuideTopic) {
    focusTarget.current = returnTo ? `guide-topic-${returnTo}` : 'guide-title'
    setLocation({ section: nextSection, topic: nextTopic })
  }
  function topicLink(id: GuideTopic, description?: string, label: string = topicTitles[id]) {
    return <button id={`guide-topic-${id}`} type="button" className={description ? 'guide-topic-link' : 'text-button'} onClick={() => navigate(section, id)}>
      {description ? <><span><strong>{label}</strong><span>{description}</span></span><AppIcon name="arrow" /></> : label}
    </button>
  }
  return <div className="usage-guide">
    <nav className="guide-contents" aria-label="Guide sections">
      <strong>Guide topics</strong>
      {sections.map(([id, label]) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} aria-controls="guide-content" onClick={() => navigate(id)}>{label}</button>)}
    </nav>
    <article id="guide-content" className="guide-article" aria-labelledby="guide-title">
      {topic && <button className="text-button guide-back" onClick={() => navigate(section, null, topic)}>Back to {sectionTitle}</button>}
      <h2 id="guide-title" tabIndex={-1}>{topic ? topicTitles[topic] : sectionTitle}</h2>

      {!topic && section === 'start' && <>
        <p className="guide-intro">Set up once, then capture each new offer with <kbd>F9</kbd>. You need Windows 10/11 and desktop Chrome or Edge for folder import. No cloud key is needed.</p>
        <ol className="guide-steps">
          <li><h3>Install and start the helper</h3>
            <p>Install <a href="https://www.autohotkey.com/" target="_blank" rel="noreferrer">AutoHotkey v2</a>. Use <strong>Download Windows helper</strong> above, right-click the ZIP and choose <strong>Extract All</strong>. Keep the files together in a writable folder and run <code>FateCollector.ahk</code>.</p>
          </li>
          <li><h3>Frame the Fate panel</h3>
            <p>Open an offer in windowed or borderless PoE. Keep the game in front and the whole panel on one monitor. Point to its upper-left corner and press <kbd>F6</kbd>, then its lower-right corner and <kbd>F7</kbd>. Press <kbd>F8</kbd> to check the frame includes the heading, all cards and Confirm.</p>
            {topicLink('frame', undefined, 'Show framing diagram')}
          </li>
          <li><h3>Connect your captures folder</h3>
            <p>Right-click the helper’s tray icon near the Windows clock → <strong>Open capture folder</strong>. In Local review, choose <strong>Connect folder</strong>, select that <code>captures</code> folder and allow read access. Existing captures are imported too.</p>
            <button className="primary-button" onClick={onConnect}>Open local review</button>
          </li>
          <li><h3>Capture and check your first offer</h3>
            <p>Keep the helper and website open. In game, move tooltips away from the cards and press <kbd>F9</kbd> once. Wait for <strong>Capture saved</strong>, then open Current area. Compare names, tiers and rewards with the image; use <strong>Edit details</strong> for corrections and review status. Leave unidentified rewards unknown.</p>
            <p className="hint">Captures and corrections save automatically. <strong>Saved locally</strong> confirms storage on this device, not a completed review.</p>
            <button onClick={onMap}>Open current area</button>
          </li>
        </ol>
        <div className="guide-next"><p>Once your first capture appears and you have checked it, setup is complete.</p><button className="text-button" onClick={() => navigate('use')}>Next: choose and invoke</button></div>
        <button className="text-button" onClick={() => navigate('use', 'manual')}>Other browsers or manual entry</button>
      </>}

      {!topic && section === 'use' && <>
        <p className="guide-intro">Check each capture, then use it for the area you are playing.</p>
        <ol className="guide-steps">
          <li><h3>Review and assign the offer</h3><p>Compare names, tiers and rewards with the source image. Use <strong>Edit details</strong> for corrections and review status; leave unidentified rewards unknown. Click <strong>Start area with this offer</strong>, or <strong>Use this offer in current area</strong> for an existing map.</p></li>
          <li><h3>Choose a Fate</h3><p>Set <strong>Reward priorities</strong> and check the advice and modifiers. Make your choice in game, then click <strong>Collect Fate</strong> on that same card here.</p></li>
          <li><h3>Plan invocation</h3><p>Open <strong>Plan invocation</strong>. Follow the pictured order and confirm in game. Only then click <strong>Done in game</strong> to update the local collection. <strong>Undo</strong> restores the last collection change.</p></li>
          <li><h3>Move to the next area</h3><p>Use <strong>More actions → New area</strong>. This clears area planning; saved offers stay in the journal. After reopening a session, use <strong>Continue this area</strong> only for the same instance. Folder access may need <strong>Resume local review</strong>.</p></li>
        </ol>
        <p className="guide-note">The helper does not play for you. <strong>Provisional</strong> advice uses incomplete or unverified information; review the highlighted cards before relying on it.</p>
        <div className="guide-actions"><button onClick={onMap}>Go to current area</button>{topicLink('manual')}</div>
      </>}

      {!topic && section === 'data' && <>
        <p className="guide-intro">Keep a backup of your evidence and corrections. Sharing is optional and separate from local use.</p>
        <ul className="guide-topics">
          <li>{topicLink('backup', 'Export your offers, screenshots and OCR.')}</li>
          <li>{topicLink('upload', 'Send new OCR text and metadata with separate consent.')}</li>
          <li>{topicLink('symbols', 'Share symbol and tooltip images for catalog review.')}</li>
          <li>{topicLink('corrections', 'Share reviewed offers from the website.')}</li>
        </ul>
      </>}

      {!topic && section === 'problems' && <>
        <p className="guide-intro">Choose the problem you are seeing.</p>
        <ul className="guide-topics">
          <li>{topicLink('capture', 'Check the helper, game window and capture frame.')}</li>
          <li>{topicLink('missing', 'Check saved files and local folder access.')}</li>
          <li>{topicLink('recognition', 'Check the image and text recognition.')}</li>
          <li>{topicLink('storage', 'Back up the journal and make space.')}</li>
        </ul>
        <div className="guide-actions"><button onClick={onDiagnostics}>Open diagnostics</button></div>
      </>}

      {topic === 'frame' && <>
        <p>Keep the game in front, in windowed or borderless mode, with the whole Fate panel on one monitor.</p>
        <CalibrationDiagram />
        <p>The helper remembers the frame between sessions. After a resolution change, check it with <kbd>F8</kbd>. Repeat <kbd>F6</kbd>/<kbd>F7</kbd> after changing the aspect ratio, UI scale or panel position. <kbd>F10</kbd> clears the frame and cancels an active capture.</p>
      </>}
      {topic === 'manual' && <>
        <h3>Import without a folder connection</h3>
        <p>After <kbd>F9</kbd>, switch to <strong>Current area</strong> and paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or use <strong>Import capture</strong> to open a helper JSON file. Choose <strong>Save offer</strong> or <strong>Confirm and save</strong> when shown.</p>
        <p>A plain screenshot is kept as evidence but does not run text recognition in the browser.</p>
        <h3>Enter a Fate without the helper</h3>
        <p>Use <strong>Add Fate manually</strong> in Current area. Select a name or portrait, then add the tiers and rewards you know. A portrait identifies the Fate; it does not supply its reward mechanics.</p>
        <div className="guide-actions"><button onClick={onMap}>Go to current area</button></div>
      </>}
      {topic === 'backup' && <>
        <p>Browser storage can be cleared. A full backup keeps the available evidence and corrections.</p>
        <ol><li>Open <strong>Saved offers → Import, export & recovery</strong>.</li><li>Select <strong>Data, screenshots & OCR</strong>, then <strong>Export all offers</strong>.</li><li>Download every part.</li></ol>
        <button onClick={onSaved}>Open saved offers</button>
      </>}
      {topic === 'upload' && <>
        <p>Optional uploads send OCR text and capture metadata. Screenshots stay local.</p>
        <ol>
          <li>Right-click the helper’s tray icon and open <strong>Cloud upload settings</strong>.</li>
          <li>Enter the collection owner’s HTTPS site URL and <strong>capture upload key</strong>. Read the destination and consent text, tick the agreement and click <strong>Enable upload</strong>.</li>
          <li>Keep the helper running. <strong>Uploaded</strong> means the server acknowledged the capture; <strong>Queued</strong> means it is waiting for a connection or retry. The website can be closed.</li>
        </ol>
        <p>Only new captures after consent are sent. Automatic uploads remain unverified and do not appear in the browser’s journal unless you import the local files.</p>
        <h3>Stop helper sharing</h3>
        <p>Use <strong>Cloud upload settings → Consent history → Withdraw consent</strong>. Disconnecting the website folder does not stop uploads.</p>
      </>}
      {topic === 'symbols' && <>
        <ol><li>Show the reward’s tooltip in game and press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F9</kbd> with helper 0.4.0 or later.</li><li>Select the symbol and tooltip on the frozen image.</li><li>Continue to the website and choose <strong>Paste from helper</strong>. Check both previews, accept image sharing and send.</li></ol>
        <p>No collection key or typed description is needed. Symbol reports share images with separate consent.</p>
        <p>You can also use <strong>More actions → Report symbol</strong> to choose images manually. <strong>Symbol report history</strong> lets you retry or withdraw a report. Reports need review before the catalog changes.</p>
      </>}
      {topic === 'corrections' && <>
        <p>Website corrections are shared separately from helper uploads.</p>
        <p>Open <strong>Saved offers → Shared research collection</strong>. Use its own consent and reviewed-offer key to share reviewed offers.</p>
        <div className="guide-actions"><button onClick={onSaved}>Open saved offers</button></div>
      </>}
      {topic === 'capture' && <>
        <ol><li>Check that the helper is running. Its tray icon is near the Windows clock, sometimes under <strong>Show hidden icons</strong>.</li><li>Keep PoE in front and the panel on one monitor. Preview with <kbd>F8</kbd> or select it again with <kbd>F6</kbd>/<kbd>F7</kbd>.</li><li>If HDR capture fails, try with Windows HDR off.</li></ol>
        <p>A second <kbd>F9</kbd> press creates another capture. <kbd>F10</kbd> clears the frame and cancels an active capture.</p>
        <p className="hint">Recognition across live Fate scenes, HDR displays and UI scales is still being validated. Check your first capture against the game.</p>
      </>}
      {topic === 'missing' && <>
        <ol><li>Check the helper’s <code>captures</code> folder for a saved file.</li><li>Use desktop Chrome or Edge on HTTPS or localhost. Keep the page open and use <strong>Resume local review</strong> if folder permission is needed.</li><li>If the folder moved, disconnect and select it again. You can also import the helper JSON file manually in Current area.</li></ol>
        <div className="guide-actions"><button onClick={onConnect}>Open local review</button><button onClick={onMap}>Open current area</button></div>
      </>}
      {topic === 'recognition' && <>
        <ol><li>Keep the complete panel in the frame and move tooltips out of the way.</li><li>Compare the image with the result. Use <strong>Edit details</strong> for corrections and leave unidentified rewards unknown.</li><li>If text recognition is unavailable, install the relevant Windows OCR language feature. The helper uses built-in Windows PowerShell 5.1 and an installed OCR language.</li></ol>
        <p>A saved image can still be reviewed manually.</p>
        <div className="guide-actions"><button onClick={onDiagnostics}>Open diagnostics</button></div>
      </>}
      {topic === 'storage' && <>
        <p>Export a full backup from <strong>Saved offers → Import, export & recovery</strong>, remove older offers, then click <strong>Resume local review</strong>. New helper files remain on disk.</p>
        <div className="guide-actions"><button onClick={onSaved}>Open saved offers</button></div>
      </>}
    </article>
  </div>
}
