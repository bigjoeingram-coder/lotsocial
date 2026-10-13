import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SCHEMA_BOOTSTRAP_SQL } from "../app/lib/schema-bootstrap.ts";
import { MockAdapter } from "../app/lib/posting/adapters/mock.ts";
import { claimSlot, dispatchSlot } from "../app/lib/posting/dispatcher.ts";
import { defaultDeps } from "../app/lib/posting/engine.ts";
import { reconcile } from "../app/lib/posting/reconciler.ts";
import { ALLOWED_TRANSITIONS, canTransition } from "../app/lib/posting/states.ts";
import { runPostingTick } from "../app/lib/posting/tick.ts";
import { approveVariant, cancelSlot, createVariant, editVariant, localDisplay, markConnectionReconnected, operatorRetry, queueSlot } from "../app/lib/posting/workflow.ts";
import { SqliteD1 } from "./harness.mjs";

const START = Date.parse("2026-10-13T12:00:00.000Z");
const APPROVER = "manager@example.com";
const AUTHOR = "joe@example.com";

// A real SQLite database with the real schema, a controllable clock, and the mock adapter.
async function world(overrides = {}) {
  const db = new SqliteD1();
  for (const statement of SCHEMA_BOOTSTRAP_SQL) db.db.exec(statement);
  const clock = { ms: START };
  let sequence = 0;
  const mock = new MockAdapter();
  const deps = defaultDeps(db, { mock }, {
    now: () => new Date(clock.ms),
    newId: () => `id-${String(++sequence).padStart(5, "0")}`,
    workerId: "worker-a",
    leaseSeconds: 300,
    maxAttempts: 3,
    retryBaseSeconds: 60,
    retryCapSeconds: 600,
    batchSize: 2000,
    ...overrides,
  });
  db.db.exec(`INSERT INTO social_connections (id, owner_email, platform, credentials_ref, health_state) VALUES ('conn-1', '${AUTHOR}', 'mock', 'SECRET_NAME_ONLY', 'GREEN')`);
  db.db.exec("INSERT INTO social_destinations (id, connection_id, platform, platform_ref) VALUES ('dest-1', 'conn-1', 'mock', 'urn:mock:1'), ('dest-2', 'conn-1', 'mock', 'urn:mock:2')");
  const advance = (seconds) => { clock.ms += seconds * 1000; };
  const at = (seconds) => new Date(START + seconds * 1000).toISOString();
  const slot = (id) => db.rows("SELECT * FROM post_slots WHERE id = ?", id)[0];
  const attempts = (id) => db.rows("SELECT * FROM delivery_attempts WHERE slot_id = ? ORDER BY started_at, rowid", id);
  const auditActions = (id) => db.rows("SELECT action FROM posting_audit_events WHERE slot_id = ? OR variant_id = ? ORDER BY id", id, id).map((row) => row.action);
  return { db, deps, mock, advance, at, slot, attempts, auditActions, clock };
}

async function approvedVariant(w, fields = {}) {
  const variantId = await createVariant(w.deps, { creativeProjectId: "proj-1", destinationId: "dest-1", platform: "mock", caption: "Come see the 2026 F-150.", mediaStorageKey: "renders/proj-1.mp4", ...fields }, AUTHOR);
  const approval = await approveVariant(w.deps, variantId, APPROVER);
  return { variantId, approval };
}

async function queuedSlot(w, { offsetSeconds = -1, fields = {} } = {}) {
  const { variantId, approval } = await approvedVariant(w, fields);
  assert.equal(approval.ok, true);
  const queued = await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(offsetSeconds) }, AUTHOR);
  assert.equal(queued.ok, true);
  return { variantId, slotId: queued.slotId };
}

// ---- Scheduler ----

test("two workers cannot dispatch the same slot", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  const other = { ...w.deps, workerId: "worker-b" };
  const results = await Promise.all([dispatchSlot(w.deps, slotId), dispatchSlot(other, slotId)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(w.mock.createCalls.length, 1);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
});

test("a second claim on a claimed slot returns nothing", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  assert.ok(await claimSlot(w.deps, slotId));
  assert.equal(await claimSlot({ ...w.deps, workerId: "worker-b" }, slotId), null);
});

test("a retry after a retryable failure creates exactly one post", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "fail", code: "TRANSIENT_PROVIDER", retryable: true }, { kind: "publish" });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "RETRY_READY");
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "RETRY_READY", "backoff has not elapsed yet");
  w.advance(61);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.equal(w.mock.posts.length, 1);
  assert.equal(w.mock.createCalls.length, 2);
});

