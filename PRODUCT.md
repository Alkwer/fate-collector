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
- Connected captures and corrections save automatically. Manual imports retain
  the appropriate explicit save action. New automatic observations remain
  unreviewed until the player checks them.
- The current-map workspace separates **Choose a Fate** and **Plan invocation**.
  Reward priorities, exclusions and reusable profiles support the solver.
  The saved-offer archive and current-map collection are distinct; moving
  observations between them is an explicit action.

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
  handling. Sharing must respect the existing explicit consent and access key
  flow; examples must remain test-only observations.
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
