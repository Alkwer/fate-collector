# Fate Collector

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Path of Exile 1 players collecting Fate observations and deciding which Fate
to choose or invoke during a map. The workflow should minimize typing and
allow the player to inspect the original evidence when recognition is uncertain.

## Product Purpose

Capture, preserve, review and compare Fate offers, then support choices using
the current map collection and the player's reward priorities. Keeping a sample
must not require filling every field or interpreting every unknown icon.

## Operating Context

- The Windows helper captures offers with F9 and performs local OCR. Optional
  helper upload works independently of the website; screenshot pixels stay local.
- Optional local review connects the captures folder in desktop Chrome/Edge
  on HTTPS or localhost. The page must remain open for browser folder import.
  Manual import, paste and drag/drop are fallback paths.
- Helper 0.10.3 runs the bundled advisor locally in a WebView2 host. No browser
  tab or internet is required for advice; closing its window keeps it running.
  Collection, reward priorities and saved offers persist in the local Windows
  profile. Website data is separate; offers can move through export/import.
- Optional website advice connects the helper's overlay folder with separate
  read/write permission. In this mode the website stays open and uses the same advisor and
  current-area collection. Explicit shortcuts confirm area membership, record
  the actual choice, undo and start a new area. They never control the game.
  Capture changes and expired heartbeats remove stale advice. Reward corrections,
  priorities and invocation planning remain on the website in this version.
- The helper detects stable calibrated offers automatically while the overlay
  connection and foreground game are active. Automatic captures stay local;
  existing raw-upload consent covers F9 captures only. Manual F9 remains a
  fallback for unreadable or unknown names. No choice or area is inferred.
- **Add Fate manually** provides direct website entry by name or sourced portrait,
  with optional tiers and rewards. A portrait never supplies reward mechanics.
- Connected captures and corrections save automatically. Manual imports retain
  the appropriate explicit save action. New automatic observations remain
  unreviewed until the player checks them.
- Campaign areas allow two invocation inputs and maps allow three. Reviewed same-name
  T1 and T2 pairs upgrade one tier and triple the first card’s regular rewards.
- The current-map workspace separates **Choose a Fate** and **Plan invocation**.
  Reward priorities, exclusions and reusable profiles support the solver.
  The saved-offer archive and current-map collection are distinct; moving
  observations between them is an explicit action.
- New solver profiles include a provisional trade weight for every confirmed reward variant. Campaign / SSF
  and Viscera starters replace priorities only through an explicit action;
  saved profiles are preserved. Points are not profit estimates. Identified
  rewards with no positive weight are visible beside advice.
- A local library holds up to 20 named build profiles with independent priorities,
  danger filters, objectives, single-reward goals and personal templates. Settings
  save automatically. Explicit create, duplicate, rename and delete actions preserve
  map state. Library backups include all profiles; single-profile import replaces
  only the active configuration. Existing settings migrate without discarding them.
- Source references include versioned PoEDB effects and official patch corrections.
  They never confirm captured rewards, tiers or modifier lists. Shared unique
  icons require the exact tooltip before scoring, including in older records.
- Invocation advice requires an active weighted reward; incomplete combos remain
  collection progress. Players can separately record a different invocation already
  performed in game, with undo.
- A player can mark the current offer as the last one in the area. The reward
  comparison then uses active rewards and ties equally valuable choices.
- The overlay can identify a tooltip to check for a decision or an active
  Promised Profits objective. The player verifies it in game.
- Optional build-danger actions (Allow / Warn / Exclude) apply to both solvers and
  overlay advice. Full Tier 1–2 screenshot effects and Tier 3 PoEDB effects are labelled as source references,
  not captured evidence. These filters do not assess overall encounter safety.
- Boss Viscera farming is a separate planning objective. It compares input count
  and supported duplicate presence, retaining incomparable alternatives without
  inventing drop probabilities. Reward weights show the reward trade-off.
- **Report symbol** is an independent, opt-in image-research flow with preview,
  source references, durable local retries and withdrawal. Normal capture/offer
  sharing stays text-only. Symbol reports are public, with no account or collection
  key, separate consent, Turnstile and bounded intake. Reports require maintainer
  verification before any catalog update.
- The helper's Ctrl+Shift+F9 freezes the verified game window for two crops:
  a symbol and its visible tooltip. A local draft goes through the clipboard
  to the website for preview, separate consent and verification. The helper
  never uploads symbol images. A matching local F9 offer supplies context;
  otherwise the symbol can be reported without identifying its Fate.

## Capabilities and Constraints

- Keep routine capture/review read-only on the main surface. Corrections belong
  under **Edit details**; secondary operations belong under **More actions**.
- Distinguish saving evidence, reviewing extraction and making a map choice.
  Do not ask for duplicate input or imply that review resolves unknown mechanics.
- Unknown or unsupported rewards stay unknown. Provisional advice, ties and
  missing data remain explicit; link a missing-data check to the affected card.
- Report only observable save/connection states. Pending corrections are not
  saved. The browser must not invent the helper's cloud upload/queue status.
- Preserve original local evidence, corrected metadata, recovery and revision
  handling. Capture/offer sharing must respect the existing explicit consent and
  access key flow; public symbol reports have independent consent and anti-bot
  verification. Examples must remain test-only observations.
- UI changes must not silently alter capture, storage, sharing or solver
  contracts. Product facts and mechanics require evidence, not visual inference.

## Brand Commitments

The product name is **Fate Collector**. Application copy is English, concise
and operational. Preserve established game terms and distinguish supported
facts from assumptions. Do not fabricate statistics, testimonials or authority.

## Evidence on Hand

This record consolidates existing requirements from `README.md`,
`docs/architecture.md`, `docs/design/design-spec.md` and the current implementation
on 2026-11-11; it introduces no new product decisions.

Existing concept images and `docs/design/verification.md` describe earlier UI
iterations. Their screenshots do not validate the current layout. Positive
native Fate recognition and full HDR/UI-scale coverage require their own
current evidence; frontend tests alone cannot establish those results.

## Product Principles

1. Preserve useful observations before requiring complete interpretation.
2. Show the next useful action and reveal secondary controls progressively.
3. Keep evidence and uncertainty visible when making recommendations.
4. Protect local corrections and recovery across imports and saves.

## Accessibility & Inclusion

Preserve keyboard operation, visible focus and text explanations for colored
states. Keep controls usable at narrow widths and with longer labels or enlarged
text. Desktop and mobile target sizes follow the existing design specification.