// Simulates a worker that claimed a slot, wrote the send marker, called the platform, and died.
async function claimAndDieMidSend(w, slotId) {
  const claim = await claimSlot(w.deps, slotId);
  assert.ok(claim);
  const now = new Date(w.clock.ms).toISOString();
  w.db.db.prepare("INSERT INTO delivery_attempts (id, slot_id, idempotency_key, adapter, started_at) VALUES (?, ?, ?, 'mock', ?)").run(claim.attemptId, slotId, claim.idempotency_key, now);
  w.db.db.prepare("UPDATE post_slots SET send_started_at = ? WHERE id = ?").run(now, slotId);
  return claim;
}

test("a worker that dies mid-send leaves the slot UNCERTAIN, never QUEUED", async () => {
  const w = await world();
  w.mock.lookupsDefinitive = false;
  const { slotId } = await queuedSlot(w);
  await claimAndDieMidSend(w, slotId);
  w.advance(301);
  const summary = await runPostingTick(w.deps);
  assert.equal(summary.reconcile.expiredLeases, 1);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
  assert.equal(w.mock.createCalls.length, 0, "an expired mid-send lease is never blindly re-sent");
  assert.equal(canTransition("IN_FLIGHT", "QUEUED"), false);
  assert.ok(!ALLOWED_TRANSITIONS.UNCERTAIN.includes("QUEUED"));
});

test("a worker that dies before the send started is retried, not stuck (Gene F2)", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  assert.ok(await claimSlot(w.deps, slotId));
  assert.equal(w.slot(slotId).send_started_at, null);
  w.advance(301);
  const first = await runPostingTick(w.deps);
  assert.equal(first.reconcile.neverSentRequeued, 1);
  assert.equal(first.reconcile.expiredLeases, 0);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED", "the same pass re-claims and sends it");
  assert.equal(w.mock.createCalls.length, 1);
  assert.equal(w.mock.posts.length, 1);
  assert.ok(w.auditActions(slotId).includes("lease_expired_never_sent"));
  assert.equal(w.attempts(slotId)[0].outcome, "published");
});

test("the send marker is set only when the platform call starts", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  let seenDuringSend = null;
  const original = w.mock.createPost.bind(w.mock);
  w.mock.createPost = async (...args) => { seenDuringSend = w.slot(slotId).send_started_at; return original(...args); };
  await runPostingTick(w.deps);
  assert.ok(seenDuringSend, "marker is present by the time createPost runs");
});

test("an UNCERTAIN slot past the time limit goes to a person and is never re-sent (Gene F2)", async () => {
  const w = await world({ uncertainTimeoutSeconds: 7200 });
  w.mock.lookupsDefinitive = false;
  w.mock.enqueue({ kind: "throw_without_post" });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  w.advance(3600);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
  w.advance(3601);
  const summary = await runPostingTick(w.deps);
  assert.equal(summary.reconcile.needsReview, 1);
  assert.equal(w.slot(slotId).slot_status, "NEEDS_REVIEW");
  assert.ok(w.auditActions(slotId).includes("uncertain_timeout_needs_review"));
  for (let pass = 0; pass < 3; pass += 1) { w.advance(3600); await runPostingTick(w.deps); }
  assert.equal(w.slot(slotId).slot_status, "NEEDS_REVIEW");
  assert.equal(w.mock.createCalls.length, 1);
});

test("stuck slots do not block a newer slot from resolving (Gene F3)", async () => {
  const w = await world({ batchSize: 2 });
  w.mock.lookupsDefinitive = false;
  w.mock.enqueue({ kind: "throw_without_post" }, { kind: "throw_without_post" }, { kind: "throw_without_post" }, { kind: "processing", readyAfterChecks: 0 });
  const stuck = [];
  for (let index = 0; index < 3; index += 1) stuck.push((await queuedSlot(w, { offsetSeconds: -100 + index, fields: { caption: `Stuck post ${index}.` } })).slotId);
  const newer = await queuedSlot(w, { offsetSeconds: -1, fields: { caption: "Newer post." } });
  await runPostingTick(w.deps);
  await runPostingTick(w.deps);
  assert.equal(w.slot(newer.slotId).slot_status, "PROCESSING");
  for (const id of stuck) assert.equal(w.slot(id).slot_status, "UNCERTAIN");
  for (let pass = 0; pass < 3; pass += 1) { w.advance(10); await reconcile(w.deps); }
  assert.equal(w.slot(newer.slotId).slot_status, "PUBLISHED", "3 stuck slots with batchSize 2 must not starve it");
});

