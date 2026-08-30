# LotSocial — State of the Company (Clarity Break, 2026-08-28)

Auditor: Fable (Visionary seat). Repo at commit c63240a. Live context: semi-live on ChatGPT Sites, real salespeople testing.

Format: one issue per line, [impact] — issue → why it matters.

## Security & money

- [HIGH] I-01 — `getChatGPTUser` trusts the `oai-authenticated-user-email` header with no proof the request came through OpenAI's proxy → if the worker is reachable at any direct URL (workers.dev or custom route), anyone can set that header and read/write/delete any associate's inventory, projects, and authorizations. Verify platform provenance or block direct routes.
- [HIGH] I-02 — No rate limit or quota on `/api/vdp-imports` POST → each blocked import fires up to 6 external reader fetches plus a PAID Bright Data request; one eager tester or a loop burns real spend with zero cap or alert.
- [MED-HIGH] I-03 — `/api/authorization-requests` POST sends email to any attacker-typed `managerEmail` with attacker-controlled names via Resend → signed-in user can use LotSocial as a spam cannon; hits sender reputation. No rate limit, no domain sanity check.
- [MED] I-04 — Manager approval token never expires and doubles as the permanent management credential (`manageAuthorization` by token) → a forwarded or breached inbox controls the authorization forever. Add token expiry/rotation on decision.
- [LOW] I-05 — `.env.example` omits BRIGHTDATA_API_KEY/BRIGHTDATA_ZONE/SHOTSTACK_API_KEY/SHOTSTACK_STAGE → env drift between devs/deploys is invisible until a silent fallback fires.

## Correctness & the dead state machine

- [HIGH] I-06 — Nothing in the codebase ever sets an authorization to status `active`, but `evaluateAuthorization` requires exactly `active` and the UI promises "enforcement will deny until Active" → the entire manager→provider→enforcement pipeline is a road to a door that never opens. Either build the activation transition or cut the flow to what's real (do less better).
- [MED-HIGH] I-07 — Dealer Inspire listing-guess fallback parses ±5000 chars around VIN evidence on multi-vehicle inventory pages → price/mileage regexes can capture the NEIGHBORING vehicle's numbers; a salesperson publishes a wrong price with LotSocial's name on the video. Compliance-grade risk given real users.
- [MED] I-08 — Module-level `schemaReady` caches a FAILED promise forever (vdp, authorization, creative all copy the pattern) → one transient D1 error poisons every subsequent request until redeploy. Reset on rejection.
- [MED] I-09 — Runtime `CREATE TABLE IF NOT EXISTS` in three libs competes with drizzle migrations in `drizzle/` as a second source of schema truth → drift between environments is undetectable; migrations exist but aren't the authority.
- [MED-LOW] I-10 — Delete route runs sequential per-project deletes with no transaction (D1 `batch` exists, unused) → a mid-flight failure leaves orphaned render jobs the code specifically claims to prevent.
- [LOW] I-11 — `sourceUrlVariants` only toggles trailing slash → same VDP with ?utm params or case differences imports as a duplicate row despite the UNIQUE constraint's intent.

## Process & proof

- [HIGH] I-12 — Both test files assert regex matches against SOURCE TEXT, not behavior (`assert.match(deleteRoute, /DELETE FROM/)`) → the proof passes while the feature can be completely broken; this is the "proof that lies" anti-pattern, institutionalized.
- [MED-HIGH] I-13 — CI triggers only on a stale feature branch (`build/delete-and-draft-revalidation`) plus narrow PR paths → pushes to main ship untested; the extractor (highest-churn, highest-risk file) has zero coverage of any kind.
- [MED] I-14 — No import outcome telemetry beyond console.warn → with salespeople live, nobody knows the import success rate, which dealer hosts fail, or when Bright Data starts eating money. Failures are discovered by user complaint (the scavenger-hunt pattern already ruled against in INGRAM OS).

## Fragility & debt

