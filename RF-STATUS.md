# RF-STATUS — LotSocial Hardening Cycle

**Updated:** 2026-11-02
**Verified against:** `origin/main` @ `949f21f`
**Cycle status:** **COMPLETE — all six rocks built and landed in `main`.**

---

## Verdict

Every rock from PLAN.md r4 was built, and all six are in `main`.

| Rock | Scope | Landed in `main` as | Date |
|---|---|---|---|
| 1 | Foundation: schema authority, two-tier harness, enforced CI | `3c2a8d1` Rock 1: schema authority, a harness that runs, enforced CI | 08-29 |
| 2 | Lock the front door (I-01, I-02, I-03) | `13ce65c` Rock 2: lock the front door | 08-31 |
| 3 | Un-poison persistence (I-08, I-10, I-11) | `d9bf358` Rock 3: harden persistence recovery and URL identity | 09-12 |
| 4 | Import telemetry + spend control (I-14, I-02-cost, I-15, I-05) | `e1572a2` Complete closed customer pilot hardening | 09-13 |
| 5 | Honest authorization state machine (I-06, I-04) | `e1572a2` (same commit) | 09-13 |
| 6 | Real extractor tests (I-07, I-18) | `7ea76dd` Rock 6: real extractor tests | 09-10 |

Rocks 4 and 5 landed folded into a pilot-hardening commit rather than under their own
names, which is why searching commit messages for "Rock 4" / "Rock 5" finds them only on
abandoned branches.

Rock 6 landed before Rock 3. PLAN permitted this: "Rocks 3–6 are independent of each
other and could reorder if a rock stalls."

### How this was verified

Commit-ancestry checks are **misleading here** and should not be repeated as the test.
`git merge-base --is-ancestor` reports Rocks 3, 4 and 5 as absent from `main`, because the
work landed via squash/rebase under different commits. The decisive test is whether each
rock's artifacts exist in the tree:

- Rock 1 → `app/lib/schema-bootstrap.ts`, `scripts/check-bootstrap-schema.mjs`
- Rock 2 → `app/lib/limits.ts`, `tests/auth-boundary.test.mjs`, `tests/rate-limits.test.mjs`
- Rock 3 → `tests/persistence.test.mjs`
- Rock 4 → `app/lib/telemetry.ts`, `app/api/ops/import-health/route.ts`, `tests/telemetry.test.mjs`
- Rock 5 → `tests/authorization-flow.test.mjs`, `app/api/authorization-details/[id]/manager-link/route.ts`, the `authorization_management_links` table
- Rock 6 → `tests/extractor.test.mjs`

All present on `origin/main`.

---

## Proof state on `main`

`npm test` still runs the full Rock 1 gate:

```
npm run build && node --test tests/*.test.mjs && npm run db:bootstrap-check && npm run db:check && npm run lint
```

The suite is now 17 test files, up from 2 source-grep fakes at the start of the cycle.
Every rock's proof is in it: `persistence`, `telemetry`, `authorization-flow`, `extractor`,
`rate-limits`, `auth-boundary`, `schema-repair`, plus the pilot-era behaviour tests.

**Not re-run by this status pass.** This update verified tree contents and history, not a
fresh test execution. Run `npm test` on `main` before treating the suite as green today.

---

## Rock 5 — implemented better than specified

PLAN called for "a token-expiry column in the migration and a re-issue path." `main`
implements the expiry as a **dedicated `authorization_management_links` table** with
`expires_at NOT NULL` and `authorization_management_links_expiry_idx`, plus
`manager-link/route.ts` as the re-issue path. A separate table is the stronger design;
the promise that a decision token stops doubling as a permanent management credential is
kept, not half-built.

---

## Verified against the live deployment — 2026-11-06

First live verification of this cycle. Run by Joe at
`lotsocial-authorization.salesgenius.chatgpt.site` on an already-imported vehicle.

