# LotSocial Hardening Cycle — PLAN (Clarity Break, 2026-08-28)

Core Focus: **Secure and stabilize the live VDP-to-video product that salespeople are testing right now — no new features, no weakened compliance copy.**

Scope ruling (Joe, 2026-08-28): Phase 0 gamification (Claim the Sale, Standings, Rising Star, Hall of Fame) is DEFERRED until a real user database exists; current auth is email-header identity only. This cycle is hardening only.

Revision r2 (Same Page Meeting round 1): the foundation work — schema authority, a test harness that can actually run, and CI that enforces it — was split out of Rocks 1/2/5 into its own Rock 1, because every other rock's proof is a lie without it. Rock 5's activation model was rewritten after Codex correctly flagged that the original weakened the provider-rights promise. Six rocks, still dependency-ordered.

Standing constraints for every rock:
- The compliance assets are untouchable: facts allowlist, "price when captured" wording, 7-day ad expiry line, flavor-mode puffery boundary, and the provider-rights promise in `authorization-shared.ts`.
- No deploy to the live site without Joe's approval (existing operating model). Build and prove on branch. "Green on main" is never a rock's proof; local `npm test` plus a correctly-targeted workflow file is.
- No new runtime dependencies without naming them in the rock report. Dev-dependencies for testing are expected in Rock 1.
- Tests introduced by a rock are behavior tests. No source-text grepping — that is the anti-pattern this cycle exists to kill.

**Known-unknown carried into deployment (not a build task):** the platform documents no signed or verifiable provenance signal — `README.md` describes `oai-authenticated-user-email` and the two full-name headers as plaintext, with no signature and no shared secret. Identity is therefore trusted-by-topology. Rock 2 is built to be correct in both worlds (direct URL reachable or not) and to be a one-line change on the day the platform ships a signed signal. Joe should confirm at deploy whether the worker answers on any hostname other than the Sites one.

---

## Rock 1 — Foundation: schema authority, a harness that runs, CI that enforces (I-09, I-12, I-13)

