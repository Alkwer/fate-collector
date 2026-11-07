# Foundation verification

Historical record of the initial foundation, before the subsequent UI simplification.
The screenshots below show the earlier form layout. See `design-spec.md` for the
current minimal-entry flow; fields now sit under Edit details and confirmation/save
are combined. This record does not claim verification of later UI revisions.

Checked on Windows, 2026-11-07. Reference: [English concept](collector-concept-en.png).
Final renders: [desktop](collector-rendered-desktop.png) and
[mobile](collector-rendered-mobile.png). Both concept and browser renders were
opened with `view_image` and compared directly.

The in-app browser failed to initialize its runtime assets. Chromium was used as
the documented fallback, first through browser DevTools and then through Playwright.
The final desktop capture uses the concept's native 1470 × 1070 viewport at device
scale 1. Mobile was checked at 390 × 844, with a full-page capture.

## Fidelity ledger

| Comparison | Concept evidence | Render and resolution |
| --- | --- | --- |
| Layout | Header, title/import toolbar, source left, editable offer right, bottom action band | Same order and column balance. Initial side margins were too wide; adjusted the container to 1470px with 32px gutters. |
| Palette | Charcoal, olive borders, ivory text and gold emphasis | Explicit tokens preserve this palette. No photographic background or decorative game art. |
| Typography | Serif wordmark/title, sans-serif tool chrome | Georgia 30px/45px; headings 24px; controls 15px; labels/table 14px. Enlarged headings/controls during review. |
| Table and selection | Two illustrative rows, highlighted current card, separate choice control | Same table structure and selected-row treatment. Editing is in one inspector, avoiding duplicate editable inputs. |
| Import icon and evidence | Thin outlined upload arrow, dashed drop target | Code-native SVG and dashed target; real imported images replace the target and can be enlarged. No screenshot is used as the UI. |
| Optional fields | Context/modifier/reward fields shown expanded | Intentionally collapsed in response to the user's request to minimize manual work. Encounter metadata is under Capture details. |
| Primary actions | Save offer and Export JSON in a full-width band | Both remain visible on desktop and full-width paired actions on mobile. Local-save feedback is real. |
| Responsive behavior | Desktop concept only | Columns stack on mobile. Fixed an intrinsic table-width overflow and reduced mobile cell padding to keep card controls readable. History uses a contained horizontal scroller. |

Above-the-fold copy comparison: brand, headline, subtitle, import actions, section
titles and primary action labels match the recorded allowed copy. Intentional
functional additions are the paste hint, optional-field summaries, selection hint,
review clarification, local-save state and helper setup disclosure. The review
label explicitly asks users to check extracted cards against the source. It does
not imply that unknown icons have been identified. The example is loaded only on
request; new users start with an empty collector instead of invented observations.

The implementation was checked faithfully against the concept and the subsequent
English-only/minimal-entry requirements. The listed reductions in visible form
fields are intentional. No unresolved clipping or page overflow was observed in
the tested viewports. Other viewport sizes and assistive technologies have not had
an exhaustive audit.

## Functional evidence

- `npm run check`: TypeScript, 17 unit/integration tests and production build pass.
- `npm run test:e2e`: five Chromium flows pass against real local Worker/D1.
  They cover import, paste, correction persistence, duplicate imports, export,
  explicit sharing/retries, rejection of unauthorized/test data, helper download,
  response headers and phone layout.
- `npm run test:helper -- -RequireOcr`: real Windows OCR recognizes fixture lines;
  unavailable OCR preserves the image, oversized captures and invalid game windows
  are rejected.
- A real helper bundle generated from GGG's `Fates_UI_2.png` imports into the app:
  Torchbearer, Tempest, Stormcaller and Houndmaster are offered; the lower collected
  Torchbearer is excluded. Source enlargement and local save work without page errors.
- Deployment guard rejects a missing production UUID before attempting network work.

Not validated: hotkeys/capture in a running PoE client, HDR, other game layouts,
Cloudflare production deployment or GitHub-hosted workflow execution. No reward
icon recognizer or probability model is implemented.
