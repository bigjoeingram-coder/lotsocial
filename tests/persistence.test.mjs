import assert from "node:assert/strict";
import test from "node:test";
import { ensureLotSocialSchema, resetSchemaBootstrapForTests } from "../app/lib/schema-bootstrap.ts";
import { handleVdpImportDelete } from "../app/lib/vdp-imports-handler.ts";
import { normalizeSourceUrl, saveImportedVehicle } from "../app/lib/vdp.ts";
import { FakeD1, SqliteD1, importedVehicle, jsonRequest, signedInUser } from "./harness.mjs";

function vehicle(sourceUrl) {
  return {
    sourceUrl,
    sourceHost: new URL(sourceUrl).hostname,
    title: "2026 Test Vehicle",
    vin: "1HGBH41JXMN109186",
    stockNumber: "A1",
    year: "2026",
    make: "Test",
    model: "Vehicle",
    trim: "",
    price: "45000",
    currency: "USD",
    description: "",
    imageUrls: [],
    facts: {},
  };
}

test("a failed schema bootstrap is retried on the next request", async () => {
  resetSchemaBootstrapForTests();
  let attempts = 0;
  const db = {
    prepare(sql) {
      return { sql, bind() { return this; }, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
    },
    async batch() {
      attempts += 1;
      if (attempts === 1) throw new Error("transient bootstrap failure");
      return [];
    },
  };

  await assert.rejects(() => ensureLotSocialSchema({ DB: db }), /transient bootstrap failure/);
  await ensureLotSocialSchema({ DB: db });
  assert.equal(attempts, 2);
});

test("inventory deletion rolls back the whole batch when a child delete fails", async () => {
  const db = new FakeD1({
    importedVehicles: [importedVehicle({ id: "veh_joe" })],
    creativeProjects: [{ id: "project_joe", vehicle_id: "veh_joe", associate_email: signedInUser.email }],
    creativeRenderJobs: [{ id: "job_joe", project_id: "project_joe", associate_email: signedInUser.email }],
    failOnSql: "DELETE FROM creative_projects",
  });

  await assert.rejects(() => handleVdpImportDelete(
    jsonRequest("https://app.example/api/vdp-imports/delete", "DELETE", { sourceUrl: "https://dealer.example/vdp/1" }),
    { DB: db },
    { associate: signedInUser },
  ), /Injected batch failure/);

  assert.deepEqual(db.importedVehicles.map((row) => row.id), ["veh_joe"]);
  assert.deepEqual(db.creativeProjects.map((row) => row.id), ["project_joe"]);
  assert.deepEqual(db.creativeRenderJobs.map((row) => row.id), ["job_joe"]);
});

for (const [label, firstUrl, secondUrl] of [
  ["tracking URL then bare URL", "https://Dealer.Example/vdp/1/?utm_source=email&gclid=abc", "https://dealer.example/vdp/1"],
  ["bare URL then tracking URL", "https://dealer.example/vdp/1", "https://dealer.example/vdp/1/?fbclid=abc&utm_campaign=sale"],
]) {
  test(`${label} reuses one canonical persistence row`, async () => {
    resetSchemaBootstrapForTests();
    const db = new SqliteD1();
    try {
      const first = await saveImportedVehicle(signedInUser.email, vehicle(firstUrl), { DB: db });
      const second = await saveImportedVehicle(signedInUser.email, vehicle(secondUrl), { DB: db });
      assert.equal(second.id, first.id);
      assert.equal(normalizeSourceUrl(firstUrl), "https://dealer.example/vdp/1");
      assert.deepEqual(db.rows("SELECT id, source_url FROM imported_vehicles").map((row) => ({ ...row })), [
        { id: first.id, source_url: "https://dealer.example/vdp/1" },
      ]);
    } finally {
      db.close();
    }
  });
}
