import assert from "node:assert/strict";
import test from "node:test";
import { handleVdpImportsGet, handleVdpImportsPost } from "../app/lib/vdp-imports-handler.ts";
import { importedVehicle, json, jsonRequest, signedInUser } from "./harness.mjs";

test("VDP handlers return real Responses under plain node --test", async () => {
  const response = await handleVdpImportsGet(new Request("https://app.example/api/vdp-imports"), {}, {
    getUser: async () => null,
  });

  assert.equal(response instanceof Response, true);
  assert.equal(response.status, 401);
  assert.deepEqual(await json(response), { error: "Associate sign-in is required." });
});

test("VDP import rejects unconfirmed marketing authority before extraction", async () => {
  let extracted = false;
  const response = await handleVdpImportsPost(jsonRequest("https://app.example/api/vdp-imports", "POST", {
    sourceUrl: "https://dealer.example/vdp/1",
    authorizedToMarket: false,
  }), {}, {
    getUser: async () => signedInUser,
    extractVehicleFromVdp: async () => {
      extracted = true;
      throw new Error("should not extract");
    },
  });

  assert.equal(response.status, 400);
  assert.equal(extracted, false);
});

test("VDP import reuses an existing source record before scraping", async () => {
  let extracted = false;
  const existing = importedVehicle({ id: "veh_existing", title: "Existing vehicle" });
  const response = await handleVdpImportsPost(jsonRequest("https://app.example/api/vdp-imports", "POST", {
    sourceUrl: " https://dealer.example/vdp/1 ",
    authorizedToMarket: true,
  }), {}, {
    getUser: async () => signedInUser,
    getImportedVehicleBySourceUrl: async (associateEmail, sourceUrl) => {
      assert.equal(associateEmail, signedInUser.email);
      assert.equal(sourceUrl, "https://dealer.example/vdp/1");
      return existing;
    },
    extractVehicleFromVdp: async () => {
      extracted = true;
      throw new Error("should not extract");
    },
  });

  assert.equal(response.status, 200);
  assert.equal(extracted, false);
  const payload = await json(response);
  assert.equal(payload.reused, true);
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
  }), {}, {
    getUser: async () => signedInUser,
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
  });

  assert.equal(response.status, 201);
  const payload = await json(response);
  assert.equal(payload.vehicle.id, "veh_saved");
  assert.equal(payload.vehicle.title, "New extracted vehicle");
});
