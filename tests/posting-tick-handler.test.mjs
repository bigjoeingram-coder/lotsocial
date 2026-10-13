import assert from "node:assert/strict";
import test from "node:test";
import { handlePostingTick, PRODUCTION_ADAPTERS } from "../app/lib/posting-tick-handler.ts";
import { MockAdapter } from "../app/lib/posting/adapters/mock.ts";
import { resetSchemaBootstrapForTests } from "../app/lib/schema-bootstrap.ts";
import { SqliteD1 } from "./harness.mjs";

function request(key) {
  return new Request("https://lotsocial.test/api/ops/posting/tick", { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {} });
}

function env(overrides = {}) {
  resetSchemaBootstrapForTests();
  return { DB: new SqliteD1(), ENFORCEMENT_API_KEY: "test-key", LOTSOCIAL_POSTING_ENABLED: "true", ...overrides };
}

test("the tick route is off unless posting is switched on", async () => {
  const response = await handlePostingTick(request("test-key"), env({ LOTSOCIAL_POSTING_ENABLED: undefined }));
  assert.equal(response.status, 503);
});

test("the tick route rejects a missing or wrong key", async () => {
  assert.equal((await handlePostingTick(request(""), env())).status, 401);
  assert.equal((await handlePostingTick(request("wrong"), env())).status, 401);
});

test("no live adapter is registered, so production cannot send", async () => {
  assert.deepEqual(Object.keys(PRODUCTION_ADAPTERS), []);
});

test("an authorized tick runs the engine and reports what it did", async () => {
  const environment = env();
  const mock = new MockAdapter();
  const first = await handlePostingTick(request("test-key"), environment, { mock });
  assert.equal(first.status, 200);
  const db = environment.DB;
  db.db.exec("INSERT INTO social_connections (id, owner_email, platform, health_state) VALUES ('c1', 'joe@example.com', 'mock', 'GREEN')");
  db.db.exec("INSERT INTO social_destinations (id, connection_id, platform, platform_ref) VALUES ('d1', 'c1', 'mock', 'urn:mock:1')");
  const { createVariant, approveVariant, queueSlot } = await import("../app/lib/posting/workflow.ts");
  const { defaultDeps } = await import("../app/lib/posting/engine.ts");
  const deps = defaultDeps(db, { mock });
  const variantId = await createVariant(deps, { creativeProjectId: "p1", destinationId: "d1", platform: "mock", caption: "Hello.", mediaStorageKey: "renders/p1.mp4" }, "joe@example.com");
  await approveVariant(deps, variantId, "manager@example.com");
  await queueSlot(deps, { variantId, scheduledAtUtc: new Date(Date.now() - 1000).toISOString() }, "joe@example.com");
  const body = await (await handlePostingTick(request("test-key"), environment, { mock })).json();
  assert.equal(body.dispatched.length, 1);
  assert.equal(body.dispatched[0].status, "PUBLISHED");
  assert.deepEqual(body.adapters, ["mock"]);
});
