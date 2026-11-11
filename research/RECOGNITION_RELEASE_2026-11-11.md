# Recognition release evidence — 11 November 2026

## Native corpus search

Searched local `.qa` capture bundles (`fate-*.json`, recursively), native validation records, `.qa/offer-captures`, `.qa/offer-labels`, `.qa/recognition-validation-replay` and indexed `prototypes/vision/fixtures` manifests. Inspected capture mode, helper version and OCR evidence without copying private image bytes into this report.

The real native game records in `native-f9-20261109-aed67f77`, `manual-staging-802dfa3`, `deployment-migration-2026-11-09`, `production-ee80b71`, `release-2104ee0` and `release-4cc7300` show Character/Offence statistics. Other game-mode records explicitly contain synthetic staging text, so `captureMode=game` alone is not proof. Positive offer bundles in `offer-captures` use fixture mode and press/showcase scenes. `native-folder-4cc7300` is a directory-picker test using synthetic fixture captures. Archived native candidates are negative gameplay images, not positive independent F9 captures. No qualifying independent positive native release holdout was found in this searched local inventory; this does not establish absence on every disk.

The checked-in release holdout remains empty and fails. The user confirmed that the Fate league releases on Friday **13 November 2026**; the GGG FAQ also dates its release to 13 November (PST). Positive live Fate captures are therefore unavailable before launch and cannot be supplied now. Current native F9/Character-screen checks can establish negative capture/import behavior only. After launch, fresh native positive encounters, independent labels, the exact staging package, full F6/F7 calibration and physical HDR/alternate UI/ultrawide evidence require the operator and relevant hardware. No press replay, generated fixture, resized frame or old negative was relabeled as native evidence. Production promotion is intentionally blocked until the required corpus passes; this is a release evidence blocker, not unfinished code or a request to capture unavailable content now.

## Fresh source review

Reviewed on 2026-11-11:

- [GGG Covens FAQ, published 10 November](https://www.pathofexile.com/forum/view-thread/4013527/page/1): selection order is clarified. It does not provide mixed-tier merge rules, third-copy behavior or a general duplicate/combo algorithm. Its rarity clarification also warns that an ExileCon TCG note was outdated; that note cannot be imported as a reliable rule.
- [GGG expansion page](https://www.pathofexile.com/covens): the web reader exposed navigation only, so no new name was extracted from it.
- [PoEDB Covens overview](https://poedb.tw/us/Covens_league): no complete Fate or reward table. [Partial 3.30 notes](https://poedb.tw/us/Version_3.30.0) contain TCG fragments, including rarity text contradicted by GGG; no new mechanics imported. [Dreadmaidens' Sacrament](https://poedb.tw/us/Dreadmaidens_Sacrament) corroborates the existing unique name and Basalt Flask base, not its combo threshold. PoEDB is community data provenance, separately identified from GGG.
- Reopened and visually inspected the preserved original [GGG showcase at 07:23:55](https://www.youtube.com/watch?v=8FKW2rKJyxA&t=26635s), indexed as `prototypes/vision/fixtures/v2/images/showcase.png` by `holdout-v2.json`. The offered headers **Dryad** and **Avalanche** are readable and were missing from the production name dictionary. Added only those two confirmed names; no rewards are inferred from them. The frame remains prerelease development evidence, not the release holdout.

Queries included `site:pathofexile.com Covens Fates tier`, `site:poedb.tw Fates Torchbearer`, `site:pathofexile.com Fate Avalanche Rot` and mixed-tier/third-duplicate searches. Secondary guides were discovery leads, not grounds for new mechanics. No new supported motif meaning or combo threshold was established. Existing tooltip evidence is recorded in `REWARD_CATALOG_2026-11-10.md`; the new versioned ledger is `shared/catalog-metadata.json`.

### Later documentation update — 11 November

The official [3.30.0 patch notes](https://www.pathofexile.com/forum/view-thread/4013680)
are now available. The earlier PoEDB/TCG entry above records the initial review,
not the current availability of official notes. The [research update](FATE_ADVISOR_RESEARCH_2026-11-07.md#aktualizacja-z-11-listopada-2026)
records the direct source recheck and relevant findings. This documentation
update adds no recognition labels, catalog rules or native release evidence.

## Deliberately unresolved

Mixed-tier duplicates, third duplicates, slot recovery and general duplicate/combo interactions still need a specific primary explanation or controlled native experiment. The conservative advisor remains unchanged. The historical T2+T2 example must not be generalized. A newly visible source is not evidence for an unstated rule.

## Release policy and limits

`native-holdout-v2` requires per profile 10 offers, 3 invocation scenes, 5 negatives; at least 30 names, 20 tiers and 20 motifs; five distinct known names; both supported tiers; and all eight supported motifs globally. Recall minima remain 95% names and 90% tiers/motifs with zero false acceptances. This is an explicit smoke corpus minimum, not a claim of statistical confidence.

The report workflow verifies a local operator-attested measurement against the trusted staging package and publishes a controlled GitHub artifact. It does not run Windows F9 or replay private screenshots on GitHub. Promotion checks the producer workflow/repository/main/SHA, artifact, exact release ID/helper version/frozen asset hashes, counters and coverage. The local operator still attests independence and native capture authenticity; a submitted `PASS` string alone has no authority.

## Validation performed

Targeted Vitest recognition, visual-suggestion and gate tests pass. The empty default holdout exits nonzero with `FAIL` and zero measured scenes. A browser replay of the private historical five-scene manifest measured both press offers and both native Character negatives without per-scene problems. The fifth showcase invocation was correctly refused because its old annotations mark a newly dictionary-known name as unknown; the historical manifest must be relabeled for the expanded dictionary before it can be used as a new regression replay. The old five-scene PASS is not claimed for this revision. Initial sandbox replay could not fetch localhost modules; the diagnostic localhost connection returned `EACCES`, and the browser replay above was run outside the sandbox. No GitHub workflow, production promotion, native positive capture or physical HDR test was executed.
