import assert from "node:assert/strict";
import test from "node:test";
import { handleVdpImportDelete } from "../app/lib/vdp-imports-handler.ts";
import { FakeD1, importedVehicle, json, jsonRequest, signedInUser } from "./harness.mjs";

test("inventory deletion removes only the signed-in associate's vehicle, projects, and render jobs", async () => {
  const db = new FakeD1({
    importedVehicles: [
      importedVehicle({ id: "veh_joe", associate_email: "joe@example.com", source_url: "https://dealer.example/vdp/1" }),
      importedVehicle({ id: "veh_other", associate_email: "other@example.com", source_url: "https://dealer.example/vdp/1" }),
    ],
    creativeProjects: [
      { id: "project_joe", vehicle_id: "veh_joe", associate_email: "joe@example.com" },
      { id: "project_other", vehicle_id: "veh_other", associate_email: "other@example.com" },
      { id: "project_cross", vehicle_id: "veh_joe", associate_email: "other@example.com" },
    ],
    creativeRenderJobs: [
      { id: "job_joe", project_id: "project_joe", associate_email: "joe@example.com" },
      { id: "job_other", project_id: "project_other", associate_email: "other@example.com" },
      { id: "job_cross", project_id: "project_joe", associate_email: "other@example.com" },
    ],
  });

  const response = await handleVdpImportDelete(
    jsonRequest("https://app.example/api/vdp-imports/delete", "DELETE", {
      sourceUrl: "https://dealer.example/vdp/1",
    }),
    { DB: db },
    { getUser: async () => signedInUser },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { deleted: true, vehicleId: "veh_joe" });
  assert.deepEqual(db.importedVehicles.map((vehicle) => vehicle.id), ["veh_other"]);
  assert.deepEqual(db.creativeProjects.map((project) => project.id).sort(), ["project_cross", "project_other"]);
  assert.deepEqual(db.creativeRenderJobs.map((job) => job.id).sort(), ["job_cross", "job_other"]);
});

test("inventory deletion returns 404 when the source belongs to another associate", async () => {
  const db = new FakeD1({
    importedVehicles: [
      importedVehicle({ id: "veh_other", associate_email: "other@example.com", source_url: "https://dealer.example/vdp/1" }),
    ],
  });

  const response = await handleVdpImportDelete(
    jsonRequest("https://app.example/api/vdp-imports/delete", "DELETE", {
      sourceUrl: "https://dealer.example/vdp/1",
    }),
    { DB: db },
    { getUser: async () => signedInUser },
  );

  assert.equal(response.status, 404);
  assert.equal((await json(response)).error, "That vehicle is not in your inventory.");
  assert.deepEqual(db.importedVehicles.map((vehicle) => vehicle.id), ["veh_other"]);
});
