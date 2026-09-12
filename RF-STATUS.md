# RF-STATUS — LotSocial Hardening Cycle

**Updated:** 2026-08-31 ~18:30 PDT
**Branch:** `rf/clarity-break-2026-08-28` @ `cbb2d7f` (in sync with origin)
**Platform:** Sites classified as STAGING by the control gate — 1 pass, 7 fails.

---

## Committed on this branch

| Commit | What |
|---|---|
| `3c2a8d1` | Rock 1 — schema authority, harness, enforced CI |
| `699ed92` | I-22 — nullable-PK gap proven, repair built (live DB untouched) |
| `4a23c5c` | RF-STATUS snapshot (subject line says Rock 1; content is status only) |
| `2154ade` | I-22 headline corrected — five columns, MED |
| `13ce65c` | Rock 2 — lock the front door (I-01, I-02, I-03) |
| `cbb2d7f` | I-22 runbook corrected — D1 is Sites-provisioned, not wrangler-reachable |

`npm test` at this tip: build clean, 26/26 pass, both schema guards pass, lint 0 errors.

**Rock 3 is NOT on this branch or any ref on this remote.** `git log --all --grep="Rock 3"`
returns nothing and the branch is in sync with origin. Whatever the cloud session
committed has not reached `github.com/bigjoeingram-coder/lotsocial`. Confirm before
assuming Rock 3 is preserved anywhere but that session's own machine.

---

## 2026-08-31 — Task 1: storage_key live test — NOT RUN (blocked)

**Blocked, not skipped.** The test requires the live Sites deployment: its URL (which
appears nowhere in this repo), an authenticated allowlisted associate session, and a
real render against Shotstack. `app/api/rendered-videos/[id]/route.ts:9` gates playback
behind `requireAssociate`, and the `oai-*` identity headers are issued by the Sites
platform. This session has none of that. It is the Q2/Q5 gap the gate documented.

### The test design changed — as originally specified it would have been ambiguous

Reading the two code paths that touch the column:

- `getRenderJob` (`creative.ts:272`) runs **`SELECT *`**. If `storage_key` is missing
  from the live table this does NOT error — it returns the columns that exist, and
  `job.storage_key` is `undefined`, so `route.ts:15` returns a soft
  **404 "That video is not available in permanent storage."**
- `updateRenderJob` (`creative.ts:263`) names the column explicitly:
  `SET status = ?, output_url = ?, storage_key = ?, ...`. A missing column throws
  `no such column: storage_key`. It is called at
  `creative-render-handler.ts:112` on the **render status-refresh path**.

**Therefore playback alone cannot distinguish "column missing" from "column present but
empty" — both return the same 404.** The decisive signal is at render completion, not
playback. And if the column is missing, every render has been failing at status refresh
since 2026-07-22, not merely failing to archive.

### Signal table — what to conclude

| Observation | Conclusion |
|---|---|
| Render completes, status updates normally | Column EXISTS. I-22-class damage on `storage_key` ruled out. |
| Render errors at completion / `no such column: storage_key` in logs | Column MISSING. Confirmed live damage predating this cycle. |
| Render completes, `stored: false`, playback 404s | Column exists, archival did not populate it. Milder, separate issue. |
| Render completes, `stored: true`, playback streams video | Full pass. |

### The requested storage_key VALUE cannot be reported by anyone

`serializeRenderJob` (`creative.ts:285`) exposes **`stored: Boolean(record.storage_key)`**
— a boolean, never the value. Reading the actual key requires DB access, which is Q2 =
FAIL. Substitute the `stored` boolean plus the completion behavior above; that answers
the question the value was being used to answer.

---

## 2026-08-31 — Task 2: Deploy Rock 2 to Sites — NOT RUN (blocked)

**Blocked, not skipped.** Deploy authority on Sites is console-mediated (gate Q4/Q6),
the branch is not merged to `main`, and `.github/workflows/lot-hardening.yml` runs
`npm test` only — there is no deploy step anywhere in the repo. Setting
`LOTSOCIAL_EXPECTED_SITES_HOSTNAME` and `LOTSOCIAL_ASSOCIATE_ALLOWLIST` happens in the
Sites console, which passed for Joe (Q7) and is unreachable from here.

### Front-door verification, ready to run once deployed

