# In-game Fate advice

The Windows helper 0.6.0 adds a local overlay for choosing and recording Fates.
The website remains the source of reward priorities, current-area collection and
recommendation logic. Use desktop Chrome or Edge with HTTPS or localhost, and
PoE in windowed or borderless mode. Exclusive fullscreen is not supported by
this first version.

## Setup

1. Exit the old helper. Update the entire helper package, preserving captures,
   symbol reports and calibration. Run `FateCollector.ahk`.
2. On the website open **More actions → In-game overlay**.
3. Choose **Connect overlay folder**, select the running helper's `captures`
   directory and allow read/write access. The helper must already have created
   `captures/.overlay`. This also connects normal local capture review.
4. In the game, calibrate with F6/F7 if needed, then press F9.
5. Confirm the current area with Ctrl+Alt+Enter. Check the displayed names and
   missing data. After choosing a Fate in game, record that choice with the
   corresponding Ctrl+Alt+number shortcut.

| Shortcut | Effect in Fate Collector |
| --- | --- |
| F9 | Capture the next offer; immediately clear prior advice |
| Ctrl+Alt+Enter | Confirm the displayed area action, or cancel new-area reset |
| Ctrl+Alt+1–9 | Record the corresponding recognized Fate in the local collection |
| Ctrl+Alt+N | Request a new area, then confirm with a second press |
| Ctrl+Alt+Z | Undo the latest collection/area change |
| Ctrl+Alt+O | Show or hide the overlay |

Only currently displayed actions are accepted. Keys are handled while the
verified game is active and never click cards or automate game actions. Numbers
follow the recognized offer order; check the name, especially after corrections.
More than nine recognized cards requires website review. Excluded cards cannot
be recorded through the overlay. A new area discards the current offer binding
and requires a fresh F9 capture.
When the full comparison cannot fit at a readable size, the overlay retains the
recommended position, reason and uncertainty, asks you to compare on the website,
and pauses its action shortcuts. It never hides missing-data details to fit more
choice buttons.

## Missing data and connection state

The overlay calls the existing single-goal or portfolio recommendation engine.
It preserves equal matches, unknown rewards and provisional advice. It does not
infer reward meanings from portraits or improve OCR. Inspect and correct unknown
data on the website. Invocation planning remains on the website in this version.
An open editor, pending changes or unavailable capture connection blocks overlay
actions so background commands cannot overwrite a correction.

The website must remain open. A background tab can be throttled or suspended;
after 12 seconds without a valid heartbeat the helper removes the advice and
actions. Return to the website to resume updates. A new F9, failed/cancelled
capture or mismatched capture ID also prevents an old recommendation from showing.
Reconnect the overlay explicitly after reloading the page. Only one tab per
browser origin can own the overlay. A recently active writer from another origin
also blocks connection until it disconnects or expires.

**Disconnect overlay** leaves normal local review connected. It does not change
cloud upload settings. Overlay messages never enter the upload queue or offer
backups. Closing the helper closes its overlay sidecar.

## Local protocol and validation

The browser's ordinary capture connection stays read-only. The separate overlay
connection explicitly requests read/write permission, writing only
`captures/.overlay/state.json`. The helper owns `capture.json` and `command.json`.
Original capture files are not changed. No HTTP listener, remote service,
credentials or additional runtime installation is needed.

Protocol 1 is defined by `shared/overlay.ts`. Messages are bounded to 32 KiB.
Browser state contains a connection ID, stable snapshot revision, capture ID,
heartbeat, display rows, advertised actions and last acknowledged command.
Commands echo those IDs and expire after 12 seconds. Each action is checked
against the current snapshot and capture marker immediately before dispatch.
The helper allows only one pending action; reconnecting gives the browser a new
identity, preventing replay from a previous visit. Native writes are atomic and
browser writes use `createWritable`/close.

Run `npm run test:overlay` for native protocol/render checks and
`npx vitest run tests/overlay.test.ts` for recommendation/bridge checks.
`npx playwright test e2e/overlay.spec.ts` exercises import, area confirmation,
choice, undo, reset, stale commands, multiple tabs and responsive setup UI.
Browser tests use real Chromium OPFS instead of the OS folder picker. Native
fixture/render checks do not establish live PoE, HDR, exclusive-fullscreen or
every DPI/resolution combination; these require an in-game smoke test.

`npm run test:overlay:background` is a separate native-desktop browser check.
It launches an isolated, minimized Chromium profile under `.qa/overlay-browser`,
attaches with Playwright `noDefaults`, verifies that the application document is
actually hidden, and checks heartbeat and capture intake after the timer-throttling
grace period. Ordinary headless tests emulate focus and cannot establish this.
The grace period is shortened only in this test using Chromium's
[documented test flag](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#testing).
Browser freezing/discarding is still handled by expiring advice, not by claiming
that the website keeps running while suspended.
