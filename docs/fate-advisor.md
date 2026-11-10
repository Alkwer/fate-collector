# Fate advisor

The **Advisor** tab covers two decisions: the next Fate from the current offer,
and the order of up to three input cards from the current area's collection.
Everything runs locally, without an API, market prices or changes to observation
schemas. The rule baseline is the [prerelease research checked on 8 November
2026](../research/FATE_ADVISOR_RESEARCH_2026-11-07.md), not live-game validation.

## Use

1. Capture/import an offer in **Collector**. In **Edit details → Modifiers &
   rewards**, identify each visible reward's exact label, kind, count and, when
   known, combo threshold. Supported icon shapes and T2/T3 are now suggested locally
   from the image. Shape matches do not establish a reward's meaning or kind.
   Check the tier and the full reward row using the two visual-review checkboxes.
2. Open **Advisor**, choose **Choose from current offer** and a **Reward goal**.
   The result names the matching Fate(s), shows icon progress and invocation order,
   and separates a supported recommendation from a provisional preference.
3. After choosing in the game, use **Add … to collected** for that card. Only one
   card per imported offer can be added; remove it to change that planning choice.
   This does not mark the observation's optional Choice field or automate the game.
4. After the next capture, repeat. Choose **Plan collected Fates** for an invocation
   plan. Use **Edit collected cards** to enter earlier cards or correct these local
   snapshots. Later changes to an observed offer do not silently alter the snapshots.
5. Use **Start a new area** when leaving the instance. The collection survives app
   navigation and reload in this browser tab through versioned `sessionStorage`.
   Restored cards require **Continue this area** before advice resumes. A separate
   browser tab has separate planning state; closing the tab normally ends its session.
   It is not part of observation backups or uploads. Storage failures are shown;
   invalid edits preserve the last valid stored area rather than overwriting it.

## Rules and uncertainty

- Reward labels match after case, whitespace, Unicode and apostrophe normalization;
  regular and combo rewards remain separate. Names never imply a reward.
- A regular goal ranks matching icon units. Counts do not estimate item quantity,
  price, profit, modifier value, build suitability or fight difficulty.
- Combo goals use identified matching icons and a consistent threshold. The small
  verified catalog supplies Item Rarity (3), Exceptional Gem (3) and Dreadmaidens'
  Sacrament (2). A conflicting explicit threshold leaves activation unresolved.
  A threshold reached once is not assumed to pay multiple times.
- The search considers subsets of up to three input cards, including both orders
  of a supported duplicate pair. Two identical named T2 cards merge to T3: regular
  rewards of the first ×3; the second card's rewards are discarded. Two inputs are
  still consumed. At equal target progress, fewer input cards are preferred.
- Next-card recommendations require improved target progress over the best plan
  available from the collection alone. A neutral reward can still help when the
  new card enables a confirmed duplicate merge. No improvement means no preference.
- Three duplicates, mixed-tier merges, merges involving T3 and duplicate/combo
  interactions are unresolved, not assigned a zero benefit. They produce warnings.
- Empty reward lists, unread names or relevant unidentified icons prevent a firm
  ranking. Positive known progress can yield a provisional preference; no supported
  progress yields no recommendation. All tied offered cards are named.
- Automatic icon lists are partial until explicitly checked against the image.
  Unchecked lists keep advice provisional; unreviewed visual tiers cannot enable
  a duplicate merge. Neither saving an offer nor a shape match confirms these fields.
- Missing cards outside the supplied offer are not inferred. The collection is
  explicit and never assembled automatically from saved history or capture sessions.
  Up to 12 collected cards and 30 offered cards bound the search; 12 is an application
  limit, not a claim about the game. Invalid draft numbers abstain until corrected.

The engine is in `shared/advisor.ts`, independent of React, capture parsing and
storage. Unit tests cover ranking, unknowns, thresholds, duplicate order and limits.
`e2e/advisor.spec.ts` covers both decisions, edits, area resets, local-only planning,
and desktop/tablet/mobile rendering alongside the existing collector regression suite.