test("a content match never claims a post that belongs to another slot", async () => {
  const w = await world();
  w.mock.supportsClientRef = false;
  w.mock.lookupsDefinitive = false;
  // Two different posts with identical content to the same destination. The first send is lost; the second lands.
  w.mock.enqueue({ kind: "throw_without_post" }, { kind: "publish" });
  const lost = await queuedSlot(w, { offsetSeconds: -10 });
  const landed = await queuedSlot(w, { offsetSeconds: -5, fields: { creativeProjectId: "proj-2" } });
  await runPostingTick(w.deps);
  assert.equal(w.slot(landed.slotId).slot_status, "PUBLISHED");
  for (let pass = 0; pass < 3; pass += 1) { w.advance(10); await reconcile(w.deps); }
  assert.equal(w.slot(lost.slotId).slot_status, "UNCERTAIN", "it must not adopt the other slot's post");
  assert.equal(w.mock.posts.length, 1);
});

test("queueing the same post twice is refused and sends once (Gene F1)", async () => {
  const w = await world();
  const { variantId, slotId } = await queuedSlot(w);
  const second = await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(-1) }, AUTHOR);
  assert.equal(second.ok, false);
  assert.equal(second.existingSlotId, slotId);
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls.length, 1);
  assert.equal(w.mock.posts.length, 1);
  const third = await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(0) }, AUTHOR);
  assert.equal(third.ok, false, "a published post cannot be queued again");
  await runPostingTick(w.deps);
  assert.equal(w.mock.posts.length, 1);
});

test("the database itself refuses a second live slot for the same post (Gene F1)", async () => {
  const w = await world();
  const { variantId } = await queuedSlot(w);
  assert.throws(() => w.db.db.prepare("INSERT INTO post_slots (id, variant_id, destination_id, scheduled_at_utc, idempotency_key) VALUES ('rogue', ?, 'dest-1', ?, 'rogue-key')").run(variantId, w.at(-1)), /UNIQUE/i);
});

test("a slot voided by an edit is revived by re-approval, not duplicated", async () => {
  const w = await world();
  const { variantId, slotId } = await queuedSlot(w);
  await editVariant(w.deps, variantId, { caption: "Second draft." }, AUTHOR);
  assert.equal((await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(-1) }, AUTHOR)).ok, false, "not approved yet");
  await approveVariant(w.deps, variantId, APPROVER);
  const requeued = await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(-1) }, AUTHOR);
  assert.equal(requeued.slotId, slotId);
  assert.equal(w.db.rows("SELECT count(*) AS n FROM post_slots")[0].n, 1);
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls[0].caption, "Second draft.");
  assert.equal(w.mock.posts.length, 1);
});

test("only a person can retry a failed slot, and the retry is audited (Gene H2)", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "fail", code: "PLATFORM_REJECTED", retryable: false });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "FAILED");
  w.advance(86400);
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls.length, 1, "the engine never retries a failed slot on its own");
  await assert.rejects(() => operatorRetry(w.deps, slotId, APPROVER, " "));
  assert.equal(await operatorRetry(w.deps, slotId, APPROVER, "Platform outage is over."), true);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  const event = w.db.rows("SELECT actor_email, metadata FROM posting_audit_events WHERE slot_id = ? AND action = 'operator_retry'", slotId)[0];
  assert.equal(event.actor_email, APPROVER);
  assert.match(event.metadata, /Platform outage is over/);
});

test("a different file at the same storage key voids approval (Gene H3)", async () => {
  const w = await world();
  const { variantId, slotId } = await queuedSlot(w, { fields: { mediaChecksum: "sha256-aaa" } });
  await editVariant(w.deps, variantId, { mediaChecksum: "sha256-bbb" }, AUTHOR);
  assert.equal(w.slot(slotId).slot_status, "DRAFT");
  const other = await queuedSlot(w, { fields: { mediaChecksum: "sha256-ccc", destinationId: "dest-2" } });
  w.db.db.prepare("UPDATE post_variants SET media_checksum = 'sha256-swapped' WHERE id = ?").run(other.variantId);
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls.length, 0);
  assert.equal(w.slot(other.slotId).slot_status, "DRAFT");
});

