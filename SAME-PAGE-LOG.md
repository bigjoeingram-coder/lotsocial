# Same Page Meeting — LotSocial Hardening Cycle

Plan file: `PLAN.md` · Core Focus: secure and stabilize the live VDP-to-video product that salespeople are testing right now — no new features, no weakened compliance copy.

Integrator: Codex CLI 0.150.1, model `gpt-5.5`, reasoning effort raised to `high` for review rounds (config default is `low`). Thread `01a04b01-c30a-7862-be51-e4a395d7cd4b`. Round cap: 5.

Pre-meeting scope rulings by Joe, excluded from review: all 5 rocks in scope, hardening only, I-21 deferred.

---

## Round 1

### Integrator findings (Codex, verbatim)

- [FIX] Rock 1(a) makes a security claim without a repo-visible provenance signal: `worker/index.ts` only forwards to Vinext and `app/chatgpt-auth.ts` blindly trusts `oai-authenticated-user-email`. -> First verify the actual OpenAI Sites signed header or ingress contract, and fail closed if none exists.
- [FIX] Rock 1's `node --test` harness cannot invoke the Worker/routes as written because direct imports hit `virtual:` Vinext modules, extensionless TS imports, and `cloudflare:workers`. -> Define a compiled Worker/Miniflare-style harness or extract pure handlers with injectable env before making route proofs depend on it.
- [FIX] Rock 1's auth proof can pass while auth is broken if the test fabricates a "proxied" request header that direct attackers can also send. -> Require the test to prove forged direct-origin email headers fail and only the real platform provenance signal passes.
- [FIX] Rock 1 adds D1 rate-limit counters before Rock 2 establishes migration authority. -> Either move schema authority/migrations into Rock 1 or make Rock 2 first.
- [FIX] Rock 1's "4th-over-cap" proof misses the concurrency race that matters for spend control. -> Test and implement atomic D1 upsert/compare behavior, not read-then-write counters.
- [FIX] Rock 2 says `db:generate` diff checking is required but its proof command does not run any migration drift check. -> Add a non-lying proof that build/tests pass and generated migrations match `db/schema.ts`.
- [FIX] Rock 2's URL normalization can pass one reuse case while duplicates still enter through writes if canonical source URLs are not stored consistently. -> Normalize tracking params, host case, and trailing slash before both lookup and save, then test both import orders.
- [FIX] Rock 3's `import_outcomes` table repeats the Rock 1/Rock 2 migration dependency problem. -> Put telemetry schema changes under the same migration authority before route code depends on them.
- [FIX] Rock 3's "exactly one outcome row" proof can pass while fallback paths double-log or miss thrown `ResolvedVehicle` successes. -> Test direct success, Bright Data success, listing success, budget skip, timeout, and parse failure with one-row assertions per request.
- [FIX] Rock 4 weakens the current compliance promise by making manager approval directly `active` while provider verification becomes optional. -> Preserve the provider-gated promise or explicitly revise enforcement/copy without weakening compliance language.
- [FIX] Rock 4's expiring management token requires new schema and a fresh emailed management-link flow that is not in the files or proof. -> Add the migration, token rotation/expiry model, and proof for expired-token recovery, or cut the fresh-link promise.
- [FIX] Rock 4's proof would pass while management-token expiry, already-decided links, and provider-status transitions remain broken. -> Expand the state-machine tests to cover decision reuse, management expiry, fresh-link issuance, provider invite/verify/decline, suspend, revoke, and expiry.
- [FIX] Rock 5 leaves CI until the end even though Rocks 1-4 depend on the new behavior-test harness for truthful proof. -> Move the default `npm test`/CI wiring into Rock 1 and let later rocks add fixtures to an already-enforced suite.
- [FIX] Rock 5's "CI green on main" proof is not a valid branch-stage proof under the no-live/no-main approval boundary. -> Prove locally with `npm test` and verify the workflow targets push/PR to `main`; main-green happens only after approved merge.

