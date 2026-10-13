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
import { approveVariant, cancelSlot, createVariant, editVariant, localDisplay, queueSlot } from "../app/lib/posting/workflow.ts";
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

test("an expired lease becomes UNCERTAIN and never returns to QUEUED", async () => {
  const w = await world();
  w.mock.lookupsDefinitive = false;
  const { slotId } = await queuedSlot(w);
  assert.ok(await claimSlot(w.deps, slotId));
  w.advance(301);
  const summary = await runPostingTick(w.deps);
  assert.equal(summary.reconcile.expiredLeases, 1);
  assert.equal(w.slot(slotId).slot_status, "UNCERTAIN");
  assert.equal(w.mock.createCalls.length, 0, "an expired lease is never blindly re-sent");
  assert.equal(canTransition("IN_FLIGHT", "QUEUED"), false);
  assert.ok(!ALLOWED_TRANSITIONS.UNCERTAIN.includes("QUEUED"));
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
  const { variantId } = await approvedVariant(w);
  const expected = [];
  for (let index = 0; index < 1000; index += 1) {
    const offset = -((index * 7919) % 1000) - 1;
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
  assert.deepEqual(Object.keys(JSON.parse(w.attempts(slotId)[0].request_snapshot)), ["revisionHash"]);
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
