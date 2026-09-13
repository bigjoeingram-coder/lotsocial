import assert from "node:assert/strict";
import test from "node:test";
import { handleVdpImportsPost } from "../app/lib/vdp-imports-handler.ts";
import { incrementDailyLimit } from "../app/lib/limits.ts";
import { importHealth, secureEqual, writeImportOutcome } from "../app/lib/telemetry.ts";
import { importedVehicle, SqliteD1, testEnv } from "./harness.mjs";
import { reserveBrightDataBudget } from "../app/lib/vdp.ts";

const associate = { displayName: "Joe Associate", email: "joe@example.com", fullName: "Joe Associate" };

async function runImportScenario({ fallback = "none", budgetSkipped = false, brightDataUsed = false, networkTimedOut = false, failure = false }) {
  const db = new SqliteD1();
  const env = testEnv({ DB: db });
  const outcomes = [];
  const response = await handleVdpImportsPost(new Request("https://lotsocial.test/api/vdp-imports", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl: "https://dealer.example/vdp/1", authorizedToMarket: true }),
  }), env, {
    associate,
    getImportedVehicleBySourceUrl: async () => null,
    extractVehicleFromVdp: async (_url, _env, context) => {
      Object.assign(context.trace, {
        fallback, budgetSkipped, brightDataUsed, networkTimedOut,
        notice: budgetSkipped ? "Paid extraction was skipped." : "",
      });
      if (failure) throw new Error("fixture failed");
      return {};
    },
    saveImportedVehicle: async () => importedVehicle(),
    writeImportOutcome: async (outcome) => { outcomes.push(outcome); },
  });
  db.close();
  assert.equal(outcomes.length, 1);
  return { response, outcome: outcomes[0] };
}

test("each import branch writes exactly one truthful outcome", async () => {
  const cases = [
    [{}, "direct_success"],
    [{ fallback: "bright_data", brightDataUsed: true }, "bright_data_success"],
    [{ fallback: "listing_guess" }, "listing_guess_success"],
    [{ budgetSkipped: true, fallback: "listing_guess" }, "skipped_budget_success"],
    [{ networkTimedOut: true, failure: true }, "network_timeout"],
    [{ failure: true }, "parse_failure"],
  ];
  for (const [scenario, expected] of cases) {
    const { outcome } = await runImportScenario(scenario);
    assert.equal(outcome.outcome, expected);
  }
});

test("budget-skip notice reaches both success and failure responses", async () => {
  const success = await runImportScenario({ budgetSkipped: true, fallback: "listing_guess" });
  assert.match((await success.response.json()).notice, /skipped/i);
  const failure = await runImportScenario({ budgetSkipped: true, failure: true });
  assert.match((await failure.response.json()).notice, /skipped/i);
});

test("Bright Data caps are enforced independently per associate and globally", async () => {
  const db = new SqliteD1();
  const env = testEnv({ DB: db, LOTSOCIAL_DAILY_BRIGHTDATA_ASSOCIATE_CAP: "1", LOTSOCIAL_DAILY_BRIGHTDATA_GLOBAL_CAP: "2" });
  assert.equal((await incrementDailyLimit(env, "brightdata_associate", "a@example.com")).allowed, true);
  assert.equal((await incrementDailyLimit(env, "brightdata_associate", "a@example.com")).allowed, false);
  assert.equal((await incrementDailyLimit(env, "brightdata_associate", "b@example.com")).allowed, true);
  assert.equal((await incrementDailyLimit(env, "brightdata_global", "all-associates")).allowed, true);
  assert.equal((await incrementDailyLimit(env, "brightdata_global", "all-associates")).allowed, true);
  assert.equal((await incrementDailyLimit(env, "brightdata_global", "all-associates")).allowed, false);
  db.close();
});

test("an associate over cap does not consume the global Bright Data budget", async () => {
  const db = new SqliteD1();
  const env = testEnv({ DB: db, LOTSOCIAL_DAILY_BRIGHTDATA_ASSOCIATE_CAP: "1", LOTSOCIAL_DAILY_BRIGHTDATA_GLOBAL_CAP: "5" });
  assert.equal((await reserveBrightDataBudget(env, "a@example.com")).allowed, true);
  assert.equal((await reserveBrightDataBudget(env, "a@example.com")).allowed, false);
  const global = db.rows("SELECT count FROM rate_limit_counters WHERE counter_scope = 'brightdata_global'");
  assert.equal(global[0].count, 1);
  db.close();
});

test("seven-day health report aggregates host success and paid usage", async () => {
  const db = new SqliteD1();
  const env = testEnv({ DB: db });
  await writeImportOutcome({ associateEmail: "a@example.com", sourceHost: "dealer.example", outcome: "direct_success", elapsedMs: 10, fallback: "none", brightDataUsed: false }, env);
  await writeImportOutcome({ associateEmail: "a@example.com", sourceHost: "dealer.example", outcome: "bright_data_success", elapsedMs: 20, fallback: "bright_data", brightDataUsed: true }, env);
  await writeImportOutcome({ associateEmail: "a@example.com", sourceHost: "dealer.example", outcome: "parse_failure", elapsedMs: 30, fallback: "none", brightDataUsed: false }, env);
  const health = await importHealth(env);
  assert.deepEqual(health, [{ host: "dealer.example", attempts: 3, successes: 2, successRate: 2 / 3, brightDataUses: 1 }]);
  assert.equal(secureEqual("pilot-key", "pilot-key"), true);
  assert.equal(secureEqual("pilot-key", "wrong-key"), false);
  db.close();
});
