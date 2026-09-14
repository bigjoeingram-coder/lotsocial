import assert from "node:assert/strict";
import test from "node:test";
import { handleVdpImportsGet, handleVdpImportsPost } from "../app/lib/vdp-imports-handler.ts";
import { FakeD1, importedVehicle, json, jsonRequest, signedInUser, testEnv } from "./harness.mjs";

test("VDP handlers return real Responses under plain node --test", async () => {
  const response = await handleVdpImportsGet(new Request("https://app.example/api/vdp-imports"), testEnv(), {
    associate: signedInUser,
    listImportedVehicles: async () => [],
  });

  assert.equal(response instanceof Response, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { vehicles: [] });
});

test("VDP import rejects unconfirmed marketing authority before extraction", async () => {
  let extracted = false;
  const response = await handleVdpImportsPost(jsonRequest("https://app.example/api/vdp-imports", "POST", {
    sourceUrl: "https://dealer.example/vdp/1",
    authorizedToMarket: false,
  }), testEnv(), {
    associate: signedInUser,
    extractVehicleFromVdp: async () => {
      extracted = true;
      throw new Error("should not extract");
    },
  });

  assert.equal(response.status, 400);
  assert.equal(extracted, false);
});

test("a deliberate reimport scrapes again and writes a second immutable evidence record", async () => {
  let extracted = 0;
  let evidenceWrites = 0;
  const existing = importedVehicle({ id: "veh_existing", title: "Existing vehicle" });
  const response = await handleVdpImportsPost(jsonRequest("https://app.example/api/vdp-imports", "POST", {
    sourceUrl: " https://dealer.example/vdp/1 ",
    authorizedToMarket: true,
    purposeNote: "Create a vehicle social post",
  }), testEnv({ DB: new FakeD1() }), {
    associate: signedInUser,
    getImportedVehicleBySourceUrl: async () => existing,
    extractVehicleFromVdp: async () => { extracted += 1; return { sourceUrl: existing.source_url, sourceHost: existing.source_host }; },
    saveImportedVehicle: async () => existing,
    recordImportEvidence: async (input) => { evidenceWrites += 1; assert.equal(input.purposeNote, "Create a vehicle social post"); return { id: `ev_${evidenceWrites}` }; },
  });

  assert.equal(response.status, 201);
  assert.equal(extracted, 1);
  assert.equal(evidenceWrites, 1);
  const payload = await json(response);
  assert.equal(payload.vehicle.id, "veh_existing");
});

test("VDP import scrapes and saves when no existing source record exists", async () => {
  const extractedVehicle = {
    sourceUrl: "https://dealer.example/vdp/2",
    sourceHost: "dealer.example",
    title: "New extracted vehicle",
    vin: "1HGBH41JXMN109186",
    stockNumber: "A2",
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

  const response = await handleVdpImportsPost(jsonRequest("https://app.example/api/vdp-imports", "POST", {
    sourceUrl: "https://dealer.example/vdp/2",
    authorizedToMarket: true,
    purposeNote: "Create a walkaround video",
  }), testEnv({ DB: new FakeD1() }), {
    associate: signedInUser,
    getImportedVehicleBySourceUrl: async () => null,
    extractVehicleFromVdp: async (sourceUrl) => {
      assert.equal(sourceUrl, "https://dealer.example/vdp/2");
      return extractedVehicle;
    },
    saveImportedVehicle: async (associateEmail, vehicle) => {
      assert.equal(associateEmail, signedInUser.email);
      assert.equal(vehicle, extractedVehicle);
      return importedVehicle({ id: "veh_saved", title: vehicle.title, source_url: vehicle.sourceUrl });
    },
    recordImportEvidence: async () => ({ id: "ev_saved", screenshotStatus: "unavailable" }),
  });

  assert.equal(response.status, 201);
  const payload = await json(response);
  assert.equal(payload.vehicle.id, "veh_saved");
  assert.equal(payload.vehicle.title, "New extracted vehicle");
});
