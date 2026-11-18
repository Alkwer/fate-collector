# Planning rules follow-up — 17 November 2026

This change separates collection progress from payable invocation rewards, adds
optional build-danger filters and introduces a boss Viscera planning objective.
It uses existing recorded references; it does not certify new game mechanics.

## Evidence and decisions

| Source | Supported conclusion | Implementation boundary |
| --- | --- | --- |
| [GGG Fate of the Vaal FAQ](https://www.pathofexile.com/forum/view-thread/4013527/page/1), rechecked 17 November | Regular empowered bosses have better Viscera chances with more invoked Fates and duplicates; Grim-Fate empowered Pinnacles guarantee Viscera. | Compare input count and supported duplicate presence. No percentage, expected yield or ranking of a duplicate pair against three distinct Fates. Players must check the eligible boss. |
| [3.30.0b Hotfix 3](https://www.pathofexile.com/forum/view-thread/4015683/page/1), recorded in the 16 November patch review | Three identical Fates keep the first and third rewards at ×3 and discard the middle rewards. | Preserve the existing reviewed equal-tier regular-reward model. Output tier and duplicate combo scaling remain unresolved. |
| [PoEDB Fates](https://poedb.tw/us/Fates), versioned local catalog with official patch corrections | Named Tier 3 references contain explicit combat effects. | Use matching references for optional danger categories on known reviewed T3 cards and supported T2 → T3 merges. Never overwrite capture fields or assign a T3 effect to a plain T2 card. |
| [Community mechanics discussion](https://www.reddit.com/r/pathofexile/comments/1xxh3ar/how_fates_actually_work_twins_sets_and_whats/), rechecked 17 November | Reports suggest duplicate combo count multiplication and possible repeated payouts; the thread also contains older statements corrected after the hotfix. | Treat these as hypotheses, not a universal formula. They do not establish every reward family, tier, input order or current-patch outcome. |

The FAQ supports the direction of two Viscera factors, not their relative strength.
The application keeps non-dominated factor combinations; equal combinations use
the user's reward points as a tie-breaker. Duplicate presence is a binary factor,
not an assumption that triples confer a particular additional multiplier. The
existing explicit Viscera Item combo priority remains independent of boss farming.

Incomplete combos can guide collection but do not establish an active payout.
In reward mode, invocation plans require positive active points (or an activated
single combo goal). A separate manual record action handles an invocation already
performed in game and retains the existing undo behavior.

Build-danger filters recognize explicit phrases in recorded modifiers and known
Tier 3 references for physical damage over time, chaos/poison, bleeding, curses,
boss recovery and companion bosses. This is not a complete build simulator.
Missing effects remain unverified; unsupported triple output effects are shown
as unknown when danger filters are active. Allow means that category is unfiltered.

## Unverified hypothesis: later offers complete two-icon combos

Player observation reported on 17 November: after the first part of a two-icon
combo appears, a later Fate offer in the same instance seems always to contain
the second part. This is an anecdotal observation without a recorded sample size.
In the [community mechanics discussion](https://www.reddit.com/r/pathofexile/comments/1xxh3ar/how_fates_actually_work_twins_sets_and_whats/),
PaladinWiz similarly reports that, after choosing a Fate with a two-icon currency
combo, the next two or three encounters often offer either a matching reward or
a duplicate Fate. These are separate outcomes; a duplicate alone does not verify
that the matching reward appeared or resolve duplicate/combo scaling.

Hypothesis: later offers may favour completing a combo already offered or chosen.
Neither a guarantee nor a probability is established. It is also unknown whether
the first part must be selected, rather than merely appear in an offer. The
[GGG FAQ](https://www.pathofexile.com/forum/view-thread/4013527) confirms that the
next offer stays hidden until a choice is made, but does not establish this bias.

To investigate, record complete offer sequences within the same instance:

1. Record the patch, exact reward label, icon count and threshold (1/2), Fate name
   and tier, and whether that card was selected or another offered card was chosen.
2. Keep every subsequent offer and choice through the final encounter. Count
   later offers with the exact matching reward separately from duplicate Fates.
3. Include instances with no matching later reward. Record how many offers
   remained; distinguish fully observed sequences, no remaining offers and runs
   stopped before all offers were seen.
4. Compare selected and unselected first parts, keeping reward families and the
   number of remaining offers separate. Frequent completion alone does not prove
   that the selection changes the offer distribution or guarantees completion.

No solver rule or weight changes follow from this hypothesis. If supported by
evidence, it could inform future-offer estimates when choosing a Fate. Invocation
planning must still use only actually collected cards and supported active rewards.

## Evidence still needed for duplicate combos

Collect before/after captures from the current patch, keeping exact reward names,
tiers, visual-review status, input order, the final invocation panel and the actual
outcome. Repeat separately for the following cases:

1. A confirmed T2 pair with one combo icon on the first card, then reversed order.
2. A combo on the discarded second card only, and a mixed regular/combo first card.
3. Three equal-tier copies with different retained combo families and a combo on
   the discarded middle card; record the final tier and combat effects separately.
4. A threshold reached exactly once versus apparent counts above that threshold;
   distinguish displayed icon counts, activation count and received rewards.
5. Different combo families, including unique-specific orange-feather rewards;
   do not transfer a result from one family to another without evidence.
6. Mixed tiers and non-T2 pairs as independent experiments.

No new controlled in-game evidence was obtained in this task. Automated tests use
synthetic fixtures to check application behavior and do not validate these game rules.
Native capture accuracy, OCR, HDR calibration and actual drop rates remain outside
this validation. See [advisor documentation](../docs/fate-advisor.md) for behavior.

## Implementation validation

- ESLint, TypeScript and production build passed. Unit tests passed: 371, with
  one existing skipped test. Lint, unit tests and the final build also ran with
  the project's supported Node 24 runtime.
- All 36 selected browser scenarios passed across `advisor-flow`, `advisor`,
  `overlay` and `solver`, using scoped runs and rerunning affected cases after
  corrections. New cases cover incomplete combos in both engines, single-mode
  collected-card exclusions, manual invocation recording and undo, danger
  exclusions, Viscera planning, no-improvement messaging and restored profiles.
- Rendered screenshots were inspected at 1440, 820 and 390 pixels. Relevant
  controls retain keyboard focus and the tested pages have no horizontal overflow.
- Impeccable reported only advisory font-size findings in existing CSS rules;
  the changed component checks had no findings. The established visual system
  was preserved. `git diff --check` passed.
- The initial sandbox could not connect to the local Wrangler test runtime;
  browser tests passed with approved execution outside that sandbox. No remote
  deployment or native in-game test was performed. Vite still reports a main
  bundle over its 500 kB advisory threshold.
