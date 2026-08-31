# RF-STATUS — LotSocial Hardening Cycle

**Updated:** 2026-08-29 ~20:15 PDT
**Branch:** `rf/clarity-break-2026-08-28` @ `699ed92`
**Rock 1:** committed. **I-22:** repair built and proven; live database untouched.

---

## Committed this session

| Commit | What |
|---|---|
| `3c2a8d1` | Rock 1 — schema authority, a harness that runs, enforced CI |
| `699ed92` | I-22 — prove the nullable-PK gap and build the repair |

Working tree is clean apart from this file.

---

## Rock 1 — done

Built by Codex, Level 10 reviewed by Fable across two fix rounds, proof verified
independently on 08-28 and again on 08-29 before committing.

- `npm test` — build clean, **16/16 pass**, both schema guards pass, lint 0 errors
- Drift check genuinely fails when probed with an injected schema change
- Tier 2 boots the built worker under Miniflare and serves real fetches
- No test reads source text; compliance assets untouched
- Both Level 10 watch-items closed (`media.ts`/`rendering.ts` by Fable; the
  module-scoped env stash here — latent, not a live cross-request bleed, because
  what is stashed is per-isolate `env` and every call site passes it explicitly)

**Carried into Rock 2:** flip `env?` to required and delete
`bindLotSocialEnvironment` while Rock 2 is already rewriting every route.

---

## I-22 — what is fixed and what is not

**Fixed (in the repo, proven):**
- `scripts/i22-generate-repair.mjs` derives the rebuild from
  `SCHEMA_BOOTSTRAP_SQL`, so the repair cannot drift from the schema authority.
- `drizzle/repair/i22-enforce-pk-not-null.sql` — generated, checked in for
  review, deliberately outside `drizzle/` so `db:check` stays green.
- `scripts/i22-check-schema.mjs` — read-only audit of a live schema dump.
  Needs no deploy, so the live database can be diagnosed before any decision.
- `tests/schema-repair.test.mjs` — 5 tests on real SQLite proving the legacy
  schema accepts a NULL id, the repair enforces NOT NULL while preserving rows
  and indexes, and the repair fails loudly rather than silently dropping rows if
  NULL ids already exist.

**Two corrections to the original finding:**
- **Five columns, not six.** `authorization_audit_events.id` is
  `INTEGER PRIMARY KEY AUTOINCREMENT` — the rowid alias, which cannot hold NULL.
  Proven by test, not assumed.
- **Lower severity than MED-HIGH.** Every insert path uses
  `crypto.randomUUID()`, so no application code can write a NULL id. This is an
  unenforced constraint, not known corruption.

**NOT fixed — needs Joe.** This repo has no `wrangler.toml` and no D1
credentials; the binding lives on the Sites platform. The live database has not
been read, verified, or altered. Runbook on ISSUES.md under I-22:

1. Dump `SELECT name, sql FROM sqlite_master WHERE type='table'` from live D1,
   run it through `scripts/i22-check-schema.mjs`. This confirms whether the
   deployed schema is affected at all — it may not be.
2. If affected, run `SELECT COUNT(*) FROM <table> WHERE <column> IS NULL` per
   table. Any non-zero count is real bad data and must be resolved first.
3. Export a D1 backup.
4. Apply the repair SQL as a single batch.

Steps 3 and 4 are destructive and are Joe's call.

---

## Next

- **Rock 2 — Lock the front door** (I-01/02/03): single `requireAssociate()`
  choke point, host pinning, associate allowlist, atomic per-associate rate
  limits, manager-domain policy, `.env.example`. Fold in the env-stash cleanup.
- **Rocks 3 → 6** in dependency order (2 precedes 4; 4 reuses 2's counter).
- **I-22 live verification** whenever Joe has D1 access to hand.

## Accepted nit

`tests/harness.mjs` carries a hardcoded
`node_modules/.pnpm/miniflare@4.20260515.0/...` fallback path that rots on a
version bump. Dead code while miniflare is a direct devDependency.
