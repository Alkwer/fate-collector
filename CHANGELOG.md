# Fate Collector releases

## 0.8.0 — 17 November 2026

- Incomplete combos guide collection without being presented as active invocation
  rewards. Reward planning prefers fewer inputs when active rewards are equal.
- Six optional build-danger categories support Allow, Warn and Exclude. They use
  recorded modifiers and labelled Tier 3 PoEDB references, including supported
  T2 merges. Literal and individual-card exclusions apply in every planning mode.
- **Planning objective → Farm boss Viscera** compares input count and supported
  duplicates separately from reward priorities. It shows the reward trade-off;
  unknown drop chances and duplicate combo rules remain explicit.
- **Record a different invocation** records the exact cards used in game and
  supports collection undo even when no recommended reward plan is available.
- Existing profiles retain their priorities. The new objective and danger settings
  persist locally and travel with profile exports. The local advisor and website
  use the same planning rules; overlay choices respect the same exclusions.

Exit the helper before upgrading. Extract the entire new ZIP and replace the
program files, including `desktop` and `webview2`. Keep `captures`, `symbol-reports`
and `fate-collector.ini`; existing local advisor data stays in the Windows profile.
The website and local advisor have separate collections.

In-game validation is deferred at the owner's request. Automated checks do not
establish native recognition accuracy, combat safety or actual drop probabilities.