test("a paused connection holds the slot and it resumes with an audit record (Gene H4, H5)", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  w.db.db.exec("UPDATE social_connections SET status = 'paused' WHERE id = 'conn-1'");
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "AUTH_REQUIRED", "held, not failed");
  assert.equal(w.mock.createCalls.length, 0);
  w.db.db.exec("UPDATE social_connections SET status = 'active' WHERE id = 'conn-1'");
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.ok(w.auditActions(slotId).includes("resumed_after_reconnect"));
});

test("a canceled slot never dispatches", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  assert.equal(await cancelSlot(w.deps, slotId, AUTHOR), true);
  const summary = await runPostingTick(w.deps);
  assert.equal(summary.dispatched.length, 0);
  assert.equal(w.mock.createCalls.length, 0);
  assert.equal(w.slot(slotId).slot_status, "CANCELED");
});

test("a superseded variant never dispatches", async () => {
  const w = await world();
  const { slotId, variantId } = await queuedSlot(w);
  await createVariant(w.deps, { creativeProjectId: "proj-1", destinationId: "dest-1", platform: "mock", caption: "New copy.", mediaStorageKey: "renders/proj-1-v2.mp4", supersedesId: variantId }, AUTHOR);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "SUPERSEDED");
  assert.equal(w.mock.createCalls.length, 0);
});

test("an unapproved variant never queues", async () => {
  const w = await world();
  const variantId = await createVariant(w.deps, { creativeProjectId: "proj-1", destinationId: "dest-1", platform: "mock", caption: "Draft.", mediaStorageKey: "renders/a.mp4" }, AUTHOR);
  const queued = await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(-1) }, AUTHOR);
  assert.equal(queued.ok, false);
  assert.equal(w.db.rows("SELECT count(*) AS n FROM post_slots")[0].n, 0);
});

test("a variant with no rendered asset is never approved or queued", async () => {
  const w = await world();
  const { variantId, approval } = await approvedVariant(w, { mediaStorageKey: "" });
  assert.equal(approval.ok, false);
  assert.equal((await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(-1) }, AUTHOR)).ok, false);
});

test("a variant that fails platform validation never queues", async () => {
  const w = await world();
  const { variantId, approval } = await approvedVariant(w, { caption: "x".repeat(281) });
  assert.equal(approval.ok, false);
  assert.match(approval.errors.join(" "), /280/);
  assert.equal((await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(-1) }, AUTHOR)).ok, false);
  assert.equal(w.mock.createCalls.length, 0);
});

test("slots are stored in UTC and display correctly across a daylight-saving change", async () => {
  const w = await world();
  const { variantId } = await approvedVariant(w);
  const queued = await queueSlot(w.deps, { variantId, scheduledAtUtc: "2026-11-01T08:30:00-08:00", timezone: "America/Los_Angeles" }, AUTHOR);
  assert.equal(w.slot(queued.slotId).scheduled_at_utc, "2026-11-01T16:30:00.000Z");
  assert.match(localDisplay("2026-10-31T15:30:00.000Z", "America/Los_Angeles"), /8:30/);
  assert.match(localDisplay("2026-11-01T16:30:00.000Z", "America/Los_Angeles"), /8:30/);
});

test("an immediate slot publishes now and a future slot waits for its time", async () => {
  const w = await world();
  const now = await queuedSlot(w, { offsetSeconds: 0 });
  const later = await queuedSlot(w, { offsetSeconds: 3600 });
  await runPostingTick(w.deps);
  assert.equal(w.slot(now.slotId).slot_status, "PUBLISHED");
  assert.equal(w.slot(later.slotId).slot_status, "QUEUED");
  w.advance(3601);
  await runPostingTick(w.deps);
  assert.equal(w.slot(later.slotId).slot_status, "PUBLISHED");
});

test("1,000 queued slots dispatch once each, in scheduled order", async () => {
  const w = await world();
  const expected = [];
  for (let index = 0; index < 1000; index += 1) {
    const offset = -((index * 7919) % 1000) - 1;
    const { variantId } = await approvedVariant(w, { creativeProjectId: `proj-${index}`, caption: `Post ${index}.` });
    const queued = await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(offset) }, AUTHOR);
    expected.push({ id: queued.slotId, at: w.at(offset) });
  }
  expected.sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
  const summary = await runPostingTick(w.deps);
  assert.equal(summary.dispatched.length, 1000);
  assert.deepEqual(summary.dispatched.map((result) => result.slotId), expected.map((slot) => slot.id));
  assert.equal(w.mock.posts.length, 1000);
  assert.equal(new Set(w.mock.createCalls.map((call) => call.clientRef)).size, 1000);
  assert.equal((await runPostingTick(w.deps)).dispatched.length, 0);
});

