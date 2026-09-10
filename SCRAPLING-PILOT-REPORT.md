# LotSocial Scrapling VDP Reliability Pilot — Phase 1 report

**Decision:** REVISION_NEEDED  
**Branch:** `pilot/scrapling-vdp-reliability-phase1`  
**Implementation commit:** `0f372f6f60406e8be43bfc3b43dbd416e7572272`  
**Base:** `origin/rf/clarity-break-2026-08-28` at `f82a9c03e9041fc7a832e5107109b1c6fe911c9d`  
**Deployment:** Not performed; feature flag remains off by default.

## Completed and proven

- Python 3.12 parsing-only service under `services/scrapling-parser/`, with `scrapling==0.4.15` and exact transitive pins.
- Authenticated `POST /extract/v1`, `GET /healthz`, 3 MB request cap, 256 KB response cap, candidate/evidence response model, non-root container, and no fetcher/browser/DNS/redirect/asset-loading code.
- Narrow TypeScript adapter behind `LOTSOCIAL_SCRAPLING_ENABLED=false`; tracking queries, cookies, credentials, and customer data are not forwarded.
- Existing direct/Bright Data/listing order preserved. Scrapling is invoked only when supplied HTML fails the current parser; TypeScript remains the final VIN, page-type, challenge, field-evidence, image, and source-fidelity validator.
- Safe fallthrough on disabled/missing configuration, timeout, non-2xx, malformed JSON, oversized response, schema mismatch, private source URL, evidence failure, and VIN conflict.
- ADR, operations/rollback documentation, frozen-corpus schema, baseline runner, three-run pilot benchmark harness, and machine-readable gap result.

## Exact proof

| Command/check | Result |
|---|---|
| `python -m unittest discover -s services/scrapling-parser/tests -v` | PASS — 9/9 |
| `node --test tests/scrapling-parser-adapter.test.mjs` | PASS — 7/7 |
| Local HTTP health + authenticated extraction smoke | PASS — correct version and exact VIN |
| `python -m pip check` | PASS — no broken requirements |
| `pnpm test` | PASS — build, 33/33 Node behavior tests, bootstrap/schema checks, drift check, lint 0 errors (5 pre-existing warnings) |
| `python services/scrapling-parser/benchmark.py` | Exit 2 — `REVISION_NEEDED`, frozen corpus incomplete |

## Benchmark gap

The approved Drive specification and Relay row 1215 supplied no saved HTML fixtures or verified expected-value manifest. Available corpus: **0/50 positive VDPs and 0/10 negative controls**. Missing: **50 positives and 10 negatives**. The harness refused to invent expected values and wrote the exact result to `benchmarks/scrapling-vdp/latest-results.json`.

Therefore the required acceptance, field-accuracy, VIN-fidelity, negative-control, incremental-lift, three-run determinism, and comparative-latency gates cannot be scored. Adaptive-selector value is also unproven until a verified corpus supplies safe selector history. End-to-end p95 under 36 seconds remains unproven without that identical frozen corpus and the production-equivalent access path.

## Recommendation

**REVISION_NEEDED**, not GO and not NO-GO. The architecture and security implementation pass every test that is independent of the corpus. Supply and independently verify the scrubbed 50-positive/10-negative frozen corpus, then run the committed harness unchanged. No production deployment, hosting spend, public claim, Bright Data replacement, or Phase 2 browser capability is warranted before those gates pass.