**What:** (a) Drizzle migrations become the single schema authority: the runtime `CREATE TABLE IF NOT EXISTS` blocks in `vdp.ts` / `authorization.ts` / `creative.ts` collapse into one shared bootstrap that provably matches the generated migrations, with a drift check that fails when `db/schema.ts` and `drizzle/` disagree. The check is specified exactly, because a check that regenerates and then passes is worthless: `npm run db:check` snapshots the contents of `drizzle/`, runs `drizzle-kit generate`, and fails if generation produced any new or changed file. It compares before-and-after around its own run rather than against git, so it is correct from a dirty tree — a rock that legitimately adds a migration still passes, while a `db/schema.ts` edit whose migration was never generated fails. Drift is "the generator would produce something different", not "the working tree is dirty". Every later rock adds its tables here first. (b) Two-tier test harness, because app-router route files cannot be imported under `node --test` (they pull `next/headers`, vinext `virtual:` modules, and `cloudflare:workers`): **Tier 1** — route bodies move into pure, env-injectable handlers under `app/lib/` that take `(request, env, ctx)` and return a `Response`, with the route file left as a thin adapter; these test under plain `node --test`. **Tier 2** — one worker-level integration path for the things only the edge can prove (first consumer: Rock 2's auth boundary, which is about what the edge does with a header and cannot be proven by a Tier-1 unit test). Mechanism is the Integrator's call — `wrangler`'s programmatic dev/miniflare API is already a devDependency and is the obvious candidate, but it has not been verified working in this repo. **Tier 2 is mandatory, not best-effort.** Rock 2's auth boundary is the highest-severity issue in the audit and a Tier-1 unit test of a host-pinning helper does not prove the edge rejects a forged header. If Tier 2 cannot be made to work, that is a `BLOCKED:` report back to the Visionary — not a completed rock with a caveat. There is no fallback that still counts as done. (c) `npm test` runs the real suite, not one file: build + `node --test tests/*.test.mjs` + `npm run db:check` + `npm run lint` — lint is inside the test command because a guard nothing runs is not a guard, and Rock 2's choke-point rule depends on it. The two source-grep test files are deleted and their intent ported to behavior tests. (d) CI workflow triggers on push/PR to `main` (the current one triggers on a stale feature branch) and runs that same `npm test`, so CI and local prove the identical thing.

**Files:** `app/lib/schema-bootstrap.ts` (new), `app/lib/vdp.ts`, `app/lib/authorization.ts`, `app/lib/creative.ts`, `db/schema.ts` + generated migration, `package.json` (scripts + dev deps), `tests/harness.mjs` (new), delete `tests/inventory-hardening.test.mjs` and `tests/rendered-html.test.mjs` (port intent), `.github/workflows/`.

**Done looks like:** an intentionally-introduced drift between `db/schema.ts` and `drizzle/` fails the drift check; a Tier-1 handler can be invoked with a fake D1 binding and returns a real `Response`; Tier 2 can boot the worker and issue a request; `npm test` runs everything and no test asserts on source text.

**Proof:** `npm test` (build + `node --test tests/*.test.mjs` + `npm run db:check` + `npm run lint`), and the deleted grep-tests are gone from the tree.

## Rock 2 — Lock the front door (I-01, I-02, I-03)

**What:** (a) One choke point: a single `requireAssociate()` is the only place any `oai-*` header is read; it fails closed, validates the email shape, pins the request to the expected Sites hostname (rejecting a forged header arriving at any other host), and checks the email against a configured associate allowlist. A comment in that function states plainly that the header is trusted-by-topology, names the absent platform signal, and marks the one line to change when a signed signal ships. Every route and page switches to it, and an ESLint `no-restricted-syntax` rule bans reading any `oai-*` header anywhere except that one function, enforced by `npm run lint` in CI — otherwise the rock's proof passes while a page added next month reads the header directly. (This is a static guard on an invariant, not a source-grep test standing in for behavior; the behavior tests below still do the proving.) (b) Rate limits: per-associate daily caps on `/api/vdp-imports` POST and `/api/authorization-requests` POST, plus a per-manager-address cap, backed by a D1 counter table declared in Rock 1's migration authority. The counter is an **atomic** `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` — never read-then-write, because the race is exactly the runaway-spend case the cap exists to stop. Over-cap returns 429 with honest copy. (c) Manager-email sanity, the half of I-03 that rate limits do not cover: a manager address outside the configured dealership domain policy is rejected (or held for manual review) rather than emailed, so the spam-cannon path is closed by policy and not only by volume. (d) `.env.example` gains every new variable this rock introduces — expected Sites hostname, associate allowlist, cap values, domain policy — in this rock, not deferred to Rock 4.

**Files:** `app/chatgpt-auth.ts`, `app/lib/limits.ts` (new), the API route handlers extracted in Rock 1, `db/schema.ts` + migration, `eslint.config.mjs`, `.env.example`, `tests/auth-boundary.test.mjs` (new, Tier 2), `tests/rate-limits.test.mjs` (new, Tier 1).

**Done looks like:** a request carrying a forged `oai-authenticated-user-email` — including an allowlisted address — at a non-Sites host gets 401 (proven at Tier 2, through the worker); a request with the same header at the Sites host for an allowlisted associate passes; a non-allowlisted email gets 401; N concurrent import requests at the cap boundary never let more than the cap through; caps are per-associate, not global; an out-of-policy manager domain is refused before any email is sent; `npm run lint` fails if `oai-` is read outside `requireAssociate()`.

**Proof:** `node --test tests/auth-boundary.test.mjs tests/rate-limits.test.mjs`

## Rock 3 — Un-poison persistence (I-08, I-10, I-11)

**What:** (a) `schemaReady` failure no longer sticks: a rejected init clears the cached promise so the next request retries — fixed once in Rock 1's shared bootstrap, not three times. (b) Delete route becomes one `db.batch` (atomic), same per-associate scoping. (c) `sourceUrlVariants` normalizes tracking params (`utm_*`, `gclid`, `fbclid`), lowercases host, and handles the trailing slash — applied on **both** lookup and insert, so the canonical form is what gets stored, not just what gets searched.

**Files:** `app/lib/schema-bootstrap.ts`, `app/lib/vdp.ts`, `app/api/vdp-imports/delete/route.ts`, `tests/persistence.test.mjs` (new).

**Done looks like:** a simulated first-init failure recovers on the next call rather than poisoning the process; a mid-batch delete failure leaves no orphaned render jobs; importing `?utm_source=x` then the bare URL reuses one row, **and** importing the bare URL then the `?utm_source=x` variant also reuses one row (both orders tested).

**Proof:** `node --test tests/persistence.test.mjs`

## Rock 4 — Import telemetry and spend control (I-14, I-02-cost, I-15, I-05)

**What:** (a) `import_outcomes` table (declared under Rock 1's migration authority): one row per import attempt — host, outcome, elapsed ms, which fallback fired, Bright Data used yes/no. (b) Bright Data circuit: per-associate daily BD budget and a global daily cap, using the same atomic counter primitive as Rock 2; at cap, skip BD (log `skipped_budget`) and fall through to the free listing path with honest user-facing copy. **This requires a signature change**, and the rock owns it: `extractVehicleFromVdp(value: string)` (`app/lib/vdp.ts:417`) currently receives only a URL, so a *per-associate* budget is unenforceable inside it. Identity and the env/counter context get threaded in from the import handler extracted in Rock 1; a budget keyed on anything other than the real associate would be a global cap wearing a per-associate label. (c) The skipped-budget notice is part of the import response contract, not just a log line — the handler returns it so the salesperson learns why a result is thinner, and the test asserts it appears on both the free-path-succeeds and free-path-fails branches. (d) `/api/ops/import-health`, ENFORCEMENT_API_KEY-gated, returning last-7-day success rates by host and BD usage counts — the thing a daily sweep can actually read. (e) `.env.example` completed with every remaining secret the code reads (auth and rate-limit vars already landed in Rock 2).

**Files:** `app/lib/vdp.ts` (signature + budget threading), the extracted VDP import handler and its route adapter, `app/lib/telemetry.ts` (new), `app/api/ops/import-health/route.ts` (new), `db/schema.ts` + migration, `.env.example`, `tests/telemetry.test.mjs` (new).

**Done looks like:** each of the six paths — direct success, Bright Data success, listing-guess success, budget skip, network timeout, parse failure — writes **exactly one** outcome row per request, with the right outcome value; at budget, BD is skipped and the import still attempts the free path; the budget counter increments for the requesting associate and not for a different one; the skipped-budget notice reaches the import response on both free-path outcomes; the health endpoint reports rates by host and rejects an unkeyed request.

**Proof:** `node --test tests/telemetry.test.mjs`

## Rock 5 — Honest authorization state machine (I-06, I-04)

**What:** Make the pipeline reachable end-to-end **without weakening the provider-rights promise.** The original draft let manager approval alone flip the record to `active`; that is wrong, because `authorization-shared.ts` promises that images, descriptions, and window stickers are used only where licensing/reuse/redistribution rights are *confirmed*, and a sales manager does not hold those rights. So activation becomes tiered by who can actually grant each permission:

- **Manager-grantable** (dealership-owned): `vehicle_facts`, `pricing`, `social_publishing`. Manager approval activates these immediately.
- **Provider-gated** (third-party rights): `images`, `descriptions`, `window_stickers`. These activate only on provider verification, and stay denied until then.

`evaluateAuthorization` evaluates per permission against states that actually occur, so an approved record genuinely allows the manager-grantable set while still denying the provider-gated set with a truthful reason. UI copy says exactly that — no string may reference a state the code cannot reach. Separately, the decision token stops doubling as a permanent management credential: it expires for management use after a set window, and management then requires a fresh emailed link, which means a token-expiry column in the migration and a re-issue path — both in scope, or the fresh-link promise gets cut rather than half-built.

**Files:** `app/lib/authorization.ts`, `app/lib/authorization-shared.ts` (permission tiering metadata only — no permission's meaning changes), `app/components/AuthorizationApp.tsx` (copy + status maps only), `app/api/authorization-requests/[token]/decision/route.ts`, `app/api/authorization-requests/[token]/management/route.ts`, `db/schema.ts` + migration, `tests/authorization-flow.test.mjs` (new).

**Done looks like:** a full **matrix test** — every permission in both tiers evaluated against every state that actually occurs (`requested`, manager-approved, `provider_pending`, `provider_verified`, `provider_declined`, suspended, revoked, expired) — with the tier invariant explicitly asserted: manager-grantable permissions stay allowed straight through `provider_pending`, `provider_verified`, and `provider_declined`, because a provider declining image rights must not silently switch off pricing. Provider-gated permissions are denied with a distinct, truthful reason in each of the unverified states. Plus: a decision link reused after decision behaves correctly; the management token works inside its window and fails outside it with a fresh-link path that works; no UI string references an unreachable state.

**Proof:** `node --test tests/authorization-flow.test.mjs`

## Rock 6 — Real extractor tests (I-07, I-18)

**What:** (a) Export the parsers for testability and build a fixture suite: a JSON-LD VDP, a meta/regex-only VDP, a Cloudflare challenge page, a Dealer Inspire inventory page with TWO vehicles adjacent — which locks the wrong-neighbor price bug with a failing-then-fixed test, constraining field extraction to the matched vehicle's block — and a no-VIN URL. (b) Replace the hardcoded 23-make allowlist with a slug heuristic that doesn't silently skip unlisted brands (today: no Ram, Jeep, Chrysler, or Dodge, in a dealership app).

**Files:** `app/lib/vdp.ts` (testability exports + neighbor-block fix + allowlist removal), `tests/extractor.test.mjs` (new).

**Done looks like:** the two-vehicle fixture yields the matched vehicle's price or empty — never the neighbor's; the Cloudflare-challenge fixture is detected as blocked rather than parsed as a vehicle; a Ram or Jeep URL still generates candidate inventory paths.

**Proof:** `node --test tests/extractor.test.mjs`

---

Dependency order: 1 → 2 → 3 → 4 → 5 → 6. Rock 1 is a hard prerequisite for all five others: it owns migration authority (every later table is declared through it) and the harness (every later proof runs on it). Rocks 3–6 are independent of each other and could reorder if a rock stalls; Rock 2's counter primitive is reused by Rock 4's budget circuit, so 2 precedes 4.

Out of scope this cycle (→ ISSUES.md stays the record): Phase 0 gamification (I-21, Joe-deferred), UI decomposition (I-17), vdp.ts module split beyond the testability extraction Rock 1 requires (I-16), repo identity cleanup (I-20), helper dedupe (I-19). Note that Rock 1's handler extraction does part of I-16's job as a side effect; the remaining god-module split stays deferred.