// ---- Outcomes ----

test("processing resolves to published on a later reconcile", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "processing", readyAfterChecks: 1 });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PROCESSING");
  await reconcile(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PROCESSING");
  await reconcile(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.equal(w.mock.createCalls.length, 1);
});

test("an uncertain send that did reach the platform is found, not re-sent", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "accept_then_throw" });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.equal(w.mock.createCalls.length, 1);
  assert.equal(w.mock.posts.length, 1);
  assert.ok(w.attempts(slotId)[0].platform_post_id);
});

test("an uncertain send found by content match when the platform has no client reference", async () => {
  const w = await world();
  w.mock.supportsClientRef = false;
  w.mock.enqueue({ kind: "accept_then_throw" });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.equal(w.mock.createCalls.length, 1);
  assert.ok(w.mock.lookupCalls.some((call) => call.startsWith("candidates:")));
});

test("an uncertain send the platform confirms never happened is retried once", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "throw_without_post" }, { kind: "publish" });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN", "a worker could still be sending, so 'no such post' is not trusted yet");
  w.advance(300 + 900 + 1);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.equal(w.mock.posts.length, 1);
  assert.ok(w.auditActions(slotId).includes("reconcile_confirmed_no_post"));
});

test("an uncertain send that stays unknown is never re-sent", async () => {
  const w = await world();
  w.mock.lookupsDefinitive = false;
  w.mock.enqueue({ kind: "throw_without_post" });
  const { slotId } = await queuedSlot(w);
  for (let pass = 0; pass < 5; pass += 1) {
    await runPostingTick(w.deps);
    w.advance(3600);
  }
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
  assert.equal(w.mock.createCalls.length, 1);
});

test("a rate limit waits for the platform's retry window and backoff is capped", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "fail", code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 5000 }, { kind: "publish" });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  const limited = w.slot(slotId);
  assert.equal(limited.slot_status, "RATE_LIMITED");
  assert.equal(limited.next_retry_at, w.at(600), "capped at retryCapSeconds");
  w.advance(599);
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls.length, 1);
  w.advance(2);
  await runPostingTick(w.deps);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.ok(w.auditActions(slotId).includes("resumed_after_rate_limit"));
});

test("an auth failure pauses the slot and it resumes after the connection is healthy", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "fail", code: "AUTH_REQUIRED", retryable: false });
  const first = await queuedSlot(w);
  const second = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(first.slotId).slot_status, "AUTH_REQUIRED");
  assert.equal(w.slot(second.slotId).slot_status, "AUTH_REQUIRED", "the next slot is held without a send");
  assert.equal(w.mock.createCalls.length, 1);
  assert.equal(w.db.rows("SELECT health_state FROM social_connections WHERE id = 'conn-1'")[0].health_state, "AUTH_REQUIRED");
  w.db.db.exec("UPDATE social_connections SET health_state = 'GREEN' WHERE id = 'conn-1'");
  await runPostingTick(w.deps);
  assert.equal(w.slot(first.slotId).slot_status, "PUBLISHED");
  assert.equal(w.slot(second.slotId).slot_status, "PUBLISHED");
});

test("media that turns invalid after approval is rejected before any network call", async () => {
  const w = await world();
  const { slotId, variantId } = await queuedSlot(w);
  // Simulate the platform tightening a rule after approval, without changing the approved content.
  w.mock.validateContent = () => ({ ok: false, errors: ["The media file type is not supported."] });
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "FAILED");
  assert.equal(w.mock.createCalls.length, 0);
  assert.equal(w.attempts(slotId)[0].outcome, "rejected_validation");
  assert.ok(w.auditActions(variantId).includes("send_blocked_validation"));
});

test("two destinations keep separate outcomes when one fails", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "fail", code: "PLATFORM_REJECTED", retryable: false }, { kind: "publish" });
  const failed = await queuedSlot(w, { offsetSeconds: -10 });
  const passed = await queuedSlot(w, { offsetSeconds: -5, fields: { destinationId: "dest-2" } });
  await runPostingTick(w.deps);
  assert.equal(w.slot(failed.slotId).slot_status, "FAILED");
  assert.equal(w.slot(passed.slotId).slot_status, "PUBLISHED");
  assert.equal(w.attempts(failed.slotId)[0].error_code, "PLATFORM_REJECTED");
});

