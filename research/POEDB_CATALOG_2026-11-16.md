# PoEDB Fate reference · 16 November 2026

`poedb-fates-2026-11-16` records 25 tier-three Fate entries and 146 reward definitions for the 3.30 Covens League. The source explicitly tags the Fate entries as tier three. Where the reward table lists a minimum level, the snapshot preserves that value. [PoEDB Fates and Rewards](https://poedb.tw/us/Fates)

Hotfix 2 removed Culling Strike from tier-three Crowkeeper and reduced the damage of its explosions and Wildfire's Blackfire Walls. Crowkeeper's old culling lines are retained under `corrections[].superseded` for provenance. The displayed description and effects omit those lines. The same hotfix fixed Viscera drops from some Fate-spawned bosses without identifying individual reward chances. [GGG 3.30.0b Hotfix 2](https://www.pathofexile.com/forum/view-thread/4015564)

Rotted and Savage expand the Fate name dictionary. The earlier screenshot evidence records Rot under its own heading. The catalog leaves both Rot and Rotted selectable under their own names. [PoEDB Fates and Rewards](https://poedb.tw/us/Fates) · [Screenshot evidence](SCREENSHOT_CATALOG_2026-11-15.md)

The reward entries are read-only search references. Minimum levels and icons do not establish observed card rewards, reward kind, combo threshold, counts or drop odds. Verification still requires the card's tooltip. The eight additional Fate portraits are the original CDN WebP files with their paths, dimensions and SHA-256 values recorded in [credits.json](../public/game-art/poedb/credits.json).

## Product decisions and related tool

The shared orange-feather motif appears beside several league-unique definitions
in PoEDB. It no longer identifies Dreadmaidens' Sacrament automatically. Existing
observations retain their recorded text but need an exact tooltip check before
scoring. Reward families organize the editor only; they never merge combo counters.

[Wickerman Ledger](https://wickermanledger.site/), inspected on 16 November 2026,
offers effect/boss/zone/map/slot search, campaign/endgame filters, four equipment
slots, DPS/Tanky starters, saved setups and share links. Its disclaimer describes
campaign-to-map boss mappings as inferred, not GGG-confirmed. Those mappings and
weights were not imported. The relevant design idea adopted here is explicit starter
selection with preserved saved preferences. Fate Collector's starter weights are
its own provisional preferences. A separate Viscera/Wickerman equipment planner,
named multi-profile library and challenge tracker remain future work; this release
focuses on current Fate decisions and source references.

## Implementation validation

Local validation on 16 November: lint, TypeScript and build passed; 343 unit tests
passed with one existing native-fixture skip; all 144 Chromium flows and 20 Windows
visual comparisons passed. The PoEDB offline checker verified all records and
portrait hashes. Browser flows cover legacy shared-icon abstention and explicit
tooltip selection, preset replacement/persistence, unweighted rewards, source
corrections, empty search and Savage artwork. Desktop (1440 px) and phone (390 px)
screenshots of the new panels were inspected; no horizontal overflow or console
errors occurred in those flows. Existing tablet flows also passed.

The Impeccable detector returned no primary findings. Its 16 font-size advisories
refer to unchanged CSS outside the added rules; the established visual style was
preserved. Native game/HDR recognition is not established by these checks. The
production gate still requires exact-release native evidence or a separately
approved, package-specific exception.

## Reproduce the snapshot

Save the two source pages above as HTML. These commands check the checked-in snapshot and rebuild it from the saved source pages using the existing portrait files.

```sh
node scripts/poedb-catalog.mjs --check
node scripts/poedb-catalog.mjs --check-source fates.html hotfix.html
node scripts/poedb-catalog.mjs --import fates.html hotfix.html
```

The importer is scoped to this snapshot's date, entry counts and source layout. A later update requires reviewing the source changes and incrementing the snapshot date. `--check` uses only checked-in data and local portraits.
