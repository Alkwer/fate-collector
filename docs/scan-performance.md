# Capture archive scan measurements

Measured locally on Windows, 2026-11-09. These are bounded development benchmarks,
not device-independent latency promises. Both implementations retain full directory
enumeration so files missed during a crash are discoverable after restart.

## Browser receipt lookup

Run `node scripts/benchmark-capture-scan.mjs` with Chromium installed. The benchmark
uses actual IndexedDB and the production `CaptureReader` in an isolated Chromium
profile. Directory enumeration is synthetic: it excludes filesystem/picker costs
and never reads screenshots. Each size has three measurements; values are medians.

| Historical capture IDs | Previous per-file lookup | New cold reader | New warm reader |
| ---: | ---: | ---: | ---: |
| 1,000 | 203.5 ms | 2.8 ms | 0.8 ms |
| 10,000 | 2,129.6 ms | 20.2 ms | 6.1 ms |

The reader loads receipt/evidence keys once instead of opening a transaction for
each historical file. Explicit metadata import updates a shared invalidation marker.
The next scan rebuilds that cache and can recover missing evidence without a
reconnect. Regression tests cover that case and deleted-offer suppression.

## Windows uploader

Run `helpers/tests/Measure-UploadScan.ps1` in Windows PowerShell 5.1. This creates
real synthetic files on disk and uses a fake transport. Each full cycle discovers
and sends a newly added capture; five warm runs per size exclude network latency
and the tray's scheduling delay.

| Processed files | Previous median | New median | Other I/O operations, before → after |
| ---: | ---: | ---: | ---: |
| 1,000 | 345 ms | 113 ms | 9,863 → 4,843 |
| 10,000 | 2,925 ms | 842 ms | 91,314 → 41,291 |

Every new capture was delivered in the first measured cycle. DirectoryInfo-based
enumeration and early queue-state checks reduce metadata operations without adding
a persistent index or a new recovery mechanism. Process reads/writes remained
22/4 per invocation; working-set deltas were noisy and do not establish a memory
improvement. See the [helper measurement notes](../helpers/README.md).
