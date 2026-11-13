# Automatic area context

The Windows helper reads a bounded tail of `logs/Client.txt` beside the verified
Path of Exile process when capturing an offer. This is read-only and local.
It records only the area category, internal identifier and area level. A missing
or unreadable log does not prevent an F9 capture.

The parser is based on observed PoE 1 records, including:

```text
Generating level 1 area "1_1_1" with seed …
Generating level 83 area "MapWorldsDunes" with seed …
Generating level 60 area "HideoutCosmicAtlas" with seed …
Generating level 69 area "2_11_endgame_town" with seed …
```

The actual parser requires the full system-log prefix, the matching process and
current process lifetime. A completed scene entry is required. A transition or
disconnect invalidates the previous area; the capture checks that the area did
not change while taking the image. It does not infer current location from an
old session or from chat text that resembles a log message.

- **Campaign:** recognized Act 1–5 (`1_1`–`1_5`) and Act 6–10 (`2_6`–`2_10`)
  area identifiers. A suffix such as `2_7_5_map` still belongs to the campaign.
- **Map:** recognized `MapWorlds…` identifiers, including endgame encounters
  using that namespace. This is not a claim that every entry is a regular Atlas map.
- **Other:** recognized hideouts and endgame town.
- **Unknown:** missing, ambiguous or unsupported context. An unfamiliar area ID
  is not classified by its level. In particular, level 69 does not imply a map.

In **More actions → Edit details**, **Area category** can be corrected without
editing Notes. The original detected category remains visible below the fields.
The category appears with the offer and in the archive; **Saved offers → More
filters → Area category** filters on the saved, possibly corrected value.
Old offers remain readable and show Unknown until explicitly corrected.

Local review, backup, restore and reviewed sharing preserve the separate field.
Automatic uploads include the bounded source metadata only. The capture-sharing
policy changes to `2026-11-13.1`, so existing sharing must be accepted again;
local capture does not require upload consent. Deploy the compatible website/API
before distributing helper 0.5.0 because older strict parsers reject new fields.

Validating recorded log entries and synthetic transitions does not establish
live behavior after a game update. A live F9 check across campaign, map and
hideout remains the final native verification.
