# LotSocial Hardening Cycle — PLAN (Clarity Break, 2026-08-28)

Core Focus: **Secure and stabilize the live VDP-to-video product that salespeople are testing right now — no new features, no weakened compliance copy.**

Scope ruling (Joe, 2026-08-28): Phase 0 gamification (Claim the Sale, Standings, Rising Star, Hall of Fame) is DEFERRED until a real user database exists; current auth is email-header identity only. This cycle is hardening only.

Standing constraints for every rock:
- The compliance assets are untouchable: facts allowlist, "price when captured" wording, 7-day ad expiry line, flavor-mode puffery boundary.
- No deploy to the live site without Joe's approval (existing operating model). Build and prove on branch.
- No new runtime dependencies without naming them in the rock report. Dev-dependencies for testing are expected in Rock 1.
- Tests introduced by a rock are behavior tests. No source-text grepping.

---

## Rock 1 — Lock the front door (I-01, I-02, I-03)

**What:** (a) Auth provenance: requests must provably originate from the OpenAI Sites proxy — verify whatever signal the platform provides (signed header, known ingress) and reject direct-origin requests carrying `oai-authenticated-user-email`; document the verified mechanism in the code. (b) Rate limits: per-associate daily caps on `/api/vdp-imports` POST (imports/day) and `/api/authorization-requests` POST (requests/day, plus per-manager-address cap) backed by a D1 counter table; over-cap returns 429 with honest copy. (c) Bootstrap the behavior-test harness (worker-level test runner able to invoke routes with fake env bindings) — first rock pays the setup cost, later rocks reuse it.

**Files:** `app/chatgpt-auth.ts`, `worker/index.ts`, `app/api/vdp-imports/route.ts`, `app/api/authorization-requests/route.ts`, new `app/lib/limits.ts`, new `tests/auth-boundary.test.mjs`, `tests/rate-limits.test.mjs`.

**Done looks like:** a forged `oai-authenticated-user-email` on a direct request gets 401; a legitimate proxied request passes; the 4th-over-cap import in a day gets 429; caps are per-associate, not global.

**Proof:** `node --test tests/auth-boundary.test.mjs tests/rate-limits.test.mjs`

## Rock 2 — Un-poison persistence (I-08, I-09, I-10, I-11)

**What:** (a) `schemaReady` failure no longer sticks: a rejected init clears the cached promise so the next request retries (all three copies of the pattern, or better: one shared `ensureSchema` helper). (b) Declare drizzle migrations the single schema authority: runtime `CREATE TABLE IF NOT EXISTS` blocks become a thin bootstrap that matches generated migrations, with a checked-in note on which is authoritative and a `db:generate` diff check. (c) Delete route becomes one `db.batch` (atomic), same scoping. (d) `sourceUrlVariants` also normalizes tracking params (`utm_*`, `gclid`, `fbclid`) and lowercases host.

**Files:** `app/lib/vdp.ts`, `app/lib/authorization.ts`, `app/lib/creative.ts`, new `app/lib/schema-bootstrap.ts`, `app/api/vdp-imports/delete/route.ts`, `db/schema.ts` + generated migration, new `tests/persistence.test.mjs`.

**Done looks like:** simulated first-init failure recovers on the next call; delete is atomic; a `?utm_source=x` variant of an imported URL reuses the existing row.

**Proof:** `node --test tests/persistence.test.mjs`

## Rock 3 — Import telemetry and spend control (I-14, I-02-cost, I-15, I-05)

**What:** (a) `import_outcomes` table: one row per import attempt — host, outcome (direct_ok / brightdata_ok / listing_ok / failed_*), elapsed ms, which fallback fired, BD used yes/no. (b) Bright Data circuit: per-associate daily BD budget and a global daily cap; at cap, skip BD (log `skipped_budget`) and fall through to the listing path with honest user-facing copy. (c) A minimal `/api/ops/import-health` endpoint (ENFORCEMENT_API_KEY-gated) returning last-7-day success rates by host and BD usage counts — the thing Gene's daily sweep can actually read. (d) `.env.example` completed with every secret the code reads.

**Files:** `app/lib/vdp.ts`, new `app/lib/telemetry.ts`, new `app/api/ops/import-health/route.ts`, `.env.example`, new `tests/telemetry.test.mjs`.

**Done looks like:** every import writes exactly one outcome row; BD stops at budget and the import still tries the free path; the health endpoint reports rates by host.

**Proof:** `node --test tests/telemetry.test.mjs`

## Rock 4 — Honest authorization state machine (I-06, I-04)

**What:** Make the pipeline reachable end-to-end without inventing new product: manager approval transitions the record to `active` directly (provider verification remains an optional strengthening step that annotates but does not gate), `evaluateAuthorization` evaluates against states that actually occur, UI copy tells the truth about what enables access, and the decided approval token expires for management use after a set window (management then requires a fresh emailed link). No new features — the door either opens or the promise of the door is removed.

**Files:** `app/lib/authorization.ts`, `app/components/AuthorizationApp.tsx` (copy + status maps only), `app/api/authorization-requests/[token]/decision/route.ts`, `app/api/authorization-requests/[token]/management/route.ts`, new `tests/authorization-flow.test.mjs`.

**Done looks like:** approve → enforcement check for an approved permission returns allowed; revoke/suspend/expiry each deny with the right reason; no UI string references a state the code cannot reach.

**Proof:** `node --test tests/authorization-flow.test.mjs`

## Rock 5 — Real extractor tests + CI that guards main (I-12, I-13, I-07, I-18)

**What:** (a) Export the parsers for testability and build a fixture suite: a JSON-LD VDP, a meta/regex-only VDP, a Cloudflare challenge page, a Dealer Inspire inventory markdown with TWO vehicles adjacent (locks the wrong-neighbor price bug with a failing-then-fixed test — constrain field extraction to the matched vehicle's block), a no-VIN URL. (b) Replace the make allowlist with a slug heuristic that doesn't skip unlisted brands. (c) Delete the source-grep tests; port their intent to behavior tests. (d) CI workflow runs the full suite on push/PR to `main`.

**Files:** `app/lib/vdp.ts` (export + neighbor-block fix + allowlist), `tests/extractor.test.mjs`, delete/replace `tests/inventory-hardening.test.mjs` + `tests/rendered-html.test.mjs` equivalents, `.github/workflows/` (main-guarding workflow).

**Done looks like:** the two-vehicle fixture yields the correct vehicle's price or empty (never the neighbor's); a Ram/Jeep URL still generates candidate paths; CI is green on main and red when any rock's test breaks.

**Proof:** `npm test` (build + full `node --test tests/*.test.mjs`)

---

Dependency order: 1 → 2 → 3 → 4 → 5 (harness from R1 reused throughout; telemetry table rides R2's migration authority; R4/R5 independent of each other).

Out of scope this cycle (→ ISSUES.md stays the record): Phase 0 gamification (I-21, Joe-deferred), UI decomposition (I-17), vdp.ts module split beyond testability exports (I-16), repo identity cleanup (I-20), helper dedupe (I-19).