`chatgpt-auth.ts:38` rejects when the expected host is unset or mismatched;
`chatgpt-auth.ts:55` rejects an email absent from the allowlist. Three checks:

1. **Allowlisted associate, correct host** → request succeeds. Front door open to the right people.
2. **Non-allowlisted email, correct host** → 401. Allowlist enforced.
3. **Any identity at a non-Sites hostname** → 401. Host pinning enforced.

Check 3 is the one that proves Rock 2's actual security claim. If the worker answers on
only one hostname, it cannot be exercised — record that as untestable rather than as a pass.

**Set the allowlist deliberately: it is the enforced ceiling on who can use the product
while Sites remains staging.**

---

## Where the rocks stand

- **Rock 1** — committed, proven twice.
- **Rock 2** — committed, undeployed, unverified in production.
- **Rock 3** — reported committed from the cloud session; not present on this remote.
- **Rock 4** — new table, safe on Sites via bootstrap. Its ops endpoint gets no platform verification (Q5).
- **Rock 5** — adds a column to an existing table. **Not safely deployable on Sites**; same failure mode as `storage_key`. Wait for cutover or resequence.
- **Rock 6** — no schema change, safe.

Rock 1's `db:bootstrap-check` is load-bearing now: with controlled migration unavailable,
it is the only guarantee that new tables get created correctly.

## I-22

Repair built and proven (`drizzle/repair/i22-enforce-pk-not-null.sql`,
`scripts/i22-check-schema.mjs`, `tests/schema-repair.test.mjs`). Live database never
inspected — Q2 failed, no SQL surface exists. If the Cloudflare cutover happens, data is
imported into a fresh D1 built from corrected migrations and the nullable columns never
exist there; the repair is insurance for staying, not a blocker for leaving.

## 2026-09-09 — Rock 6: real extractor tests — BUILT (Fable, cloud session)

**Files:** `app/lib/vdp.ts`, `tests/extractor.test.mjs` (new, 17 tests, offline fixtures).

- **I-07 wrong-neighbor price — fixed and locked.** `vehicleBlockBounds()` constrains the
  Dealer Inspire window to the matched vehicle's own block: it starts at that vehicle's
  `## [title](link)` heading and stops at the next heading or the next `VIN:` line. The
  two-vehicle fixture (vehicle A has no price, vehicle B directly after it does) fails on
  the old fixed 5000-character window — A inherited B's $64,120 — and passes on the fix
  with A's price empty. Verified failing-then-fixed by swapping the window logic back in.
- **I-18 hardcoded 23-make allowlist — removed.** `slugMakeAndModel()` anchors on the year
  token in the `<condition>-<year>-<make>-<model>-...` slug (fallback: first token after
  the condition words), handles two-word makes (land-rover, mercedes-benz, alfa-romeo,
  aston-martin, rolls-royce), keeps single-word MINI intact, and never treats a VIN as a model. Ram, Jeep, Chrysler and
  Dodge URLs now generate `/new-vehicles/<model>/` candidate paths; Lexus/Maserati paths
  are unchanged. `certified-` slugs are recognized alongside `new-`/`used-`.
- **Testability exports:** `parseVehicleHtml`, `parseDealerInspireMarkdown`,
  `candidateInventoryPaths`, `slugMakeAndModel`, `vehicleBlockBounds`, `vinFromUrl`,
  `normalizeListedPrice` (behavior unchanged; `isCloudflareChallenge` was already exported).
- **Fixtures covered:** JSON-LD VDP, meta/regex-only VDP (Jeep), Cloudflare challenge page
  (HTML + reader markdown), Dealer Inspire two-vehicle listing, no-VIN URL, inventory-page
  title refusal, no-evidence refusal, price normalization.

**Proof:** `node --test tests/extractor.test.mjs` → 17/17. Full `node --test tests/*.test.mjs`
in the cloud session: 37 pass / 6 fail, and every failure is the pre-existing Tier-2/worker
boot set (500 instead of 401 from miniflare in that sandbox) — the untouched branch fails the
same tests there (20 pass / 7 fail before this change). No schema change (safe on Sites).

**Delivery note:** the cloud session's git proxy refuses to push to this repository
(403, "not in this session's authorized repository set"), so this rock lands via the GitHub
web UI on branch `rf/rock-6-extractor-tests` and a PR into `rf/clarity-break-2026-08-28`.