test("retries stop at the attempt cap", async () => {
  const w = await world();
  w.mock.enqueue(...Array.from({ length: 5 }, () => ({ kind: "fail", code: "TRANSIENT_PROVIDER", retryable: true })));
  const { slotId } = await queuedSlot(w);
  for (let pass = 0; pass < 8; pass += 1) {
    await runPostingTick(w.deps);
    w.advance(700);
  }
  assert.equal(w.slot(slotId).slot_status, "FAILED");
  assert.equal(w.mock.createCalls.length, 3);
});

// ---- Governance ----

test("editing an approved caption voids approval and blocks the send", async () => {
  const w = await world();
  const { slotId, variantId } = await queuedSlot(w);
  await editVariant(w.deps, variantId, { caption: "Changed after approval." }, AUTHOR);
  assert.equal(w.slot(slotId).slot_status, "DRAFT");
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls.length, 0);
  assert.equal(w.db.rows("SELECT approval_status FROM post_variants WHERE id = ?", variantId)[0].approval_status, "DRAFT");
});

test("a change that bypasses the workflow is caught by the send-time hash check", async () => {
  const w = await world();
  const { slotId, variantId } = await queuedSlot(w);
  w.db.db.prepare("UPDATE post_variants SET caption = 'Tampered copy.' WHERE id = ?").run(variantId);
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls.length, 0);
  assert.equal(w.slot(slotId).slot_status, "DRAFT");
  assert.ok(w.auditActions(slotId).includes("send_blocked_approval_mismatch"));
});

test("a published post traces to the approved revision, approver and time", async () => {
  const w = await world();
  const { slotId, variantId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  const variant = w.db.rows("SELECT * FROM post_variants WHERE id = ?", variantId)[0];
  const events = w.db.rows("SELECT action, metadata FROM posting_audit_events WHERE slot_id = ? ORDER BY id", slotId);
  const started = JSON.parse(events.find((event) => event.action === "send_started").metadata);
  const published = JSON.parse(events.find((event) => event.action === "published").metadata);
  assert.equal(started.revisionHash, variant.approved_revision_hash);
  assert.equal(started.approvedBy, APPROVER);
  assert.equal(started.approvedAt, variant.approved_at);
  assert.equal(published.revisionHash, variant.approved_revision_hash);
  assert.equal(published.platformPostId, w.attempts(slotId)[0].platform_post_id);
  assert.match(w.slot(slotId).idempotency_key, new RegExp(`${variant.approved_revision_hash}$`));
});

test("a success response with no post id is not recorded as published", async () => {
  const w = await world();
  w.mock.lookupsDefinitive = false;
  w.mock.enqueue({ kind: "success_without_id" });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
});

test("the delivery record stores no credentials", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  const raw = w.attempts(slotId)[0].request_snapshot;
  assert.deepEqual(Object.keys(JSON.parse(raw)), ["revisionHash", "sent"]);
  assert.ok(!raw.includes("SECRET_NAME_ONLY") && !/credential|token/i.test(raw));
});

// ---- Third-party boundary ----

test("no dependency is added beyond the reviewed allowlist", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const allowed = new Set([
    "drizzle-orm", "next", "react", "react-dom",
    "@cloudflare/vite-plugin", "@tailwindcss/postcss", "@types/node", "@types/react", "@types/react-dom",
    "@vitejs/plugin-react", "@vitejs/plugin-rsc", "drizzle-kit", "eslint", "eslint-config-next", "miniflare",
    "react-server-dom-webpack", "tailwindcss", "typescript", "vinext", "vite", "wrangler",
  ]);
  const present = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
  assert.deepEqual(present.filter((name) => !allowed.has(name)), [], "A new dependency needs a boundary review (spec section 29 C2) before it is added here.");
});

// ---- Independent review, 2026-10-13 (defects D1-D4, D8-D10, D13) ----

// Waits until the slow worker has reached the platform call (hashing runs off-thread, so this takes real time).
const settle = async (reached) => { for (let turn = 0; turn < 500 && !reached(); turn += 1) await new Promise((resolve) => setTimeout(resolve, 2)); };

test("a send that outlives its lease is not re-sent by another worker (review D1)", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  const real = w.mock.createPost.bind(w.mock);
  let release;
  w.mock.createPost = async (...args) => { await new Promise((resolve) => { release = resolve; }); return real(...args); };
  const slow = dispatchSlot(w.deps, slotId);
  await settle(() => Boolean(release));
  assert.ok(release, "worker A is inside the platform call");
  w.advance(301);
  const other = { ...w.deps, workerId: "worker-b" };
  await runPostingTick(other);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
  await runPostingTick(other);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN", "'no such post' is not trusted while a worker may still be sending");
  release();
  const result = await slow;
  assert.equal(result.status, "PUBLISHED", "the late worker's answer settles its own attempt");
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.equal(w.mock.posts.length, 1);
  assert.equal(w.mock.createCalls.length, 1);
});