VERDICT: NOT YET

### Visionary response (Fable)

Independently verified before responding: `app/chatgpt-auth.ts`, `worker/index.ts`, `README.md` (auth header docs), `package.json`, `.github/workflows/lot-hardening.yml`, `app/lib/authorization.ts`, `app/lib/authorization-shared.ts`, and a dependency-tree grep for any `oai-*` handling.

- **ACCEPTED** (provenance claim unbacked) -> Verified and material. `README.md:31-38` documents three plaintext headers with no signature, no shared secret, and no ingress contract; a grep of the dependency tree finds no `oai-` handling in vinext at all. The plan asserted a mechanism that does not exist. Rewritten: the rock no longer claims to verify provenance. It builds the honest mitigation — one `requireAssociate()` choke point that fails closed, pins the expected Sites hostname, and checks an associate allowlist — with an in-code comment naming the absent signal and the single line to change when one ships. The topology question ("is the worker reachable on any other hostname?") is recorded in PLAN.md as a deployment-time check for Joe, not a build task, because it is not answerable from the repo and the fix is correct either way.
- **ACCEPTED** (harness cannot invoke routes) -> Verified: app-router route files pull `next/headers`, vinext `virtual:` modules, and `cloudflare:workers`; `node_modules` has no miniflare and no vitest. Rewritten as a two-tier harness — Tier 1 pure env-injectable handlers under `node --test`, Tier 2 one worker-level path for edge-only proofs. Mechanism left to the Integrator with an explicit honest-failure clause: if Tier 2 is impractical, report it rather than fake it.
- **ACCEPTED** (auth proof can pass while broken) -> Folded into the rewrite above. The test set now includes the case that matters: an *allowlisted* email forged at a non-Sites host must still 401. A test that only proves "random forged email fails" would be the lying proof Codex describes.
- **ACCEPTED** (counters before migration authority) -> Real ordering defect. Schema authority is promoted out of old Rock 2 into a new Rock 1 that every later table declares through.
- **ACCEPTED** (read-then-write race) -> Correct, and it is the spend-control case specifically. Now specified as atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`, with a concurrent-increment test at the cap boundary.
- **ACCEPTED** (drift check absent from proof) -> Drift check moved into `npm test` and CI, so the proof runs it.
- **ACCEPTED** (normalize on write, both orders) -> Normalization now applies to lookup *and* insert; both import orders are named in "done looks like".
- **ACCEPTED** (telemetry table repeats the dependency) -> Resolved by the same Rock 1 promotion.
- **ACCEPTED** (one-row proof too weak) -> All six paths enumerated explicitly in the rock.
- **ACCEPTED, with a different fix than Codex proposed** (Rock 4 weakens compliance) -> The finding is right and it is the most important one in the round. `authorization-shared.ts` promises images, descriptions, and window stickers are used only where licensing/reuse/redistribution rights are *confirmed*; a sales manager does not hold those rights, so manager-approval-to-`active` would have made the compliance copy false. Codex offered "preserve the provider-gated promise or revise enforcement/copy"; I took neither wholesale, because preserving it as-is leaves the door that never opens (I-06) and revising the copy weakens the moat. Instead: tier the permissions by who can actually grant them — manager-grantable (`vehicle_facts`, `pricing`, `social_publishing`) activate on manager approval; provider-gated (`images`, `descriptions`, `window_stickers`) activate only on provider verification. The pipeline becomes reachable end-to-end and the rights promise gets stronger, not weaker.
- **ACCEPTED** (management token expiry needs schema + reissue) -> Migration column and re-issue path are now explicitly in scope, with the stated alternative of cutting the fresh-link promise rather than half-building it.
- **ACCEPTED** (state-machine proof too narrow) -> Expanded to decision reuse, management expiry, fresh-link issuance, provider verify/decline, suspend, revoke, expiry.
- **ACCEPTED** (CI too late) -> Strong point: an unenforced suite is not proof, so every rock before CI would rest on a promise. `npm test` wiring, grep-test deletion, and the main-targeting workflow all move into Rock 1.
- **ACCEPTED** (main-green is not a branch-stage proof) -> Correct under the no-deploy-without-approval constraint. Proof is local `npm test` plus a correctly-targeted workflow file; this is now a standing constraint for every rock, not just one.

Net: 14 findings, 14 accepted (one with a materially different fix), 0 rejected, 0 deferred. Plan restructured from 5 rocks to 6 — foundation split out — and revised to r2.

---

## Round 2

### Integrator findings (Codex, verbatim)

- [FIX] Rock 1 still permits a fake proof path by allowing Tier 2 to fail and falling back to pure host-pinning tests for Rock 2's edge auth boundary. -> Make Worker-level auth proof mandatory for Rock 2, or the rock fails.
- [FIX] Rock 1's `db:generate` drift check is underspecified and may generate files then pass instead of failing on drift. -> Define the exact script as generate/check plus clean-tree diff failure.
- [FIX] Rock 2's proof can pass while another route or page still reads `oai-*` headers outside `requireAssociate()`. -> Add an AST/import-boundary guard or lint rule banning direct `oai-*` header access outside the choke point.
- [FIX] Rock 2 addresses I-03 rate limiting but drops the manager-email domain sanity risk from the original issue. -> Require manager email to align with dealership/domain policy or force mismatches into preview/manual-review mode.
- [FIX] Rock 2 adds required host, allowlist, and cap configuration but `.env.example` is not updated until Rock 4. -> Update `.env.example` in Rock 2 for all new auth/rate-limit config, then let Rock 4 add telemetry/rendering gaps.
- [FIX] Rock 4's per-associate Bright Data budget cannot be enforced inside `extractVehicleFromVdp(sourceUrl)` unless the import handler passes associate identity into the extraction/budget path. -> Add the extracted VDP import handler/API adapter to Rock 4 files and test budget counters by associate.
- [FIX] Rock 4 promises honest user-facing copy when Bright Data is skipped, but the listed files do not include the import response surface that returns that notice. -> Include the import handler response contract and assert the skipped-budget notice appears when free fallback succeeds or fails.
- [FIX] Rock 5's tier split is directionally right, but the proof does not require manager-grantable permissions to remain allowed through `provider_pending`, `provider_verified`, and `provider_declined`. -> Add matrix tests for every permission tier across requested, manager_approved, provider_pending, provider_verified, provider_declined, suspended, revoked, and expired.

VERDICT: NOT YET

### Visionary response (Fable)

No round-1 finding was re-raised, and the Rock 5 tiering was checked against the code and accepted as directionally right. All eight new findings are second-order: they attack the revision, not the original plan. That is convergence, not politicking.

- **ACCEPTED** (Tier 2 fallback is a fake proof path) -> Right, and it catches me hedging. I added the fallback to avoid a blocked rock, but the effect was that the audit's highest-severity issue could end the cycle marked done-with-a-caveat. Tier 2 is now mandatory for Rock 2; if it cannot be made to work the Integrator reports `BLOCKED:` and the rock does not complete. There is no longer a fallback that counts as done.
- **ACCEPTED** (drift check could generate-then-pass) -> Correct: an unspecified check is a check that passes. Now pinned exactly — `drizzle-kit generate` followed by `git diff --exit-code drizzle/`, run from a clean tree so an uncommitted migration cannot mask drift.
- **ACCEPTED** (choke point unenforced) -> A single choke point that nothing enforces decays the first time someone adds a page. Added an ESLint `no-restricted-syntax` rule banning `oai-*` header reads outside `requireAssociate()`, enforced by `npm run lint` in CI. Noted in the plan that this is a static guard on an invariant, not a reintroduction of the source-grep anti-pattern (I-12) — the behavior tests still do the proving.
- **ACCEPTED** (manager-email domain sanity dropped) -> A real omission on my part: I-03 named both the volume risk and the domain risk, and my rewrite covered only volume. Rate limits cap how fast the spam cannon fires; they do not stop it pointing anywhere. Domain policy added to Rock 2.
- **ACCEPTED** (`.env.example` deferred) -> Each rock now documents its own config in the same rock. Config that lands a cycle before its documentation is exactly the env-drift I-05 describes.
- **ACCEPTED** (BD budget needs identity threaded) -> Verified in the code: `extractVehicleFromVdp(value: string)` at `app/lib/vdp.ts:417` takes a URL and nothing else, and its only caller is the import route. A per-associate budget is therefore unenforceable as written. Rock 4 now explicitly owns the signature change and the handler wiring; without it the "per-associate budget" would have been a global cap wearing a per-associate label.
- **ACCEPTED** (skipped-budget copy has no response surface) -> The notice is now part of the import response contract with assertions on both free-path branches, rather than a log line nobody reads.
- **ACCEPTED** (tier proof missing the cross-state invariant) -> The sharpest finding of the round. My "done looks like" tested the tiers at a moment, not across transitions, which would have let a provider *declining image rights* silently switch off pricing — a regression that would look like working code. Replaced with a full matrix (both tiers x eight real states) and the invariant stated outright.

Net round 2: 8 findings, 8 accepted, 0 rejected, 0 deferred. Plan revised to r3; structure unchanged at 6 rocks.

---

## Round 3

### Integrator findings (Codex, verbatim)

- [FIX] Rock 1's `db:check` uses `git diff --exit-code drizzle/`, which will fail on a correct uncommitted migration during local rock proof before the user-gated commit. -> Make the drift check compare before/after `drizzle-kit generate`, or state it runs only from clean CI/post-commit state.
- [FIX] Rock 2's `oai-*` ESLint guard is specified, but neither Rock 2's proof command nor Rock 1's CI/npm-test contract actually runs `npm run lint`. -> Add `npm run lint` to `npm test`, CI, or Rock 2's proof command.

VERDICT: NOT YET

### Visionary response (Fable)

Both accepted. Notably, the first is a defect I introduced in my own round-2 fix — the drift check I tightened would have failed every build that legitimately added a migration, which is every rock from 2 onward. Codex caught a regression in the correction, which is the whole point of running the meeting more than once.

- **ACCEPTED** (db:check breaks on a legitimate uncommitted migration) -> Rewritten to compare before/after around its own `drizzle-kit generate` run rather than against git. Drift is now defined as "the generator would produce something different", not "the working tree is dirty", so the check is correct from a dirty tree and still fails a schema edit whose migration was never generated.
- **ACCEPTED** (lint guard never runs) -> A guard nothing executes is not a guard — the same class of error as the source-grep tests this cycle exists to delete. `npm run lint` folded into `npm test`, and CI now runs that same `npm test`, so local and CI prove the identical thing.

Net round 3: 2 findings, 2 accepted, 0 rejected. Plan revised to r4.

---

## Round 4

### Integrator findings (Codex, verbatim)

VERDICT: SAME PAGE

### Visionary response (Fable)

No findings. Meeting closed at round 4 of 5, inside the cap, with no user override required and no deadlock.

**Meeting scorecard:** 24 findings across 3 substantive rounds — 24 accepted (one with a materially different fix than proposed), 0 rejected, 0 deferred, 0 silently dropped. The plan went from 5 rocks to 6. Three changes were load-bearing enough that building the original plan would have produced working-looking code that was wrong:

1. Rock 1(a) originally promised to verify a platform provenance signal that does not exist. It would have shipped a security control that verified nothing while reading as though it did.
2. The original Rock 4 would have let manager approval activate provider-gated permissions, making the compliance copy in `authorization-shared.ts` false — the one asset the Core Focus names as untouchable.
3. Every rock's proof rested on a test harness that could not have run at all, since app-router routes cannot be imported under `node --test` in this repo.

The Integrator earned its seat this cycle.