- [MED] I-15 — Extraction chain leans on free unauthenticated r.jina.ai (including an intentionally nested double-reader hack) → third-party rate limits or a jina change silently kill the fallback with no signal.
- [MED] I-16 — `app/lib/vdp.ts` (628 lines) mixes URL validation, three fetch strategies, two parsers, persistence, and serialization → god module; every extractor tweak risks persistence, and it's the file that changes most.
- [MED] I-17 — `AuthorizationApp.tsx` is a 759-line client component with 38 useState hooks and 9 inline fetch flows → any UI change risks every UI feature; split by view.
- [MED-LOW] I-18 — Hardcoded 23-make allowlist inside `candidateInventoryPaths` → fallback silently skips model-path guessing for any brand not on the list (no Ram trucks, no Jeep, no Chrysler, no Dodge — in a dealership app).
- [LOW] I-19 — `vehicleName`/price-formatting logic duplicated across creative.ts and rendering.ts; `seed`/`vibeSeed` computed twice identically in createCopy → divergence bugs waiting.
- [LOW] I-20 — Repo identity is still the starter's: package name `site-creator-vinext-starter`, starter README, leftover `examples/d1/` → onboarding confusion, and the README documents a different product.
- [CLARIFY] I-21 — Phase 0 spec features (Claim the Sale, Standings, Rising Star, Hall of Fame) are entirely absent from the codebase → is this cycle about hardening what's live, or resuming the spec? Changes what the rocks are.

## Found during the build (added after the audit)

- [MED-HIGH] I-22 — The live D1 database was created by the runtime `CREATE TABLE IF NOT EXISTS` bootstrap, not by the drizzle migrations, and the two declared DIFFERENT schemas: six primary key columns (`authorization_audit_events.id`, `authorization_requests.id`, `creative_projects.id`, `creative_render_jobs.id`, `imported_vehicles.id`, `provider_verifications.request_id`) were `PRIMARY KEY` in the bootstrap but `PRIMARY KEY NOT NULL` in the migrations, and SQLite genuinely allows NULL in a TEXT PRIMARY KEY column. Rock 1 corrected the bootstrap and added `npm run db:bootstrap-check` to keep them in lockstep, but `CREATE TABLE IF NOT EXISTS` cannot alter a table that already exists → the deployed database very likely still carries the nullable-id variant. This is I-09 confirmed as an actual divergence rather than a hypothetical one. Needs a real migration path plus a deploy-time verification of the live schema; not fixable from the bootstrap. Discovered 2026-08-28 by the bootstrap-vs-migrations check on its first run.
  - **2026-08-29 — repair built and proven; live database NOT yet verified or repaired.** Two refinements to the finding. (1) It is **five** columns, not six: `authorization_audit_events.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`, which is the SQLite rowid alias and cannot store NULL — proven by test, not assumed, so that table needs no repair. (2) Severity in practice is lower than MED-HIGH: every insert path generates its id with `crypto.randomUUID()`, so no application code can write a NULL id. This is an **unenforced constraint**, not known data corruption. Delivered: `scripts/i22-check-schema.mjs` (read-only audit of a live schema dump — needs no deploy), `drizzle/repair/i22-enforce-pk-not-null.sql` (generated from `SCHEMA_BOOTSTRAP_SQL` by `scripts/i22-generate-repair.mjs`, so it cannot drift from the authority), and `tests/schema-repair.test.mjs` (5 tests on real SQLite: proves the legacy schema accepts a NULL id, proves the repair enforces NOT NULL and preserves rows and indexes, and proves the repair fails loudly rather than silently dropping rows if NULL ids already exist).
  - **Still open, and requires Joe.** This repo has no `wrangler.toml` and no D1 credentials — the binding and deploy config live on the Sites platform — so the live database cannot be read or altered from here. Runbook: (a) dump `SELECT name, sql FROM sqlite_master WHERE type='table'` from the live D1 and run it through `scripts/i22-check-schema.mjs` to confirm whether the deployed schema is actually affected; (b) if it is, run `SELECT COUNT(*) FROM <table> WHERE <column> IS NULL` per affected table — any non-zero count is real bad data and must be resolved before the rebuild; (c) export a D1 backup; (d) apply the repair SQL as a single batch. Steps (c) and (d) are destructive and are Joe's call, not automated.

## Assets worth protecting (not issues)

- Compliance discipline in copy: facts allowlist, "price when captured" wording, 7-day ad expiry line, flavor mode constrained to puffery — this is the product's moat; no rock may weaken it.
- Bright Data branch logging with credential redaction; token hashing at rest; SSRF guard on VDP URLs; per-associate scoping on every query.