test("a late worker cannot settle a slot that a newer attempt owns", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  const real = w.mock.createPost.bind(w.mock);
  let release;
  w.mock.createPost = async (...args) => { await new Promise((resolve) => { release = resolve; }); return real(...args); };
  const slow = dispatchSlot(w.deps, slotId);
  await settle(() => Boolean(release));
  w.db.db.prepare("UPDATE post_slots SET attempt_id = 'newer-attempt' WHERE id = ?").run(slotId);
  release();
  assert.equal((await slow).status, "LEASE_LOST");
  assert.equal(w.slot(slotId).slot_status, "IN_FLIGHT");
});

test("the send marker is refused once the lease has expired (review D2)", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  let stalled = false;
  const stalling = { ...w.deps, db: { prepare: (sql) => {
    // The worker stalls for longer than its lease right before it would write the marker.
    if (!stalled && sql.includes("SET send_started_at = ?")) { stalled = true; w.advance(301); }
    return w.db.prepare(sql);
  }, batch: (statements) => w.db.batch(statements) } };
  const result = await dispatchSlot(stalling, slotId);
  assert.equal(result.status, "LEASE_LOST");
  assert.equal(w.mock.createCalls.length, 0, "no marker, no send");
  await runPostingTick({ ...w.deps, workerId: "worker-b" });
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.equal(w.mock.posts.length, 1);
});

test("lease expiry reads the marker and moves the slot in one statement (review D2)", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  await claimAndDieMidSend(w, slotId);
  w.advance(301);
  const summary = await reconcile({ ...w.deps, adapters: {} });
  assert.equal(summary.neverSentRequeued, 0);
  assert.equal(summary.expiredLeases, 1);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
});

test("a stale reconcile answer does not move a newer attempt (review D3)", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "throw_without_post" });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  w.advance(1201);
  const real = w.mock.findByClientRef.bind(w.mock);
  w.mock.findByClientRef = async (...args) => {
    // While this lookup is in the air, another pass retries the slot and it lands in UNCERTAIN again.
    w.db.db.prepare("UPDATE post_slots SET attempt_id = 'newer-attempt' WHERE id = ?").run(slotId);
    return real(...args);
  };
  const summary = await reconcile(w.deps);
  assert.equal(summary.retryReady, 0);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
});

test("a replaced post can never send again, and its replacement waits until it is resolved (review D4)", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "throw_without_post" });
  const { variantId, slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
  const next = await approvedVariant(w, { caption: "Come see the 2026 F-150 Lightning.", supersedesId: variantId });
  assert.equal(next.approval.ok, true);
  const blocked = await queueSlot(w.deps, { variantId: next.variantId, scheduledAtUtc: w.at(-1) }, AUTHOR);
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors.join(" "), /still unresolved/);
  w.advance(1201);
  await runPostingTick(w.deps);
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls.length, 1, "the old content is never sent again");
  assert.equal(w.slot(slotId).slot_status, "DRAFT");
  assert.equal((await approveVariant(w.deps, variantId, APPROVER)).ok, false, "a replaced variant cannot be re-approved");
  const queued = await queueSlot(w.deps, { variantId: next.variantId, scheduledAtUtc: w.at(-1) }, AUTHOR);
  assert.equal(queued.ok, true);
  await runPostingTick(w.deps);
  assert.deepEqual(w.mock.posts.map((post) => post.destination), ["dest-1"]);
  assert.equal(w.mock.createCalls.at(-1).caption, "Come see the 2026 F-150 Lightning.");
});

test("a slot is never sent again when an earlier attempt already has a platform post", async () => {
  const w = await world();
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.mock.posts.length, 1);
  w.db.db.prepare("UPDATE post_slots SET slot_status = 'RETRY_READY' WHERE id = ?").run(slotId);
  await runPostingTick(w.deps);
  await runPostingTick(w.deps);
  assert.equal(w.mock.createCalls.length, 1);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.ok(w.auditActions(slotId).includes("send_blocked_earlier_attempt_has_post"));
});

