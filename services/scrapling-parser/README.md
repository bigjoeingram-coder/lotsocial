# LotSocial Scrapling parser

Internal Phase 1 candidate parser. It accepts supplied HTML, uses Scrapling 0.4.15 selectors locally, and returns structured vehicle candidates plus field evidence. It contains no URL fetcher, JavaScript runtime, browser, DNS call, redirect handler, or persistent storage.

The TypeScript LotSocial pipeline remains the final validator. See `docs/adr/ADR-0001-scrapling-parsing-sidecar.md` and `docs/scrapling-pilot-operations.md`.
