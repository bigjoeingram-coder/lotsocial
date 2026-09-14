import assert from "node:assert/strict";
import test from "node:test";
import { handleVdpImportsPost } from "../app/lib/vdp-imports-handler.ts";
import { handleImportHealth, recordImportOutcome, reserveBrightDataBudget } from "../app/lib/telemetry.ts";
import { resetSchemaBootstrapForTests } from "../app/lib/schema-bootstrap.ts";
import { SqliteD1, importedVehicle, jsonRequest, signedInUser, testEnv } from "./harness.mjs";

function extracted() {
  return {
    sourceUrl: "https://dealer.example/vdp/1", sourceHost: "dealer.example", title: "2026 Test Vehicle",
    vin: "1HGBH41JXMN109186", stockNumber: "A1", year: "2026", make: "Test", model: "Vehicle", trim: "",
    price: "45000", currency: "USD", description: "", imageUrls: [], facts: {},
  };
}

async function runImport(meta, { fail = false } = {}) {
  resetSchemaBootstrapForTests();
  const DB = new SqliteD1();
  const env = testEnv({ DB });
  const request = jsonRequest("https://app.example/api/vdp-imports", "POST", {
    sourceUrl: "https://dealer.example/vdp/1", authorizedToMarket: true,
  });
  const response = await handleVdpImportsPost(request, env, {
    associate: signedInUser,
    getImportedVehicleBySourceUrl: async () => null,
    extractVehicleFromVdp: async (_url, _env, context) => {
      context?.report?.(meta);
      if (fail) throw Object.assign(new Error(meta.outcome === "network_timeout" ? "Timed out" : "Could not parse"), { name: meta.outcome === "network_timeout" ? "AbortError" : "Error" });
      return extracted();
    },
    saveImportedVehicle: async () => importedVehicle(),
    serializeVehicle: (row) => row,
  });
  const outcomes = DB.rows("SELECT outcome, fallback, bright_data_used FROM import_outcomes ORDER BY created_at");
  return { DB, response, payload: await response.json(), outcomes };
}

for (const [label, meta, expectedStatus] of [
  ["direct success", { outcome: "direct_success", fallback: "none", brightDataUsed: false }, 201],
  ["Bright Data success", { outcome: "brightdata_success", fallback: "brightdata", brightDataUsed: true }, 201],
  ["listing guess success", { outcome: "listing_guess_success", fallback: "listing_guess", brightDataUsed: true }, 201],
]) {
  test(`${label} records exactly one outcome`, async () => {
    const result = await runImport(meta);
    assert.equal(result.response.status, expectedStatus);
    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0].outcome, meta.outcome);
    assert.equal(Number(result.outcomes[0].bright_data_used), meta.brightDataUsed ? 1 : 0);
    result.DB.close();
  });
}

test("budget skip succeeds on the free path and returns an honest notice", async () => {
  const notice = "Bright Data daily budget reached. LotSocial continued with the free inventory fallback.";
  const result = await runImport({ outcome: "skipped_budget", fallback: "listing_guess", brightDataUsed: false, budgetSkipped: true, notice });
  assert.equal(result.response.status, 201);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].outcome, "skipped_budget");
  assert.equal(result.payload.budgetSkipped, true);
  assert.match(result.payload.notice, /budget reached/i);
  result.DB.close();
});

test("budget skip failure still returns the budget notice and one outcome", async () => {
  const notice = "Bright Data daily budget reached. LotSocial continued with the free inventory fallback.";
  const result = await runImport({ outcome: "skipped_budget", fallback: "listing_guess_failed", brightDataUsed: false, budgetSkipped: true, notice }, { fail: true });
  assert.equal(result.response.status, 422);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].outcome, "skipped_budget");
  assert.equal(result.payload.budgetSkipped, true);
  assert.match(result.payload.notice, /budget reached/i);
  result.DB.close();
});

for (const outcome of ["network_timeout", "parse_failure"]) {
  test(`${outcome} records exactly one failed outcome`, async () => {
    const result = await runImport({ outcome, fallback: "none", brightDataUsed: false }, { fail: true });
    assert.equal(result.response.status, 422);
    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0].outcome, outcome);
    result.DB.close();
  });
}

test("Bright Data associate budgets are isolated", async () => {
  resetSchemaBootstrapForTests();
  const DB = new SqliteD1();
  const env = testEnv({ DB, LOTSOCIAL_DAILY_BRIGHTDATA_ASSOCIATE_CAP: "1", LOTSOCIAL_DAILY_BRIGHTDATA_GLOBAL_CAP: "10" });
  assert.equal((await reserveBrightDataBudget(env, "one@example.com")).allowed, true);
  assert.equal((await reserveBrightDataBudget(env, "one@example.com")).allowed, false);
  assert.equal((await reserveBrightDataBudget(env, "two@example.com")).allowed, true);
  DB.close();
});

test("import health rejects bad keys and groups seven-day host health", async () => {
  resetSchemaBootstrapForTests();
  const DB = new SqliteD1();
  const env = testEnv({ DB, ENFORCEMENT_API_KEY: "secret" });
  await recordImportOutcome(env, { associateEmail: signedInUser.email, sourceHost: "dealer.example", outcome: "direct_success", elapsedMs: 25, fallback: "none", brightDataUsed: false });
  await recordImportOutcome(env, { associateEmail: signedInUser.email, sourceHost: "dealer.example", outcome: "parse_failure", elapsedMs: 30, fallback: "none", brightDataUsed: false });
  const denied = await handleImportHealth(new Request("https://app.example/api/ops/import-health"), env);
  assert.equal(denied.status, 401);
  const allowed = await handleImportHealth(new Request("https://app.example/api/ops/import-health", { headers: { "x-enforcement-api-key": "secret" } }), env);
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.windowDays, 7);
  assert.deepEqual(body.hosts.map((row) => ({ host: row.sourceHost, attempts: row.attempts, successes: row.successes, successRate: row.successRate })), [
    { host: "dealer.example", attempts: 2, successes: 1, successRate: 0.5 },
  ]);
  DB.close();
});