test("a post that never finishes processing goes to a person (review D8)", async () => {
  const w = await world({ uncertainTimeoutSeconds: 3600 });
  w.mock.enqueue({ kind: "processing", readyAfterChecks: 1_000_000 });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PROCESSING");
  w.advance(1800);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PROCESSING");
  w.advance(1801);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "NEEDS_REVIEW");
  assert.ok(canTransition("PROCESSING", "NEEDS_REVIEW"));
  assert.ok(w.auditActions(slotId).includes("processing_timeout_needs_review"));
});

test("a processing post whose record disappears goes to a person, not into a loop (review D8)", async () => {
  const w = await world({ uncertainTimeoutSeconds: 3600 });
  w.mock.enqueue({ kind: "processing", readyAfterChecks: 5 });
  const { slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  w.mock.posts.length = 0;
  w.advance(3601);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "NEEDS_REVIEW");
  assert.equal(w.mock.createCalls.length, 1);
});

test("a held slot resumes when the hold clears, without a GREEN health record (review D9)", async () => {
  const w = await world();
  w.db.db.exec("UPDATE social_connections SET health_state = 'UNVERIFIED' WHERE id = 'conn-1'");
  const { slotId } = await queuedSlot(w);
  w.db.db.exec("UPDATE social_destinations SET status = 'paused' WHERE id = 'dest-1'");
  for (let pass = 0; pass < 5; pass += 1) await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "AUTH_REQUIRED");
  assert.equal(w.slot(slotId).attempt_count, 0, "a hold does not use up the retry budget");
  w.db.db.exec("UPDATE social_destinations SET status = 'active' WHERE id = 'dest-1'");
  await runPostingTick(w.deps);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
});

test("after a platform refusal the slot waits for a person to reconnect, then sends (review D9)", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "fail", code: "PERMISSION_DENIED", retryable: false });
  const { slotId } = await queuedSlot(w);
  for (let pass = 0; pass < 4; pass += 1) await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "AUTH_REQUIRED");
  assert.equal(w.mock.createCalls.length, 1, "the engine does not keep hitting a refused connection");
  await assert.rejects(markConnectionReconnected(w.deps, "conn-1", ""), /named person/);
  assert.equal(await markConnectionReconnected(w.deps, "conn-1", AUTHOR), true);
  await runPostingTick(w.deps);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "PUBLISHED");
  assert.equal(w.mock.posts.length, 1);
});

test("every person action needs a real address (review D10)", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "fail", code: "PLATFORM_REJECTED", retryable: false });
  const { variantId, slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  assert.equal(w.slot(slotId).slot_status, "FAILED");
  for (const actor of ["", " ", "engine"]) {
    await assert.rejects(operatorRetry(w.deps, slotId, actor, "try again"), /named person/);
    await assert.rejects(approveVariant(w.deps, variantId, actor), /named person/);
    await assert.rejects(queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(-1) }, actor), /named person/);
    await assert.rejects(cancelSlot(w.deps, slotId, actor), /named person/);
  }
  assert.equal(w.slot(slotId).slot_status, "FAILED");
});

test("a failed post cannot be re-sent by queueing a new slot around it (review D10)", async () => {
  const w = await world();
  w.mock.enqueue({ kind: "fail", code: "PLATFORM_REJECTED", retryable: false });
  const { variantId, slotId } = await queuedSlot(w);
  await runPostingTick(w.deps);
  const again = await queueSlot(w.deps, { variantId, scheduledAtUtc: w.at(-1) }, AUTHOR);
  assert.equal(again.ok, false);
  assert.equal(again.existingSlotId, slotId);
  assert.equal(w.db.rows("SELECT COUNT(*) AS n FROM post_slots")[0].n, 1);
  assert.equal(await operatorRetry(w.deps, slotId, APPROVER, "Platform outage is over."), true);
});

test("approval reports failure when the variant changed underneath it (review D13)", async () => {
  const w = await world();
  const variantId = await createVariant(w.deps, { creativeProjectId: "proj-1", destinationId: "dest-1", platform: "mock", caption: "First.", mediaStorageKey: "renders/proj-1.mp4" }, AUTHOR);
  let raced = false;
  const racing = { ...w.deps, db: { prepare: (sql) => {
    if (!raced && sql.includes("SET approval_status = 'APPROVED'")) { raced = true; w.db.db.prepare("UPDATE post_variants SET revision_hash = 'changed-by-an-edit' WHERE id = ?").run(variantId); }
    return w.db.prepare(sql);
  }, batch: (statements) => w.db.batch(statements) } };
  const result = await approveVariant(racing, variantId, APPROVER);
  assert.equal(result.ok, false);
  assert.ok(!w.auditActions(variantId).includes("variant_approved"));
});