**`creative_render_jobs.storage_key` EXISTS in the live D1. Risk closed.**

A Fast Cuts 9:16 render (30s, 9 shots + end card) completed and reported
`Storage: Saved permanently`. That label is driven by `renderJob.stored`, which is
`Boolean(record.storage_key)` in `serializeRenderJob` and rendered at
`app/components/AuthorizationApp.tsx:883`. For it to read true, three things had to
succeed in production: `archiveRenderedVideo` wrote the MP4 to R2, `updateRenderJob`
(`app/lib/creative.ts`) executed its `UPDATE ... SET storage_key = ?` without throwing,
and the value persisted. So `drizzle/0006_goofy_blob.sql` — the only `ALTER TABLE` in the
migration history, which added that column on 2026-07-22 — did reach the live table.

This retires the open concern recorded on 2026-08-31 that the column might be missing.

**What this does NOT prove — do not conflate the two.** It says nothing about I-22. That
finding is about five TEXT primary key columns lacking `NOT NULL`, which this render never
touched. There is still no SQL surface on Sites to read that schema. I-22 stays open below.

**How a missing column would have presented, for the record.** Not as a visible error.
`app/lib/creative-render-handler.ts:114-138` wraps the status refresh in a try/catch, with
a second catch around the archive step at line 123. A throw from `updateRenderJob` is
swallowed by the outer catch, which returns the job *unchanged*. The symptom would have
been a render that never advanced past "Rendering" no matter how often status was checked
— not an error message. Worth knowing before diagnosing a stuck render as slow.

**Latency observation, no baseline.** Joe reported the render "took way too long." No
timing instrumentation exists on this path, so there is nothing to compare it against.
Recorded as an observation, not a defect.

---

## Still open

**I-22 — the live D1 may still carry nullable primary keys.** Unchanged since August. The
repair is built and proven (`drizzle/repair/i22-enforce-pk-not-null.sql`,
`scripts/i22-check-schema.mjs`, `tests/schema-repair.test.mjs`) but has never been applied,
because the Sites console exposes no SQL surface to inspect the live schema. Five TEXT
primary key columns; severity MED, not MED-HIGH, because every insert path uses
`crypto.randomUUID()` and no code path can write a NULL id. It is an unenforced constraint,
not known corruption.

**VDP import is failing on new-vehicle pages — found live 2026-11-06.** Two imports from
two unrelated dealerships both failed with the same message: "This store blocks the direct
page and no matching public inventory listing was found."

- `landrovercerritos.com/inventory/2027-land-rover-range-rover-sport-...`
- `normreevesford.com/inventory/new-2026-ford-maverick-lobo%e2%84%a2-...`

The message is not accurate. An independent fetch of `landrovercerritos.com/inventory/`
returned HTTP 200 with 75,766 characters of real inventory markup on a basic proxy, so the
store does not block readers outright. Two candidate causes, which the current error text
cannot distinguish:

1. **New vs used.** Both vehicles are new (the Ford URL says `new-` in the path; the Land
   Rover is a 2027). On that Land Rover site `/inventory/` redirects to `/used-vehicles/`,
   a pre-owned-only catalog of 79 vehicles. Neither the VIN fragment `sal1l9e9xva675` nor
   the trim `p530` appears in it. The listing fallback may be searching a catalog that
   structurally cannot contain a new car.
2. **Encoded entities in the URL.** The Ford path carries `%e2%84%a2` and `%c2%ae` — an
   encoded trademark and registered symbol.

This is I-14 in practice: with no import outcome telemetry surfaced, one generic string
covers every failure mode and the cause is unknowable from the UI. Rock 4's
`/api/ops/import-health` plus the `import_outcomes` table (`source_host`, `outcome`,
`fallback`, `bright_data_used`, `notice`, 7-day window) is the instrument that would answer
this, gated by a bearer token against `ENFORCEMENT_API_KEY`. It returns 503 when that key
is unset, which makes it a cheap first check.

