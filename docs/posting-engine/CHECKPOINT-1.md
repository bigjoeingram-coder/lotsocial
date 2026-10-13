# LotSocial posting engine v1: checkpoint 1 (architecture, schema, tests)

- **Status:** created by Fable, not graded. Gene grades. Data is second eyes.
- **Date:** 2026-10-13 (PT). Repo commit read: `fc33e39`.
- **Governing spec:** [LotSocial Open Social Engine v1](https://docs.google.com/document/d/1497HEFxOzuI8TLMZI5PqWoOiQqQf-TLgjYOaq7rY-ZU/edit), sections 25 to 29. Scope fence: section 28. Third-party boundary: section 29 C2.
- **This checkpoint changes no application code.** It is the plan that the Phase A and Phase B code must match.

## 1. What exists today (read from the repo)

| Area | Fact |
| --- | --- |
| Stack | vinext (Next 16 app router) on a Cloudflare Worker, D1 (`DB`), R2 (`MEDIA`), Drizzle ORM. Hosted through OpenAI Sites (`.openai/hosting.json`). |
| Schema authority | `db/schema.ts` plus `drizzle/` migrations `0000` to `0012`. `app/lib/schema-bootstrap.ts` mirrors the migrations and `npm run db:bootstrap-check` proves parity. `npm run db:check` fails on drift. |
| Tables (14) | `pilot_invites`, `associate_accounts`, `associate_sessions`, `account_login_links`, `authorization_requests`, `authorization_audit_events`, `provider_verifications`, `authorization_management_links`, `imported_vehicles`, `import_evidence`, `creative_projects`, `creative_render_jobs`, `rate_limit_counters`, `import_outcomes`. |
| Content record | `creative_projects` holds `voiceover_script`, `social_caption`, end-card fields and `status`. `creative_render_jobs` holds the Shotstack render, `output_url` and `storage_key`. |
| Posting | None. No table, route or library posts to any social platform. |
| Scheduled work | None. `worker/index.ts` exports only `fetch`. No cron handler exists. |
| Tests | 16 behavior test files under `node --test`, a fake D1 harness (`tests/harness.mjs`), and Miniflare worker tests. `npm test` runs build, tests, both schema checks and lint. CI runs the same command. |

## 2. Dependency scan against the third-party boundary

- Runtime dependencies: `drizzle-orm`, `next`, `react`, `react-dom`. Dev dependencies: Cloudflare, Vite, Tailwind, ESLint, TypeScript, Miniflare, Wrangler tooling.
- `pnpm-lock.yaml` lists 696 resolved packages. A name search for social, LinkedIn, YouTube, Twitter, Facebook, Instagram, TikTok, Postiz, cron, queue and bull found only `queue-microtask` and `yocto-queue`. Both are general-purpose utilities.
- **Result: no dependency violates the boundary.**
- **Plan: the posting engine adds zero new dependencies.** Platform calls use `fetch`. Hashing uses Web Crypto. Tests use `node:test` and `node:sqlite`, which the repo already uses.

## 3. Schema diff: six new tables, no change to existing tables

Existing tables are not altered. `creative_projects` stays the one content record. A post variant points at it. Conventions match the repo: text ids, ISO text timestamps, JSON stored as text.

### `social_connections`
One authorized platform account.

| Column | Notes |
| --- | --- |
| `id` | Primary key. |
| `owner_email` | Associate who owns it. Tenant scoping follows the existing email model. |
| `platform` | `mock`, `linkedin` or `youtube`. |
| `account_label` | Display name. |
| `credentials_ref` | Name of the Worker secret that holds the token. The token itself is never stored in D1, code, docs or the Relay. |
| `granted_scopes` | JSON list. |
| `health_state` | `GREEN`, `DEGRADED`, `AUTH_REQUIRED`, `RATE_LIMITED`, `PLATFORM_OUTAGE`, `UNVERIFIED`, `DISABLED`. |
| `health_checked_at`, `last_success_at`, `status`, `created_at`, `updated_at` | |

### `social_destinations`
Where a post lands: a LinkedIn member or organization, or a YouTube channel.

`id`, `connection_id`, `platform`, `platform_ref` (URN or channel id), `kind`, `display_name`, `status`, timestamps. Unique on (`connection_id`, `platform_ref`).

### `post_variants`
The platform-specific copy of one creative project.

| Column | Notes |
| --- | --- |
| `id`, `creative_project_id`, `destination_id`, `platform` | |
| `caption`, `title`, `description`, `platform_options` (JSON) | Publish-affecting fields. |
| `render_job_id`, `media_storage_key` | The exact rendered asset. |
| `revision`, `revision_hash` | SHA-256 over the publish-affecting fields and the asset key. Any edit bumps both. |
| `approval_status` | `DRAFT`, `READY_FOR_REVIEW`, `APPROVED`. |
| `approved_revision_hash`, `approved_by`, `approved_at` | Set only by the approval action. |
| `validation_status`, `validation_errors` | Written by the adapter's `validateContent`. |
| `supersedes_id`, timestamps | |

### `post_slots`
The scheduler and dispatch ledger. One row per planned post.

| Column | Notes |
| --- | --- |
| `id`, `variant_id`, `destination_id` | |
| `scheduled_at_utc`, `timezone` | Stored in UTC. Timezone is display only. |
| `slot_status` | See the state machine in section 5. |
| `idempotency_key` | Unique. Built from slot id plus approved revision hash. This is our ledger key, because most platforms accept no client key. |
| `approved_revision_hash` | Copied at queue time, re-checked at send time. |
| `worker_id`, `attempt_id`, `claimed_at`, `lease_expires_at` | Set by the atomic claim. |
| `attempt_count`, `next_retry_at`, `latest_attempt_id` | |
| `created_at`, `updated_at` | |

Indexes: (`slot_status`, `scheduled_at_utc`) for the due scan, and (`slot_status`, `lease_expires_at`) for the expired-lease scan.

### `delivery_attempts`
One row per send attempt. Append-only apart from outcome fields.

`id`, `slot_id`, `attempt_id`, `idempotency_key`, `adapter`, `request_snapshot` (JSON, no secrets), `outcome` (`accepted`, `processing`, `published`, `failed`, `uncertain`, `rejected_validation`, `auth_required`, `rate_limited`), `platform_post_id`, `platform_url`, `provider_request_id`, `error_code` (normalized enum), `error_message`, `retryable`, `raw_response_key` (R2), `started_at`, `finished_at`, `last_checked_at`.

### `posting_audit_events`
Append-only trail, same shape as `authorization_audit_events`: `id`, `slot_id`, `variant_id`, `actor_type`, `actor_email`, `action`, `metadata`, `created_at`. It records approval, queue, claim, send, reconcile, cancel and supersede.

**Cut from v1, per the spec:** webhook inbox, a new content table, a new calendar table, multi-brand tenant tables.

## 4. Adapter interface

One TypeScript contract in `app/lib/posting/adapter.ts`. Every adapter implements all of it. An operation a platform lacks returns `UNSUPPORTED` before any network call.

```ts
export type ErrorCode =
  | "VALIDATION" | "AUTH_REQUIRED" | "PERMISSION_DENIED" | "RATE_LIMITED"
  | "MEDIA_PROCESSING" | "PLATFORM_REJECTED" | "TRANSIENT_PROVIDER"
  | "INTERNAL" | "UNCERTAIN_WRITE";

export type Verification = "VERIFIED_LIVE" | "DOCUMENTED_NOT_LIVE_TESTED" | "UNSUPPORTED";

export interface CapabilityManifest {
  platform: string;
  features: Record<"text" | "single_image" | "video" | "native_schedule" | "delete" | "find_by_client_ref", Verification>;
  maxTextLength: number;
  videoLimits: { maxBytes: number; maxSeconds: number; aspectRatios: string[] };
  requiredFields: string[];
}

export type Outcome =
  | { kind: "published"; platformPostId: string; platformUrl: string }
  | { kind: "processing"; platformPostId: string }
  | { kind: "uncertain"; detail: string }
  | { kind: "failed"; code: ErrorCode; message: string; retryable: boolean; retryAfterSeconds?: number };

export interface PlatformAdapter {
  getCapabilities(): CapabilityManifest;
  requiredScopes(operation: string): string[];
  validateContent(variant: VariantSnapshot): ValidationResult;

  // connection
  beginConnection(input: ConnectInput): Promise<ConnectStart>;
  completeConnection(input: ConnectCallback): Promise<ConnectionResult>;
  refreshConnection(conn: ConnectionRef): Promise<ConnectionResult>;
  listDestinations(conn: ConnectionRef): Promise<Destination[]>;
  healthCheck(conn: ConnectionRef): Promise<HealthResult>;
  getRateBudget(dest: DestinationRef): Promise<RateBudget | null>;

  // media
  beginMediaUpload(dest: DestinationRef, media: MediaRef): Promise<UploadSession>;
  uploadMediaChunk(session: UploadSession, chunk: ArrayBuffer, index: number): Promise<UploadSession>;
  getMediaProcessingStatus(dest: DestinationRef, mediaRef: string): Promise<MediaStatus>;
  cancelMediaUpload(session: UploadSession): Promise<void>;

  // publish and readback
  createPost(dest: DestinationRef, variant: VariantSnapshot, clientRef: string): Promise<Outcome>;
  readbackPost(dest: DestinationRef, platformPostId: string): Promise<Outcome>;
  findByClientRef(dest: DestinationRef, clientRef: string): Promise<Outcome | null>;
  findRecentCandidates(dest: DestinationRef, fingerprint: string, sinceIso: string): Promise<Outcome[]>;
  scheduleNativePost?(dest: DestinationRef, variant: VariantSnapshot, atIso: string): Promise<Outcome>;
  unscheduleNativePost?(dest: DestinationRef, platformPostId: string): Promise<void>;
  deletePost?(dest: DestinationRef, platformPostId: string): Promise<void>;
}
```

Rule the dispatcher enforces: after an `uncertain` outcome, it calls `readbackPost`, then `findByClientRef`, then `findRecentCandidates` before any second `createPost`.

## 5. D1 state machine

States: `DRAFT`, `READY_FOR_REVIEW`, `APPROVED`, `QUEUED`, `IN_FLIGHT`, `PROCESSING`, `PUBLISHED`, `UNCERTAIN`, `RATE_LIMITED`, `AUTH_REQUIRED`, `FAILED`, `RETRY_READY`, `CANCELED`, `SUPERSEDED`.

| From | To | Guard |
| --- | --- | --- |
| `APPROVED` | `QUEUED` | Variant approved, validation passed, asset key present, destination connection not `DISABLED`. |
| `QUEUED` or `RETRY_READY` | `IN_FLIGHT` | Atomic claim (below). Due time reached. |
| `IN_FLIGHT` | `PUBLISHED` | Adapter returns a definitive published result, or readback resolves the post id and URL. HTTP 200 alone is not enough. |
| `IN_FLIGHT` | `PROCESSING` | Platform accepted the post and is still processing media. |
| `IN_FLIGHT` | `UNCERTAIN` | Network result unknown, or the lease expired. **An expired lease never returns to `QUEUED`.** |
| `IN_FLIGHT` | `RATE_LIMITED`, `AUTH_REQUIRED`, `FAILED` | Normalized error code from the adapter. |
| `PROCESSING` | `PUBLISHED` or `FAILED` | Reconciler poll. |
| `UNCERTAIN` | `PUBLISHED`, `PROCESSING`, `RETRY_READY`, or stays `UNCERTAIN` | Reconciler: post found, post processing, platform definitively shows no post, or still unknown. After the timeout an unknown slot waits for a person. |
| `RATE_LIMITED` | `RETRY_READY` | `next_retry_at` reached. Capped backoff. |
| `AUTH_REQUIRED` | `RETRY_READY` | Connection health returns to `GREEN`. |
| any pre-send state | `CANCELED`, `SUPERSEDED` | Person cancels, or a newer revision replaces the variant. |
| `APPROVED`, `QUEUED` | `DRAFT` | A publish-affecting edit changes `revision_hash`. Approval is void. |

**Atomic claim.** One statement, no read-then-write:

```sql
UPDATE post_slots
   SET slot_status = 'IN_FLIGHT', worker_id = ?, attempt_id = ?,
       claimed_at = ?, lease_expires_at = ?, attempt_count = attempt_count + 1
 WHERE id = ? AND slot_status IN ('QUEUED','RETRY_READY') AND scheduled_at_utc <= ?
RETURNING id, approved_revision_hash, idempotency_key;
```

A worker that gets no row back lost the race and stops.

**Send-time approval check.** After the claim and before `createPost`, the dispatcher recomputes the variant's `revision_hash` and compares it with the slot's `approved_revision_hash`. A mismatch sends nothing and moves the slot to `DRAFT` with an audit event.

**Wake mechanism (open decision, see section 9).** The engine exposes one function, `runPostingTick(env, now)`. It runs the expired-lease sweep, the reconciler, then the due-slot dispatch. Phase B calls it only from tests and from a protected route `POST /api/ops/posting/tick` (bearer `ENFORCEMENT_API_KEY`, same pattern as the existing ops routes). No cron is wired in Phase B.

## 6. Files to add and change

**New**
- `app/lib/posting/adapter.ts`: contract and shared types.
- `app/lib/posting/states.ts`: state list and the allowed-transition table.
- `app/lib/posting/revision.ts`: publish-affecting hash.
- `app/lib/posting/store.ts`: D1 reads and writes, including the atomic claim.
- `app/lib/posting/dispatcher.ts`: claim, send-time check, send, record outcome.
- `app/lib/posting/reconciler.ts`: expired leases, processing polls, uncertain resolution, backoff.
- `app/lib/posting/tick.ts`: `runPostingTick`.
- `app/lib/posting/health.ts`: connection health states.
- `app/lib/posting/adapters/mock.ts`: deterministic mock adapter with scripted outcomes.
- `app/lib/posting/adapters/linkedin.ts`, `youtube.ts`: Phase C and D only.
- `app/lib/posting-tick-handler.ts` and `app/api/ops/posting/tick/route.ts`: thin route, same two-tier pattern as the existing handlers.
- `drizzle/0013_*.sql`: generated migration for the six tables.
- `tests/posting-*.test.mjs`: see section 7.

**Changed**
- `db/schema.ts`: six new table definitions appended. No existing definition edited.
- `app/lib/schema-bootstrap.ts`: matching `CREATE TABLE IF NOT EXISTS` blocks, so the parity check stays green.
- `.env.example`: new variable names only, no values (`LOTSOCIAL_POSTING_ENABLED`, lease and retry limits).
- `README.md`: one operations paragraph.

**Not touched:** `vdp.ts`, `vdp-imports-handler.ts`, `rendering.ts`, `render-source.ts`, `creative-render-handler.ts`, `authorization*.ts`, `account-auth.ts`, `evidence.ts`, `limits.ts`, `workers/render-source/`, `worker/index.ts`.

## 7. Test plan

All tests are behavior tests under `node --test`, per the repo rule against source-text checks. They run against a real SQLite database (`node:sqlite`) loaded with the migrations, so the atomic claim is tested on real SQL.

**Scheduler**
1. Two workers claim the same slot; exactly one succeeds.
2. A retry after failure creates no second post.
3. An expired lease moves to `UNCERTAIN`, never to `QUEUED`.
4. A canceled slot never dispatches.
5. A superseded variant never dispatches.
6. An unapproved variant never queues.
7. A slot with no asset never queues.
8. A variant that fails adapter validation never queues.
9. Time handling: UTC storage, correct local display across a daylight-saving change.
10. Immediate publish and future publish both work.
11. 1,000 queued slots dispatch in a deterministic order.

**Outcomes, through the mock adapter**
12. Immediate success.
13. Processing, then success on a later poll.
14. Uncertain result where readback finds the post: slot becomes `PUBLISHED`, `createPost` is called once.
15. Uncertain result where the platform shows no post: slot becomes `RETRY_READY`, then publishes.
16. Uncertain result that stays unknown: slot stays `UNCERTAIN`, no resend.
17. Rate limit: backoff respected and capped.
18. Auth failure: slot `AUTH_REQUIRED`, connection health updated, resumes after health is `GREEN`.
19. Invalid media: rejected before any network call.
20. Partial failure across two destinations: each slot keeps its own outcome.

**Governance**
21. Editing an approved caption voids approval and blocks the send.
22. Send-time hash mismatch sends nothing.
23. Every published post traces to the exact approved revision, approver and time in the audit trail.
24. HTTP 200 without a post id is not recorded as published.

**Repo gates**
25. `npm run db:check` and `npm run db:bootstrap-check` pass with the new migration.
26. Existing 16 test files still pass unchanged.
27. A test fails if `package.json` gains a dependency outside an allowlist. This enforces the third-party boundary in CI.

## 8. Preserve list

Not modified, not replaced, not bypassed:

- VDP import and the facts allowlist (`vdp.ts`, `vdp-imports-handler.ts`).
- Append-only import evidence (`evidence.ts`, `import_evidence`).
- Authorization request and manager decision flow, including the provider-rights promise in `authorization-shared.ts`.
- Closed-pilot identity: allowlist, hostname pin, sessions, login links (`account-auth.ts`).
- Shotstack rendering and `creative_render_jobs` (`rendering.ts`).
- The `lotsocial-render-source-v1` Worker and its config.
- Rate and cost caps (`limits.ts`, `rate_limit_counters`).
- Schema authority: Drizzle migrations plus the bootstrap parity and drift checks.
- The two-tier test harness and CI workflow.
- Compliance copy: "price when captured", the 7-day ad expiry line, the flavor-mode boundary.
- Outside the repo: Content Gravy tracker and review flow, Social Media Bible, AdaptlyPost and its active schedules.

## 9. Open items for Gene and Joe

1. **Wake mechanism.** The app's Worker has no cron handler, and OpenAI Sites hosting is not confirmed to support one. Recommended: keep the engine wake-agnostic (`runPostingTick` behind a protected route) and decide the caller at Phase E. The likely caller is a small separate Cloudflare Worker cron, the same pattern as the render-source Worker. That is a deploy decision, so it is Joe-gated. It does not block Phase A or B.
2. **Credential storage.** Plan: tokens live in Worker secrets, and D1 stores only the secret's name. Refreshable tokens (YouTube) need a writable encrypted store. Recommended: an encrypted column using a Worker-secret key, decided before Phase D. It does not block Phase A or B.
3. **Already-authorized credentials.** Not inventoried by Fable. Phase C and D need a LinkedIn app with `w_member_social` and a Google project with `youtube.upload`. Data's Phase 0 inventory answers this. No new OAuth app is created without Joe.
4. **Approval surface.** v1 records approval in `post_variants` and reuses the existing review pages where feasible. No new calendar or review UI is planned.

## 10. Next step after this checkpoint

Phase A and B code: schema and migration, state table, store, dispatcher, reconciler, mock adapter, and tests 1 to 27. No live credentials, no deploy, no post.

## 11. Checkpoint 2: Phase A and Phase B code (2026-10-13, created by Fable, not graded)

**Built on this branch**
- Migration `0013` with the six tables, plus matching bootstrap blocks. Both schema checks pass.
- `app/lib/posting/`: `states.ts`, `revision.ts`, `adapter.ts`, `engine.ts`, `workflow.ts`, `dispatcher.ts`, `reconciler.ts`, `tick.ts`, `adapters/mock.ts`.
- `tests/posting-engine.test.mjs`: 28 behavior tests on real SQLite.

**Results**
- `npm test`: 126 of 126 tests pass (98 existing, 28 new). Build, bootstrap parity, drift check and lint pass. Lint reports 0 errors; its 9 warnings are all in the existing `AuthorizationApp.tsx`.
- `tsc --noEmit`: no errors in the posting files or `db/schema.ts`.
- Mutation check: removing the send-time hash check, making the claim unconditional, sending expired leases back to `QUEUED`, and retrying on a non-definitive lookup each made at least one test fail. The tests catch the failures they claim to catch.

**Differences from the plan above**
- `engine.ts` holds the shared store helpers instead of a separate `store.ts`. `workflow.ts` holds create, edit, approve, queue and cancel. No `health.ts` yet; health state changes live in the dispatcher and reconciler.
- `post_slots` gained `uncertain_since` and an index on `variant_id`. It has no `latest_attempt_id`; the latest attempt is read from `delivery_attempts`.
- `delivery_attempts.id` is the attempt id, so there is no separate `attempt_id` column there.
- Lookups return a `LookupResult` with `not_found` and a `definitive` flag. A retry happens only when the platform definitively shows no post.
- One existing file outside the plan changed: `tests/harness.mjs`, one line, so the in-memory fake database accepts `CREATE UNIQUE INDEX`.
- No new dependency was added. A test now fails if one is.

**Added after checkpoint 2**
- Protected tick route (`POST /api/ops/posting/tick`) and handler, off unless `LOTSOCIAL_POSTING_ENABLED` is `true`, with 4 tests. The production adapter registry is empty, so it cannot send. `npm test`: 130 of 130 pass.
- `.env.example` and README notes.

**Not built yet**
- Any wiring from `creative_projects` screens to variants. The engine is reachable only from tests.
- LinkedIn and YouTube adapters (Phase C and D).
- Human-review timeout handling for a slot that stays `UNCERTAIN`; it stays put and is counted, but nothing alerts a person yet.