Not yet tested: whether a *used* vehicle from the same dealer imports successfully. That is
the controlled experiment that would confirm or kill cause 1.

**Platform decision stands: Sites is a staging surface, not a production home.** The
control gate run on 2026-08-31 returned 1 pass (env vars / secrets) and 7 fails (database
identity, schema inspection, backup/export, controlled migration, production verification,
rollback, portable egress). The exit path, if taken, is direct Cloudflare under Joe's own
account — not Lovable — because the code is already Cloudflare-shaped (`wrangler`,
`miniflare`, `cloudflare:workers`, D1, R2). If the cutover happens, data imports into a
fresh D1 built from corrected migrations and I-22 dissolves on its own.

---

## Branch cleanup — done 2026-11-04 through 11-06

Six superseded branches were deleted from `origin` on 2026-11-04 on Joe's explicit
instruction. Each tip was tagged `archive/<branch-name>` and the tags were confirmed
present on `origin` **before** any branch was deleted, so nothing is unrecoverable.

| Deleted branch | Archive tag | Tip |
|---|---|---|
| `rf/rock-3-persistence` | `archive/rf/rock-3-persistence` | `65db9f0` |
| `build/delete-and-draft-revalidation` | `archive/build/delete-and-draft-revalidation` | `c63240a` |
| `cody-identity` | `archive/cody-identity` | `e82f52e` |
| `rf/clarity-break-2026-08-28` | `archive/rf/clarity-break-2026-08-28` | `3a5a8cc` |
| `rf/complete-rocks-3-5-cloudflare` | `archive/rf/complete-rocks-3-5-cloudflare` | `035640c` |
| `rf/rock-6-extractor-tests` | `archive/rf/rock-6-extractor-tests` | `a94a285` |

Each was verified strictly behind `main` by content diff before deletion (8,500–11,000
deletions relative to `main` — i.e. `main` carries far more). Their rock content had
already reached `main` under other commits. The one unique fix on
`rf/rock-6-extractor-tests` — dropping `mini` from `TWO_WORD_MAKES` — was confirmed
already present in `main` at `3e9c091`.

Restore any of them with:

```
git push origin archive/<branch-name>:refs/heads/<branch-name>
```

That command is also written into each tag's own annotation, so it survives this file.

Three more were removed after that batch, bringing the total to nine. Remote went from 17
branches to 10.

| Deleted branch | Archive tag | Tip | When |
|---|---|---|---|
| `docs/rf-status-2026-11-02` | `archive/docs/rf-status-2026-11-02` | `c04dfe4` | 11-05, after PR #14 |
| `chore/drop-deleted-ci-base-branch` | none | `54afc70` | 11-06, after PR #15 |
| `docs/scrapling-pilot-memory` | none | `462fbe9` | 11-06, after PR #16 |

The last two were deleted through GitHub's post-merge button, which does not create a tag.
Nothing is lost: both tips are ancestors of `main`, so the commits are permanent regardless
of the branches. Seven `archive/*` tags exist in total.

**Kept, deliberately:** `pilot/scrapling-vdp-reliability-phase1` (`e45c08f`) carries
`SCRAPLING-PILOT-REPORT.md`, `docs/adr/ADR-0001-scrapling-parsing-sidecar.md` and
`benchmarks/scrapling-vdp/`. That is a documented, deliberately rejected experiment and is
institutional memory, not dead code. It was not touched.

Its decision record now **is** on `main` as of PR #16 — `SCRAPLING-PILOT-REPORT.md`,
`docs/adr/ADR-0001-scrapling-parsing-sidecar.md`, `docs/scrapling-pilot-operations.md` and
`benchmarks/scrapling-vdp/`. The implementation was deliberately left off: the branch is
11,624 deletions against current `main` and would remove most of today's test suite, so it
must never be merged. The precondition for retiring the branch is therefore satisfied, but
deleting it remains Joe's call.
